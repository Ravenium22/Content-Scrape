# Discord Twitter Link Scraper Bot

A Discord bot that automatically detects and saves Twitter/X links from specified channels to MongoDB. Features historical message scraping and real-time monitoring.

## 🚀 Features

- **Real-time Twitter link detection** from Discord messages
- **Historical scraping** from any custom start date to present
- **Multiple URL format support**: twitter.com, x.com, t.co short links
- **MongoDB storage** with comprehensive metadata
- **Test mode** for development without database
- **Duplicate prevention** and URL expansion
- **Multi-channel monitoring**
- **Batch processing** with rate limiting

## 📋 Requirements

- **Node.js** 18.0.0 or higher
- **Discord Bot Token** (from Discord Developer Portal)
- **MongoDB** (optional for test mode)

## 🛠️ Installation

1. **Clone and install dependencies:**
```bash
npm install
```

2. **Create `.env` file:**
```bash
cp .env.template .env
```

3. **Configure your `.env` file** (see Configuration section below)

## ⚙️ Configuration

### Required Settings
```bash
# Discord Configuration
DISCORD_TOKEN=your_discord_bot_token_here
GUILD_ID=123456789012345678
CHANNEL_ID_1=123456789012345678
CHANNEL_ID_2=987654321098765432  # Optional second channel
```

### Database Settings
```bash
# For Production (with MongoDB)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/twitterlinks
DATABASE_NAME=twitterlinks
COLLECTION_NAME=links

# For Testing (without MongoDB)
TEST_MODE=true
```

### Historical Scraping Settings
```bash
# Enable historical scraping from a specific date
ENABLE_HISTORICAL_SCRAPING=true
SCRAPE_FROM_DATE=2024-01-01  # or 2024-01-01 12:30:00

# Performance tuning (optional)
BATCH_SIZE=100                    # Messages per batch
DELAY_BETWEEN_BATCHES=1000       # Milliseconds between batches
```

## 🎮 Usage

### Testing Mode (No Database)
```bash
# Set in .env:
TEST_MODE=true

# Run bot
node bot.js
```

### Production Mode (With MongoDB)
```bash
# Set in .env:
TEST_MODE=false
MONGODB_URI=your_mongodb_connection

# Run bot
node bot.js
```

### Historical Scraping
```bash
# Set in .env:
ENABLE_HISTORICAL_SCRAPING=true
SCRAPE_FROM_DATE=2024-01-01

# Bot will scrape all messages from Jan 1, 2024 to today
node bot.js
```

## 📊 Database Schema

Each Twitter link is saved with the following information:

```javascript
{
  url: "https://x.com/user/status/123456",           // Expanded URL
  originalUrl: "https://t.co/abc123",                // Original short URL
  messageId: "1234567890",                           // Discord message ID
  channelId: "9876543210",                           // Discord channel ID  
  channelName: "general",                            // Channel name
  guildId: "1357924680",                             // Discord server ID
  guildName: "My Server",                            // Server name
  authorId: "2468013579",                            // User ID who posted
  authorUsername: "username",                        // Username
  authorDisplayName: "Display Name",                 // Display name
  messageContent: "Check out this tweet!",           // Full message content
  messageTimestamp: "2024-01-01T12:00:00.000Z",    // When message was posted
  foundAt: "2024-01-01T12:01:00.000Z",              // When bot found it
  createdAt: "2024-01-01T12:01:00.000Z"             // Database entry created
}
```

## 🔧 Discord Bot Setup

1. **Go to [Discord Developer Portal](https://discord.com/developers/applications)**
2. **Create New Application** → Give it a name
3. **Go to "Bot" section** → Create bot
4. **Copy the bot token** → Add to `.env` as `DISCORD_TOKEN`
5. **Bot Permissions needed:**
   - Read Messages/View Channels
   - Read Message History
6. **Invite bot to your server** with these permissions

## 📝 Getting Channel and Guild IDs

1. **Enable Developer Mode** in Discord (User Settings → Advanced)
2. **Right-click your server** → Copy Server ID → This is `GUILD_ID`
3. **Right-click the channel** → Copy Channel ID → This is `CHANNEL_ID_1`

## 🧪 Testing

The bot includes comprehensive testing capabilities:

```bash
# Test mode - no database required
TEST_MODE=true node bot.js

# Test with historical scraping
ENABLE_HISTORICAL_SCRAPING=true 
SCRAPE_FROM_DATE=2024-08-01 
node bot.js
```

**Test Mode Output:**
```
🔗 FOUND TWITTER LINK (TEST MODE):
   URL: https://x.com/user/status/123456
   Channel: #general
   Author: username
   Date: 2024-08-07
   📊 Total links found: 1
```

## 🔍 Supported URL Formats

The bot detects these Twitter/X link formats:
- `https://twitter.com/user/status/123456` 
- `https://x.com/user/status/123456`
- `https://twitter.com/username`
- `https://x.com/username` 
- `https://t.co/abc123` (automatically expands)

## 📈 Performance

- **Batch processing** prevents Discord rate limits
- **Configurable delays** between API calls
- **Efficient MongoDB indexing** for fast queries
- **Memory-optimized** for large message histories

## 🛡️ Error Handling

- Graceful handling of missing permissions
- Automatic retry for temporary API failures  
- Comprehensive logging for debugging
- Safe shutdown on process termination

## 🔄 Querying Data

The bot includes utility functions for data analysis:

```javascript
const { TwitterLinkQuery } = require('./bot.js');

// Initialize query helper
const query = new TwitterLinkQuery(collection);

// Get links by user
await query.getLinksByUser('userId', 10);

// Get links by channel  
await query.getLinksByChannel('channelId', 10);

// Get links in date range
await query.getLinksByDateRange(startDate, endDate);

// Get top posters
await query.getTopPosters(10);

// Search links
await query.searchLinks('keyword', 10);

// Get scraping statistics
await query.getScrapingStats();
```

## 📋 Example Output

```bash
🤖 Bot is ready! Logged in as TwitterBot#1234
🎯 Monitoring guild: 123456789012345678
📺 Monitoring channels: 1403095225353633883
📋 Configuration check:
   ENABLE_HISTORICAL_SCRAPING: true
   SCRAPE_FROM_DATE: 2024-01-01
   BATCH_SIZE: 100
   DELAY_BETWEEN_BATCHES: 1000ms

📚 Starting historical scraping from 2024-01-01T00:00:00.000Z
🔍 Scraping channel: #general
   📦 Fetched 100 messages from #general
   📊 Processed 100 messages in date range
✅ Completed scraping #general: 1,234 messages, 67 Twitter links

🎉 Historical scraping completed!
   📊 Total messages scanned: 1,234
   🔗 Total Twitter links found: 67
   👀 Now monitoring for new messages...
```

## 🚨 Troubleshooting

**Bot not finding messages:**
- Check `GUILD_ID` and `CHANNEL_ID_1` are correct
- Verify bot has "Read Message History" permission

**MongoDB connection failed:**
- Check `MONGODB_URI` format and credentials
- Try `TEST_MODE=true` for testing without database

**Rate limiting issues:**
- Increase `DELAY_BETWEEN_BATCHES` (default: 1000ms)
- Decrease `BATCH_SIZE` (default: 100)

**No historical links found:**
- Verify `SCRAPE_FROM_DATE` format (YYYY-MM-DD)
- Check if messages exist in the date range

## 📄 License

MIT License - feel free to modify and distribute.

## 🤝 Contributing

Issues and pull requests welcome! Please test with `TEST_MODE=true` before submitting.

---

**Need help?** Check the logs for detailed error messages and status updates.