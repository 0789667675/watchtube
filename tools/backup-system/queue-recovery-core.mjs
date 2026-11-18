const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW_KEY = /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_STATES = new Set([
  'active',
  'delayed',
  'paused',
  'prioritized',
  'waiting',
  'waiting-children',
  'wait',
]);

export async function recoverProcessingVideos({ videos, queue, hasRawObject, dryRun = false }) {
  const result = {
    considered: videos.length,
    enqueued: 0,
    retried: 0,
    alreadyActive: 0,
    completedButStillProcessing: 0,
    missingRawObject: 0,
    invalidRecord: 0,
    failed: 0,
    planned: 0,
    dryRun,
  };

  for (const video of videos) {
    const keyMatch = typeof video.rawStorageKey === 'string'
      ? RAW_KEY.exec(video.rawStorageKey)
      : null;
    if (!UUID.test(video.id || '') || !video.channel?.userId
        || !UUID.test(video.channel.userId) || !keyMatch
        || keyMatch[1].toLowerCase() !== video.channel.userId.toLowerCase()) {
      result.invalidRecord += 1;
      continue;
    }

    try {
      if (!await hasRawObject(video.rawStorageKey)) {
        result.missingRawObject += 1;
        continue;
      }
      const job = await queue.getJob(video.id);
      if (job) {
        const state = await job.getState();
        if (state === 'failed') {
          if (dryRun) result.planned += 1;
          else {
            await job.retry('failed');
            result.retried += 1;
          }
        } else if (ACTIVE_STATES.has(state)) {
          result.alreadyActive += 1;
        } else if (state === 'completed') {
          result.completedButStillProcessing += 1;
        } else {
          result.failed += 1;
        }
        continue;
      }

      if (dryRun) {
        result.planned += 1;
      } else {
        await queue.add(
          'processVideo',
          { videoId: video.id, rawStorageKey: video.rawStorageKey },
          { jobId: video.id },
        );
        result.enqueued += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
