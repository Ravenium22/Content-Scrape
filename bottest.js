const { Client, GatewayIntentBits } = require('discord.js');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// Load environment variables from .env file
require('dotenv').config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'twitterlinks';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'links';
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID_1 = process.env.CHANNEL_ID_1;
const CHANNEL_ID_2 = process.env.CHANNEL_ID_2;
const TEST_MODE = process.env.TEST_MODE === 'true' || !MONGODB_URI;

// Twitter URL regex patterns
const TWITTER_URL_PATTERNS = [
    /https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+\/status\/\d+/gi,
    /https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+/gi,
    /https?:\/\/t\.co\/\w+/gi
];

class TwitterLinkBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });
        this.db = null;
        this.collection = null;
    }

    async connectToMongoDB() {
        if (TEST_MODE) {
            console.log('🧪 TEST MODE: MongoDB connection skipped');
            console.log('   Links will be logged to console instead of saved to database');
            return;
        }

        if (!MONGODB_URI) {
            throw new Error('MONGODB_URI environment variable is required when not in test mode');
        }

        try {
            const mongoClient = new MongoClient(MONGODB_URI);
            await mongoClient.connect();
            this.db = mongoClient.db(DATABASE_NAME);
            this.collection = this.db.collection(COLLECTION_NAME);
            
            // Create index for efficient querying
            await this.collection.createIndex({ url: 1 }, { unique: true });
            await this.collection.createIndex({ createdAt: -1 });
            
            console.log('✅ Connected to MongoDB successfully');
        } catch (error) {
            console.error('❌ MongoDB connection error:', error.message);
            throw error;
        }
    }

    extractTwitterLinks(text) {
        const links = new Set();
        
        TWITTER_URL_PATTERNS.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) {
                matches.forEach(link => {
                    // Clean up the URL
                    const cleanUrl = link.replace(/[.,;!?]+$/, ''); // Remove trailing punctuation
                    links.add(cleanUrl);
                });
            }
        });
        
        return Array.from(links);
    }

    async expandShortUrl(url) {
        try {
            if (url.includes('t.co')) {
                const response = await axios.head(url, {
                    maxRedirects: 5,
                    timeout: 5000
                });
                return response.request.res.responseUrl || url;
            }
            return url;
        } catch (error) {
            console.warn(`Failed to expand URL ${url}:`, error.message);
            return url;
        }
    }

    async saveLinkToDatabase(linkData) {
        if (TEST_MODE) {
            // In test mode, just log the data instead of saving
            console.log('🔗 FOUND TWITTER LINK (TEST MODE):');
            console.log(`   URL: ${linkData.url}`);
            console.log(`   Channel: #${linkData.channelName}`);
            console.log(`   Author: ${linkData.authorUsername}`);
            console.log(`   Message: ${linkData.messageContent.substring(0, 100)}...`);
            console.log('   ─────────────────────────────────────');
            return;
        }

        try {
            const result = await this.collection.updateOne(
                { url: linkData.url },
                {
                    $set: linkData,
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
            );
            
            if (result.upsertedCount > 0) {
                console.log(`💾 New Twitter link saved: ${linkData.url}`);
            } else {
                console.log(`♻️  Twitter link already exists: ${linkData.url}`);
            }
        } catch (error) {
            console.error('❌ Error saving to database:', error.message);
        }
    }

    async processMessage(message) {
        // Skip bot messages
        if (message.author.bot) return;

        // Only process messages from the specified guild (skip if no GUILD_ID in test)
        if (GUILD_ID && (!message.guild || message.guild.id !== GUILD_ID)) {
            return;
        }

        // Only process messages from specified channels (skip filtering if no channels set)
        const allowedChannels = [CHANNEL_ID_1, CHANNEL_ID_2].filter(Boolean);
        if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel.id)) {
            return;
        }

        const twitterLinks = this.extractTwitterLinks(message.content);
        
        if (twitterLinks.length === 0) return;

        console.log(`🐦 Found ${twitterLinks.length} Twitter link(s) in #${message.channel.name} from ${message.author.username}`);

        for (const link of twitterLinks) {
            try {
                // Expand short URLs
                const expandedUrl = await this.expandShortUrl(link);
                
                const linkData = {
                    url: expandedUrl,
                    originalUrl: link,
                    messageId: message.id,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    guildId: message.guild?.id || null,
                    guildName: message.guild?.name || null,
                    authorId: message.author.id,
                    authorUsername: message.author.username,
                    authorDisplayName: message.author.displayName,
                    messageContent: message.content,
                    messageTimestamp: message.createdAt,
                    foundAt: new Date()
                };

                await this.saveLinkToDatabase(linkData);
            } catch (error) {
                console.error(`❌ Error processing link ${link}:`, error.message);
            }
        }
    }

    async setupEventListeners() {
        this.client.once('ready', () => {
            console.log(`🤖 Bot is ready! Logged in as ${this.client.user.tag}`);
            if (TEST_MODE) {
                console.log('🧪 Running in TEST MODE - no database saves');
            }
            if (GUILD_ID) {
                console.log(`🎯 Monitoring guild: ${GUILD_ID}`);
            } else {
                console.log('🌐 Monitoring all guilds (no GUILD_ID set)');
            }
            const channels = [CHANNEL_ID_1, CHANNEL_ID_2].filter(Boolean);
            if (channels.length > 0) {
                console.log(`📺 Monitoring channels: ${channels.join(', ')}`);
            } else {
                console.log('📺 Monitoring all channels (no CHANNEL_IDs set)');
            }
        });

        this.client.on('messageCreate', async (message) => {
            await this.processMessage(message);
        });

        // Handle errors
        this.client.on('error', (error) => {
            console.error('❌ Discord client error:', error.message);
        });

        process.on('unhandledRejection', (error) => {
            console.error('❌ Unhandled promise rejection:', error.message);
        });
    }

    async start() {
        // Check for required Discord token
        if (!DISCORD_TOKEN) {
            console.error('❌ DISCORD_TOKEN environment variable is required');
            console.log('💡 Create a .env file with: DISCORD_TOKEN=your_bot_token');
            process.exit(1);
        }

        try {
            await this.connectToMongoDB();
            await this.setupEventListeners();
            await this.client.login(DISCORD_TOKEN);
        } catch (error) {
            console.error('❌ Failed to start bot:', error.message);
            process.exit(1);
        }
    }

    async stop() {
        console.log('Shutting down bot...');
        await this.client.destroy();
        if (this.db) {
            await this.db.client.close();
        }
    }
}

// Utility functions for querying the database
class TwitterLinkQuery {
    constructor(collection) {
        this.collection = collection;
    }

    async getLinksByUser(authorId, limit = 10) {
        return await this.collection
            .find({ authorId })
            .sort({ foundAt: -1 })
            .limit(limit)
            .toArray();
    }

    async getLinksByChannel(channelId, limit = 10) {
        return await this.collection
            .find({ channelId })
            .sort({ foundAt: -1 })
            .limit(limit)
            .toArray();
    }

    async getLinksByDateRange(startDate, endDate) {
        return await this.collection
            .find({
                foundAt: {
                    $gte: startDate,
                    $lte: endDate
                }
            })
            .sort({ foundAt: -1 })
            .toArray();
    }

    async getTopPosters(limit = 10) {
        return await this.collection.aggregate([
            {
                $group: {
                    _id: '$authorId',
                    username: { $first: '$authorUsername' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: limit }
        ]).toArray();
    }

    async searchLinks(query, limit = 10) {
        return await this.collection
            .find({
                $or: [
                    { url: { $regex: query, $options: 'i' } },
                    { messageContent: { $regex: query, $options: 'i' } }
                ]
            })
            .sort({ foundAt: -1 })
            .limit(limit)
            .toArray();
    }
}

// Initialize and start the bot
if (require.main === module) {
    const bot = new TwitterLinkBot();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        await bot.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await bot.stop();
        process.exit(0);
    });

    bot.start();
}

module.exports = { TwitterLinkBot, TwitterLinkQuery };