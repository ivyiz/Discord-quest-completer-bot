# Ivyseal DQC Bot - Discord Quest Automation

A Discord bot that automatically completes **Discord Quests** (watch video / play game / stream) to collect Orbs. It works through a control panel posted by `/dqcspawn` and stores member tokens in encrypted form.

> Warning: this bot uses personal account tokens (self-bot). That **violates the Discord Terms of Service** and can get the account banned. Use for learning purposes only, at your own risk.

---

## Features

**Control panel**
- `/dqcspawn` sends a **Components V2** panel (Container + TextDisplay + MediaGallery) with the `banner.png` image.
- Three buttons: **Run Quests**, **View Quest List**, **How to get token**.

**Quest runner**
- Fetches quests from `GET /quests/@me`, dropping already-claimed and expired quests.
- Prioritizes **short video quests** first, then **15-minute game/stream** quests, sorted by duration.
- Auto-enrolls quests (`location: 11`) and handles HTTP 429: waits when `retry_after <= 30s`, skips when longer, up to 3 retries.
- Video quests: `POST /quests/{id}/video-progress` every 8 seconds, adding 8s each call.
- Game/stream quests: `POST /quests/{id}/heartbeat` every 30 seconds, finalized with `terminal: true`.
- Quest that does not advance after 3 attempts is **skipped** (requires real gameplay) and the next quest starts after 2 seconds.
- Safe spacing between quests: **15 seconds** for video / 200-Orb quests, **60 seconds** for 15-minute game quests.
- The bot **does not claim rewards**; users must claim in Discord manually.

**Progress tracking**
- Progress embed is sent to the user's **DM** (survives page reload) and mirrored to the ephemeral reply.
- Visual progress bar `[########....] 80%`, relative completion time via `<t:...:R>`, Orb amount including the Nitro 1.2x rate.
- Final summary embed: quests succeeded / failed / skipped, total Orbs, elapsed time.
- Optional per-run log sent to a configured log channel.

**Account management**
- `/whitelist` opens a private modal for the token, which is **AES-256-GCM encrypted** before being written to `whitelist.json`.
- Legacy plaintext tokens are **re-encrypted automatically** on startup.
- A Discord user can be linked to an account entry through the `addedBy` field.
- Duplicate runs are blocked: one account has at most one active session (`manual` or `auto`).
- Dead tokens (401 / 40001) are detected and the user is told to run `/whitelist` again.

**Automation and operation**
- `/autoschedule` sets a weekly run; the checker runs every 15 minutes and only fires once per day.
- Parallel account processing with `maxConcurrentQuests` (1-5, default 2); each worker starts 5 seconds apart and sleeps 5-15 seconds randomly between accounts.
- Logger mirrors all `console.log/warn/error` to `logs/ivyseal-YYYY-MM-DD.log`, redacting Discord caches and truncating lines over 5000 characters.
- Handles `unhandledRejection`, `uncaughtException`, `client.error` and `shardError` so the bot survives network issues.

---

## Requirements

| Component | Requirement |
| :--- | :--- |
| Node.js | **18 or newer** (uses built-in `fetch`) |
| Library | `discord.js` ^14.27.0 (Components V2) |
| OS | Windows (`.bat` launcher included) or Linux/macOS via `node index.js` |
| Intents | Only `Guilds` and `GuildMessages` - **no** privileged intents needed |

---

## Project structure

| File | Purpose |
| :--- | :--- |
| `index.js` | Main code: slash command registration, panel, modals, buttons, quest flow, auto-schedule, log sending. |
| `quest-engine.js` | Discord API calls (`/quests/@me`, `enroll`, `video-progress`, `heartbeat`), quest type detection, Orb calculation, retry and rate-limit handling. |
| `crypto-util.js` | AES-256-GCM token encryption/decryption, generates and persists `encryptionKey`. |
| `logger.js` | Writes logs to daily files; must be required first inside `index.js`. |
| `config.example.json` | Configuration template, copy to `config.json`. |
| `config.json` | Real configuration (gitignored), also stores `encryptionKey`. |
| `whitelist.json` | Whitelisted accounts (tokens already encrypted). |
| `schedule.json` | Auto-schedule state. |
| `banner.png` | Image used in the panel and progress embeds. |
| `ivyseal_avatar.gif` | Spare asset, currently **unused** by the code. |
| `Start-Ivyseal-Bot.bat` | Quick launcher for Windows. |
| `logs/` | Log directory, created automatically at runtime. |

---

## Setup

### 1. Create the bot on the Discord Developer Portal
1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Open the **Bot** tab, click **Reset Token**, and copy the **Bot Token**.
3. Open **General Information** and copy the **Application ID** (this is `clientId`).
4. Open **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Use External Emojis`, `Read Message History` (required for the log channel).
   - Open the generated URL to invite the bot.

> Shortcut: on startup the console prints an invite link with `permissions=8` (Administrator).

### 2. Install dependencies
```bash
npm install
