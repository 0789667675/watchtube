"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailDispatcher = void 0;
exports.getEmailDispatcher = getEmailDispatcher;
exports.setEmailDispatcher = setEmailDispatcher;
const node_crypto_1 = __importDefault(require("node:crypto"));
const transports_1 = require("./transports");
const emailOutbox_service_1 = require("./emailOutbox.service");
class EmailDispatcher {
    transport;
    outboxService = null;
    constructor(transport, outboxService) {
        this.transport = transport ?? (0, transports_1.resolveDefaultEmailTransport)();
        this.outboxService = outboxService ?? null;
    }
    setTransport(transport) {
        this.transport = transport;
        if (this.outboxService) {
            this.outboxService.setTransport(transport);
        }
    }
    getTransport() {
        return this.transport;
    }
    setOutboxService(service) {
        this.outboxService = service;
    }
    getOutboxService() {
        if (!this.outboxService) {
            this.outboxService = (0, emailOutbox_service_1.getEmailOutboxService)();
        }
        return this.outboxService;
    }
    /**
     * Enqueues an outgoing email into the durable outbox and immediately processes it.
     * Guarantees persistence before delivery attempt, crash-recovery, and deduplication.
     */
    async dispatchDurableEmail(message, idempotencyKey) {
        const key = idempotencyKey || `email:${node_crypto_1.default.randomUUID()}`;
        const outbox = this.getOutboxService();
        const enqueueRes = await outbox.enqueueEmail({
            idempotencyKey: key,
            to: message.to,
            from: message.from,
            subject: message.subject,
            text: message.text,
            html: message.html,
            templateId: message.templateId,
            metadata: message.metadata,
        });
        // Trigger immediate batch processing for responsive delivery
        if (enqueueRes.status === 'PENDING') {
            void outbox.processPendingBatch(10).catch(() => { });
        }
        return enqueueRes;
    }
    /**
     * Dispatches an email message via the active transport.
     * Guarantees fail-safe behavior: will never throw an exception or interrupt
     * caller transactions. If transport fails, returns error result cleanly.
     */
    async sendEmail(message, idempotencyKey) {
        const to = message.to?.trim();
        if (!to || !to.includes('@')) {
            return {
                success: false,
                error: `Invalid recipient email address: "${message.to}"`,
                timestamp: new Date(),
            };
        }
        // When an idempotency key is supplied, persist to durable outbox
        if (idempotencyKey) {
            const outbox = this.getOutboxService();
            await outbox.enqueueEmail({
                idempotencyKey,
                to,
                from: message.from,
                subject: message.subject,
                text: message.text,
                html: message.html,
                templateId: message.templateId,
                metadata: message.metadata,
            });
            void outbox.processPendingBatch(10).catch(() => { });
        }
        try {
            return await this.transport.sendEmail({
                ...message,
                to,
            });
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[EmailDispatcher] Transport error sending to ${to}:`, errorMsg);
            return {
                success: false,
                error: errorMsg,
                timestamp: new Date(),
            };
        }
    }
}
exports.EmailDispatcher = EmailDispatcher;
let defaultDispatcher = null;
function getEmailDispatcher() {
    if (!defaultDispatcher) {
        defaultDispatcher = new EmailDispatcher();
    }
    return defaultDispatcher;
}
function setEmailDispatcher(dispatcher) {
    defaultDispatcher = dispatcher;
}
