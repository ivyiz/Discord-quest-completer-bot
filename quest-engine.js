/**
 * ============================================================================
 * 🎯 IVYSEAL DQC QUEST ENGINE (KẾ THỪA VÀ NÂNG CẤP TỪ ORION DQC)
 * ============================================================================
 * Xử lý tự động:
 * - Lọc bỏ nhiệm vụ hết hạn (Expired)
 * - Tự động ghi danh (Enroll với location chuẩn)
 * - Xử lý nhiệm vụ Video (WATCH_VIDEO qua /video-progress)
 * - Xử lý nhiệm vụ Game / Stream (/heartbeat mang theo applicationId)
 * - Tự động nhận thưởng (Claim reward & Orbs)
 * ============================================================================
 */

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const ELECTRON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36";
const SUPER_PROPERTIES = Buffer.from(JSON.stringify({
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: "vi-VN",
    browser_user_agent: CHROME_UA,
    browser_version: "128.0.0.0",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: 619060,
    client_event_source: null
})).toString("base64");

const MAX_RETRIES = 3;
let enrollCooldownUntil = 0;

// Delay ngẫu nhiên giữa các quest để giả lập hành vi người dùng (anti-detection)
function randomDelay(minMs = 5000, maxMs = 20000) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    console.log(`[Ivyseal DQC] Anti-detection: Nghỉ ${(ms / 1000).toFixed(1)}s trước khi tiếp tục...`);
    return new Promise(r => setTimeout(r, ms));
}

async function discordRequest(endpoint, method = "GET", token, body = null, retryCount = 0, isDesktop = false) {
    const url = `https://discord.com/api/v9${endpoint}`;
    const cleanToken = token.trim().replace(/^["']|["']$/g, "");
    const headers = {
        "Authorization": cleanToken,
        "Content-Type": "application/json",
        "User-Agent": isDesktop ? ELECTRON_UA : CHROME_UA
    };
    if (!isDesktop) {
        headers["X-Super-Properties"] = SUPER_PROPERTIES;
        headers["X-Discord-Locale"] = "vi";
        headers["X-Discord-Timezone"] = "Asia/Saigon";
    }

    const options = { method, headers };
    if (body && method !== "GET") {
        options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    // Rate Limit Handler: chỉ đợi nếu thời gian ngắn (<= 30s), không đóng băng bot hàng giờ
    if (res.status === 429) {
        const retryData = await res.json().catch(() => ({}));
        const retryAfterSec = retryData.retry_after || parseFloat(res.headers.get("retry-after")) || (2 ** retryCount);
        if (endpoint.includes("/enroll")) {
            enrollCooldownUntil = Date.now() + Math.ceil(retryAfterSec * 1000);
        }
        if (retryAfterSec > 30) {
            console.warn(`[Ivyseal DQC] Rate limited quá dài (${retryAfterSec.toFixed(1)}s). Bỏ qua request này.`);
            const err = new Error(`Rate limited ${retryAfterSec.toFixed(1)}s`);
            err.status = 429;
            err.retryAfter = retryAfterSec;
            throw err;
        }
        const waitMs = Math.ceil(retryAfterSec * 1000) + 500;
        console.warn(`[Ivyseal DQC] Rate limited! Đợi ${(waitMs / 1000).toFixed(1)}s rồi retry... (lần ${retryCount + 1}/${MAX_RETRIES})`);
        if (retryCount >= MAX_RETRIES) {
            const err = new Error(`Rate limited sau ${MAX_RETRIES} lần retry`);
            err.status = 429;
            throw err;
        }
        await new Promise(r => setTimeout(r, waitMs));
        return discordRequest(endpoint, method, token, body, retryCount + 1, isDesktop);
    }

    if (res.status === 204) return true;
    const text = await res.text();
    try {
        const json = JSON.parse(text);
        if (!res.ok) {
            const err = new Error(json.message || `Lỗi HTTP ${res.status}`);
            err.status = res.status;
            err.code = json.code;
            throw err;
        }
        return json;
    } catch (e) {
        if (!res.ok) {
            const err = new Error(`Lỗi HTTP ${res.status}: ${text}`);
            err.status = res.status;
            throw err;
        }
        return text;
    }
}

// Xác thực token và lấy thông tin tài khoản Discord
async function fetchUserInfo(token) {
    return await discordRequest("/users/@me", "GET", token);
}

// Lấy danh sách Quest của người dùng (chỉ lấy các quest có cấu hình hợp lệ)
async function fetchUserQuests(token) {
    const data = await discordRequest("/quests/@me", "GET", token);
    const mainQuests = Array.isArray(data?.quests) ? data.quests : [];
    const excludedQuests = Array.isArray(data?.excluded_quests) ? data.excluded_quests : [];

    // Chỉ giữ lại nhiệm vụ có cấu hình thực tế (bỏ các placeholder { id, replacement_id })
    const validMain = mainQuests.filter(q => q && q.config);
    const validExcluded = excludedQuests.filter(q => q && q.config);

    const all = [...validMain];
    for (const eq of validExcluded) {
        if (!all.some(q => q.id === eq.id)) {
            all.push(eq);
        }
    }

    console.log(`[Ivyseal DQC] Lấy được: ${validMain.length} nhiệm vụ chính, ${all.length - validMain.length} nhiệm vụ mở rộng.`);
    return all;
}

// Đếm chính xác số Orb của một nhiệm vụ từ Discord API (chuẩn theo Orion DQC)
function getQuestOrbs(quest, isPremium = false) {
    if (!quest || !quest.config) return 0;
    const rewardsConfig = quest.config?.rewards_config || quest.config?.rewardsConfig;
    const rewards = rewardsConfig?.rewards || [];
    if (!Array.isArray(rewards)) return 0;

    let totalOrbs = 0;
    for (const r of rewards) {
        const base = Number(r?.orb_quantity ?? r?.orbQuantity ?? 0);
        if (base > 0) {
            if (isPremium) {
                const prem = Number(r?.premium_orb_quantity ?? r?.premiumOrbQuantity ?? base);
                totalOrbs += prem;
            } else {
                totalOrbs += base;
            }
        }
    }
    return totalOrbs;
}

// Ghi danh tham gia quest (cần location: 11 để Discord không từ chối)
async function enrollQuest(token, questId) {
    return await discordRequest(`/quests/${questId}/enroll`, "POST", token, {
        location: 11,
        is_targeted: false,
        metadata_sealed: null,
        traffic_metadata_sealed: null
    });
}

// Gửi tiến trình cho nhiệm vụ xem Video (/video-progress)
async function sendVideoProgress(token, questId, timestamp) {
    return await discordRequest(`/quests/${questId}/video-progress`, "POST", token, {
        timestamp: Number(timestamp.toFixed(6))
    });
}

// Gửi heartbeat tiến trình cho nhiệm vụ chơi Game / Stream (/heartbeat)
async function sendQuestHeartbeat(token, questId, appId, terminal = false) {
    const payload = { terminal: !!terminal };
    return await discordRequest(`/quests/${questId}/heartbeat`, "POST", token, payload, 0, true);
}

// Nhận thưởng nhiệm vụ (hỗ trợ cả claim-reward và claim)
async function claimQuestReward(token, questId) {
    const body = {
        platform: 0,
        location: 11,
        is_targeted: false,
        metadata_sealed: null,
        traffic_metadata_sealed: null
    };
    try {
        return await discordRequest(`/quests/${questId}/claim-reward`, "POST", token, body);
    } catch (_) {
        return await discordRequest(`/quests/${questId}/claim`, "POST", token, { platform: 0 });
    }
}

// Kiểm tra quest đã hết hạn chưa (hỗ trợ cả expiresAt và expires_at)
function isQuestExpired(quest) {
    const exp = quest.config?.expiresAt || quest.config?.expires_at;
    if (!exp) return false;
    const t = new Date(exp).getTime();
    return !Number.isNaN(t) && t <= Date.now();
}

// Nhận diện loại nhiệm vụ: WATCH_VIDEO hay GAME
function detectQuestTask(quest) {
    const cfg = quest.config?.task_config_v2 || quest.config?.task_config || quest.config?.taskConfigV2 || quest.config?.taskConfig;
    const tasks = cfg?.tasks || {};
    const keys = Object.keys(tasks);
    const appId = quest.config?.application?.id
        || tasks["PLAY_ON_DESKTOP"]?.applications?.[0]?.id
        || tasks["PLAY_ON_DESKTOP"]?.applicationId
        || Object.values(tasks)[0]?.applications?.[0]?.id;

    // 1. Bất kỳ nhiệm vụ nào có chứa "VIDEO" (bao gồm WATCH_VIDEO, WATCH_VIDEO_ON_MOBILE, v.v.)
    const videoKey = keys.find(k => k.toUpperCase().includes("VIDEO"));
    if (videoKey) {
        return {
            type: "WATCH_VIDEO",
            keyName: videoKey,
            target: tasks[videoKey]?.target || 60,
            appId
        };
    }

    // 2. Nhiệm vụ Game
    const playKey = keys.find(k => k.startsWith("PLAY") || k.includes("DESKTOP"));
    if (playKey) {
        return {
            type: "GAME",
            keyName: playKey,
            target: tasks[playKey]?.target || 900,
            appId: appId || tasks[playKey]?.applications?.[0]?.id || tasks[playKey]?.applicationId
        };
    }

    // 3. Nhiệm vụ Stream
    const streamKey = keys.find(k => k.startsWith("STREAM"));
    if (streamKey) {
        return {
            type: "STREAM",
            keyName: streamKey,
            target: tasks[streamKey]?.target || 900,
            appId: appId || tasks[streamKey]?.applications?.[0]?.id || tasks[streamKey]?.applicationId
        };
    }

    const firstKey = keys[0] || "PLAY_ON_DESKTOP";
    return {
        type: firstKey.toUpperCase().includes("VIDEO") ? "WATCH_VIDEO" : "GAME",
        keyName: firstKey,
        target: tasks[firstKey]?.target || 900,
        appId
    };
}

// Lấy tên hiển thị chuẩn xác nhất của nhiệm vụ (hỗ trợ cả video quest, game quest, v.v.)
function getQuestName(quest) {
    if (!quest || !quest.config) return "Nhiệm vụ Discord";
    const cfg = quest.config;
    return (
        cfg.messages?.questName ||
        cfg.messages?.quest_name ||
        cfg.messages?.gameTitle ||
        cfg.messages?.game_title ||
        cfg.application?.name ||
        "Nhiệm vụ Discord"
    );
}

// Chạy một quest tự động và gọi callback cập nhật tiến trình ra Discord
async function executeQuest(token, quest, onProgress) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const userStatus = quest.user_status;

    if (isQuestExpired(quest)) {
        console.warn(`[Ivyseal DQC] Quest "${questName}" (${questId}) đã hết hạn. Bỏ qua.`);
        return { success: false, expired: true, questName };
    }

    // Đã hoàn thành từ trước -> Ghi nhận và chuyển tiếp
    if (userStatus?.completed_at) {
        console.log(`[Ivyseal DQC] Quest "${questName}" đã hoàn thành từ trước.`);
        return { success: true, alreadyCompleted: true, questName };
    }

    // Chưa ghi danh -> Tự động ghi danh (Enroll)
    if (!userStatus?.enrolled_at) {
        if (enrollCooldownUntil && Date.now() < enrollCooldownUntil) {
            const waitMins = Math.ceil((enrollCooldownUntil - Date.now()) / 60000);
            console.warn(`[Ivyseal DQC] Bỏ qua "${questName}" vì tính năng Enroll đang bị cooldown (${waitMins} phút nữa).`);
            return { success: false, questName, error: `Enroll đang cooldown (${waitMins} phút)` };
        }

        await onProgress({ status: "enrolling", questName, percent: 0 });
        try {
            await enrollQuest(token, questId);
            console.log(`[Ivyseal DQC] Ghi danh thành công (Desktop App): "${questName}"`);
        } catch (err) {
            console.warn(`[Ivyseal DQC] Ghi danh "${questName}": ${err.message}`);
            if (err.status === 404 || err.code === 260017) {
                return { success: false, expired: true, questName, error: err.message };
            }
            if (err.status === 429) {
                const waitMins = Math.ceil((err.retryAfter || 2400) / 60);
                return { success: false, questName, error: `Enroll bị giới hạn tạm thời (${waitMins} phút)` };
            }
            return { success: false, skipped: true, requiresPlayer: true, questName, error: `Không thể ghi danh: ${err.message}` };
        }
    }

    const task = detectQuestTask(quest);
    const targetSec = task.target || 900;
    let curSec = userStatus?.progress?.[task.keyName]?.value || 0;

    await onProgress({
        status: "running",
        questName,
        currentSec: curSec,
        targetSec,
        percent: Math.min(100, Math.floor((curSec / targetSec) * 100))
    });

    let consecutiveErrors = 0;
    let consecutiveNoProgress = 0;
    const MAX_NO_PROGRESS_ATTEMPTS = 3; // Thử tối đa 3 lần nếu server không tăng tiến trình
    const MAX_CONSECUTIVE_ERRORS = 3;   // Thử tối đa 3 lần nếu gặp lỗi mạng/API liên tiếp

    // A. XỬ LÝ NHIỆM VỤ DẠNG VIDEO (WATCH_VIDEO)
    if (task.type === "WATCH_VIDEO") {
        let lastVideoSec = curSec;
        while (curSec < targetSec) {
            const delayMs = 8000;
            await new Promise(r => setTimeout(r, delayMs));
            curSec += (delayMs / 1000);
            curSec = Math.min(targetSec, curSec);

            try {
                const res = await sendVideoProgress(token, questId, curSec);
                consecutiveErrors = 0;
                const serverVal = res?.progress?.[task.keyName]?.value ?? res?.user_status?.progress?.[task.keyName]?.value;
                if (serverVal !== undefined && serverVal !== null) {
                    if (serverVal <= lastVideoSec && serverVal < targetSec) {
                        consecutiveNoProgress++;
                        console.warn(`[Ivyseal DQC] [Video] "${questName}": Tiến trình không tăng (${serverVal}s). Thử lần ${consecutiveNoProgress}/${MAX_NO_PROGRESS_ATTEMPTS}...`);
                        if (consecutiveNoProgress >= MAX_NO_PROGRESS_ATTEMPTS) {
                            console.warn(`[Ivyseal DQC] [Video] "${questName}": Bỏ qua vì tiến trình video không phản hồi.`);
                            await onProgress({
                                status: "skipped",
                                questName,
                                currentSec: serverVal,
                                targetSec,
                                percent: Math.min(100, Math.floor((serverVal / targetSec) * 100)),
                                error: "Cần tự xem/làm trong app"
                            });
                            await new Promise(r => setTimeout(r, 2000));
                            return { success: false, skipped: true, requiresPlayer: true, questName, error: "Tiến trình video không phản hồi" };
                        }
                    } else {
                        consecutiveNoProgress = 0;
                        lastVideoSec = serverVal;
                    }
                    if (serverVal > curSec) {
                        curSec = serverVal;
                    }
                }
                curSec = Math.min(targetSec, curSec);

                const percent = Math.min(100, Math.floor((curSec / targetSec) * 100));
                console.log(`[Ivyseal DQC] [Video] "${questName}": ${Math.floor(curSec)}s / ${targetSec}s (${percent}%)`);
                await onProgress({
                    status: "running",
                    questName,
                    currentSec: Math.floor(curSec),
                    targetSec,
                    percent
                });

                if (res?.completed_at || res?.user_status?.completed_at || curSec >= targetSec) {
                    curSec = targetSec;
                    await onProgress({
                        status: "running",
                        questName,
                        currentSec: targetSec,
                        targetSec,
                        percent: 100
                    });
                    break;
                }
            } catch (err) {
                consecutiveErrors++;
                console.warn(`[Ivyseal DQC] Video progress "${questName}": ${err.message} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
                if (err.status === 404 || err.code === 260017 || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    await onProgress({
                        status: "skipped",
                        questName,
                        currentSec: Math.floor(curSec),
                        targetSec,
                        percent: Math.min(100, Math.floor((curSec / targetSec) * 100)),
                        error: err.message
                    });
                    await new Promise(r => setTimeout(r, 2000));
                    return { success: false, skipped: true, requiresPlayer: true, questName, error: err.message };
                }
            }
        }
    } else {
        // B. XỬ LÝ NHIỆM VỤ DẠNG CHƠI GAME / STREAM / HEARTBEAT
        let lastServerVal = curSec;
        while (true) {
            await new Promise(r => setTimeout(r, 30000));
            try {
                curSec += 30;
                // Luôn gửi terminal: false trong quá trình đếm
                const beatRes = await sendQuestHeartbeat(token, questId, task.appId, false);
                consecutiveErrors = 0;

                const serverVal = beatRes?.progress?.[task.keyName]?.value 
                    ?? beatRes?.progress?.PLAY_ON_DESKTOP?.value
                    ?? beatRes?.user_status?.progress?.[task.keyName]?.value
                    ?? beatRes?.user_status?.progress?.PLAY_ON_DESKTOP?.value;

                // Kiểm tra xem tiến trình Discord Server có thực sự tăng không
                if (serverVal !== undefined && serverVal !== null) {
                    if (serverVal <= lastServerVal && serverVal < targetSec) {
                        consecutiveNoProgress++;
                        console.warn(`[Ivyseal DQC] [Game] "${questName}": Server không tăng tiến trình (${serverVal}s / ${targetSec}s). Thử lần ${consecutiveNoProgress}/${MAX_NO_PROGRESS_ATTEMPTS}...`);
                        
                        if (consecutiveNoProgress >= MAX_NO_PROGRESS_ATTEMPTS) {
                            console.warn(`[Ivyseal DQC] [Game] "${questName}": Không tăng tiến trình sau ${MAX_NO_PROGRESS_ATTEMPTS} lần thử. Bỏ qua (nhiệm vụ yêu cầu người chơi tự vào game/liên kết tài khoản).`);
                            await onProgress({
                                status: "skipped",
                                questName,
                                currentSec: serverVal,
                                targetSec,
                                percent: Math.min(100, Math.floor((serverVal / targetSec) * 100)),
                                error: "Cần tự vào game làm"
                            });
                            await new Promise(r => setTimeout(r, 2000));
                            return {
                                success: false,
                                skipped: true,
                                requiresPlayer: true,
                                questName,
                                error: "Yêu cầu người chơi tự vào game làm (tiến trình không tăng)"
                            };
                        }
                    } else {
                        // Tiến trình có tăng -> reset bộ đếm
                        consecutiveNoProgress = 0;
                        lastServerVal = serverVal;
                    }
                    curSec = serverVal;
                } else {
                    // Không có trường progress trả về từ server
                    consecutiveNoProgress++;
                    console.warn(`[Ivyseal DQC] [Game] "${questName}": Server không trả về tiến trình hợp lệ. Thử lần ${consecutiveNoProgress}/${MAX_NO_PROGRESS_ATTEMPTS}...`);
                    if (consecutiveNoProgress >= MAX_NO_PROGRESS_ATTEMPTS) {
                        console.warn(`[Ivyseal DQC] [Game] "${questName}": Bỏ qua vì không nhận được phản hồi tiến trình hợp lệ.`);
                        await onProgress({
                            status: "skipped",
                            questName,
                            currentSec: curSec,
                            targetSec,
                            percent: Math.min(100, Math.floor((curSec / targetSec) * 100)),
                            error: "Cần tự vào game làm"
                        });
                        await new Promise(r => setTimeout(r, 2000));
                        return {
                            success: false,
                            skipped: true,
                            requiresPlayer: true,
                            questName,
                            error: "Yêu cầu người chơi tự vào game làm (Discord không phản hồi tiến trình)"
                        };
                    }
                }

                const displaySec = Math.min(targetSec, curSec);
                const percent = Math.min(99, Math.floor((displaySec / targetSec) * 100));
                console.log(`[Ivyseal DQC] [Game] "${questName}": ${Math.floor(displaySec)}s / ${targetSec}s (${percent}%) [Server: ${serverVal !== undefined ? serverVal : curSec}s]`);

                await onProgress({
                    status: "running",
                    questName,
                    currentSec: Math.floor(displaySec),
                    targetSec,
                    percent
                });

                // Chỉ kết thúc khi Discord Server xác nhận completed_at HOẶC serverVal >= targetSec
                if (beatRes?.completed_at || beatRes?.user_status?.completed_at || (serverVal !== undefined && serverVal >= targetSec)) {
                    // Gửi một heartbeat terminal: true cuối cùng để chốt phiên
                    try {
                        await sendQuestHeartbeat(token, questId, task.appId, true);
                    } catch (_) {}

                    curSec = targetSec;
                    await onProgress({
                        status: "running",
                        questName,
                        currentSec: targetSec,
                        targetSec,
                        percent: 100
                    });
                    break;
                }
            } catch (err) {
                consecutiveErrors++;
                console.warn(`[Ivyseal DQC] Heartbeat warning "${questName}": ${err.message} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
                
                // Nếu lỗi 400 (Bad Request), 403 (Forbidden), 404 (Not Found) hoặc lỗi liên tiếp >= MAX_CONSECUTIVE_ERRORS
                if (err.status === 400 || err.status === 403 || err.status === 404 || err.code === 260017 || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    console.warn(`[Ivyseal DQC] [Game] "${questName}": Bỏ qua do không thể heartbeat tự động (${err.message}).`);
                    await onProgress({
                        status: "skipped",
                        questName,
                        currentSec: Math.floor(curSec),
                        targetSec,
                        percent: Math.min(100, Math.floor((curSec / targetSec) * 100)),
                        error: err.message
                    });
                    await new Promise(r => setTimeout(r, 2000));
                    return {
                        success: false,
                        skipped: true,
                        requiresPlayer: true,
                        questName,
                        error: `Cần tự vào game làm (${err.message})`
                    };
                }
            }
        }
    }

    // Hoàn thành nhiệm vụ 100%
    console.log(`[Ivyseal DQC] "${questName}": Đã hoàn thành 100%!`);
    await onProgress({ status: "completed", questName, currentSec: targetSec, targetSec, percent: 100 });
    // Tạm dừng 3 giây để giao diện Discord kịp hiển thị 100% trước khi chuyển sang quest tiếp theo
    await new Promise(r => setTimeout(r, 3000));
    return { success: true, completed: true, questName };
}

// Giãn cách an toàn giữa các quest theo loại nhiệm vụ:
// - Nhiệm vụ 15 phút (game/stream): 1 phút (60s)
// - Nhiệm vụ 200 orb (xem video): 15 giây (15s)
function getQuestIntermissionDelay(quest) {
    if (!quest) return { sec: 15, ms: 15000, label: "15 giây" };
    const task = detectQuestTask(quest);
    const orbs = getQuestOrbs(quest);
    const isVideo = (task?.type === "WATCH_VIDEO" || orbs === 200);
    return isVideo
        ? { sec: 15, ms: 15000, label: "15 giây (quest 200 orb / xem video)" }
        : { sec: 60, ms: 60000, label: "1 phút (quest 15 phút)" };
}

module.exports = {
    fetchUserQuests,
    fetchUserInfo,
    getQuestOrbs,
    getQuestName,
    enrollQuest,
    sendVideoProgress,
    sendQuestHeartbeat,
    claimQuestReward,
    isQuestExpired,
    detectQuestTask,
    executeQuest,
    randomDelay,
    getQuestIntermissionDelay
};
