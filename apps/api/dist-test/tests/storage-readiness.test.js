"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const storage_service_1 = require("../src/services/storage.service");
const storageEnvironmentNames = [
    'CLOUDFLARE_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_RAW',
    'R2_BUCKET_PUBLIC',
    'R2_PUBLIC_DOMAIN',
    'R2_BUCKET_PUBLIC_URL',
];
async function withoutStorageConfiguration(run) {
    const previous = storageEnvironmentNames.map((name) => process.env[name]);
    storageEnvironmentNames.forEach((name) => delete process.env[name]);
    try {
        return await run();
    }
    finally {
        storageEnvironmentNames.forEach((name, index) => {
            if (previous[index] === undefined)
                delete process.env[name];
            else
                process.env[name] = previous[index];
        });
    }
}
(0, node_test_1.test)('storage readiness reports missing configuration names without credentials or values', async () => {
    await withoutStorageConfiguration(() => {
        const status = (0, storage_service_1.getStorageConfigurationStatus)();
        strict_1.default.equal(status.status, 'unconfigured');
        strict_1.default.deepEqual(status.missing, [
            'CLOUDFLARE_ACCOUNT_ID',
            'R2_ACCESS_KEY_ID',
            'R2_SECRET_ACCESS_KEY',
            'R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL',
        ]);
    });
});
(0, node_test_1.test)('storage readiness does not treat environment-template placeholders as configured values', async () => {
    await withoutStorageConfiguration(() => {
        process.env.CLOUDFLARE_ACCOUNT_ID = 'your_cloudflare_account_id';
        process.env.R2_ACCESS_KEY_ID = 'your_r2_access_key_id';
        process.env.R2_SECRET_ACCESS_KEY = 'your_r2_secret_access_key';
        process.env.R2_BUCKET_RAW = 'your_raw_bucket_name';
        process.env.R2_BUCKET_PUBLIC = 'your_public_bucket_name';
        process.env.R2_PUBLIC_DOMAIN = 'https://your-public-domain.example';
        const status = (0, storage_service_1.getStorageConfigurationStatus)();
        strict_1.default.equal(status.status, 'unconfigured');
        strict_1.default.deepEqual(status.missing, [
            'CLOUDFLARE_ACCOUNT_ID',
            'R2_ACCESS_KEY_ID',
            'R2_SECRET_ACCESS_KEY',
            'R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL',
            'R2_BUCKET_RAW',
            'R2_BUCKET_PUBLIC',
        ]);
    });
});
(0, node_test_1.test)('storage readiness rejects malformed account IDs without exposing their values', async () => {
    await withoutStorageConfiguration(() => {
        process.env.CLOUDFLARE_ACCOUNT_ID = 'not-an-account-id';
        process.env.R2_ACCESS_KEY_ID = 'test-key-id';
        process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
        process.env.R2_PUBLIC_DOMAIN = 'https://media.example.test';
        const status = (0, storage_service_1.getStorageConfigurationStatus)();
        strict_1.default.equal(status.status, 'unconfigured');
        strict_1.default.deepEqual(status.missing, ['CLOUDFLARE_ACCOUNT_ID']);
        strict_1.default.doesNotMatch(JSON.stringify(status), /not-an-account-id/);
    });
});
(0, node_test_1.test)('presigned storage operations fail before contacting R2 when credentials are absent', async () => {
    await withoutStorageConfiguration(async () => {
        await strict_1.default.rejects((0, storage_service_1.generatePresignedUploadUrl)('11111111-1111-4111-8111-111111111111', 'video/mp4', 1024), (error) => {
            strict_1.default.ok(error instanceof storage_service_1.StorageUnavailableError);
            strict_1.default.match(error.message, /CLOUDFLARE_ACCOUNT_ID.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY/);
            strict_1.default.equal(error.message, 'Cloud storage is not configured. Missing environment variables: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
            return true;
        });
    });
});
(0, node_test_1.test)('presigned upload URL generation signs the configured raw-bucket request without contacting R2', async () => {
    await withoutStorageConfiguration(async () => {
        process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
        process.env.R2_ACCESS_KEY_ID = 'test-access-key';
        process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
        process.env.R2_BUCKET_RAW = 'watchtube-raw-uploads';
        process.env.R2_BUCKET_PUBLIC = 'watchtube-media-public';
        process.env.R2_PUBLIC_DOMAIN = 'https://media.example.test';
        const target = await (0, storage_service_1.generatePresignedUploadUrl)('11111111-1111-4111-8111-111111111111', 'video/mp4', 1024, 'uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222');
        const signedUrl = new URL(target.uploadUrl);
        strict_1.default.equal(target.expiresIn, 900);
        strict_1.default.equal(target.fileKey, 'uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222');
        strict_1.default.equal(signedUrl.hostname, 'watchtube-raw-uploads.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
        strict_1.default.match(signedUrl.pathname, /\/uploads\/11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222$/);
        strict_1.default.match(signedUrl.searchParams.get('X-Amz-Credential') ?? '', /test-access-key/);
        strict_1.default.equal(signedUrl.searchParams.get('X-Amz-Expires'), '900');
        strict_1.default.equal(signedUrl.searchParams.get('X-Amz-Signature')?.length, 64);
    });
});
