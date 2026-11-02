# 🤖 Ivyseal DQC — Discord Quest Completer Bot 🚀

> An automated Discord Bot designed to help server members complete Discord Quests automatically and accumulate Orbs for profile decorations and avatar collectibles via the **`/dqcspawn`** slash command dashboard.

---

## 🌟 Key Features

1. **Dashboard & Interactive Control (`/dqcspawn`)**:
   - Summon an interactive dashboard equipped with action buttons: **Complete Quests**, **View Quest List**, and **How to get token**.
2. **Robust Security & Encryption**:
   - User tokens are submitted securely through an ephemeral Discord Modal (never posted in chat channels).
   - Tokens stored locally are encrypted with **AES-256-GCM**.
3. **Real-Time Progress Tracking**:
   - Dynamic progress updates in ephemeral replies and automatic Direct Message (DM) tracking so users do not lose their session when navigating Discord.
4. **Smart Task Handling & Anti-Detection**:
   - Automatically prioritizes quick video quests before game/stream quests.
   - Built-in rate limiting handling and configurable intermissions between quests to mimic human behavior.
5. **Auto-Scheduler (`/autoschedule`)**:
   - Automatically processes all whitelisted accounts on a scheduled weekly day and hour with configurable concurrency queues.
6. **Dedicated Logging Channel (`/setchannellog`)**:
   - Routes detailed progress logs and results to a designated admin channel.

---

## 📂 Project Structure

| File | Description |
| :--- | :--- |
| **`index.js`** | Core bot application handling commands, events, interactions, and session orchestration. |
| **`quest-engine.js`** | Core quest engine executing Discord API calls, heartbeat pulses, video progress, and reward claims. |
| **`crypto-util.js`** | AES-256-GCM encryption/decryption utilities for sensitive tokens. |
| **`logger.js`** | Daily file logger intercepting console output into `logs/`. |
| **`config.example.json`** | Configuration template for bot tokens and IDs. |
| **`Start-Ivyseal-Bot.bat`** | Quick-start launcher script for Windows. |

---

## 🔑 Setup Guide

### 1. Create a Discord Bot
1. Navigate to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and name your application (e.g., `Ivyseal DQC`).
3. Under **Bot**:
   - Click **Reset Token** to copy your **Bot Token**.
4. Under **General Information**:
   - Copy your **Application ID** (`clientId`).
5. Under **OAuth2 > URL Generator**:
   - Select scopes: `bot`, `applications.commands`.
   - Select bot permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Use External Emojis`.
   - Open the generated URL in your browser to invite the bot to your server.

### 2. Configure `config.json`
Create a `config.json` file in the project root (or copy from `config.example.json`):

```json
{
  "botToken": "YOUR_BOT_TOKEN_HERE",
  "clientId": "YOUR_APPLICATION_ID_HERE",
  "guildId": "YOUR_SERVER_ID_FOR_INSTANT_COMMAND_UPDATE",
  "logChannelId": "OPTIONAL_LOG_CHANNEL_ID"
}
```

*(If `guildId` is omitted, commands register globally which may take a few minutes).*

### 3. Install Dependencies & Launch
Run in terminal:
```bash
npm install
node index.js
```
Or double-click **`Start-Ivyseal-Bot.bat`** on Windows.

---

## 🎮 Slash Commands

- **`/dqcspawn`**: Spawns the main quest completer control panel.
- **`/quests`**: Lists uncompleted Discord quests, progress, and available Orbs for your account.
- **`/whitelist`**: Securely adds or updates your account token via a private popup modal.
- **`/unwhitelist [user]`**: Removes an account from the whitelist (users can remove themselves; Admins can remove anyone).
- **`/whitelisted`**: Displays all currently whitelisted accounts (*Administrator only*).
- **`/autoschedule <day> [hour]`**: Schedules recurring weekly quest runs for all whitelisted accounts (*Administrator only*).
- **`/setchannellog <channel>`**: Configures the text channel for quest status and error logs (*Administrator only*).
