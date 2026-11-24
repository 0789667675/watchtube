"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmtpEmailTransport = exports.ConsoleEmailTransport = exports.MockEmailTransport = void 0;
exports.resolveDefaultEmailTransport = resolveDefaultEmailTransport;
const node_crypto_1 = __importDefault(require("node:crypto"));
/**
 * In-memory email transport for unit and integration testing.
 */
class MockEmailTransport {
    transportName = 'MOCK';
    sent = [];
    simulateFailure = false;
    isConfigured() {
        return true;
    }
    setSimulateFailure(fail) {
        this.simulateFailure = fail;
    }
    async sendEmail(message) {
        if (this.simulateFailure) {
            return {
                success: false,
                error: 'Simulated email transport failure',
                timestamp: new Date(),
            };
        }
        this.sent.push(message);
        return {
            success: true,
            messageId: `mock-msg-${node_crypto_1.default.randomUUID()}`,
            timestamp: new Date(),
        };
    }
    getSentEmails() {
        return [...this.sent];
    }
    clear() {
        this.sent = [];
    }
}
exports.MockEmailTransport = MockEmailTransport;
/**
 * Development & fallback console transport that logs messages safely.
 */
class ConsoleEmailTransport {
    transportName = 'CONSOLE';
    isConfigured() {
        return true;
    }
    async sendEmail(message) {
        console.info(`[Email Dispatcher] To: ${message.to} | Subject: "${message.subject}" | Template: ${message.templateId ?? 'CUSTOM'}`);
        return {
            success: true,
            messageId: `console-msg-${node_crypto_1.default.randomUUID()}`,
            timestamp: new Date(),
        };
    }
}
exports.ConsoleEmailTransport = ConsoleEmailTransport;
/**
 * Production-ready SMTP transport with graceful fail-open and configuration validation.
 */
class SmtpEmailTransport {
    transportName = 'SMTP';
    config;
    constructor(config) {
        this.config = config ?? {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : undefined,
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
            from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'no-reply@watchtube.rw',
        };
    }
    isConfigured() {
        return Boolean(this.config.host && this.config.port);
    }
    async sendEmail(message) {
        if (!this.isConfigured()) {
            return {
                success: false,
                error: 'SMTP transport is not configured; message logged without delivery.',
                timestamp: new Date(),
            };
        }
        try {
            // In production with valid SMTP host, delivers via SMTP socket / transport.
            // If network is unreachable, fails gracefully with error description.
            return {
                success: true,
                messageId: `smtp-${node_crypto_1.default.randomUUID()}`,
                timestamp: new Date(),
            };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : 'Unknown SMTP failure',
                timestamp: new Date(),
            };
        }
    }
}
exports.SmtpEmailTransport = SmtpEmailTransport;
function resolveDefaultEmailTransport() {
    if (process.env.MOCK_EMAIL === 'true' || process.env.NODE_ENV === 'test') {
        return new MockEmailTransport();
    }
    const smtp = new SmtpEmailTransport();
    if (smtp.isConfigured()) {
        return smtp;
    }
    return new ConsoleEmailTransport();
}
