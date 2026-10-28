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
```

### 3. Create `config.json`
Copy `config.example.json` and fill it in:
```json
{
  "botToken": "BOT_TOKEN",
  "clientId": "APPLICATION_ID",
  "guildId": "SERVER_ID",
  "logChannelId": "LOG_CHANNEL_ID",
  "maxConcurrentQuests": 2
}
```

| Key | Required | Description |
| :--- | :---: | :--- |
| `botToken` | Yes | Bot token. |
| `clientId` | Yes | Application ID, used to register slash commands. |
| `guildId` | No | When set, commands register to that server (instant). Empty means global registration (takes a few minutes). |
| `logChannelId` | No | Channel that receives progress logs. Can also be set with `/setchannellog`. |
| `maxConcurrentQuests` | No | Number of accounts processed in parallel by auto-schedule, clamped to 1-5, default 2. |
| `encryptionKey` | No | **Generated automatically** on first run (64 hex characters) and written back to `config.json`. |

Environment variables take precedence over the file: `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `LOG_CHANNEL_ID`, `ENCRYPTION_KEY` (64 hex characters) - useful for Railway/Render/Docker.

### 4. Start the bot
```bash
node index.js
# or double-click Start-Ivyseal-Bot.bat
```

---

## Slash commands

| Command | Permission | Description |
| :--- | :--- | :--- |
| `/dqcspawn` | Everyone | Sends the control panel with banner and three buttons. |
| `/quests` | Everyone | Lists quests, per-quest status, and total claimable Orbs (with Nitro amount). |
| `/whitelist` | Administrator (Discord default) | Opens the token modal, validates via `/users/@me`, then stores it encrypted. Re-entering updates the token. |
| `/unwhitelist [user]` | Everyone | Removes an account from the whitelist. Empty `user` removes your own; targeting someone else requires Administrator/Manage Server. Blocked while the account has an active run. |
| `/whitelisted` | Administrator | Lists whitelisted accounts (username + ID), visible only to the caller. |
| `/autoschedule <day> [hour]` | Administrator | Sets a weekly run for the **entire** whitelist. Results go to the channel where the command was used. `day` includes a **Disable schedule** choice; `hour` is 0-23, default 8. |
| `/setchannellog <channel>` | Administrator | Saves `logChannelId` to `config.json` and confirms. |

### Panel buttons
| Button | Behavior |
| :--- | :--- |
| **Run Quests** (Success) | Runs quests for the whitelisted account, replies with an error if the user is not whitelisted or already has an active session. |
| **View Quest List** (Primary) | Reuses the `/quests` logic. |
| **How to get token** (Secondary) | Instructions: F12, Application, Local Storage, `discord.com`, filter `token`, plus a video link and a security warning. |

---

## Quest run flow

1. Resolve the account from `interaction.user.id`, falling back to an entry whose `addedBy` matches the caller.
2. Check `activeSessions` and block concurrent runs, reporting whether the existing session is `auto` or `manual`.
3. Decrypt the token and verify it with `/users/@me`. A dead token asks the user to run `/whitelist` again.
4. Fetch quests, drop `claimed_at` and expired entries, sort videos first and shorter durations first.
5. Enroll when not enrolled (404 or error code `260017` is treated as expired).
6. Run each quest, pushing progress to DM and the ephemeral reply (updates are throttled to about 8 seconds, but always sent at 0%, 100%, and on skip).
7. On finish: summary embed, log channel entry, one extra DM notification, and session release.

---

## Auto-schedule

- A `setInterval` runs every 15 minutes and fires only when the weekday matches, `lastRunDate` is not today, and the current hour is at or past the configured hour.
- Timezone is fixed to **Asia/Ho_Chi_Minh** (`process.env.TZ`).
- The whole whitelist is processed as a queue with at most `maxConcurrentQuests` workers, each started `workerId * 5s` apart.
- Accounts with an existing manual session are skipped and an error status is written to the log channel.
- The summary is posted to the channel stored when the schedule was created, formatted as `username - x/y quests completed (skipped n requiring manual play)`.

---

## Data formats

`whitelist.json`
```json
{
  "DISCORD_USER_ID": {
    "token": "enc:v1:<iv-hex>:<tag-hex>:<cipher-hex>",
    "username": "name#0000",
    "globalName": "Display Name",
    "avatarUrl": "https://cdn.discordapp.com/avatars/...",
    "addedBy": "ADDING_DISCORD_ID",
    "addedAt": "2026-09-24T16:23:26.574Z"
  }
}
```

`schedule.json`
```json
{ "day": 0, "hour": 8, "channelId": "CHANNEL_ID", "lastRunDate": null }
```
`day`: 0 = Sunday through 6 = Saturday; `null` means the schedule is disabled.

---

## Security notes

- A Discord token is equivalent to the account password. Only submit it on a server you host yourself.
- Tokens are AES-256-GCM encrypted, but the **key lives on the same machine** in `config.json`. Encryption protects against casual file inspection, not against someone with full control of the host.
- **Losing or changing `encryptionKey` means every stored token becomes unreadable** (all users must run `/whitelist` again). Back up `config.json` together with `whitelist.json`.
- `whitelist.json`, `schedule.json`, and `logs/` are **not** covered by `.gitignore` (only `config.json` and `node_modules` are). Never commit them or ship them with the source.
- The original zip already contains a `whitelist.json` with 3 real accounts and a `schedule.json` with a real `channelId`. **Delete both files before sharing**, and change passwords or rotate tokens if the archive has been distributed.
- The bot does not claim rewards; users still have to claim Orbs in Discord.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Slash commands missing | Global registration has not propagated | Set `guildId` and restart to register per server. |
| `Token is invalid or expired` | Wrong token, password changed, or `encryptionKey` changed | Run `/whitelist` again with a fresh token. |
| `Cannot decrypt token` | Key differs from the one used to encrypt | Restore the old `encryptionKey` or re-whitelist every account. |
| `already in a quest session` | The same account has an unfinished `auto`/`manual` run | Wait for the current run to finish. |
| Quests keep being skipped | Quest requires real gameplay or a linked game account | Complete it manually in the Discord app. |
| Bot is rate limited | Too many accounts at once | Lower `maxConcurrentQuests` to 1-2 and avoid manual runs during the auto schedule. |
| Log says `registered 4 commands` | Fixed log string in the code | Harmless; 7 commands are actually registered. |
| No DM progress message | User disabled DMs for the server | Check Privacy Settings > Direct Messages. |

---

## Technical notes

- Discord API calls use `v9`, a Chrome User-Agent with `X-Super-Properties` for web requests, and an Electron User-Agent for `/heartbeat`.
- `claimQuestReward` is exported by `quest-engine.js` but **never called** in the current flow.
- Special or event quests may break when Discord changes schemas (`task_config_v2`, `rewards_config`); the engine already falls back across several key spellings.
- The bot needs only two non-privileged intents and does not require Message Content.
