import crypto from 'node:crypto';
import { EmailMessage, EmailSendResult, IEmailTransport } from './types';
import { resolveDefaultEmailTransport } from './transports';
import { EmailOutboxService, getEmailOutboxService } from './emailOutbox.service';

export class EmailDispatcher {
  private transport: IEmailTransport;
  private outboxService: EmailOutboxService | null = null;

  constructor(transport?: IEmailTransport, outboxService?: EmailOutboxService) {
    this.transport = transport ?? resolveDefaultEmailTransport();
    this.outboxService = outboxService ?? null;
  }

  setTransport(transport: IEmailTransport): void {
    this.transport = transport;
    if (this.outboxService) {
      this.outboxService.setTransport(transport);
    }
  }

  getTransport(): IEmailTransport {
    return this.transport;
  }

  setOutboxService(service: EmailOutboxService): void {
    this.outboxService = service;
  }

  getOutboxService(): EmailOutboxService {
    if (!this.outboxService) {
      this.outboxService = getEmailOutboxService();
    }
    return this.outboxService;
  }

  /**
   * Enqueues an outgoing email into the durable outbox and immediately processes it.
   * Guarantees persistence before delivery attempt, crash-recovery, and deduplication.
   */
  async dispatchDurableEmail(
    message: EmailMessage,
    idempotencyKey?: string
  ): Promise<{ outboxId: string; status: string; duplicate: boolean }> {
    const key = idempotencyKey || `email:${crypto.randomUUID()}`;
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
      void outbox.processPendingBatch(10).catch(() => {});
    }

    return enqueueRes;
  }

  /**
   * Dispatches an email message via the active transport.
   * Guarantees fail-safe behavior: will never throw an exception or interrupt
   * caller transactions. If transport fails, returns error result cleanly.
   */
  async sendEmail(message: EmailMessage, idempotencyKey?: string): Promise<EmailSendResult> {
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
      void outbox.processPendingBatch(10).catch(() => {});
    }

    try {
      return await this.transport.sendEmail({
        ...message,
        to,
      });
    } catch (err: unknown) {
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

let defaultDispatcher: EmailDispatcher | null = null;

export function getEmailDispatcher(): EmailDispatcher {
  if (!defaultDispatcher) {
    defaultDispatcher = new EmailDispatcher();
  }
  return defaultDispatcher;
}

export function setEmailDispatcher(dispatcher: EmailDispatcher): void {
  defaultDispatcher = dispatcher;
}
