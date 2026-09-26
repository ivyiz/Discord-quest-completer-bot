/**
 * ============================================================================
 * 📝 IVYSEAL LOGGER — Ghi log ra file tự động
 * ============================================================================
 * Require file này ở đầu index.js để tự động ghi tất cả console.log/warn/error
 * ra file log theo ngày trong thư mục logs/
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
    const date = new Date().toISOString().split("T")[0];
    return path.join(LOG_DIR, `ivyseal-${date}.log`);
}

function safeFormat(a) {
    if (a instanceof Error) {
        let text = `${a.name}: ${a.message}`;
        if (a.code) text += ` [Code: ${a.code}]`;
        if (a.status) text += ` [Status: ${a.status}]`;
        if (a.stack) text += `\n${a.stack}`;
        return text;
    }
    if (typeof a === "object" && a !== null) {
        try {
            return JSON.stringify(a, (key, value) => {
                if (Buffer.isBuffer(value) || (value && value.type === "Buffer")) {
                    return `[Buffer ${(value.data && value.data.length) || value.length || 0} bytes]`;
                }
                if (key === "client" || key === "guild" || key === "guilds" || key === "channels" || key === "users" || key === "members") {
                    return "[Discord Cache]";
                }
                if (key === "files" && Array.isArray(value)) {
                    return `[${value.length} File(s)]`;
                }
                return value;
            }, 2);
        } catch (_) {
            return String(a);
        }
    }
    return String(a);
}

function writeToFile(level, args) {
    const timestamp = new Date().toISOString();
    let message = args.map(safeFormat).join(" ");
    // Giới hạn độ dài tối đa mỗi dòng log tránh nghẽn I/O
    if (message.length > 5000) {
        message = message.slice(0, 5000) + "... [TRUNCATED]";
    }
    const line = `[${timestamp}] [${level}] ${message}\n`;
    try {
        fs.appendFile(getLogFile(), line, () => {});
    } catch (_) {}
}

// Patch console methods
const _log = console.log;
const _warn = console.warn;
const _error = console.error;

console.log = (...args) => {
    _log(...args);
    writeToFile("INFO", args);
};
console.warn = (...args) => {
    _warn(...args);
    writeToFile("WARN", args);
};
console.error = (...args) => {
    _error(...args);
    writeToFile("ERROR", args);
};

module.exports = { getLogFile, LOG_DIR };
