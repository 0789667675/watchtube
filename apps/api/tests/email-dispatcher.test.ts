import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EmailDispatcher,
  MockEmailTransport,
  SmtpEmailTransport,
  renderWtppStatusEmail,
  renderPaymentReceivedEmail,
  renderWithdrawalRequestedEmail,
  renderWithdrawalDispatchedEmail,
  renderWithdrawalFailedEmail,
  renderSecurityAlertEmail,
  renderVideoProcessingStatusEmail,
} from '../src/services/email';

test('EmailDispatcher: dispatches using MockEmailTransport and records sent messages', async () => {
  const mockTransport = new MockEmailTransport();
  const dispatcher = new EmailDispatcher(mockTransport);

  const email = renderPaymentReceivedEmail({
    recipientEmail: 'creator@example.com',
    channelName: 'Rwanda Tech Reviews',
    amountRwf: '50,000',
    provider: 'MTN_MOMO',
    transactionId: 'tx-momo-123',
  });

  const result = await dispatcher.sendEmail(email);
  assert.equal(result.success, true);
  assert.ok(result.messageId?.startsWith('mock-msg-'));

  const sent = mockTransport.getSentEmails();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'creator@example.com');
  assert.equal(sent[0].templateId, 'PAYMENT_RECEIVED');
  assert.ok(sent[0].subject.includes('50,000 RWF'));
  assert.ok(sent[0].text.includes('Rwanda Tech Reviews'));
  assert.ok(sent[0].html?.includes('Rwanda Tech Reviews'));
});

test('EmailDispatcher: all template generators produce valid text and HTML formats', () => {
  const wtpp = renderWtppStatusEmail({
    recipientEmail: 'wtpp@example.com',
    channelName: 'Kigali Beats',
    status: 'APPROVED',
  });
  assert.equal(wtpp.templateId, 'WTPP_STATUS');
  assert.ok(wtpp.subject.includes('Approved'));

  const req = renderWithdrawalRequestedEmail({
    recipientEmail: 'pay@example.com',
    channelName: 'Channel One',
    amountRwf: '100,000',
    provider: 'AIRTEL_MONEY',
    maskedPhone: '25073****123',
    payoutId: 'payout-uuid-1',
  });
  assert.equal(req.templateId, 'WITHDRAWAL_REQUESTED');
  assert.ok(req.text.includes('25073****123'));

  const disp = renderWithdrawalDispatchedEmail({
    recipientEmail: 'pay@example.com',
    channelName: 'Channel One',
    amountRwf: '100,000',
    provider: 'MTN_MOMO',
    maskedPhone: '25078****999',
    providerReference: 'mtn-ref-987',
  });
  assert.equal(disp.templateId, 'WITHDRAWAL_DISPATCHED');
  assert.ok(disp.text.includes('mtn-ref-987'));

  const fail = renderWithdrawalFailedEmail({
    recipientEmail: 'pay@example.com',
    channelName: 'Channel One',
    amountRwf: '100,000',
    provider: 'MTN_MOMO',
    maskedPhone: '25078****999',
    reason: 'Account frozen by provider',
  });
  assert.equal(fail.templateId, 'WITHDRAWAL_FAILED');
  assert.ok(fail.text.includes('restored to your available wallet balance'));

  const sec = renderSecurityAlertEmail({
    recipientEmail: 'sec@example.com',
    title: 'Password changed',
    details: 'Your account password was updated from 192.168.1.1',
  });
  assert.equal(sec.templateId, 'SECURITY_ALERT');
  assert.ok(sec.text.includes('192.168.1.1'));

  const vid = renderVideoProcessingStatusEmail({
    recipientEmail: 'vid@example.com',
    videoTitle: 'My Journey to Volcanoes National Park',
    status: 'READY',
  });
  assert.equal(vid.templateId, 'VIDEO_PROCESSING_STATUS');
  assert.ok(vid.text.includes('My Journey to Volcanoes National Park'));
});

test('EmailDispatcher: rejects invalid recipient emails cleanly without throwing', async () => {
  const mockTransport = new MockEmailTransport();
  const dispatcher = new EmailDispatcher(mockTransport);

  const res1 = await dispatcher.sendEmail({
    to: '',
    subject: 'Test',
    text: 'Body',
  });
  assert.equal(res1.success, false);
  assert.ok(res1.error?.includes('Invalid recipient email'));

  const res2 = await dispatcher.sendEmail({
    to: 'invalid-address-without-at',
    subject: 'Test',
    text: 'Body',
  });
  assert.equal(res2.success, false);
  assert.ok(res2.error?.includes('Invalid recipient email'));
});

test('EmailDispatcher: fail-safe handling isolates transport failure cleanly', async () => {
  const mockTransport = new MockEmailTransport();
  mockTransport.setSimulateFailure(true);
  const dispatcher = new EmailDispatcher(mockTransport);

  const res = await dispatcher.sendEmail({
    to: 'user@example.com',
    subject: 'Test',
    text: 'Body',
  });
  assert.equal(res.success, false);
  assert.equal(res.error, 'Simulated email transport failure');
});

test('SmtpEmailTransport: reports unconfigured without throwing when environment is missing', async () => {
  const smtp = new SmtpEmailTransport({});
  assert.equal(smtp.isConfigured(), false);
  const res = await smtp.sendEmail({
    to: 'user@example.com',
    subject: 'Test',
    text: 'Body',
  });
  assert.equal(res.success, false);
  assert.ok(res.error?.includes('not configured'));
});
