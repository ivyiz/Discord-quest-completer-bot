const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const ELECTRON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36";
const SUPER_PROPERTIES = Buffer.from(JSON.stringify({
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: "en-US",
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

function randomDelay(minMs = 5000, maxMs = 20000) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    console.log(`[Ivyseal DQC] Anti-detection: Waiting ${(ms / 1000).toFixed(1)}s before continuing...`);
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
        headers["X-Discord-Locale"] = "en-US";
        headers["X-Discord-Timezone"] = "UTC";
    }

    const options = { method, headers };
    if (body && method !== "GET") {
        options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (res.status === 429) {
        const retryData = await res.json().catch(() => ({}));
        const retryAfterSec = retryData.retry_after || parseFloat(res.headers.get("retry-after")) || (2 ** retryCount);
        if (endpoint.includes("/enroll")) {
            enrollCooldownUntil = Date.now() + Math.ceil(retryAfterSec * 1000);
        }
        if (retryAfterSec > 30) {
            console.warn(`[Ivyseal DQC] Rate limited for too long (${retryAfterSec.toFixed(1)}s). Skipping this request.`);
            const err = new Error(`Rate limited ${retryAfterSec.toFixed(1)}s`);
            err.status = 429;
            err.retryAfter = retryAfterSec;
            throw err;
        }
        const waitMs = Math.ceil(retryAfterSec * 1000) + 500;
        console.warn(`[Ivyseal DQC] Rate limited! Waiting ${(waitMs / 1000).toFixed(1)}s then retrying... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        if (retryCount >= MAX_RETRIES) {
            const err = new Error(`Rate limited after ${MAX_RETRIES} retries`);
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
            const err = new Error(json.message || `HTTP Error ${res.status}`);
            err.status = res.status;
            err.code = json.code;
            throw err;
        }
        return json;
    } catch (e) {
        if (!res.ok) {
            const err = new Error(`HTTP Error ${res.status}: ${text}`);
            err.status = res.status;
            throw err;
        }
        return text;
    }
}

async function fetchUserInfo(token) {
    return await discordRequest("/users/@me", "GET", token);
}

async function fetchUserQuests(token) {
    const data = await discordRequest("/quests/@me", "GET", token);
    const mainQuests = Array.isArray(data?.quests) ? data.quests : [];
    const excludedQuests = Array.isArray(data?.excluded_quests) ? data.excluded_quests : [];

    const validMain = mainQuests.filter(q => q && q.config);
    const validExcluded = excludedQuests.filter(q => q && q.config);

    const all = [...validMain];
    for (const eq of validExcluded) {
        if (!all.some(q => q.id === eq.id)) {
            all.push(eq);
        }
    }

    console.log(`[Ivyseal DQC] Retrieved: ${validMain.length} main quests, ${all.length - validMain.length} extended quests.`);
    return all;
}

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

async function enrollQuest(token, questId) {
    return await discordRequest(`/quests/${questId}/enroll`, "POST", token, {
        location: 11,
        is_targeted: false,
        metadata_sealed: null,
        traffic_metadata_sealed: null
    });
}

async function sendVideoProgress(token, questId, timestamp) {
    return await discordRequest(`/quests/${questId}/video-progress`, "POST", token, {
        timestamp: Number(timestamp.toFixed(6))
    });
}

async function sendQuestHeartbeat(token, questId, appId, terminal = false) {
    const payload = { terminal: !!terminal };
    return await discordRequest(`/quests/${questId}/heartbeat`, "POST", token, payload, 0, true);
}

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

function isQuestExpired(quest) {
    const exp = quest.config?.expiresAt || quest.config?.expires_at;
    if (!exp) return false;
    const t = new Date(exp).getTime();
    return !Number.isNaN(t) && t <= Date.now();
}

function detectQuestTask(quest) {
    const cfg = quest.config?.task_config_v2 || quest.config?.task_config || quest.config?.taskConfigV2 || quest.config?.taskConfig;
    const tasks = cfg?.tasks || {};
    const keys = Object.keys(tasks);
    const appId = quest.config?.application?.id
        || tasks["PLAY_ON_DESKTOP"]?.applications?.[0]?.id
        || tasks["PLAY_ON_DESKTOP"]?.applicationId
        || Object.values(tasks)[0]?.applications?.[0]?.id;

    const videoKey = keys.find(k => k.toUpperCase().includes("VIDEO"));
    if (videoKey) {
        return {
            type: "WATCH_VIDEO",
            keyName: videoKey,
            target: tasks[videoKey]?.target || 60,
            appId
        };
    }

    const playKey = keys.find(k => k.startsWith("PLAY") || k.includes("DESKTOP"));
    if (playKey) {
        return {
            type: "GAME",
            keyName: playKey,
            target: tasks[playKey]?.target || 900,
            appId: appId || tasks[playKey]?.applications?.[0]?.id || tasks[playKey]?.applicationId
        };
    }

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

function getQuestName(quest) {
    if (!quest || !quest.config) return "Discord Quest";
    const cfg = quest.config;
    return (
        cfg.messages?.questName ||
        cfg.messages?.quest_name ||
        cfg.messages?.gameTitle ||
        cfg.messages?.game_title ||
        cfg.application?.name ||
        "Discord Quest"
    );
}

async function executeQuest(token, quest, onProgress) {
    const questId = quest.id;
    const questName = getQuestName(quest);
    const userStatus = quest.user_status;

    if (isQuestExpired(quest)) {
        console.warn(`[Ivyseal DQC] Quest "${questName}" (${questId}) has expired. Skipping.`);
        return { success: false, expired: true, questName };
    }

    if (userStatus?.completed_at) {
        console.log(`[Ivyseal DQC] Quest "${questName}" was already completed.`);
        return { success: true, alreadyCompleted: true, questName };
    }

    if (!userStatus?.enrolled_at) {
        if (enrollCooldownUntil && Date.now() < enrollCooldownUntil) {
            const waitMins = Math.ceil((enrollCooldownUntil - Date.now()) / 60000);
            console.warn(`[Ivyseal DQC] Skipping "${questName}" because Enroll is on cooldown (${waitMins} min remaining).`);
            return { success: false, questName, error: `Enroll cooldown active (${waitMins} min)` };
        }

        await onProgress({ status: "enrolling", questName, percent: 0 });
        try {
            await enrollQuest(token, questId);
            console.log(`[Ivyseal DQC] Successfully enrolled (Desktop App): "${questName}"`);
        } catch (err) {
            console.warn(`[Ivyseal DQC] Enroll "${questName}": ${err.message}`);
            if (err.status === 404 || err.code === 260017) {
                return { success: false, expired: true, questName, error: err.message };
            }
            if (err.status === 429) {
                const waitMins = Math.ceil((err.retryAfter || 2400) / 60);
                return { success: false, questName, error: `Enroll temporarily rate limited (${waitMins} min)` };
            }
            return { success: false, skipped: true, requiresPlayer: true, questName, error: `Could not enroll: ${err.message}` };
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
    const MAX_NO_PROGRESS_ATTEMPTS = 3;
    const MAX_CONSECUTIVE_ERRORS = 3;

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
                        console.warn(`[Ivyseal DQC] [Video] "${questName}": Progress not increasing (${serverVal}s). Attempt ${consecutiveNoProgress}/${MAX_NO_PROGRESS_ATTEMPTS}...`);
                        if (consecutiveNoProgress >= MAX_NO_PROGRESS_ATTEMPTS) {
                            console.warn(`[Ivyseal DQC] [Video] "${questName}": Skipped because video progress did not respond.`);
                            await onProgress({
                                status: "skipped",
                                questName,
                                currentSec: serverVal,
                                targetSec,
                                percent: Math.min(100, Math.floor((serverVal / targetSec) * 100)),
                                error: "Requires manual completion in app"
                            });
                            await new Promise(r => setTimeout(r, 2000));
                            return { success: false, skipped: true, requiresPlayer: true, questName, error: "Video progress did not respond" };
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
        let lastServerVal = curSec;
        while (true) {
            await new Promise(r => setTimeout(r, 30000));
            try {
                curSec += 30;
                const beatRes = await sendQuestHeartbeat(token, questId, task.appId, false);
                consecutiveErrors = 0;

                const serverVal = beatRes?.progress?.[task.keyName]?.value 
                    ?? beatRes?.progress?.PLAY_ON_DESKTOP?.value
                    ?? beatRes?.user_status?.progress?.[task.keyName]?.value
                    ?? beatRes?.user_status?.progress?.PLAY_ON_DESKTOP?.value;

                if (serverVal !== undefined && serverVal !== null) {
                    if (serverVal <= lastServerVal && serverVal < targetSec) {
                        consecutiveNoProgress++;
                        console.warn(`[Ivyseal DQC] [Game] "${questName}": Server did not increase progress (${serverVal}s / ${targetSec}s). Attempt ${consecutiveNoProgress}/${MAX_NO_PROGRESS_ATTEMPTS}...`);
                        
                        if (consecutiveNoProgress >= MAX_NO_PROGRESS_ATTEMPTS) {
                            console.warn(`[Ivyseal DQC] [Game] "${questName}": Progress did not increase after ${MAX_NO_PROGRESS_ATTEMPTS} attempts. Skipping (manual gameplay or account linking required).`);
                            await onProgress({
                                status: "skipped",
                                questName,
                                currentSec: serverVal,
                                targetSec,
                                percent: Math.min(100, Math.floor((serverVal / targetSec) * 100)),
                                error: "Requires manual gameplay"
                            });
                            await new Promise(r => setTimeout(r, 2000));
                            return {
                                success: false,
                                skipped: true,
                                requiresPlayer: true,
                                questName,
                                error: "Requires manual gameplay (progress not increasing)"
                            };
                        }
                    } else {
                        consecutiveNoProgress = 0;
                        lastServerVal = serverVal;
                    }
                    curSec = serverVal;
                } else {
                    consecutiveNoProgress++;
                    console.warn(`[Ivyseal DQC] [Game] "${questName}": Server returned invalid progress. Attempt ${consecutiveNoProgress}/${MAX_NO_PROGRESS_ATTEMPTS}...`);
                    if (consecutiveNoProgress >= MAX_NO_PROGRESS_ATTEMPTS) {
                        console.warn(`[Ivyseal DQC] [Game] "${questName}": Skipped due to invalid progress response.`);
                        await onProgress({
                            status: "skipped",
                            questName,
                            currentSec: curSec,
                            targetSec,
                            percent: Math.min(100, Math.floor((curSec / targetSec) * 100)),
                            error: "Requires manual gameplay"
                        });
                        await new Promise(r => setTimeout(r, 2000));
                        return {
                            success: false,
                            skipped: true,
                            requiresPlayer: true,
                            questName,
                            error: "Requires manual gameplay (Discord did not return valid progress)"
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

                if (beatRes?.completed_at || beatRes?.user_status?.completed_at || (serverVal !== undefined && serverVal >= targetSec)) {
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
                
                if (err.status === 400 || err.status === 403 || err.status === 404 || err.code === 260017 || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    console.warn(`[Ivyseal DQC] [Game] "${questName}": Skipped because automatic heartbeat failed (${err.message}).`);
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
                        error: `Requires manual gameplay (${err.message})`
                    };
                }
            }
        }
    }

    console.log(`[Ivyseal DQC] "${questName}": Completed 100%!`);
    await onProgress({ status: "completed", questName, currentSec: targetSec, targetSec, percent: 100 });
    await new Promise(r => setTimeout(r, 3000));
    return { success: true, completed: true, questName };
}

function getQuestIntermissionDelay(quest) {
    if (!quest) return { sec: 15, ms: 15000, label: "15 seconds" };
    const task = detectQuestTask(quest);
    const orbs = getQuestOrbs(quest);
    const isVideo = (task?.type === "WATCH_VIDEO" || orbs === 200);
    return isVideo
        ? { sec: 15, ms: 15000, label: "15 seconds (200 orb / video quest)" }
        : { sec: 60, ms: 60000, label: "1 minute (15-min quest)" };
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
