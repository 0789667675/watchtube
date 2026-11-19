import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generatePresignedUploadUrl,
  getStorageConfigurationStatus,
  StorageUnavailableError,
} from '../src/services/storage.service';

const storageEnvironmentNames = [
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_RAW',
  'R2_BUCKET_PUBLIC',
  'R2_PUBLIC_DOMAIN',
  'R2_BUCKET_PUBLIC_URL',
] as const;

async function withoutStorageConfiguration<T>(run: () => Promise<T> | T): Promise<T> {
  const previous = storageEnvironmentNames.map((name) => process.env[name]);
  storageEnvironmentNames.forEach((name) => delete process.env[name]);
  try {
    return await run();
  } finally {
    storageEnvironmentNames.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

test('storage readiness reports missing configuration names without credentials or values', async () => {
  await withoutStorageConfiguration(() => {
    const status = getStorageConfigurationStatus();
    assert.equal(status.status, 'unconfigured');
    assert.deepEqual(status.missing, [
      'CLOUDFLARE_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL',
    ]);
  });
});

test('storage readiness does not treat environment-template placeholders as configured values', async () => {
  await withoutStorageConfiguration(() => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'your_cloudflare_account_id';
    process.env.R2_ACCESS_KEY_ID = 'your_r2_access_key_id';
    process.env.R2_SECRET_ACCESS_KEY = 'your_r2_secret_access_key';
    process.env.R2_BUCKET_RAW = 'your_raw_bucket_name';
    process.env.R2_BUCKET_PUBLIC = 'your_public_bucket_name';
    process.env.R2_PUBLIC_DOMAIN = 'https://your-public-domain.example';
    const status = getStorageConfigurationStatus();
    assert.equal(status.status, 'unconfigured');
    assert.deepEqual(status.missing, [
      'CLOUDFLARE_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL',
      'R2_BUCKET_RAW',
      'R2_BUCKET_PUBLIC',
    ]);
  });
});

test('storage readiness rejects malformed account IDs without exposing their values', async () => {
  await withoutStorageConfiguration(() => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'not-an-account-id';
    process.env.R2_ACCESS_KEY_ID = 'test-key-id';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_PUBLIC_DOMAIN = 'https://media.example.test';
    const status = getStorageConfigurationStatus();
    assert.equal(status.status, 'unconfigured');
    assert.deepEqual(status.missing, ['CLOUDFLARE_ACCOUNT_ID']);
    assert.doesNotMatch(JSON.stringify(status), /not-an-account-id/);
  });
});

test('presigned storage operations fail before contacting R2 when credentials are absent', async () => {
  await withoutStorageConfiguration(async () => {
    await assert.rejects(
      generatePresignedUploadUrl('11111111-1111-4111-8111-111111111111', 'video/mp4', 1024),
      (error: unknown) => {
        assert.ok(error instanceof StorageUnavailableError);
        assert.match(error.message, /CLOUDFLARE_ACCOUNT_ID.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY/);
        assert.equal(
          error.message,
          'Cloud storage is not configured. Missing environment variables: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.',
        );
        return true;
      },
    );
  });
});

test('presigned upload URL generation signs the configured raw-bucket request without contacting R2', async () => {
  await withoutStorageConfiguration(async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_BUCKET_RAW = 'watchtube-raw-uploads';
    process.env.R2_BUCKET_PUBLIC = 'watchtube-media-public';
    process.env.R2_PUBLIC_DOMAIN = 'https://media.example.test';

    const target = await generatePresignedUploadUrl(
      '11111111-1111-4111-8111-111111111111',
      'video/mp4',
      1024,
      'uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
    );
    const signedUrl = new URL(target.uploadUrl);
    assert.equal(target.expiresIn, 900);
    assert.equal(target.fileKey, 'uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222');
    assert.equal(
      signedUrl.hostname,
      'watchtube-raw-uploads.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    );
    assert.match(
      signedUrl.pathname,
      /\/uploads\/11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222$/,
    );
    assert.match(signedUrl.searchParams.get('X-Amz-Credential') ?? '', /test-access-key/);
    assert.equal(signedUrl.searchParams.get('X-Amz-Expires'), '900');
    assert.equal(signedUrl.searchParams.get('X-Amz-Signature')?.length, 64);
  });
});
