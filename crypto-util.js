const crypto = require("crypto");
const fs = require("fs");

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getOrCreateEncryptionKey(configPath) {
    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === 64) {
        return Buffer.from(process.env.ENCRYPTION_KEY, "hex");
    }

    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (_) {
        config = {};
    }

    if (config.encryptionKey && config.encryptionKey.length === 64) {
        return Buffer.from(config.encryptionKey, "hex");
    }

    const newKey = crypto.randomBytes(32).toString("hex");
    config.encryptionKey = newKey;
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    } catch (err) {
        console.warn("[Crypto] Không thể lưu encryptionKey vào config:", err.message);
    }

    return Buffer.from(newKey, "hex");
}

function encryptToken(token, keyBuffer) {
    if (!token) return "";
    const cleanToken = token.trim().replace(/^["']|["']$/g, "");
    if (cleanToken.startsWith(PREFIX)) return cleanToken;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
    let encrypted = cipher.update(cleanToken, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");

    return `${PREFIX}${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decryptToken(storedToken, keyBuffer) {
    if (!storedToken) return "";
    const str = String(storedToken).trim();
    if (!str.startsWith(PREFIX)) return str;

    const raw = str.slice(PREFIX.length);
    const parts = raw.split(":");
    if (parts.length !== 3) return str;

    const [ivHex, tagHex, encryptedHex] = parts;
    try {
        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");
        const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encryptedHex, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch (err) {
        console.error("[Crypto] Lỗi giải mã token:", err.message);
        return "";
    }
}

module.exports = {
    getOrCreateEncryptionKey,
    encryptToken,
    decryptToken
};
