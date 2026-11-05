const fs = require("fs");
const path = require("path");

const PREFERENCES_PATH = path.join(__dirname, "preferences.json");

let preferences = {};
try {
    preferences = JSON.parse(fs.readFileSync(PREFERENCES_PATH, "utf8"));
} catch (_) {
    preferences = {};
}

function savePreferences() {
    try {
        fs.writeFileSync(PREFERENCES_PATH, JSON.stringify(preferences, null, 2), "utf8");
    } catch (_) {}
}

function getUserLang(userId) {
    return preferences[userId] || "vi";
}

function setUserLang(userId, lang) {
    preferences[userId] = lang;
    savePreferences();
}

const translations = {
    vi: {
        dashboardTitle: "# Auto Quest Completer\nHoàn thành tự động nhiệm vụ Discord để nhận Orbs và vật phẩm trang trí hồ sơ",
        dashboardNote: "> **Lưu ý:** Vui lòng liên hệ **@ivy.ls** để được duyệt whitelist trước khi bấm **Hoàn thành nhiệm vụ**!\n\n**Tuyên bố miễn trừ trách nhiệm:** Chúng tôi không chịu trách nhiệm về bất kỳ hành động nào đối với tài khoản của bạn khi sử dụng dịch vụ.",
        btnCompleteQuests: "Hoàn thành nhiệm vụ",
        btnViewQuests: "Xem danh sách nhiệm vụ",
        btnHowToGetToken: "Cách lấy token",
        btnLanguage: "🌐 Ngôn ngữ / Language",
        selectLangPrompt: "Chọn ngôn ngữ hiển thị cho tài khoản của bạn:",
        langUpdated: "Đã chuyển ngôn ngữ sang **Tiếng Việt 🇻🇳** thành công!",
        inQueueTitle: "Đang trong hàng đợi",
        inQueueDesc: "Hiện tại hệ thống đang đạt số lượng luồng xử lý tối đa. Yêu cầu của bạn đang ở **Vị trí #{pos}** trong hàng đợi và sẽ bắt đầu ngay khi có chỗ trống...",
        initStatus: "Đang khởi tạo và chuẩn bị nhiệm vụ...",
        accountLabel: "Tài khoản",
        totalQuestsLabel: "Tổng số nhiệm vụ",
        totalRewardsLabel: "Tổng phần thưởng",
        currentQuestLabel: "Đang thực hiện",
        progressLabel: "Tiến độ",
        estCompletionLabel: "Dự kiến hoàn thành",
        waitNotice: "Vui lòng đợi cho đến khi tất cả nhiệm vụ hoàn tất trước khi vào Discord nhận thưởng!",
        claimNotice: "Vui lòng vào Discord để nhận thưởng cho các nhiệm vụ đã hoàn thành!",
        skippedNote: "Tiến độ không tăng sau nhiều lần thử. Đang chuyển sang nhiệm vụ tiếp theo...",
        nitroApplied: "Orbs (đã áp dụng Nitro 1.2x)",
        nitroPotential: "Orbs ({nitro} với Nitro)",
        completedTitle: "Hoàn thành nhiệm vụ",
        completedSummary: "**Hoàn tất nhiệm vụ cho tài khoản {username}!**\n> Nhận được: **{orbs}** ({success}/{total} nhiệm vụ thành công).\n> Thời gian kết thúc: <t:{finishUnix}:T> (mất {elapsed}).\n> {notice}",
        tokenInvalidDm: "⚠️ **Cảnh báo Token Discord**\n\nToken của tài khoản **{username}** (`<@{userId}>`) đã hết hạn hoặc không hợp lệ (401 Unauthorized).\nVui lòng sử dụng lệnh `/whitelist` trên máy chủ để cập nhật lại token.",
        tokenInvalidChat: "Token của bạn không hợp lệ hoặc đã hết hạn. Vui lòng cập nhật lại qua `/whitelist`.",
        noQuestsFound: "Không tìm thấy nhiệm vụ nào khả dụng.",
        noActiveQuests: "Tất cả nhiệm vụ đã được hoàn thành trước đó.",
        sessionAlreadyRunning: "Tài khoản của bạn đang có một phiên làm nhiệm vụ đang chạy ({type}). Vui lòng đợi hoàn tất.",
        notWhitelisted: "Tài khoản của bạn chưa nằm trong whitelist. Vui lòng liên hệ Admin!",
        guideTitle: "Hướng Dẫn Lấy Discord User Token",
        guideDesc: "1. Mở Discord trên trình duyệt (Chrome/Brave/Edge).\n2. Nhấn tổ hợp phím **F12** (hoặc Ctrl + Shift + I) để mở DevTools.\n3. Chuyển sang tab **Console** và dán đoạn mã bên dưới rồi nhấn **Enter**:\n```js\n(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()\n```\n4. Sao chép chuỗi mã hiển thị (bỏ qua dấu ngoặc kép).\n5. Dùng lệnh `/whitelist` của Bot để dán token an toàn qua popup riêng tư.\n\n⚠️ **Lưu ý bảo mật:** Tuyệt đối không gửi token này cho bất kỳ ai khác!",
        questListTitle: "Danh Sách Nhiệm Vụ Của Bạn",
        noQuests: "Không có nhiệm vụ nào cần làm."
    },
    en: {
        dashboardTitle: "# Auto Quest Completer\nAutomatically complete Discord quests to earn Orbs for profile decorations",
        dashboardNote: "> **Note:** Please contact **@ivy.ls** to be whitelisted before clicking **Complete Quests**!\n\n**Disclaimer:** By using this service, we assume no liability for any actions taken regarding your account.",
        btnCompleteQuests: "Complete Quests",
        btnViewQuests: "View Quest List",
        btnHowToGetToken: "How to get token",
        btnLanguage: "🌐 Language / Ngôn ngữ",
        selectLangPrompt: "Select display language for your account:",
        langUpdated: "Display language successfully changed to **English 🇺🇸**!",
        inQueueTitle: "In Queue",
        inQueueDesc: "System is currently at maximum capacity. Your request is at **Position #{pos}** in the queue and will start as soon as a slot is available...",
        initStatus: "Initializing and preparing quests...",
        accountLabel: "Account",
        totalQuestsLabel: "Total Quests",
        totalRewardsLabel: "Total Rewards",
        currentQuestLabel: "Current",
        progressLabel: "Progress",
        estCompletionLabel: "Estimated Completion",
        waitNotice: "Please wait until all quests are completed before claiming your rewards!",
        claimNotice: "Please head to Discord to claim rewards for completed quests!",
        skippedNote: "Progress did not advance after several attempts. Skipping to the next quest...",
        nitroApplied: "Orbs (Nitro 1.2x applied)",
        nitroPotential: "Orbs ({nitro} with Nitro)",
        completedTitle: "Auto Quest Completer",
        completedSummary: "**Quest completion finished for account {username}!**\n> Earned: **{orbs}** ({success}/{total} quests succeeded).\n> Completion time: <t:{finishUnix}:T> (took {elapsed}).\n> {notice}",
        tokenInvalidDm: "⚠️ **Discord Token Alert**\n\nThe token for account **{username}** (`<@{userId}>`) is expired or invalid (401 Unauthorized).\nPlease use the `/whitelist` command in the server to update your token.",
        tokenInvalidChat: "Your token is invalid or expired. Please update it using `/whitelist`.",
        noQuestsFound: "No quests found.",
        noActiveQuests: "No active quests remaining to complete.",
        sessionAlreadyRunning: "A quest session is already running for your account ({type}). Please wait until it finishes.",
        notWhitelisted: "Your account is not whitelisted. Please contact an Administrator!",
        guideTitle: "How to Get Discord User Token",
        guideDesc: "1. Open Discord in your web browser (Chrome/Edge/Brave).\n2. Press **F12** (or Ctrl + Shift + I) to open Developer Tools.\n3. Navigate to the **Console** tab, paste the following snippet, and hit **Enter**:\n```js\n(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()\n```\n4. Copy the returned token (without quotation marks).\n5. Use the bot's `/whitelist` command to securely submit it via modal.\n\n⚠️ **Security Warning:** Never share your token with anyone else!",
        questListTitle: "Your Discord Quests",
        noQuests: "No active quests found."
    }
};

function t(userId, key, vars = {}) {
    const lang = getUserLang(userId);
    const dict = translations[lang] || translations.vi;
    let text = dict[key] || translations.en[key] || key;
    for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
    }
    return text;
}

module.exports = {
    getUserLang,
    setUserLang,
    t
};
