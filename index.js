/**
 * ============================================================================
 * IVYSEAL DQC BOT — DỊCH VỤ TỰ ĐỘNG CÀY ỌP
 * ============================================================================
 * Lệnh:
 *   /dqcspawn           : Triệu hồi bảng điều khiển
 *   /whitelist           : Thêm tài khoản vào whitelist (nhập token qua modal)
 *   /whitelisted         : Xem danh sách tài khoản đã whitelist
 *   /autoschedule <ngày> : Lên lịch tự động cày ọp hàng tuần
 *
 * Nút bấm:
 *   🔥 Cày Ọp           : Tự động làm quest cho tài khoản đã whitelist
 *   Hướng dẫn lấy token : Hướng dẫn chi tiết
 * ============================================================================
 */

// Logger — phải require ĐẦU TIÊN để patch console
require("./logger.js");

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    PermissionFlagsBits,
    Events
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
    getQuestIntermissionDelay
} = require("./quest-engine.js");

// ============================================================================
// CẤU HÌNH & DỮ LIỆU
// ============================================================================
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
// Ưu tiên biến môi trường (Railway/hosting), fallback về config.json khi chạy local
if (process.env.BOT_TOKEN)  config.botToken = process.env.BOT_TOKEN;
if (process.env.CLIENT_ID)  config.clientId  = process.env.CLIENT_ID;
if (process.env.GUILD_ID)   config.guildId   = process.env.GUILD_ID;

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
        console.log("[Crypto] Đã mã hóa toàn bộ token hiện có trong whitelist sang AES-256-GCM.");
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

// Map quản lý phiên đang cày: targetUserId -> { type: 'manual' | 'auto', username, startedAt }
const activeSessions = new Map();

// ============================================================================
// CLIENT & UTILITIES
// ============================================================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Chống crash bot khi mạng chập chờn, handshake timeout hoặc WebSocket disconnect
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
    if (h > 0 && m > 0) return `${h} giờ ${m} phút`;
    if (h > 0) return `${h} giờ`;
    if (m > 0 && s > 0) return `${m} phút ${s}s`;
    if (m > 0) return `${m} phút`;
    return `${s}s`;
}

function getOnTimestamp() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
}

let botOnlineTime = getOnTimestamp();

const DAY_NAMES = {
    0: "Chủ Nhật", 1: "Thứ 2", 2: "Thứ 3", 3: "Thứ 4",
    4: "Thứ 5", 5: "Thứ 6", 6: "Thứ 7"
};

// ============================================================================
// ĐĂNG KÝ SLASH COMMANDS
// ============================================================================
const commands = [
    new SlashCommandBuilder()
        .setName("dqcspawn")
        .setDescription("Triệu hồi bảng điều khiển Tự Động Cày Ọp"),
    new SlashCommandBuilder()
        .setName("whitelist")
        .setDescription("Thêm tài khoản vào whitelist (nhập token an toàn qua popup)"),
    new SlashCommandBuilder()
        .setName("unwhitelist")
        .setDescription("Xóa tài khoản khỏi danh sách whitelist")
        .addUserOption(opt =>
            opt.setName("user")
                .setDescription("Người dùng Discord muốn xóa (để trống nếu muốn xóa chính mình)")
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName("quests")
        .setDescription("Xem danh sách nhiệm vụ Discord và số Orb có thể cày"),
    new SlashCommandBuilder()
        .setName("whitelisted")
        .setDescription("Xem danh sách tài khoản đã được whitelist (Chỉ Quản trị viên)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName("autoschedule")
        .setDescription("Lên lịch tự động cày ọp hàng tuần cho tất cả tài khoản (Chỉ Quản trị viên)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName("ngay")
                .setDescription("Chọn thứ trong tuần để chạy tự động")
                .setRequired(true)
                .addChoices(
                    { name: "Thứ 2", value: "1" },
                    { name: "Thứ 3", value: "2" },
                    { name: "Thứ 4", value: "3" },
                    { name: "Thứ 5", value: "4" },
                    { name: "Thứ 6", value: "5" },
                    { name: "Thứ 7", value: "6" },
                    { name: "Chủ Nhật", value: "0" },
                    { name: "Tắt lịch", value: "-1" }
                )
        )
        .addIntegerOption(opt =>
            opt.setName("gio")
                .setDescription("Giờ chạy trong ngày (0 - 23, mặc định là 8)")
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(23)
        )
].map(cmd => cmd.toJSON());

async function registerCommands(token, clientId, guildId) {
    if (!token || !clientId) return;
    const rest = new REST({ version: "10" }).setToken(token);

    if (guildId) {
        try {
            console.log(`[Bot] Đang đăng ký lệnh cho Server ${guildId}...`);
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
            console.log(`[Bot] Đã đăng ký 4 lệnh cho Server: ${guildId}`);
            return;
        } catch (error) {
            console.warn(`[Bot] Không thể đăng ký cho Server ${guildId}: ${error.message}`);
        }
    }
    try {
        console.log("[Bot] Đang đăng ký lệnh toàn cầu...");
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log("[Bot] Đã đăng ký lệnh toàn cầu thành công.");
    } catch (error) {
        console.error("[Bot] Lỗi đăng ký Slash Command:", error);
    }
}

// ============================================================================
// EMBEDS & HELPERS
// ============================================================================
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
                content: "Bạn chưa được whitelist!\n> Vui lòng liên hệ **@ivy.ls** để được cấp quyền whitelist tài khoản.",
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
        try {
            await interaction.editReply({
                content: `Token của tài khoản **${username}** đã hết hạn hoặc không hợp lệ. Vui lòng dùng lệnh \`/whitelist\` để cập nhật lại token!`
            });
        } catch (_) {}
        return;
    }

    try {
        const quests = await fetchUserQuests(token);
        if (!quests || quests.length === 0) {
            await interaction.editReply({
                content: `Tài khoản **${username}** hiện không có nhiệm vụ Discord nào khả dụng.`
            });
            return;
        }

        let totalAvailableOrbs = 0;
        let totalNitroOrbs = 0;
        const questLines = [];

        for (let i = 0; i < quests.length; i++) {
            const q = quests[i];
            const name = getQuestName(q);
            const task = detectQuestTask(q);
            const orbs = getQuestOrbs(q, false);
            const nitroOrbs = getQuestOrbs(q, true);
            const isExpired = isQuestExpired(q);
            const userStatus = q.user_status;

            let statusStr = "";
            if (userStatus?.claimed_at) {
                statusStr = "Đã nhận thưởng";
            } else if (userStatus?.completed_at) {
                statusStr = "Đã xong (chưa nhận thưởng)";
                totalAvailableOrbs += orbs;
                totalNitroOrbs += nitroOrbs;
            } else if (isExpired) {
                statusStr = "Đã hết hạn";
            } else {
                const curSec = userStatus?.progress?.[task.keyName]?.value || 0;
                const targetSec = task.target || 900;
                const percent = Math.min(100, Math.floor((curSec / targetSec) * 100));
                statusStr = percent > 0 ? `Đang làm (${percent}%)` : "Chưa làm";
                totalAvailableOrbs += orbs;
                totalNitroOrbs += nitroOrbs;
            }

            const typeLabel = task.type === "WATCH_VIDEO" ? "Video" : (task.type === "STREAM" ? "Stream" : "Game");
            questLines.push(`**${i + 1}. ${name}** [${typeLabel}]\n> Trạng thái: ${statusStr} • Thưởng: **${orbs}** Orbs (${nitroOrbs} với Nitro)`);
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`Danh Sách Quest — ${username}`)
            .setDescription(
                `• **Tổng số nhiệm vụ:** ${quests.length}\n` +
                `• **Tổng Orb có thể cày/nhận:** **${totalAvailableOrbs.toLocaleString()}** Orbs (${totalNitroOrbs.toLocaleString()} với Nitro)\n\n` +
                questLines.slice(0, 15).join("\n\n")
            )
            .setFooter({ text: `Ivy Ọp • Dùng nút Cày Ọp để tự động hoàn thành và nhận thưởng` })
            .setTimestamp();

        if (entry.avatarUrl) {
            embed.setThumbnail(entry.avatarUrl);
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error("[Quests] Lỗi lấy danh sách quest:", err);
        await interaction.editReply({
            content: `Không thể tải danh sách quest cho **${username}**: ${err.message}`
        });
    }
}

function createSpawnEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle("Dịch Vụ Tự Động Cày Ọp")
        .setDescription(
            `Tự động hoàn thành quest Discord, nhận Orb để đổi decor\n\n` +
            `> **Lưu ý:** Vui lòng liên hệ **@ivy.ls** để được cấp quyền whitelist tài khoản trước khi bấm **Cày Ọp**!\n\n` +
            `**Cảnh báo:** Khi sử dụng dịch vụ này, chúng mình không chịu trách nhiệm cho bất cứ điều gì xảy ra trong tài khoản của các bạn.`
        )
        .setImage("attachment://banner.png")
        .setFooter({ text: `Ivy Ọp • On lúc ${botOnlineTime}` });

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ivyseal_btn_cay_op")
            .setLabel("Cày Ọp")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("ivyseal_btn_view_quests")
            .setLabel("Xem Danh Sách Quest")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("ivyseal_btn_guide")
            .setLabel("Hướng dẫn lấy token")
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [buttons] };
}

function buildStatusEmbed(username, activeQuests, totalTimeSec, currentQuest = null, isPremium = false, finishTimestamp = null) {
    let totalOrbsBase = 0;
    let totalOrbsNitro = 0;
    for (const q of activeQuests) {
        totalOrbsBase += getQuestOrbs(q, false);
        totalOrbsNitro += getQuestOrbs(q, true);
    }

    const finalOrbs = isPremium ? totalOrbsNitro : totalOrbsBase;
    const orbDesc = isPremium
        ? `${finalOrbs.toLocaleString()} Orbs (Đã tính Nitro 1.2x)`
        : (totalOrbsNitro > totalOrbsBase
            ? `${finalOrbs.toLocaleString()} Orbs (${totalOrbsNitro.toLocaleString()} với Nitro)`
            : `${finalOrbs.toLocaleString()} Orbs`);

    const targetTime = finishTimestamp || (Math.floor(Date.now() / 1000) + totalTimeSec);

    let desc = `• **Tài khoản :** ${username}\n` +
               `• **Tổng nhiệm vụ :** ${activeQuests.length}\n` +
               `• **Tổng nhận :** ${orbDesc}\n`;

    if (currentQuest) {
        const p = Math.min(100, Math.max(0, currentQuest.percent || 0));
        const bar = createProgressBar(p);
        const statusNote = currentQuest.status === "skipped"
            ? `\n> *Đã thử vài lần nhưng không tăng tiến trình. Đang bỏ qua để sang nhiệm vụ tiếp...*`
            : "";

        desc += `\n━━━━━━━━━━━━━━━━━━━━\n` +
                `• **Đang làm [${currentQuest.index + 1}/${currentQuest.total}] :** **${currentQuest.name}**${statusNote}\n` +
                `• **Tiến trình :** \`${bar}\`\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n`;
    } else {
        desc += `\n━━━━━━━━━━━━━━━━━━━━\n` +
                `• **Trạng thái :** Đang khởi tạo và chuẩn bị nhiệm vụ...\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    desc += `• **Thời gian hoàn thành :** <t:${targetTime}:R> (khoảng ${formatTime(totalTimeSec)})\n\n` +
            `• **Lưu ý :** Vui lòng chờ hoàn thành tất cả các quest rồi ấn claim một lần bạn nhé !`;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Tự Động Cày Ọp")
        .setImage("attachment://banner.png")
        .setDescription(desc)
        .setFooter({ text: `Ivy Ọp • On lúc ${botOnlineTime}` });

    return embed;
}

// ============================================================================
// CORE: CHẠY QUEST CHO 1 TÀI KHOẢN
// ============================================================================
async function runQuestsForUser(token, updateFn) {
    let quests;
    let userInfo;
    try {
        [quests, userInfo] = await Promise.all([
            fetchUserQuests(token),
            fetchUserInfo(token).catch(() => null)
        ]);
    } catch (err) {
        return { error: `Token không hợp lệ: ${err.message}` };
    }

    if (!quests || quests.length === 0) {
        return { error: "Không có quest nào." };
    }

    const isPremium = !!(userInfo?.premium_type && userInfo.premium_type > 0);

    // Lọc bỏ nhiệm vụ đã claim hoặc đã hết hạn
    const activeQuests = quests.filter(q => {
        if (!q || !q.config) return false;
        if (q.user_status?.claimed_at) return false;
        if (isQuestExpired(q)) return false;
        return true;
    });

    // ƯU TIÊN: Chạy các nhiệm vụ Video (ngắn 30s-60s) TRƯỚC, game (15 phút) chạy SAU
    activeQuests.sort((a, b) => {
        const taskA = detectQuestTask(a);
        const taskB = detectQuestTask(b);
        const isVideoA = taskA.type === "WATCH_VIDEO" ? 0 : 1;
        const isVideoB = taskB.type === "WATCH_VIDEO" ? 0 : 1;
        if (isVideoA !== isVideoB) return isVideoA - isVideoB;
        return (taskA.target || 900) - (taskB.target || 900);
    });

    if (activeQuests.length === 0) {
        return { error: "Không có nhiệm vụ nào còn hạn cần làm." };
    }

    // Tính thời gian ước lượng (bao gồm thời gian làm nhiệm vụ + thời gian nghỉ an toàn)
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

    // Gửi embed trạng thái ban đầu
    if (updateFn) await updateFn({ phase: "status", activeQuests, totalTimeSec, isPremium });

    const results = [];
    let lastQuestWasExecuted = false;

    for (let i = 0; i < activeQuests.length; i++) {
        const q = activeQuests[i];

        // Giãn cách an toàn theo yêu cầu:
        // - Nhiệm vụ 15 phút (game/stream): cách nhau 1 phút (60s)
        // - Nhiệm vụ 200 orb (xem video): cách nhau 15 giây (15s)
        if (i > 0 && lastQuestWasExecuted) {
            const delayInfo = getQuestIntermissionDelay(q);
            console.log(`[Ivyseal DQC] Giãn cách an toàn trước "${getQuestName(q)}": Nghỉ ${delayInfo.label}...`);
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
        });

        // Nếu quest hoàn thành thật sự -> đánh dấu để có delay an toàn trước quest tiếp
        // Nếu quest bị bỏ qua hoặc lỗi -> chỉ nghỉ 2 giây rồi sang quest tiếp theo luôn
        lastQuestWasExecuted = result.success && !result.alreadyCompleted;
        results.push(result);
        if (result.skipped) {
            console.log(`[Cày Ọp] Quest "${result.questName}": Đã bỏ qua (${result.error || "Cần tự vào game làm"})`);
            await new Promise(r => setTimeout(r, 2000));
        } else {
            console.log(`[Cày Ọp] Quest "${result.questName}": ${result.success ? "Thành công" : "Thất bại"} ${result.error || ""}`);
        }
    }

    return { results, activeQuests, totalTimeSec, isPremium };
}

// ============================================================================
// AUTO-SCHEDULE: CHẠY CHO TẤT CẢ TÀI KHOẢN WHITELIST
// ============================================================================
async function runAllWhitelistedQuests(channel) {
    const whitelist = loadWhitelist();
    const entries = Object.entries(whitelist);

    if (entries.length === 0) {
        await channel.send("Không có tài khoản nào trong whitelist để chạy tự động.");
        return;
    }

    const concurrency = Math.max(1, Math.min(5, config.maxConcurrentQuests || 2));
    console.log(`[Auto-Schedule] Bắt đầu chạy cho ${entries.length} tài khoản (Song song: ${concurrency} luồng)...`);

    const attachment = fs.existsSync(BANNER_PATH)
        ? new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })
        : null;

    const startEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Auto-Schedule: Tự Động Cày Ọp")
        .setDescription(`Đang xử lý **${entries.length}** tài khoản whitelist (tối đa **${concurrency}** tài khoản chạy cùng lúc)...`)
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
            console.log(`[Auto-Schedule] Bỏ qua ${username} (${userId}) vì đang có phiên (${existing.type}).`);
            allResults.push({
                username,
                userId,
                error: `Đang có phiên ${existing.type === "manual" ? "thủ công" : "khác"} đang chạy, bỏ qua để tránh rate limit.`
            });
            return;
        }

        const token = getDecryptedToken(entry);
        if (!token) {
            allResults.push({ username, userId, error: "Không thể giải mã token." });
            return;
        }

        const health = await validateTokenHealth(token);
        if (!health.ok && health.dead) {
            console.warn(`[Auto-Schedule] Token của ${username} đã hết hạn hoặc không hợp lệ.`);
            allResults.push({ username, userId, error: "Token đã hết hạn hoặc không hợp lệ (cần /whitelist lại)." });
            return;
        }

        activeSessions.set(userId, {
            type: "auto",
            username,
            startedAt: Date.now()
        });

        try {
            console.log(`[Auto-Schedule] Đang xử lý: ${username} (${userId})`);
            const result = await runQuestsForUser(token, null);
            allResults.push({ username, userId, ...result });
        } catch (err) {
            allResults.push({ username, userId, error: err.message });
        } finally {
            activeSessions.delete(userId);
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

    // Tổng kết
    const lines = allResults.map(r => {
        if (r.error) return `• **${r.username}** — ${r.error}`;
        const ok = r.results ? r.results.filter(x => x.success).length : 0;
        const total = r.results ? r.results.length : 0;
        const skipped = r.results ? r.results.filter(x => x.skipped || x.requiresPlayer).length : 0;
        const skipText = skipped > 0 ? ` (bỏ qua ${skipped} cần tự làm)` : "";
        return `• **${r.username}** — ${ok}/${total} nhiệm vụ hoàn thành${skipText}`;
    });

    const finalEmbed = new EmbedBuilder()
        .setColor(0x23A55A)
        .setTitle("Auto-Schedule: Hoàn Thành")
        .setDescription(lines.join("\n") || "Không có kết quả.")
        .setFooter({ text: `Ivy Ọp • On lúc ${botOnlineTime}` })
        .setTimestamp();

    await msg.edit({ embeds: [finalEmbed] });
    console.log(`[Auto-Schedule] Hoàn thành xử lý ${entries.length} tài khoản.`);
}

// Kiểm tra lịch mỗi 15 phút
function startScheduleChecker() {
    setInterval(async () => {
        try {
            const schedule = loadSchedule();
            if (schedule.day === null || schedule.day === undefined || schedule.day < 0 || !schedule.channelId) return;

            const now = new Date();
            const currentDay = now.getDay();
            const todayDate = now.toISOString().split("T")[0];

            // Chạy nếu đúng ngày, chưa chạy hôm nay, và từ giờ đã đặt trở đi
            const targetHour = (schedule.hour !== undefined && schedule.hour !== null) ? schedule.hour : 8;
            if (currentDay === schedule.day && schedule.lastRunDate !== todayDate && now.getHours() >= targetHour) {
                schedule.lastRunDate = todayDate;
                saveSchedule(schedule);

                console.log(`[Auto-Schedule] Đã đến ${DAY_NAMES[schedule.day]} (từ ${targetHour}:00) — bắt đầu chạy tự động!`);

                const channel = client.channels.cache.get(schedule.channelId);
                if (!channel) {
                    console.warn(`[Auto-Schedule] Không tìm thấy kênh ${schedule.channelId}`);
                    return;
                }
                await runAllWhitelistedQuests(channel);
            }
        } catch (err) {
            console.error("[Auto-Schedule] Lỗi:", err);
        }
    }, 15 * 60 * 1000); // 15 phút
}

// ============================================================================
// XỬ LÝ TƯƠNG TÁC
// ============================================================================
client.once(Events.ClientReady, async () => {
    botOnlineTime = getOnTimestamp();
    console.log(`\n======================================================`);
    console.log(`[Bot] Đã đăng nhập: ${client.user.tag} (ID: ${client.user.id})`);
    console.log(`[Bot] Link mời: https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`);
    console.log(`======================================================\n`);

    migrateExistingTokens();

    if (config.botToken && config.clientId) {
        await registerCommands(config.botToken, config.clientId, config.guildId);
    }

    startScheduleChecker();
    console.log("[Scheduler] Đã bật kiểm tra lịch tự động mỗi 15 phút.");

    const schedule = loadSchedule();
    if (schedule.day !== null && schedule.day >= 0) {
        const targetHour = (schedule.hour !== undefined && schedule.hour !== null) ? schedule.hour : 8;
        console.log(`[Scheduler] Lịch hiện tại: ${DAY_NAMES[schedule.day]} lúc ${targetHour}:00 hàng tuần.`);
    }
});

client.on("interactionCreate", async (interaction) => {
    try {
        // ================================================================
        // SLASH COMMANDS
        // ================================================================

        if (interaction.isChatInputCommand()) {
            // --- /dqcspawn ---
            if (interaction.commandName === "dqcspawn") {
                const payload = createSpawnEmbed();
                if (fs.existsSync(BANNER_PATH)) {
                    payload.files = [new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })];
                }
                try {
                    await interaction.reply(payload);
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                    throw err;
                }
                return;
            }

            // --- /whitelist (mở modal nhập token) ---
            if (interaction.commandName === "whitelist") {
                const modal = new ModalBuilder()
                    .setCustomId("ivyseal_modal_whitelist")
                    .setTitle("Thêm tài khoản vào Whitelist");

                const tokenInput = new TextInputBuilder()
                    .setCustomId("whitelist_token_input")
                    .setLabel("Token Discord")
                    .setPlaceholder("Dán token vào đây (an toàn, không ai thấy)...")
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

            // --- /quests ---
            if (interaction.commandName === "quests") {
                await showUserQuests(interaction, interaction.user.id);
                return;
            }

            // --- /whitelisted ---
            if (interaction.commandName === "whitelisted") {
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if (!isAdmin) {
                    try {
                        await interaction.reply({
                            content: "Bạn cần có quyền Quản trị viên (Administrator) để xem danh sách whitelist.",
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
                            content: "Chưa có tài khoản nào được whitelist.",
                            flags: 64
                        });
                    } catch (err) {
                        if (err.code === 10062 || err.code === 40060) return;
                    }
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle("Danh sách Whitelist")
                    .setDescription(
                        entries.map(([userId, data], idx) =>
                            `**${idx + 1}.** ${data.username} — \`${userId}\``
                        ).join("\n")
                    )
                    .setFooter({ text: `Tổng: ${entries.length} tài khoản` })
                    .setTimestamp();

                try {
                    await interaction.reply({ embeds: [embed], flags: 64 });
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                }
                return;
            }

            // --- /unwhitelist [user] ---
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
                            content: "Bạn không có quyền xóa tài khoản của người khác (yêu cầu quyền Quản trị viên).",
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
                        content: "Không tìm thấy tài khoản tương ứng trong danh sách whitelist.",
                        flags: 64
                    });
                    return;
                }

                if (activeSessions.has(targetIdToRemove)) {
                    await interaction.reply({
                        content: `Tài khoản **${targetEntry.username}** đang trong phiên cày ọp. Vui lòng đợi phiên cày hoàn thành trước khi xóa!`,
                        flags: 64
                    });
                    return;
                }

                delete whitelist[targetIdToRemove];
                saveWhitelist(whitelist);

                console.log(`[Whitelist] Đã xóa: ${targetEntry.username} (${targetIdToRemove}) bởi ${interaction.user.tag}`);

                const embed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle("Đã Xóa Khỏi Whitelist")
                    .setDescription(
                        `• **Tài khoản:** ${targetEntry.username}\n` +
                        `• **ID:** \`${targetIdToRemove}\`\n` +
                        `• **Người thực hiện:** <@${callerId}>\n\n` +
                        `Tài khoản này đã được xóa khỏi hệ thống cày ọp.`
                    )
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], flags: 64 });
                return;
            }

            // --- /autoschedule <ngay> ---
            if (interaction.commandName === "autoschedule") {
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                if (!isAdmin) {
                    try {
                        await interaction.reply({
                            content: "Bạn cần có quyền Quản trị viên (Administrator) để thiết lập lịch cày tự động.",
                            flags: 64
                        });
                    } catch (_) {}
                    return;
                }

                const dayValue = parseInt(interaction.options.getString("ngay"));

                // Tắt lịch
                if (dayValue < 0) {
                    saveSchedule({ day: null, hour: 8, channelId: null, lastRunDate: null });
                    console.log("[Auto-Schedule] Đã tắt lịch tự động.");
                    try {
                        await interaction.reply({
                            content: "Đã **tắt** lịch tự động cày ọp.",
                            flags: 64
                        });
                    } catch (err) {
                        if (err.code === 10062 || err.code === 40060) return;
                    }
                    return;
                }

                const hourOpt = interaction.options.getInteger("gio");
                const hourValue = (hourOpt !== null && hourOpt !== undefined) ? hourOpt : 8;

                const schedule = loadSchedule();
                schedule.day = dayValue;
                schedule.hour = hourValue;
                schedule.channelId = interaction.channelId;
                schedule.lastRunDate = null;
                saveSchedule(schedule);

                const hourStr = `${String(hourValue).padStart(2, "0")}:00`;
                console.log(`[Auto-Schedule] Đã lên lịch: ${DAY_NAMES[dayValue]} lúc ${hourStr}, kênh: ${interaction.channelId}`);

                const embed = new EmbedBuilder()
                    .setColor(0x23A55A)
                    .setTitle("Auto-Schedule Đã Thiết Lập")
                    .setDescription(
                        `Bot sẽ tự động cày ọp cho **tất cả tài khoản whitelist** vào:\n\n` +
                        `• **${DAY_NAMES[dayValue]}** hàng tuần (từ ~${hourStr})\n` +
                        `• **Kênh:** <#${interaction.channelId}>\n\n` +
                        `Kết quả sẽ được gửi vào kênh này.\n` +
                        `Dùng \`/autoschedule\` → **Tắt lịch** để hủy.`
                    )
                    .setTimestamp();

                try {
                    await interaction.reply({ embeds: [embed] });
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                }
                return;
            }
        }

        // ================================================================
        // MODAL SUBMIT: Whitelist Token
        // ================================================================
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

                console.log(`[Whitelist] ${isUpdate ? "Cập nhật" : "Thêm mới"}: ${displayTag} (${userId}) bởi ${interaction.user.tag}`);

                const embed = new EmbedBuilder()
                    .setColor(0x23A55A)
                    .setTitle(isUpdate ? "Đã Cập Nhật Whitelist" : "Đã Thêm Vào Whitelist")
                    .setDescription(
                        `• **Tài khoản:** ${displayTag}\n` +
                        `• **ID:** \`${userId}\`\n` +
                        `• **Trạng thái:** ${isUpdate ? "Token đã được cập nhật" : "Đã thêm thành công"}`
                    )
                    .setTimestamp();

                if (userInfo.avatar) {
                    embed.setThumbnail(`https://cdn.discordapp.com/avatars/${userId}/${userInfo.avatar}.png`);
                }

                await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error(`[Whitelist] Lỗi xác thực token: ${err.message}`);
                await interaction.editReply({
                    content: `Token không hợp lệ hoặc đã hết hạn: ${err.message}`
                });
            }
            return;
        }

        // ================================================================
        // BUTTONS
        // ================================================================

        // --- 🔥 Cày Ọp ---
        if (interaction.isButton() && interaction.customId === "ivyseal_btn_cay_op") {
            const whitelist = loadWhitelist();
            const callerId = interaction.user.id;

            // Tìm tài khoản theo callerId: hoặc là key, hoặc do callerId thêm
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
                        content: "Bạn chưa được whitelist!\n> Vui lòng liên hệ **@ivy.ls** để được cấp quyền whitelist tài khoản.",
                        flags: 64
                    });
                } catch (_) {}
                return;
            }

            const currentSession = activeSessions.get(targetUserId);
            if (currentSession) {
                const msg = currentSession.type === "auto"
                    ? "Tài khoản này đang được hệ thống **Auto-Schedule** tự động cày!\nVui lòng không bấm cày lại để tránh bị Discord giới hạn (rate limit)."
                    : "Tài khoản này đang trong một phiên cày khác. Vui lòng đợi hoàn thành!";
                try {
                    await interaction.reply({
                        content: msg,
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
                try {
                    await interaction.editReply({
                        content: `Token của tài khoản **${username}** đã hết hạn hoặc không hợp lệ. Vui lòng dùng lệnh \`/whitelist\` để cập nhật lại token!`
                    });
                } catch (_) {}
                return;
            }

            activeSessions.set(targetUserId, {
                type: "manual",
                username,
                startedAt: Date.now()
            });

            let lastUpdateTime = 0;
            const startTime = Date.now();

            console.log(`[Cày Ọp] Bắt đầu cho: ${username} (${targetUserId})`);

            // Gửi tin nhắn khởi tạo vào Direct Message (DM) để khi người dùng F5/reload không bị mất
            let dmMessage = null;
            try {
                const initialFiles = fs.existsSync(BANNER_PATH)
                    ? [new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })]
                    : [];
                const initialEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle("Tự Động Cày Ọp — Tiến Trình Riêng")
                    .setImage("attachment://banner.png")
                    .setDescription(`Đang khởi tạo danh sách nhiệm vụ cho tài khoản **${username}**...`)
                    .setFooter({ text: `Ivy Ọp • On lúc ${botOnlineTime}` });
                dmMessage = await interaction.user.send({ embeds: [initialEmbed], files: initialFiles });
                console.log(`[Cày Ọp] Đã mở DM theo dõi cho người dùng: ${interaction.user.tag}`);
            } catch (err) {
                console.warn(`[Cày Ọp] Không thể gửi DM cho ${interaction.user.tag}: ${err.message}`);
            }

            // Hàm đồng bộ cập nhật cả ephemeral reply và tin nhắn riêng (DM)
            const updateBoth = async (payload) => {
                // 1. Cập nhật ephemeral reply trên server (nếu token interaction chưa hết hạn)
                try {
                    await interaction.editReply(payload);
                } catch (_) {}

                // 2. Cập nhật tin nhắn riêng (DM) - luôn tồn tại vĩnh viễn, không bị mất khi F5
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
                            cachedFinishTimestamp
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
                            cachedFinishTimestamp
                        );
                        await updateBoth({ embeds: [embed] });
                    }
                });

                if (outcome.error) {
                    await updateBoth({ content: outcome.error, embeds: [] });
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
                        ? `${finalOrbs.toLocaleString()} Orbs (Đã có Nitro 1.2x)`
                        : `${finalOrbs.toLocaleString()} Orbs`;

                    const finishTime = Date.now();
                    const elapsedSec = Math.max(1, Math.round((finishTime - startTime) / 1000));
                    const elapsedStr = formatTime(elapsedSec);
                    const finishUnix = Math.floor(finishTime / 1000);

                    let desc = `• **Tài khoản :** ${username}\n` +
                               `• **Tổng nhận :** ${orbDesc}\n` +
                               `• **Hoàn thành :** ${successQuests.length}/${outcome.results.length} nhiệm vụ\n`;

                    if (skippedQuests.length > 0) {
                        desc += `• **Bỏ qua (cần tự vào game) :** ${skippedQuests.length} nhiệm vụ\n` +
                                `> *${skippedQuests.map(q => q.questName).join(", ")}*\n`;
                    }
                    if (failQuests.length > 0) {
                        desc += `• **Thất bại :** ${failQuests.length} nhiệm vụ\n`;
                    }
                    desc += `• **Thời gian hoàn thành :** <t:${finishUnix}:T> (khoảng ${elapsedStr})\n`;
                    desc += `\n• **Lưu ý :** Vui lòng vào Discord để nhận thưởng cho các quest đã hoàn thành bạn nhé !`;

                    const finalEmbed = new EmbedBuilder()
                        .setColor(0x23A55A)
                        .setTitle("Tự Động Cày Ọp — Hoàn Thành")
                        .setImage("attachment://banner.png")
                        .setDescription(desc)
                        .setFooter({ text: `Ivy Ọp • On lúc ${botOnlineTime}` });

                    const files = fs.existsSync(BANNER_PATH)
                        ? [new AttachmentBuilder(BANNER_PATH, { name: "banner.png" })]
                        : [];

                    await updateBoth({ embeds: [finalEmbed], files });
                    console.log(`[Cày Ọp] Hoàn thành cho ${username}: ${successQuests.length} thành công, ${failQuests.length} thất bại, ${skippedQuests.length} bỏ qua. Thời gian: ${elapsedStr}.`);

                    // Gửi thông báo kèm tin nhắn ping trong DM để người dùng biết khi hoàn thành
                    if (dmMessage) {
                        try {
                            await interaction.user.send({
                                content: `**Hoàn thành cày ọp cho tài khoản ${username}!**\n> Nhận được: **${orbDesc}** (${successQuests.length}/${outcome.results.length} nhiệm vụ thành công).\n> Thời gian hoàn thành: <t:${finishUnix}:T> (mất ${elapsedStr}).\n> Bạn hãy vào Discord kiểm tra và nhận thưởng nhé!`
                            });
                        } catch (_) {}
                    }
                }
            } finally {
                activeSessions.delete(targetUserId);
            }
            return;
        }

        // --- Xem Danh Sách Quest ---
        if (interaction.isButton() && interaction.customId === "ivyseal_btn_view_quests") {
            await showUserQuests(interaction, interaction.user.id);
            return;
        }

        // --- Hướng dẫn lấy token ---
        if (interaction.isButton() && interaction.customId === "ivyseal_btn_guide") {
            const guideEmbed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle("Hướng dẫn lấy token tài khoản")
                .setDescription(
                    `1. Mở Developer Tools (nhấn **F12**) và chuyển sang tab **Application**.\n` +
                    `2. Ở thanh bên trái, mở rộng **Local Storage** → chọn **https://discord.com**.\n` +
                    `3. Tại ô tìm kiếm (Filter), gõ \`token\`.\n` +
                    `4. Token của bạn sẽ xuất hiện ở cột **Value** (bỏ dấu ngoặc kép nếu có).\n\n` +
                    `Video hướng dẫn: https://www.youtube.com/watch?v=OUd37MWgBfs\n\n` +
                    `**Cảnh báo bảo mật:**\n` +
                    `Discord token hoạt động như mật khẩu. Không chia sẻ công khai hoặc dán vào trang web không tin cậy. ` +
                    `Nếu nghi ngờ token bị lộ, hãy đổi mật khẩu ngay lập tức.`
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel("Xem Video Hướng Dẫn")
                    .setStyle(ButtonStyle.Link)
                    .setURL("https://www.youtube.com/watch?v=OUd37MWgBfs")
            );

            try {
                await interaction.reply({ embeds: [guideEmbed], components: [row], flags: 64 });
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
            }
            return;
        }

    } catch (error) {
        if (error.code === 10062 || error.code === 40060) return;
        console.error("[Bot] Lỗi tương tác:", error);
    }
});

// ============================================================================
// KHỞI CHẠY BOT
// ============================================================================
if (!config.botToken) {
    console.log("\n[Bot] Chưa điền Bot Token vào file config.json.");
    console.log("[Bot] Mở file config.json và điền botToken + clientId.\n");
} else {
    client.login(config.botToken).catch(err => {
        console.error("[Bot] Lỗi đăng nhập:", err.message);
    });
}
