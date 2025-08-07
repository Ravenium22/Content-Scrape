const { Client, GatewayIntentBits } = require('discord.js');
const { MongoClient } = require('mongodb');
const axios = require('axios');

require('dotenv').config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'twitterlinks';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'links';
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID_1 = process.env.CHANNEL_ID_1;
const CHANNEL_ID_2 = process.env.CHANNEL_ID_2;
const TEST_MODE = process.env.TEST_MODE === 'true' || !MONGODB_URI;

const SCRAPE_FROM_DATE = process.env.SCRAPE_FROM_DATE; // Format: YYYY-MM-DD or YYYY-MM-DD HH:mm:ss
const ENABLE_HISTORICAL_SCRAPING = process.env.ENABLE_HISTORICAL_SCRAPING === 'true';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100; // Messages to fetch per batch
const DELAY_BETWEEN_BATCHES = parseInt(process.env.DELAY_BETWEEN_BATCHES) || 1000; // ms delay

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
        this.historicalScrapingComplete = false;
        this.scrapingInProgress = false;
        this.testModeLinks = []; // Store links in memory for test mode
    }

    parseScrapingDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Support multiple date formats
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                throw new Error('Invalid date format');
            }
            return date;
        } catch (error) {
            console.error(`❌ Invalid SCRAPE_FROM_DATE format: ${dateString}`);
            console.log('💡 Use format: YYYY-MM-DD or YYYY-MM-DD HH:mm:ss');
            console.log('💡 Examples: 2024-01-01 or 2024-01-01 12:30:00');
            return null;
        }
    }

    async connectToMongoDB() {
        if (TEST_MODE) {
            console.log('🧪 TEST MODE: MongoDB connection skipped');
            console.log('   Links will be logged to console and stored in memory');
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
            await this.collection.createIndex({ messageTimestamp: -1 });
            await this.collection.createIndex({ messageId: 1 }, { unique: true });
            
            console.log('✅ Connected to MongoDB successfully');
        } catch (error) {
            console.error('❌ MongoDB connection error:', error.message);
            throw error;
        }
    }

    extractTwitterLinks(text) {
        const links = new Set();
        
        // Method 1: Find complete URLs first, then decide what to keep
        const allUrlPattern = /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[^\s]+/gi;
        let allMatches = text.match(allUrlPattern);
        
        if (allMatches) {
            allMatches.forEach(link => {
                const cleanUrl = link.replace(/[.,;!?]+$/, ''); 
                
                if (cleanUrl.includes('/status/')) {
                    const statusMatch = cleanUrl.match(/(https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+\/status\/\d+)/);
                    if (statusMatch) {
                        links.add(statusMatch[1]);
                    }
                } else {
                    
                    links.add(cleanUrl);
                }
            });
        }
        
        
        const shortPattern = /https?:\/\/t\.co\/\w+/gi;
        const shortMatches = text.match(shortPattern);
        if (shortMatches) {
            shortMatches.forEach(link => {
                const cleanUrl = link.replace(/[.,;!?]+$/, '');
                links.add(cleanUrl);
            });
        }
        
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
            const existingIndex = this.testModeLinks.findIndex(
                link => link.messageId === linkData.messageId && link.url === linkData.url
            );

            if (existingIndex === -1) {
                this.testModeLinks.push(linkData);
                console.log('🔗 FOUND TWITTER LINK (TEST MODE):');
                console.log(`   URL: ${linkData.url}`);
                console.log(`   Channel: #${linkData.channelName}`);
                console.log(`   Author: ${linkData.authorUsername}`);
                console.log(`   Date: ${linkData.messageTimestamp.toISOString().split('T')[0]}`);
                console.log(`   Message: ${linkData.messageContent.substring(0, 100)}${linkData.messageContent.length > 100 ? '...' : ''}`);
                if (!this.scrapingInProgress) {
                    console.log(`   📊 Total links found: ${this.testModeLinks.length}`);
                }
                console.log('   ─────────────────────────────────────');
            }
            return;
        }

        try {
            const result = await this.collection.updateOne(
                { messageId: linkData.messageId, url: linkData.url },
                {
                    $set: linkData,
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
            );
            
            if (result.upsertedCount > 0) {
                console.log(`💾 New Twitter link saved: ${linkData.url.substring(0, 60)}... (${linkData.messageTimestamp.toISOString().split('T')[0]})`);
            } else if (result.modifiedCount > 0) {
                console.log(`♻️  Twitter link updated: ${linkData.url.substring(0, 60)}...`);
            }
        } catch (error) {
            console.error('❌ Error saving to database:', error.message);
        }
    }

    async processMessage(message) {
        if (message.author.bot) return;

        if (GUILD_ID && (!message.guild || message.guild.id !== GUILD_ID)) {
            return;
        }

        const allowedChannels = [CHANNEL_ID_1, CHANNEL_ID_2].filter(Boolean);
        if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel.id)) {
            return;
        }

        const twitterLinks = this.extractTwitterLinks(message.content);
        
        if (twitterLinks.length === 0) return;

        if (!this.scrapingInProgress) {
            console.log(`🐦 Found ${twitterLinks.length} Twitter link(s) in #${message.channel.name} from ${message.author.username}`);
        }

        for (const link of twitterLinks) {
            try {
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
                    authorDisplayName: message.author.displayName || message.author.username,
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

    async scrapeHistoricalMessages() {
        if (!ENABLE_HISTORICAL_SCRAPING) {
            console.log('📖 Historical scraping disabled');
            return;
        }

        const fromDate = this.parseScrapingDate(SCRAPE_FROM_DATE);
        if (!fromDate) {
            console.log('⚠️  Invalid or missing SCRAPE_FROM_DATE, skipping historical scraping');
            return;
        }

        console.log(`📚 Starting historical scraping from ${fromDate.toISOString()}`);
        console.log(`📅 Scraping date range: ${fromDate.toDateString()} to ${new Date().toDateString()}`);
        this.scrapingInProgress = true;

        const allowedChannels = [CHANNEL_ID_1, CHANNEL_ID_2].filter(Boolean);
        if (allowedChannels.length === 0) {
            console.log('⚠️  No channels configured for scraping');
            this.scrapingInProgress = false;
            return;
        }

        console.log(`🎯 Will scrape these channels: ${allowedChannels.join(', ')}`);

        let totalLinksFound = 0;
        let totalMessagesScanned = 0;

        for (const channelId of allowedChannels) {
            try {
                const channel = await this.client.channels.fetch(channelId);
                if (!channel || !channel.messages) {
                    console.log(`⚠️  Cannot access channel ${channelId}`);
                    continue;
                }

                console.log(`🔍 Scraping channel: #${channel.name}`);
                let lastMessageId = null;
                let channelLinksFound = 0;
                let channelMessagesScanned = 0;
                let hasMoreMessages = true;

                while (hasMoreMessages) {
                    try {
                        const options = { 
                            limit: BATCH_SIZE,
                            before: lastMessageId 
                        };

                        const messages = await channel.messages.fetch(options);
                        
                        if (messages.size === 0) {
                            console.log(`   📭 No more messages found in #${channel.name}`);
                            hasMoreMessages = false;
                            break;
                        }

                        console.log(`   📦 Fetched ${messages.size} messages from #${channel.name}`);
                        let messagesInDateRange = 0;
                        
                        for (const message of messages.values()) {
                            if (message.createdAt < fromDate) {
                                console.log(`   ⏰ Reached message older than ${fromDate.toDateString()}, stopping`);
                                hasMoreMessages = false;
                                break;
                            }

                            messagesInDateRange++;
                            channelMessagesScanned++;
                            totalMessagesScanned++;

                            const linksBeforeProcessing = totalLinksFound;
                            await this.processMessage(message);
                            
                            // Count new links found (approximate)
                            const twitterLinks = this.extractTwitterLinks(message.content);
                            if (twitterLinks.length > 0) {
                                channelLinksFound += twitterLinks.length;
                                totalLinksFound += twitterLinks.length;
                            }

                            lastMessageId = message.id;
                        }

                        console.log(`   📊 Processed ${messagesInDateRange} messages in date range`);

                        if (messagesInDateRange === 0) {
                            hasMoreMessages = false;
                        }

                        // Progress update
                        if (channelMessagesScanned % (BATCH_SIZE * 5) === 0) {
                            console.log(`   📊 Progress: ${channelMessagesScanned} messages scanned, ${channelLinksFound} links found in #${channel.name}`);
                        }

                        // Rate limiting
                        if (DELAY_BETWEEN_BATCHES > 0) {
                            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
                        }

                    } catch (error) {
                        if (error.code === 50001) {
                            console.log(`⚠️  Missing access to channel #${channel.name}`);
                            break;
                        }
                        console.error(`❌ Error fetching messages from #${channel.name}:`, error.message);
                        break;
                    }
                }

                console.log(`✅ Completed scraping #${channel.name}: ${channelMessagesScanned} messages, ${channelLinksFound} Twitter links`);

            } catch (error) {
                console.error(`❌ Error scraping channel ${channelId}:`, error.message);
            }
        }

        this.scrapingInProgress = false;
        this.historicalScrapingComplete = true;
        
        console.log(`🎉 Historical scraping completed!`);
        console.log(`   📊 Total messages scanned: ${totalMessagesScanned}`);
        console.log(`   🔗 Total Twitter links found: ${totalLinksFound}`);
        if (TEST_MODE) {
            console.log(`   💾 Links stored in memory: ${this.testModeLinks.length}`);
        }
        console.log(`   👀 Now monitoring for new messages...`);
    }

    // Test mode helper to show summary
    showTestSummary() {
        if (!TEST_MODE) return;
        
        console.log(`\n📋 TEST MODE SUMMARY:`);
        console.log(`   Total links found: ${this.testModeLinks.length}`);
        
        if (this.testModeLinks.length > 0) {
            const channels = [...new Set(this.testModeLinks.map(link => link.channelName))];
            const authors = [...new Set(this.testModeLinks.map(link => link.authorUsername))];
            
            console.log(`   Channels: ${channels.join(', ')}`);
            console.log(`   Users: ${authors.join(', ')}`);
            
            const oldestLink = this.testModeLinks.reduce((oldest, current) => 
                current.messageTimestamp < oldest.messageTimestamp ? current : oldest
            );
            const newestLink = this.testModeLinks.reduce((newest, current) => 
                current.messageTimestamp > newest.messageTimestamp ? current : newest
            );
            
            console.log(`   Date range: ${oldestLink.messageTimestamp.toISOString().split('T')[0]} to ${newestLink.messageTimestamp.toISOString().split('T')[0]}`);
        }
        console.log(`   ═══════════════════════════════════════\n`);
    }

    async setupEventListeners() {
        this.client.once('ready', async () => {
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

            console.log(`📋 Configuration check:`);
            console.log(`   ENABLE_HISTORICAL_SCRAPING: ${ENABLE_HISTORICAL_SCRAPING}`);
            console.log(`   SCRAPE_FROM_DATE: ${SCRAPE_FROM_DATE || 'not set'}`);
            console.log(`   BATCH_SIZE: ${BATCH_SIZE}`);
            console.log(`   DELAY_BETWEEN_BATCHES: ${DELAY_BETWEEN_BATCHES}ms`);

            // Start historical scraping after bot is ready
            if (ENABLE_HISTORICAL_SCRAPING) {
                console.log('⏳ Starting historical message scraping...');
                await this.scrapeHistoricalMessages();
                
                // Show test summary if in test mode
                if (TEST_MODE) {
                    this.showTestSummary();
                }
            } else {
                console.log('⚡ Historical scraping disabled - only monitoring new messages');
            }
        });

        this.client.on('messageCreate', async (message) => {
            // Only process new messages if historical scraping is complete or disabled
            if (!ENABLE_HISTORICAL_SCRAPING || this.historicalScrapingComplete) {
                await this.processMessage(message);
                
                // Show quick summary for new messages in test mode
                if (TEST_MODE && !this.scrapingInProgress) {
                    setTimeout(() => this.showTestSummary(), 1000);
                }
            }
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
        if (TEST_MODE) {
            this.showTestSummary();
        }
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
                messageTimestamp: {
                    $gte: startDate,
                    $lte: endDate
                }
            })
            .sort({ messageTimestamp: -1 })
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

    async getScrapingStats() {
        const total = await this.collection.countDocuments();
        const oldestLink = await this.collection.findOne({}, { sort: { messageTimestamp: 1 } });
        const newestLink = await this.collection.findOne({}, { sort: { messageTimestamp: -1 } });
        
        return {
            totalLinks: total,
            dateRange: {
                oldest: oldestLink?.messageTimestamp,
                newest: newestLink?.messageTimestamp
            }
        };
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