"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const email_1 = require("../src/services/email");
(0, node_test_1.test)('EmailDispatcher: dispatches using MockEmailTransport and records sent messages', async () => {
    const mockTransport = new email_1.MockEmailTransport();
    const dispatcher = new email_1.EmailDispatcher(mockTransport);
    const email = (0, email_1.renderPaymentReceivedEmail)({
        recipientEmail: 'creator@example.com',
        channelName: 'Rwanda Tech Reviews',
        amountRwf: '50,000',
        provider: 'MTN_MOMO',
        transactionId: 'tx-momo-123',
    });
    const result = await dispatcher.sendEmail(email);
    strict_1.default.equal(result.success, true);
    strict_1.default.ok(result.messageId?.startsWith('mock-msg-'));
    const sent = mockTransport.getSentEmails();
    strict_1.default.equal(sent.length, 1);
    strict_1.default.equal(sent[0].to, 'creator@example.com');
    strict_1.default.equal(sent[0].templateId, 'PAYMENT_RECEIVED');
    strict_1.default.ok(sent[0].subject.includes('50,000 RWF'));
    strict_1.default.ok(sent[0].text.includes('Rwanda Tech Reviews'));
    strict_1.default.ok(sent[0].html?.includes('Rwanda Tech Reviews'));
});
(0, node_test_1.test)('EmailDispatcher: all template generators produce valid text and HTML formats', () => {
    const wtpp = (0, email_1.renderWtppStatusEmail)({
        recipientEmail: 'wtpp@example.com',
        channelName: 'Kigali Beats',
        status: 'APPROVED',
    });
    strict_1.default.equal(wtpp.templateId, 'WTPP_STATUS');
    strict_1.default.ok(wtpp.subject.includes('Approved'));
    const req = (0, email_1.renderWithdrawalRequestedEmail)({
        recipientEmail: 'pay@example.com',
        channelName: 'Channel One',
        amountRwf: '100,000',
        provider: 'AIRTEL_MONEY',
        maskedPhone: '25073****123',
        payoutId: 'payout-uuid-1',
    });
    strict_1.default.equal(req.templateId, 'WITHDRAWAL_REQUESTED');
    strict_1.default.ok(req.text.includes('25073****123'));
    const disp = (0, email_1.renderWithdrawalDispatchedEmail)({
        recipientEmail: 'pay@example.com',
        channelName: 'Channel One',
        amountRwf: '100,000',
        provider: 'MTN_MOMO',
        maskedPhone: '25078****999',
        providerReference: 'mtn-ref-987',
    });
    strict_1.default.equal(disp.templateId, 'WITHDRAWAL_DISPATCHED');
    strict_1.default.ok(disp.text.includes('mtn-ref-987'));
    const fail = (0, email_1.renderWithdrawalFailedEmail)({
        recipientEmail: 'pay@example.com',
        channelName: 'Channel One',
        amountRwf: '100,000',
        provider: 'MTN_MOMO',
        maskedPhone: '25078****999',
        reason: 'Account frozen by provider',
    });
    strict_1.default.equal(fail.templateId, 'WITHDRAWAL_FAILED');
    strict_1.default.ok(fail.text.includes('restored to your available wallet balance'));
    const sec = (0, email_1.renderSecurityAlertEmail)({
        recipientEmail: 'sec@example.com',
        title: 'Password changed',
        details: 'Your account password was updated from 192.168.1.1',
    });
    strict_1.default.equal(sec.templateId, 'SECURITY_ALERT');
    strict_1.default.ok(sec.text.includes('192.168.1.1'));
    const vid = (0, email_1.renderVideoProcessingStatusEmail)({
        recipientEmail: 'vid@example.com',
        videoTitle: 'My Journey to Volcanoes National Park',
        status: 'READY',
    });
    strict_1.default.equal(vid.templateId, 'VIDEO_PROCESSING_STATUS');
    strict_1.default.ok(vid.text.includes('My Journey to Volcanoes National Park'));
});
(0, node_test_1.test)('EmailDispatcher: rejects invalid recipient emails cleanly without throwing', async () => {
    const mockTransport = new email_1.MockEmailTransport();
    const dispatcher = new email_1.EmailDispatcher(mockTransport);
    const res1 = await dispatcher.sendEmail({
        to: '',
        subject: 'Test',
        text: 'Body',
    });
    strict_1.default.equal(res1.success, false);
    strict_1.default.ok(res1.error?.includes('Invalid recipient email'));
    const res2 = await dispatcher.sendEmail({
        to: 'invalid-address-without-at',
        subject: 'Test',
        text: 'Body',
    });
    strict_1.default.equal(res2.success, false);
    strict_1.default.ok(res2.error?.includes('Invalid recipient email'));
});
(0, node_test_1.test)('EmailDispatcher: fail-safe handling isolates transport failure cleanly', async () => {
    const mockTransport = new email_1.MockEmailTransport();
    mockTransport.setSimulateFailure(true);
    const dispatcher = new email_1.EmailDispatcher(mockTransport);
    const res = await dispatcher.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        text: 'Body',
    });
    strict_1.default.equal(res.success, false);
    strict_1.default.equal(res.error, 'Simulated email transport failure');
});
(0, node_test_1.test)('SmtpEmailTransport: reports unconfigured without throwing when environment is missing', async () => {
    const smtp = new email_1.SmtpEmailTransport({});
    strict_1.default.equal(smtp.isConfigured(), false);
    const res = await smtp.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        text: 'Body',
    });
    strict_1.default.equal(res.success, false);
    strict_1.default.ok(res.error?.includes('not configured'));
});
