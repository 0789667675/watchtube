import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  publicRepliesWhere,
  publicTopLevelCommentsWhere,
  publicVideoWhere,
} from '../src/security/publicContent';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';
const PUBLIC_VIDEO = {
  status: { in: ['READY', 'PUBLISHED'] },
  visibility: { in: ['PUBLIC', 'UNLISTED'] },
};

test('public video lookup excludes private and non-ready videos', () => {
  assert.deepEqual(publicVideoWhere(VIDEO_ID), {
    id: VIDEO_ID,
    ...PUBLIC_VIDEO,
  });
});

test('public top-level comments require a ready public or unlisted video', () => {
  assert.deepEqual(publicTopLevelCommentsWhere(VIDEO_ID), {
    videoId: VIDEO_ID,
    parentId: null,
    video: { is: PUBLIC_VIDEO },
  });
});

test('public replies require both the reply and parent videos to be accessible', () => {
  assert.deepEqual(publicRepliesWhere(COMMENT_ID), {
    parentId: COMMENT_ID,
    video: { is: PUBLIC_VIDEO },
    parent: { is: { video: { is: PUBLIC_VIDEO } } },
  });
});
