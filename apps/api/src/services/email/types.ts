export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  templateId?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}

export interface IEmailTransport {
  readonly transportName: string;
  isConfigured(): boolean;
  sendEmail(message: EmailMessage): Promise<EmailSendResult>;
}
