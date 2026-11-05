process.env.TZ = "Asia/Ho_Chi_Minh";

require("./logger.js");

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    PermissionFlagsBits,
    Events,
    ActivityType,
    MessageFlags
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const {
    fetchUserQuests,
    fetchUserInfo,
    getQuestOrbs,
    getQuestName,
    executeQuest,
    isQuestExpired,
    detectQuestTask,
    randomDelay,
    getQuestIntermissionDelay,
    UserGatewayConnection
} = require("./quest-engine.js");
const { getUserLang, setUserLang, t } = require("./i18n.js");

const CONFIG_PATH = path.join(__dirname, "config.json");
const WHITELIST_PATH = path.join(__dirname, "whitelist.json");
const SCHEDULE_PATH = path.join(__dirname, "schedule.json");
const BANNER_PATH = path.join(__dirname, "banner.png");

const {
    getOrCreateEncryptionKey,
    encryptToken,
    decryptToken
} = require("./crypto-util.js");

const ENCRYPTION_KEY = getOrCreateEncryptionKey(CONFIG_PATH);

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
catch (_) { config = { botToken: "", clientId: "", guildId: "" }; }
if (process.env.BOT_TOKEN)  config.botToken = process.env.BOT_TOKEN;
if (process.env.CLIENT_ID)  config.clientId  = process.env.CLIENT_ID;
if (process.env.GUILD_ID)   config.guildId   = process.env.GUILD_ID;
if (process.env.LOG_CHANNEL_ID) config.logChannelId = process.env.LOG_CHANNEL_ID;

function saveConfig(data) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
    } catch (_) {}
}

function loadWhitelist() {
    try { return JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf8")); }
    catch (_) { return {}; }
}
function saveWhitelist(data) {
    fs.writeFileSync(WHITELIST_PATH, JSON.stringify(data, null, 2), "utf8");
}
function loadSchedule() {
    try { return JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf8")); }
    catch (_) { return { day: null, hour: 8, channelId: null, lastRunDate: null }; }
}
function saveSchedule(data) {
    fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getDecryptedToken(entry) {
    if (!entry || !entry.token) return "";
    return decryptToken(entry.token, ENCRYPTION_KEY);
}

function migrateExistingTokens() {
    const list = loadWhitelist();
    let updated = false;
    for (const [id, item] of Object.entries(list)) {
        if (item.token && !String(item.token).startsWith("enc:v1:")) {
            item.token = encryptToken(item.token, ENCRYPTION_KEY);
            updated = true;
        }
    }
    if (updated) {
        saveWhitelist(list);
        console.log("[Crypto] Successfully migrated all existing tokens to AES-256-GCM encryption.");
    }
}

async function validateTokenHealth(token) {
    try {
        const userInfo = await fetchUserInfo(token);
        return { ok: true, userInfo };
    } catch (err) {
        const status = err.status || err.code;
        const isDead = status === 401 || status === 40001 || /unauthorized|401/i.test(err.message);
        return { ok: false, dead: isDead, error: err.message };
    }
}

const activeSessions = new Map();
const manualQueue = [];

function getActiveManualCount() {
    let count = 0;
    for (const session of activeSessions.values()) {
        if (session.type === "manual") count++;
    }
    return count;
}

function updateBotPresence() {
    if (!client.user) return;
    const count = activeSessions.size;
    if (count === 0) {
        client.user.setPresence({
            activities: [{
                name: "Ivy Services | Auto Quests",
                type: ActivityType.Streaming,
                url: "https://www.twitch.tv/discord"
            }],
            status: "online"
        });
        return;
    }

    let latestQuestName = "Discord Quest";
    for (const session of activeSessions.values()) {
        if (session.currentQuestName) {
            latestQuestName = session.currentQuestName;
        }
    }

    const name = count > 1 ? `${latestQuestName} (${count} active)` : latestQuestName;
    client.user.setPresence({
        activities: [{
            name,
            type: ActivityType.Playing
        }],
        status: "online"
    });
}

async function notifyTokenDead(userId, username) {
    try {
        const userObj = await client.users.fetch(userId).catch(() => null);
        if (userObj) {
            await userObj.send({
                content: t(userId, "tokenInvalidDm", { username, userId })
            }).catch(() => {});
        }
    } catch (_) {}
}

function processNextInManualQueue() {
    const maxConcurrency = Math.max(1, config.maxManualConcurrentQuests || 3);
    while (manualQueue.length > 0 && getActiveManualCount() < maxConcurrency) {
        const nextTask = manualQueue.shift();
        for (let i = 0; i < manualQueue.length; i++) {
            const item = manualQueue[i];
            try {
                item.interaction.editReply({
                    content: t(item.interaction.user.id, "inQueueDesc", { pos: i + 1 })
                }).catch(() => {});
            } catch (_) {}
        }
        executeManualQuestSession(nextTask).catch(err => {
            console.error("[Manual Queue Task Error]:", err);
        });
    }
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.on("error", (err) => {
    console.warn("[Discord Client Error]:", err.message);
});

client.on("shardError", (err) => {
    console.warn("[Discord Shard Error]:", err.message);
});

process.on("unhandledRejection", (reason) => {
    console.warn("[Unhandled Rejection]:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
    console.error("[Uncaught Exception]:", err.message);
});

function createProgressBar(percent) {
    const total = 12;
    const filled = Math.round((percent / 100) * total);
    return `[${"█".repeat(filled)}${"░".repeat(total - filled)}] ${percent}%`;
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    if (m > 0 && s > 0) return `${m}m ${s}s`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
}

function formatLogDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remS = s % 60;
    if (h > 0) return `${h}h ${m}m ${remS}s`;
    return `${m}m ${remS}s`;
}

async function sendQuestLog({ user, accountName, completedCount = 0, elapsedSeconds = 0, status, isError = false, avatarUrl = null }) {
    if (!config.logChannelId) return;
    try {
        const logChannel = await client.channels.fetch(config.logChannelId).catch(() => null);
        if (!logChannel || !logChannel.isTextBased()) return;

        const title = isError ? "Quest Progress Error" : "Quest Progress Completed";
        const timeStr = formatLogDuration(elapsedSeconds);

        const userId = user?.id || "0";
        const userTag = user?.username || "Unknown";

        const desc = [
            `User: <@${userId}> (\`${userTag}\`)`,
            `Account: **${accountName || "Connecting..."}**`,
            `Quests Completed: **${completedCount}**`,
            `Time Elapsed: \`${timeStr}\``,
            `Status: **${status}**`
        ].join("\n");

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc);

        if (!isError && avatarUrl) {
            embed.setThumbnail(avatarUrl);
        }

        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.warn("[Log Channel] Failed to send log:", err.message);
    }
}

function getOnTimestamp(d = new Date()) {
    return d.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit"
    });
}

let botOnlineTime = getOnTimestamp();

const DAY_NAMES = {
    0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
    4: "Thursday", 5: "Friday", 6: "Saturday"
};

const commands = [
    new SlashCommandBuilder()
        .setName("dqcspawn")
        .setDescription("Summon the Auto Quest Completer dashboard"),
    new SlashCommandBuilder()
        .setName("whitelist")
        .setDescription("Add an account to whitelist (securely enter token via modal)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName("unwhitelist")
        .setDescription("Remove an account from whitelist")
        .addUserOption(opt =>
            opt.setName("user")
                .setDescription("Discord user to remove (leave empty to remove yourself)")
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName("quests")
        .setDescription("View pending Discord quests and obtainable Orbs"),
    new SlashCommandBuilder()
        .setName("whitelisted")
        .setDescription("View whitelisted accounts (Administrator only)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName("autoschedule")
        .setDescription("Schedule weekly auto quest completion for all accounts (Admin only)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName("day")
                .setDescription("Select day of the week to run automatically")
                .setRequired(true)
                .addChoices(
                    { name: "Monday", value: "1" },
                    { name: "Tuesday", value: "2" },
                    { name: "Wednesday", value: "3" },
                    { name: "Thursday", value: "4" },
                    { name: "Friday", value: "5" },
                    { name: "Saturday", value: "6" },
                    { name: "Sunday", value: "0" },
                    { name: "Disable schedule", value: "-1" }
                )
        )
        .addIntegerOption(opt =>
            opt.setName("hour")
                .setDescription("Hour of the day to run (0 - 23, default: 8)")
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(23)
        ),
    new SlashCommandBuilder()
        .setName("setchannellog")
        .setDescription("Set the logging channel for quest progress")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt =>
            opt.setName("channel")
                .setDescription("Text channel to receive quest logs")
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

async function registerCommands(token, clientId, guildId) {
    if (!token || !clientId) return;
    const rest = new REST({ version: "10" }).setToken(token);

    if (guildId) {
        try {
            console.log(`[Bot] Registering commands for Server ${guildId}...`);
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
            console.log(`[Bot] Successfully registered 4 commands for Server: ${guildId}`);
            return;
        } catch (error) {
            console.warn(`[Bot] Failed to register commands for Server ${guildId}: ${error.message}`);
        }
    }
    try {
        console.log("[Bot] Registering global commands...");
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log("[Bot] Successfully registered global commands.");
    } catch (error) {
        console.error("[Bot] Slash Command registration error:", error);
    }
}

async function showUserQuests(interaction, callerId) {
    const whitelist = loadWhitelist();
    let entry = whitelist[callerId];
    let targetUserId = callerId;
    if (!entry) {
        const found = Object.entries(whitelist).find(([id, data]) => data.addedBy === callerId);
        if (found) {
            targetUserId = found[0];
            entry = found[1];
        }
    }

    if (!entry) {
        try {
            await interaction.reply({
                content: t(callerId, "notWhitelisted"),
                flags: 64
            });
        } catch (_) {}
        return;
    }

    try {
        await interaction.deferReply({ flags: 64 });
    } catch (err) {
        if (err.code === 10062 || err.code === 40060) return;
        return;
    }

    const token = getDecryptedToken(entry);
    const username = entry.globalName || entry.username;

    const health = await validateTokenHealth(token);
    if (!health.ok && health.dead) {
        await notifyTokenDead(targetUserId, username);
        try {
            await interaction.editReply({
                content: t(callerId, "tokenInvalidChat")
            });
        } catch (_) {}
        return;
    }

    try {
        const quests = await fetchUserQuests(token);
        if (!quests || quests.length === 0) {
            await interaction.editReply({
                content: t(callerId, "noQuestsFound")
            });
            return;
        }

        const uncompletedQuests = quests.filter(q => {
            if (!q || !q.config) return false;
            if (isQuestExpired(q)) return false;
            const userStatus = q.user_status;
            if (userStatus?.claimed_at || userStatus?.completed_at) return false;
            const task = detectQuestTask(q);
            const curSec = userStatus?.progress?.[task.keyName]?.value || 0;
            const targetSec = task.target || 900;
            if (curSec >= targetSec) return false;
            return true;
        });

        if (uncompletedQuests.length === 0) {
            await interaction.editReply({
                content: t(callerId, "noActiveQuests")
            });
            return;
        }

        let totalAvailableOrbs = 0;
        let totalNitroOrbs = 0;
        const questLines = [];

        for (let i = 0; i < uncompletedQuests.length; i++) {
            const q = uncompletedQuests[i];
            const name = getQuestName(q);
            const task = detectQuestTask(q);
            const orbs = getQuestOrbs(q, false);
            const nitroOrbs = getQuestOrbs(q, true);
            const userStatus = q.user_status;

            const curSec = userStatus?.progress?.[task.keyName]?.value || 0;
            const targetSec = task.target || 900;
            const percent = Math.min(100, Math.floor((curSec / targetSec) * 100));
            const statusStr = percent > 0 ? `In progress (${percent}%)` : "Not started";
            totalAvailableOrbs += orbs;
            totalNitroOrbs += nitroOrbs;

            const typeLabel = task.type === "WATCH_VIDEO" ? "Video" : (task.type === "STREAM" ? "Stream" : "Game");
            questLines.push(`**${i + 1}. ${name}** [${typeLabel}]\n> Status: ${statusStr} • Reward: **${orbs}** Orbs (${nitroOrbs} with Nitro)`);
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${t(callerId, "questListTitle")} — ${username}`)
            .setDescription(
                `• **Total pending quests:** ${uncompletedQuests.length}\n` +
                `• **Total Orbs to earn:** **${totalAvailableOrbs.toLocaleString()}** Orbs (${totalNitroOrbs.toLocaleString()} with Nitro)\n\n` +
                questLines.slice(0, 15).join("\n\n")
            )
            .setTimestamp();

        if (entry.avatarUrl) {
            embed.setThumbnail(entry.avatarUrl);
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error("[Quests] Error loading quests:", err);
        await interaction.editReply({
            content: `Failed to load quests for **${username}**: ${err.message}`
        });
    }
}

function createSpawnPayload(userId = null, isEdit = false) {
    const container = new ContainerBuilder()
        .setAccentColor(0x2b2d31);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            t(userId, "dashboardTitle")
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            t(userId, "dashboardNote")
        )
    );

    const files = [];
    if (fs.existsSync(BANNER_PATH)) {
        if (!isEdit) {
            files.push(new AttachmentBuilder(BANNER_PATH, { name: "banner.png" }));
        }
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL("attachment://banner.png")
            )
        );
    }

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ivyseal_btn_cay_op")
            .setLabel(t(userId, "btnCompleteQuests"))
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("ivyseal_btn_view_quests")
            .setLabel(t(userId, "btnViewQuests"))
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("ivyseal_btn_guide")
            .setLabel(t(userId, "btnHowToGetToken"))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("ivyseal_btn_lang")
            .setLabel(t(userId, "btnLanguage"))
            .setStyle(ButtonStyle.Secondary)
    );

    container.addActionRowComponents(buttons);

    const payload = {
        components: [container],
        flags: MessageFlags.IsComponentsV2
    };
    if (!isEdit && files.length > 0) {
        payload.files = files;
    }
    return payload;
}

const createSpawnEmbed = createSpawnPayload;

function buildStatusEmbed(username, activeQuests, totalTimeSec, currentQuest = null, isPremium = false, finishTimestamp = null, userId = null) {
    let totalOrbsBase = 0;
    let totalOrbsNitro = 0;
    for (const q of activeQuests) {
        totalOrbsBase += getQuestOrbs(q, false);
        totalOrbsNitro += getQuestOrbs(q, true);
    }

    const finalOrbs = isPremium ? totalOrbsNitro : totalOrbsBase;
    const orbDesc = isPremium
        ? `${finalOrbs.toLocaleString()} ${t(userId, "nitroApplied")}`
        : (totalOrbsNitro > totalOrbsBase
            ? `${finalOrbs.toLocaleString()} Orbs (${totalOrbsNitro.toLocaleString()} ${t(userId, "nitroPotential", { nitro: totalOrbsNitro.toLocaleString() })})`
            : `${finalOrbs.toLocaleString()} Orbs`);

    const targetTime = finishTimestamp || (Math.floor(Date.now() / 1000) + totalTimeSec);

    let desc = `• **${t(userId, "accountLabel")} :** ${username}\n` +
               `• **${t(userId, "totalQuestsLabel")} :** ${activeQuests.length}\n` +
               `• **${t(userId, "totalRewardsLabel")} :** ${orbDesc}\n`;

    if (currentQuest) {
        const p = Math.min(100, Math.max(0, currentQuest.percent || 0));
        const bar = createProgressBar(p);
        const statusNote = currentQuest.status === "skipped"
            ? `\n> *${t(userId, "skippedNote")}*`
            : "";

        desc += `\n━━━━━━━━━━━━━━━━━━━━\n` +
                `• **${t(userId, "currentQuestLabel")} [${currentQuest.index + 1}/${currentQuest.total}] :** **${currentQuest.name}**${statusNote}\n` +
                `• **${t(userId, "progressLabel")} :** \`${bar}\`\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n`;
    } else {
        desc += `\n━━━━━━━━━━━━━━━━━━━━\n` +
                `• **Status :** ${t(userId, "initStatus")}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    desc += `• **${t(userId, "estCompletionLabel")} :** <t:${targetTime}:R> (about ${formatTime(totalTimeSec)})\n\n` +
            `• **Notice :** ${t(userId, "waitNotice")}`;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(t(userId, "completedTitle"))
        .setImage("attachment://banner.png")
        .setDescription(desc);

    return embed;
}

async function runQuestsForUser(token, updateFn, onQuestChange = null) {
    let quests;
    let userInfo;
    try {
        [quests, userInfo] = await Promise.all([
            fetchUserQuests(token),
            fetchUserInfo(token).catch(() => null)
        ]);
    } catch (err) {
        const isDead = err.status === 401 || err.code === 40001 || /unauthorized|401/i.test(err.message);
        return { error: `Invalid token: ${err.message}`, isDead };
    }

    if (!quests || quests.length === 0) {
        return { error: "No quests found." };
    }

    const isPremium = !!(userInfo?.premium_type && userInfo.premium_type > 0);

    const activeQuests = quests.filter(q => {
        if (!q || !q.config) return false;
        if (q.user_status?.claimed_at) return false;
        if (isQuestExpired(q)) return false;
        return true;
    });

    activeQuests.sort((a, b) => {
        const taskA = detectQuestTask(a);
        const taskB = detectQuestTask(b);
        const isVideoA = taskA.type === "WATCH_VIDEO" ? 0 : 1;
        const isVideoB = taskB.type === "WATCH_VIDEO" ? 0 : 1;
        if (isVideoA !== isVideoB) return isVideoA - isVideoB;
        return (taskA.target || 900) - (taskB.target || 900);
    });

    if (activeQuests.length === 0) {
        return { error: "No active quests remaining to complete." };
    }

    let totalTimeSec = 0;
    for (let i = 0; i < activeQuests.length; i++) {
        const q = activeQuests[i];
        const task = detectQuestTask(q);
        const curSec = q.user_status?.progress?.[task.keyName]?.value || 0;
        totalTimeSec += Math.max(0, (task.target || 900) - curSec);
        if (i > 0) {
            totalTimeSec += getQuestIntermissionDelay(q).sec;
        }
    }

    if (updateFn) await updateFn({ phase: "status", activeQuests, totalTimeSec, isPremium });

    const results = [];
    let lastQuestWasExecuted = false;
    const gateway = new UserGatewayConnection(token);

    try {
        for (let i = 0; i < activeQuests.length; i++) {
            const q = activeQuests[i];
            const qName = getQuestName(q);
            const task = detectQuestTask(q);

            gateway.updateActivity(qName, task.appId);
            if (onQuestChange) onQuestChange(qName);

            if (i > 0 && lastQuestWasExecuted) {
                const delayInfo = getQuestIntermissionDelay(q);
                console.log(`[Ivyseal DQC] Safe intermission before "${qName}": Resting ${delayInfo.label}...`);
                await new Promise(r => setTimeout(r, delayInfo.ms));
            }

            const result = await executeQuest(token, q, async (progress) => {
                if (updateFn) {
                    await updateFn({
                        phase: "progress",
                        questIndex: i,
                        total: activeQuests.length,
                        progress,
                        isPremium
                    });
                }
            }, gateway);

            lastQuestWasExecuted = result.success && !result.alreadyCompleted;
            results.push(result);
            if (result.skipped) {
                console.log(`[DQC] Quest "${result.questName}": Skipped (${result.error || "Manual gameplay required"})`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.log(`[DQC] Quest "${result.questName}": ${result.success ? "Success" : "Failed"} ${result.error || ""}`);
            }
        }
    } finally {
        gateway.destroy();
    }

    return { results, activeQuests, totalTimeSec, isPremium };
}

async function runAllWhitelistedQuests(channel) {
    const whitelist = loadWhitelist();
    const entries = Object.entries(whitelist);

    if (entries.length === 0) {
        await channel.send("No accounts in whitelist to run auto-schedule.");
        return;
    }

    const concurrency = Math.max(1, Math.min(5, config.maxConcurrentQuests || 2));
    console.log(`[Auto-Schedule] Starting for ${entries.length} accounts (Concurrency: ${concurrency} threads)...`);

    const attachment = fs.existsSync(BANNER_PATH)
        ? new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })
        : null;

    const startEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Auto-Schedule: Quest Completer")
        .setDescription(`Processing **${entries.length}** whitelisted accounts (up to **${concurrency}** running concurrently)...`)
        .setImage(attachment ? "attachment://banner.png" : null)
        .setTimestamp();

    const msgPayload = { embeds: [startEmbed] };
    if (attachment) msgPayload.files = [attachment];
    const msg = await channel.send(msgPayload);

    const queue = [...entries];
    const allResults = [];

    async function processAccount(userId, entry) {
        const username = entry.globalName || entry.username;

        if (activeSessions.has(userId)) {
            const existing = activeSessions.get(userId);
            console.log(`[Auto-Schedule] Skipping ${username} (${userId}) because a session is already active (${existing.type}).`);
            allResults.push({
                username,
                userId,
                error: `An active ${existing.type === "manual" ? "manual" : "other"} session is running; skipped to prevent rate limits.`
            });
            return;
        }

        const token = getDecryptedToken(entry);
        if (!token) {
            allResults.push({ username, userId, error: "Failed to decrypt token." });
            await sendQuestLog({
                user: { id: entry.addedBy || userId, username: entry.username || username },
                accountName: entry.username || username,
                completedCount: 0,
                elapsedSeconds: 0,
                status: "Error (Failed to decrypt token.)",
                isError: true
            });
            return;
        }

        const health = await validateTokenHealth(token);
        if (!health.ok && health.dead) {
            console.warn(`[Auto-Schedule] Token for ${username} has expired or is invalid.`);
            allResults.push({ username, userId, error: "Token expired or invalid (/whitelist required)." });
            await notifyTokenDead(entry.addedBy || userId, username);
            await sendQuestLog({
                user: { id: entry.addedBy || userId, username: entry.username || username },
                accountName: "Connecting...",
                completedCount: 0,
                elapsedSeconds: 0,
                status: "Error (Discord token invalid or changed.)",
                isError: true
            });
            return;
        }

        activeSessions.set(userId, {
            type: "auto",
            username,
            startedAt: Date.now(),
            currentQuestName: null
        });
        updateBotPresence();

        const startAccTime = Date.now();
        try {
            console.log(`[Auto-Schedule] Processing: ${username} (${userId})`);
            const result = await runQuestsForUser(token, null, (questName) => {
                const session = activeSessions.get(userId);
                if (session) {
                    session.currentQuestName = questName;
                    updateBotPresence();
                }
            });
            allResults.push({ username, userId, ...result });

            const elapsedSec = Math.max(1, Math.round((Date.now() - startAccTime) / 1000));
            if (result.error) {
                if (result.isDead) {
                    await notifyTokenDead(entry.addedBy || userId, username);
                }
                await sendQuestLog({
                    user: { id: entry.addedBy || userId, username: entry.username || username },
                    accountName: entry.username || username,
                    completedCount: 0,
                    elapsedSeconds: elapsedSec,
                    status: `Error (${result.error})`,
                    isError: true
                });
            } else {
                const okCount = result.results ? result.results.filter(x => x.success).length : 0;
                await sendQuestLog({
                    user: { id: entry.addedBy || userId, username: entry.username || username },
                    accountName: entry.username || username,
                    completedCount: okCount,
                    elapsedSeconds: elapsedSec,
                    status: "Completed",
                    isError: false,
                    avatarUrl: entry.avatarUrl
                });
            }
        } catch (err) {
            allResults.push({ username, userId, error: err.message });
            const elapsedSec = Math.max(1, Math.round((Date.now() - startAccTime) / 1000));
            await sendQuestLog({
                user: { id: entry.addedBy || userId, username: entry.username || username },
                accountName: entry.username || username,
                completedCount: 0,
                elapsedSeconds: elapsedSec,
                status: `Error (${err.message})`,
                isError: true
            });
        } finally {
            activeSessions.delete(userId);
            updateBotPresence();
        }
    }

    async function worker(workerId) {
        if (workerId > 0) {
            await new Promise(r => setTimeout(r, workerId * 5000));
        }

        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            const [userId, entry] = item;
            await processAccount(userId, entry);
            if (queue.length > 0) {
                await randomDelay(5000, 15000);
            }
        }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, entries.length); w++) {
        workers.push(worker(w));
    }
    await Promise.all(workers);

    const lines = allResults.map(r => {
        if (r.error) return `• **${r.username}** — ${r.error}`;
        const ok = r.results ? r.results.filter(x => x.success).length : 0;
        const total = r.results ? r.results.length : 0;
        const skipped = r.results ? r.results.filter(x => x.skipped || x.requiresPlayer).length : 0;
        const skipText = skipped > 0 ? ` (skipped ${skipped} requiring manual play)` : "";
        return `• **${r.username}** — ${ok}/${total} quests completed${skipText}`;
    });

    const finalEmbed = new EmbedBuilder()
        .setColor(0x23A55A)
        .setTitle("Auto-Schedule: Completed")
        .setDescription(lines.join("\n") || "No results.")
        .setTimestamp();

    await msg.edit({ embeds: [finalEmbed] });
    console.log(`[Auto-Schedule] Finished processing ${entries.length} accounts.`);
}

function startScheduleChecker() {
    setInterval(async () => {
        try {
            const schedule = loadSchedule();
            if (schedule.day === null || schedule.day === undefined || schedule.day < 0 || !schedule.channelId) return;

            const nowVn = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
            const currentDay = nowVn.getDay();
            const todayDate = nowVn.toISOString().split("T")[0];

            const targetHour = (schedule.hour !== undefined && schedule.hour !== null) ? schedule.hour : 8;
            if (currentDay === schedule.day && schedule.lastRunDate !== todayDate && nowVn.getHours() >= targetHour) {
                schedule.lastRunDate = todayDate;
                saveSchedule(schedule);

                console.log(`[Auto-Schedule] It is now ${DAY_NAMES[schedule.day]} (from ${targetHour}:00) — starting auto-run!`);

                const channel = client.channels.cache.get(schedule.channelId);
                if (!channel) {
                    console.warn(`[Auto-Schedule] Channel ${schedule.channelId} not found`);
                    return;
                }
                await runAllWhitelistedQuests(channel);
            }
        } catch (err) {
            console.error("[Auto-Schedule] Error:", err);
        }
    }, 15 * 60 * 1000);
}

client.once(Events.ClientReady, async () => {
    updateBotPresence();

    botOnlineTime = getOnTimestamp();
    console.log(`\n======================================================`);
    console.log(`[Bot] Logged in as: ${client.user.tag} (ID: ${client.user.id})`);
    console.log(`[Bot] Invite link: https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`);
    console.log(`======================================================\n`);

    migrateExistingTokens();

    if (config.botToken && config.clientId) {
        await registerCommands(config.botToken, config.clientId, config.guildId);
    }

    startScheduleChecker();
    console.log("[Scheduler] Automatic schedule checking enabled (every 15 minutes).");

    const schedule = loadSchedule();
    if (schedule.day !== null && schedule.day >= 0) {
        const targetHour = (schedule.hour !== undefined && schedule.hour !== null) ? schedule.hour : 8;
        console.log(`[Scheduler] Active schedule: ${DAY_NAMES[schedule.day]} at ${targetHour}:00 weekly.`);
    }
});

client.on("interactionCreate", async (interaction) => {
    try {

        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === "dqcspawn") {
                const payload = createSpawnPayload(interaction.user.id);
                try {
                    await interaction.reply(payload);
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                    throw err;
                }
                return;
            }

            if (interaction.commandName === "whitelist") {
                const modal = new ModalBuilder()
                    .setCustomId("ivyseal_modal_whitelist")
                    .setTitle("Add Account to Whitelist");

                const tokenInput = new TextInputBuilder()
                    .setCustomId("whitelist_token_input")
                    .setLabel("Discord Token")
                    .setPlaceholder("Paste token here (secure, hidden from others)...")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(tokenInput));
                try {
                    await interaction.showModal(modal);
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                }
                return;
            }

            if (interaction.commandName === "quests") {
                await showUserQuests(interaction, interaction.user.id);
                return;
            }

            if (interaction.commandName === "whitelisted") {
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if (!isAdmin) {
                    try {
                        await interaction.reply({
                            content: "You need Administrator permissions to view the whitelist.",
                            flags: 64
                        });
                    } catch (_) {}
                    return;
                }

                const whitelist = loadWhitelist();
                const entries = Object.entries(whitelist);

                if (entries.length === 0) {
                    try {
                        await interaction.reply({
                            content: "No accounts have been whitelisted yet.",
                            flags: 64
                        });
                    } catch (err) {
                        if (err.code === 10062 || err.code === 40060) return;
                    }
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle("Whitelist Accounts")
                    .setDescription(
                        entries.map(([userId, data], idx) =>
                            `**${idx + 1}.** ${data.username} — \`${userId}\``
                        ).join("\n")
                    )
                    .setTimestamp();

                try {
                    await interaction.reply({ embeds: [embed], flags: 64 });
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                }
                return;
            }

            if (interaction.commandName === "unwhitelist") {
                const targetUser = interaction.options.getUser("user");
                const callerId = interaction.user.id;
                const isAdmin = interaction.memberPermissions?.has("Administrator") || interaction.memberPermissions?.has("ManageGuild");

                const whitelist = loadWhitelist();
                let targetIdToRemove = null;
                let targetEntry = null;

                if (targetUser) {
                    const found = whitelist[targetUser.id];
                    if (!found) {
                        const byAdded = Object.entries(whitelist).find(([_, data]) => data.addedBy === targetUser.id);
                        if (byAdded) {
                            targetIdToRemove = byAdded[0];
                            targetEntry = byAdded[1];
                        }
                    } else {
                        targetIdToRemove = targetUser.id;
                        targetEntry = found;
                    }

                    if (!isAdmin && targetEntry && targetEntry.addedBy !== callerId && targetIdToRemove !== callerId) {
                        await interaction.reply({
                            content: "You do not have permission to remove other users' accounts (Administrator required).",
                            flags: 64
                        });
                        return;
                    }
                } else {
                    if (whitelist[callerId]) {
                        targetIdToRemove = callerId;
                        targetEntry = whitelist[callerId];
                    } else {
                        const byAdded = Object.entries(whitelist).find(([_, data]) => data.addedBy === callerId);
                        if (byAdded) {
                            targetIdToRemove = byAdded[0];
                            targetEntry = byAdded[1];
                        }
                    }
                }

                if (!targetIdToRemove || !targetEntry) {
                    await interaction.reply({
                        content: "No matching account found in whitelist.",
                        flags: 64
                    });
                    return;
                }

                if (activeSessions.has(targetIdToRemove)) {
                    await interaction.reply({
                        content: `Account **${targetEntry.username}** is currently in an active session. Please wait until it completes!`,
                        flags: 64
                    });
                    return;
                }

                delete whitelist[targetIdToRemove];
                saveWhitelist(whitelist);

                console.log(`[Whitelist] Removed: ${targetEntry.username} (${targetIdToRemove}) by ${interaction.user.tag}`);

                const embed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle("Removed from Whitelist")
                    .setDescription(
                        `• **Account:** ${targetEntry.username}\n` +
                        `• **ID:** \`${targetIdToRemove}\`\n` +
                        `• **Executed by:** <@${callerId}>\n\n` +
                        `This account has been removed from the quest completer system.`
                    )
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], flags: 64 });
                return;
            }

            if (interaction.commandName === "autoschedule") {
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if (!isAdmin) {
                    try {
                        await interaction.reply({
                            content: "You need Administrator permissions to configure auto-schedule.",
                            flags: 64
                        });
                    } catch (_) {}
                    return;
                }

                const dayOptStr = interaction.options.getString("day") || interaction.options.getString("ngay");
                const dayValue = parseInt(dayOptStr);

                if (dayValue < 0) {
                    saveSchedule({ day: null, hour: 8, channelId: null, lastRunDate: null });
                    console.log("[Auto-Schedule] Auto-schedule disabled.");
                    try {
                        await interaction.reply({
                            content: "Auto-schedule has been **disabled**.",
                            flags: 64
                        });
                    } catch (err) {
                        if (err.code === 10062 || err.code === 40060) return;
                    }
                    return;
                }

                const hourOpt = interaction.options.getInteger("hour") ?? interaction.options.getInteger("gio");
                const hourValue = (hourOpt !== null && hourOpt !== undefined) ? hourOpt : 8;

                const schedule = loadSchedule();
                schedule.day = dayValue;
                schedule.hour = hourValue;
                schedule.channelId = interaction.channelId;
                schedule.lastRunDate = null;
                saveSchedule(schedule);

                const hourStr = `${String(hourValue).padStart(2, "0")}:00`;
                console.log(`[Auto-Schedule] Scheduled: ${DAY_NAMES[dayValue]} at ${hourStr}, channel: ${interaction.channelId}`);

                const embed = new EmbedBuilder()
                    .setColor(0x23A55A)
                    .setTitle("Auto-Schedule Configured")
                    .setDescription(
                        `The bot will automatically complete quests for **all whitelisted accounts** on:\n\n` +
                        `• **${DAY_NAMES[dayValue]}** weekly (from ~${hourStr})\n` +
                        `• **Channel:** <#${interaction.channelId}>\n\n` +
                        `Results will be posted in this channel.\n` +
                        `Use \`/autoschedule\` → **Disable schedule** to cancel.`
                    )
                    .setTimestamp();

                try {
                    await interaction.reply({ embeds: [embed] });
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                }
                return;
            }

            if (interaction.commandName === "setchannellog") {
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if (!isAdmin) {
                    try {
                        await interaction.reply({
                            content: "You need Administrator permissions to configure the log channel.",
                            flags: 64
                        });
                    } catch (_) {}
                    return;
                }

                const targetChannel = interaction.options.getChannel("channel");
                if (!targetChannel || !targetChannel.isTextBased()) {
                    try {
                        await interaction.reply({
                            content: "Please select a valid text channel.",
                            flags: 64
                        });
                    } catch (_) {}
                    return;
                }

                config.logChannelId = targetChannel.id;
                saveConfig(config);

                console.log(`[Log Channel] Log channel set to: #${targetChannel.name} (${targetChannel.id})`);

                const embed = new EmbedBuilder()
                    .setColor(0x23A55A)
                    .setTitle("Log Channel Configured Successfully")
                    .setDescription(`Quest progress log channel has been set to <#${targetChannel.id}>.`)
                    .setTimestamp();

                try {
                    await interaction.reply({ embeds: [embed], flags: 64 });
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                }
                return;
            }
        }

        if (interaction.isModalSubmit() && interaction.customId === "ivyseal_modal_whitelist") {
            try {
                await interaction.deferReply({ flags: 64 });
            } catch (err) {
                if (err.code === 10062) return;
                return;
            }

            const token = interaction.fields.getTextInputValue("whitelist_token_input");

            try {
                const userInfo = await fetchUserInfo(token);
                const userId = userInfo.id;
                const username = userInfo.global_name || userInfo.username || "Unknown";
                const displayTag = userInfo.discriminator && userInfo.discriminator !== "0"
                    ? `${userInfo.username}#${userInfo.discriminator}`
                    : userInfo.username;

                const whitelist = loadWhitelist();
                const isUpdate = !!whitelist[userId];

                whitelist[userId] = {
                    token: encryptToken(token, ENCRYPTION_KEY),
                    username: displayTag,
                    globalName: username,
                    avatarUrl: userInfo.avatar
                        ? `https://cdn.discordapp.com/avatars/${userId}/${userInfo.avatar}.png`
                        : null,
                    addedBy: interaction.user.id,
                    addedAt: new Date().toISOString()
                };
                saveWhitelist(whitelist);

                console.log(`[Whitelist] ${isUpdate ? "Updated" : "Added"}: ${displayTag} (${userId}) by ${interaction.user.tag}`);

                const embed = new EmbedBuilder()
                    .setColor(0x23A55A)
                    .setTitle(isUpdate ? "Whitelist Updated" : "Added to Whitelist")
                    .setDescription(
                        `• **Account:** ${displayTag}\n` +
                        `• **ID:** \`${userId}\`\n` +
                        `• **Status:** ${isUpdate ? "Token updated successfully" : "Successfully added"}`
                    )
                    .setTimestamp();

                if (userInfo.avatar) {
                    embed.setThumbnail(`https://cdn.discordapp.com/avatars/${userId}/${userInfo.avatar}.png`);
                }

                await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error(`[Whitelist] Token validation error: ${err.message}`);
                await interaction.editReply({
                    content: `Invalid or expired token: ${err.message}`
                });
            }
            return;
        }

async function executeManualQuestSession({ interaction, targetUserId, entry, username, token }) {
    const callerId = interaction.user.id;
    if (activeSessions.has(targetUserId)) {
        try {
            await interaction.editReply({
                content: t(callerId, "sessionAlreadyRunning", { type: activeSessions.get(targetUserId).type })
            });
        } catch (_) {}
        processNextInManualQueue();
        return;
    }

    activeSessions.set(targetUserId, {
        type: "manual",
        username,
        startedAt: Date.now(),
        currentQuestName: null
    });
    updateBotPresence();

    let lastUpdateTime = 0;
    const startTime = Date.now();

    console.log(`[DQC] Starting for: ${username} (${targetUserId})`);

    let dmMessage = null;
    try {
        const initialFiles = fs.existsSync(BANNER_PATH)
            ? [new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })]
            : [];
        const initialEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${t(callerId, "completedTitle")} — Private Session`)
            .setImage("attachment://banner.png")
            .setDescription(`Initializing quest list for account **${username}**...`);
        dmMessage = await interaction.user.send({ embeds: [initialEmbed], files: initialFiles });
        console.log(`[DQC] Opened tracking DM for user: ${interaction.user.tag}`);
    } catch (err) {
        console.warn(`[DQC] Could not send DM to ${interaction.user.tag}: ${err.message}`);
    }

    const updateBoth = async (payload) => {
        try {
            await interaction.editReply(payload);
        } catch (_) {}

        if (dmMessage) {
            try {
                await dmMessage.edit(payload);
            } catch (_) {}
        }
    };

    try {
        let cachedActiveQuests = [];
        let cachedTotalTimeSec = 0;
        let cachedIsPremium = false;
        let cachedFinishTimestamp = null;

        const outcome = await runQuestsForUser(token, async (update) => {
            const now = Date.now();

            if (update.phase === "status") {
                cachedActiveQuests = update.activeQuests;
                cachedTotalTimeSec = update.totalTimeSec;
                cachedIsPremium = update.isPremium;
                cachedFinishTimestamp = Math.floor(now / 1000) + cachedTotalTimeSec;

                const embed = buildStatusEmbed(
                    username,
                    cachedActiveQuests,
                    cachedTotalTimeSec,
                    null,
                    cachedIsPremium,
                    cachedFinishTimestamp,
                    callerId
                );
                const files = fs.existsSync(BANNER_PATH)
                    ? [new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })]
                    : [];
                await updateBoth({ embeds: [embed], files });
            }

            if (update.phase === "progress" && (now - lastUpdateTime > 8000 || update.progress?.percent === 100 || update.progress?.percent === 0 || update.progress?.status === "skipped")) {
                lastUpdateTime = now;
                const embed = buildStatusEmbed(
                    username,
                    cachedActiveQuests,
                    cachedTotalTimeSec,
                    {
                        name: update.progress.questName,
                        index: update.questIndex,
                        total: update.total,
                        percent: update.progress.percent,
                        currentSec: update.progress.currentSec,
                        targetSec: update.progress.targetSec,
                        status: update.progress.status
                    },
                    cachedIsPremium,
                    cachedFinishTimestamp,
                    callerId
                );
                await updateBoth({ embeds: [embed] });
            }
        }, (questName) => {
            const session = activeSessions.get(targetUserId);
            if (session) {
                session.currentQuestName = questName;
                updateBotPresence();
            }
        });

        if (outcome.error) {
            if (outcome.isDead) {
                await notifyTokenDead(targetUserId, username);
            }
            const elapsedSec = Math.max(0, Math.round((Date.now() - startTime) / 1000));
            await updateBoth({ content: outcome.error, embeds: [] });
            await sendQuestLog({
                user: interaction.user,
                accountName: entry.username || username,
                completedCount: 0,
                elapsedSeconds: elapsedSec,
                status: `Error (${outcome.error})`,
                isError: true
            });
        } else {
            const successQuests = outcome.results.filter(r => r.success);
            const skippedQuests = outcome.results.filter(r => r.skipped || r.requiresPlayer);
            const failQuests = outcome.results.filter(r => !r.success && !r.skipped && !r.requiresPlayer && !r.expired);

            let totalOrbsBase = 0;
            let totalOrbsNitro = 0;
            for (const q of cachedActiveQuests) {
                const name = getQuestName(q);
                const isDone = successQuests.some(sq => sq.questName === name);
                if (isDone) {
                    totalOrbsBase += getQuestOrbs(q, false);
                    totalOrbsNitro += getQuestOrbs(q, true);
                }
            }
            const finalOrbs = cachedIsPremium ? totalOrbsNitro : totalOrbsBase;
            const orbDesc = cachedIsPremium
                ? `${finalOrbs.toLocaleString()} ${t(callerId, "nitroApplied")}`
                : `${finalOrbs.toLocaleString()} Orbs`;

            const finishTime = Date.now();
            const elapsedSec = Math.max(1, Math.round((finishTime - startTime) / 1000));
            const elapsedStr = formatTime(elapsedSec);
            const finishUnix = Math.floor(finishTime / 1000);

            let desc = `• **${t(callerId, "accountLabel")} :** ${username}\n` +
                       `• **${t(callerId, "totalRewardsLabel")} :** ${orbDesc}\n` +
                       `• **${t(callerId, "completedTitle")} :** ${successQuests.length}/${outcome.results.length}\n`;

            if (skippedQuests.length > 0) {
                desc += `• **Skipped :** ${skippedQuests.length}\n` +
                        `> *${skippedQuests.map(q => q.questName).join(", ")}*\n`;
            }
            if (failQuests.length > 0) {
                desc += `• **Failed :** ${failQuests.length}\n`;
            }
            desc += `• **${t(callerId, "estCompletionLabel")} :** <t:${finishUnix}:T> (${elapsedStr})\n`;
            desc += `\n• **${t(callerId, "claimNotice")}**`;

            const finalEmbed = new EmbedBuilder()
                .setColor(0x23A55A)
                .setTitle(`${t(callerId, "completedTitle")}`)
                .setImage("attachment://banner.png")
                .setDescription(desc);

            const files = fs.existsSync(BANNER_PATH)
                ? [new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })]
                : [];

            await updateBoth({ embeds: [finalEmbed], files });
            console.log(`[DQC] Finished for ${username}: ${successQuests.length} succeeded, ${failQuests.length} failed, ${skippedQuests.length} skipped. Duration: ${elapsedStr}.`);

            const avatarUrl = interaction.user.displayAvatarURL({ extension: "png", size: 256 }) || entry.avatarUrl;
            await sendQuestLog({
                user: interaction.user,
                accountName: entry.username || username,
                completedCount: successQuests.length,
                elapsedSeconds: elapsedSec,
                status: "Completed",
                isError: false,
                avatarUrl
            });

            if (dmMessage) {
                try {
                    await interaction.user.send({
                        content: t(callerId, "completedSummary", {
                            username,
                            orbs: orbDesc,
                            success: successQuests.length,
                            total: outcome.results.length,
                            finishUnix,
                            elapsed: elapsedStr,
                            notice: t(callerId, "claimNotice")
                        })
                    });
                } catch (_) {}
            }
        }
    } catch (err) {
        const elapsedSec = Math.max(0, Math.round((Date.now() - startTime) / 1000));
        await sendQuestLog({
            user: interaction.user,
            accountName: entry.username || username,
            completedCount: 0,
            elapsedSeconds: elapsedSec,
            status: `Error (${err.message})`,
            isError: true
        });
        console.error(`[DQC] Progress error for ${username}:`, err);
    } finally {
        activeSessions.delete(targetUserId);
        updateBotPresence();
        processNextInManualQueue();
    }
}

        if (interaction.isButton() && interaction.customId === "ivyseal_btn_cay_op") {
            const whitelist = loadWhitelist();
            const callerId = interaction.user.id;

            let entry = whitelist[callerId];
            let targetUserId = callerId;
            if (!entry) {
                const found = Object.entries(whitelist).find(([id, data]) => data.addedBy === callerId);
                if (found) {
                    targetUserId = found[0];
                    entry = found[1];
                }
            }

            if (!entry) {
                try {
                    await interaction.reply({
                        content: t(callerId, "notWhitelisted"),
                        flags: 64
                    });
                } catch (_) {}
                return;
            }

            const currentSession = activeSessions.get(targetUserId);
            if (currentSession) {
                try {
                    await interaction.reply({
                        content: t(callerId, "sessionAlreadyRunning", { type: currentSession.type }),
                        flags: 64
                    });
                } catch (_) {}
                return;
            }

            const inQueueIndex = manualQueue.findIndex(q => q.targetUserId === targetUserId);
            if (inQueueIndex !== -1) {
                try {
                    await interaction.reply({
                        content: t(callerId, "inQueueDesc", { pos: inQueueIndex + 1 }),
                        flags: 64
                    });
                } catch (_) {}
                return;
            }

            try {
                await interaction.deferReply({ flags: 64 });
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
                return;
            }

            const token = getDecryptedToken(entry);
            const username = entry.globalName || entry.username;

            const health = await validateTokenHealth(token);
            if (!health.ok && health.dead) {
                await notifyTokenDead(targetUserId, username);
                await sendQuestLog({
                    user: interaction.user,
                    accountName: "Connecting...",
                    completedCount: 0,
                    elapsedSeconds: 0,
                    status: "Error (Discord token is invalid or changed.)",
                    isError: true
                });
                try {
                    await interaction.editReply({
                        content: t(callerId, "tokenInvalidChat")
                    });
                } catch (_) {}
                return;
            }

            const maxConcurrency = Math.max(1, config.maxManualConcurrentQuests || 3);
            const task = { interaction, targetUserId, entry, username, token };

            if (getActiveManualCount() >= maxConcurrency) {
                manualQueue.push(task);
                try {
                    await interaction.editReply({
                        content: t(callerId, "inQueueDesc", { pos: manualQueue.length })
                    });
                } catch (_) {}
                return;
            }

            await executeManualQuestSession(task);
            return;
        }

        if (interaction.isButton() && interaction.customId === "ivyseal_btn_lang") {
            const currentLang = getUserLang(interaction.user.id);
            const msgId = interaction.message?.id || "";
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ivyseal_set_lang_vi_${msgId}`)
                    .setLabel("🇻🇳 Tiếng Việt")
                    .setStyle(currentLang === "vi" ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`ivyseal_set_lang_en_${msgId}`)
                    .setLabel("🇺🇸 English")
                    .setStyle(currentLang === "en" ? ButtonStyle.Success : ButtonStyle.Secondary)
            );
            await interaction.reply({
                content: t(interaction.user.id, "selectLangPrompt"),
                components: [row],
                flags: 64
            });
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith("ivyseal_set_lang_")) {
            const parts = interaction.customId.split("_");
            const lang = parts[3];
            const msgId = parts.slice(4).join("_");

            setUserLang(interaction.user.id, lang);

            if (msgId && interaction.channel) {
                try {
                    const dashboardMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
                    if (dashboardMsg && dashboardMsg.editable) {
                        await dashboardMsg.edit(createSpawnPayload(interaction.user.id, true));
                    }
                } catch (err) {
                    console.warn("[Dashboard Edit Warning]:", err.message);
                }
            }

            await interaction.update({
                content: t(interaction.user.id, "langUpdated"),
                components: []
            });
            return;
        }

        if (interaction.isButton() && interaction.customId === "ivyseal_btn_view_quests") {
            await showUserQuests(interaction, interaction.user.id);
            return;
        }

        if (interaction.isButton() && interaction.customId === "ivyseal_btn_guide") {
            const guideContainer = new ContainerBuilder()
                .setAccentColor(0x2b2d31)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${t(interaction.user.id, "guideTitle")}\n\n` +
                        t(interaction.user.id, "guideDesc")
                    )
                )
                .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel("Watch Video Tutorial")
                            .setStyle(ButtonStyle.Link)
                            .setURL("https://www.youtube.com/watch?v=OUd37MWgBfs")
                    )
                );

            try {
                await interaction.reply({
                    components: [guideContainer],
                    flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]
                });
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
            }
            return;
        }

    } catch (error) {
        if (error.code === 10062 || error.code === 40060) return;
        console.error("[Bot] Interaction error:", error);
    }
});

if (!config.botToken) {
    console.log("\n[Bot] Bot Token not found in config.json.");
    console.log("[Bot] Open config.json and enter your botToken and clientId.\n");
} else {
    client.login(config.botToken).catch(err => {
        console.error("[Bot] Login error:", err.message);
    });
}
