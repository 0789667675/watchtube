import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reportModalUrl = new URL('../src/components/modals/ReportModal.tsx', import.meta.url);
const channelPageUrl = new URL('../src/pages/ChannelPage.tsx', import.meta.url);

test('report modal uses the trust API contract and safe inline feedback', async () => {
  const source = await readFile(reportModalUrl, 'utf8');

  assert.match(source, /\/api\/v1\/reports/);
  assert.match(source, /targetType/);
  assert.match(source, /details:\s*details\.trim\(\)\s*\|\|\s*undefined/);
  assert.match(source, /<option value="MISLEADING">Misleading content<\/option>/);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status"/);
  assert.match(source, /Sign in to submit a report/);
  assert.match(source, /isSubmitting \? 'Submitting…'/);
  assert.doesNotMatch(source, /\balert\s*\(/);
});

test('channel page exposes the report modal for channel targets', async () => {
  const source = await readFile(channelPageUrl, 'utf8');

  assert.match(source, /ReportModal/);
  assert.match(source, /targetType="CHANNEL"/);
  assert.match(source, /setIsReportOpen\(true\)/);
  assert.doesNotMatch(source, /interaction\.route/);
});
