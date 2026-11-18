import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverProcessingVideos } from '../queue-recovery-core.mjs';

const userId = '123e4567-e89b-42d3-a456-426614174000';
const videoId = '123e4567-e89b-42d3-a456-426614174001';
const rawStorageKey = `uploads/${userId}/${videoId}`;
const video = { id: videoId, rawStorageKey, channel: { userId } };

function fakeQueue(job) {
  return {
    added: [],
    async getJob() { return job || null; },
    async add(...args) { this.added.push(args); },
  };
}

test('recovery enqueues only when the raw object exists and the queue job is absent', async () => {
  const queue = fakeQueue(null);
  const result = await recoverProcessingVideos({
    videos: [video],
    queue,
    async hasRawObject(key) { return key === rawStorageKey; },
  });
  assert.equal(result.enqueued, 1);
  assert.deepEqual(queue.added[0], [
    'processVideo',
    { videoId, rawStorageKey },
    { jobId: videoId },
  ]);
});

test('recovery retries a failed job without creating a duplicate job', async () => {
  let retries = 0;
  const queue = fakeQueue({
    async getState() { return 'failed'; },
    async retry(state) { assert.equal(state, 'failed'); retries += 1; },
  });
  const result = await recoverProcessingVideos({
    videos: [video],
    queue,
    async hasRawObject() { return true; },
  });
  assert.equal(retries, 1);
  assert.equal(result.retried, 1);
  assert.equal(queue.added.length, 0);
});

test('recovery refuses invalid or missing raw-object records and reports completed jobs', async () => {
  const completedQueue = fakeQueue({
    async getState() { return 'completed'; },
  });
  const result = await recoverProcessingVideos({
    videos: [
      video,
      { ...video, rawStorageKey: `uploads/${userId}/../${videoId}` },
      { ...video, id: 'not-a-uuid' },
    ],
    queue: completedQueue,
    async hasRawObject() { return true; },
  });
  assert.equal(result.completedButStillProcessing, 1);
  assert.equal(result.invalidRecord, 2);

  const missing = await recoverProcessingVideos({
    videos: [video],
    queue: fakeQueue(null),
    async hasRawObject() { return false; },
  });
  assert.equal(missing.missingRawObject, 1);
  assert.equal(missing.enqueued, 0);
});

test('dry run reports planned work without mutating the queue', async () => {
  const queue = fakeQueue(null);
  const result = await recoverProcessingVideos({
    videos: [video],
    queue,
    async hasRawObject() { return true; },
    dryRun: true,
  });
  assert.equal(result.planned, 1);
  assert.equal(result.enqueued, 0);
  assert.equal(queue.added.length, 0);
});
