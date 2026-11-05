class UserGatewayConnection {
    constructor(token, initialActivity = null) {
        this.token = (token || "").trim().replace(/^["']|["']$/g, "");
        this.currentActivity = initialActivity;
        this.ws = null;
        this.initialTimeout = null;
        this.heartbeatTimer = null;
        this.lastSequence = null;
        this.destroyed = false;
        this.connect();
    }

    connect() {
        if (!this.token || this.destroyed) return;

        try {
            this.ws = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");
        } catch (err) {
            console.warn("[User Gateway] Init error:", err.message);
            return;
        }

        this.ws.onopen = () => {
            console.log("[User Gateway] Connected to Discord Gateway.");
        };

        this.ws.onmessage = (event) => {
            try {
                const packet = JSON.parse(event.data);
                if (packet.s !== null && packet.s !== undefined) {
                    this.lastSequence = packet.s;
                }
                this.handlePacket(packet);
            } catch (_) {}
        };

        this.ws.onerror = (err) => {
            const msg = err.message || err.error?.message || "connection error";
            console.warn("[User Gateway] Socket warning:", msg);
        };

        this.ws.onclose = (event) => {
            this.clearHeartbeat();
            if (!this.destroyed) {
                console.log(`[User Gateway] Socket closed (${event.code}). Cleaning up.`);
            }
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    handlePacket(packet) {
        const { op, d } = packet;

        if (op === 10) {
            const heartbeatInterval = d.heartbeat_interval || 41250;
            this.startHeartbeat(heartbeatInterval);
            this.identify();
            return;
        }

        if (op === 1) {
            this.sendHeartbeat();
            return;
        }

        if (op === 7 || op === 9) {
            if (!this.destroyed) {
                this.destroy();
            }
            return;
        }
    }

    startHeartbeat(intervalMs) {
        this.clearHeartbeat();
        const firstDelay = Math.floor(intervalMs * Math.random());
        this.initialTimeout = setTimeout(() => {
            if (this.destroyed) return;
            this.sendHeartbeat();
            this.heartbeatTimer = setInterval(() => {
                if (this.destroyed) return;
                this.sendHeartbeat();
            }, intervalMs);
        }, firstDelay);
    }

    sendHeartbeat() {
        this.send({
            op: 1,
            d: this.lastSequence
        });
    }

    clearHeartbeat() {
        if (this.initialTimeout) {
            clearTimeout(this.initialTimeout);
            this.initialTimeout = null;
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    identify() {
        const activities = [];
        if (this.currentActivity?.name) {
            activities.push({
                name: this.currentActivity.name,
                type: 0,
                application_id: this.currentActivity.appId || undefined
            });
        }

        const payload = {
            op: 2,
            d: {
                token: this.token,
                capabilities: 30717,
                properties: {
                    os: "Windows",
                    browser: "Discord Client",
                    release_channel: "stable",
                    client_version: "1.0.9180",
                    os_version: "10.0.22631",
                    os_arch: "x64",
                    system_locale: "en-US",
                    client_build_number: 382400
                },
                presence: {
                    status: "online",
                    since: 0,
                    activities,
                    afk: false
                }
            }
        };
        this.send(payload);
    }

    updateActivity(name, appId) {
        this.currentActivity = { name, appId };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.send({
                op: 3,
                d: {
                    since: 0,
                    activities: [{
                        name,
                        type: 0,
                        application_id: appId || undefined
                    }],
                    status: "online",
                    afk: false
                }
            });
        }
    }

    destroy() {
        this.destroyed = true;
        this.clearHeartbeat();
        if (this.ws) {
            try {
                this.ws.close(1000, "Quest Completed");
            } catch (_) {}
            this.ws = null;
        }
    }
}

module.exports = {
    UserGatewayConnection
};
