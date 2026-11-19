import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import * as fs from 'fs';

let s3Client: S3Client | null = null;

function hasConfiguredValue(value: string | undefined): value is string {
    if (!value?.trim()) return false;
    return !/(your[_-]|replace.?with|placeholder|x{4,})/i.test(value.trim());
}

function isValidBucketName(bucket: string): boolean {
    return hasConfiguredValue(bucket)
        && bucket.length >= 3
        && bucket.length <= 63
        && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
        && !bucket.includes('..');
}

function isValidAccountId(accountId: string | undefined): boolean {
    return hasConfiguredValue(accountId) && /^[a-f0-9]{32}$/i.test(accountId.trim());
}

export function getStorageConfigurationStatus(requirePublicMediaUrl = true): { missing: string[] } {
    const missing = [
        ...(!isValidAccountId(process.env.CLOUDFLARE_ACCOUNT_ID) ? ['CLOUDFLARE_ACCOUNT_ID'] : []),
        ...['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
            .filter((name) => !hasConfiguredValue(process.env[name])),
    ];
    if (
        requirePublicMediaUrl &&
        !hasConfiguredValue(process.env.R2_PUBLIC_DOMAIN)
        && !hasConfiguredValue(process.env.R2_BUCKET_PUBLIC_URL)
    ) {
        missing.push('R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL');
    }
    for (const name of ['R2_BUCKET_RAW', 'R2_BUCKET_PUBLIC']) {
        const bucket = process.env[name]?.trim();
        if (bucket && !isValidBucketName(bucket)) missing.push(name);
    }
    return { missing };
}

export function getStorageClient(): S3Client {
    if (!s3Client) {
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        const accessKeyId = process.env.R2_ACCESS_KEY_ID;
        const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
        const missing = [
            ...(!isValidAccountId(accountId) ? ['CLOUDFLARE_ACCOUNT_ID'] : []),
            ...['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
                .filter((name) => !hasConfiguredValue(process.env[name])),
        ];
        if (missing.length) {
            throw new Error(`Cloud storage is not configured. Missing environment variables: ${missing.join(', ')}.`);
        }
        s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: accessKeyId!,
                secretAccessKey: secretAccessKey!,
            },
            maxAttempts: 3,
        });
    }
    return s3Client;
}

export async function downloadRawVideo(key: string, destinationPath: string) {
    if (!key || key.includes('..')) throw new Error(`Unsafe raw storage key: ${key}`);
    const bucket = process.env.R2_BUCKET_RAW?.trim() || 'watchtube-raw-uploads';
    if (!isValidBucketName(bucket)) throw new Error('R2_BUCKET_RAW is not a valid bucket name.');
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    });
    const response = await getStorageClient().send(command);
    if (response.Body) {
        await pipeline(response.Body as Readable, createWriteStream(destinationPath));
    } else {
        throw new Error('No body in response');
    }
}

export async function uploadPrivateProcessingFile(localPath: string, s3Key: string, contentType: string) {
    if (!/^processing\/[0-9a-f-]{36}\/[A-Za-z0-9._%()-]+$/i.test(s3Key) || s3Key.includes('..')) {
        throw new Error('Unsafe processing storage key.');
    }
    const stat = await fs.promises.stat(localPath);
    if (!stat.isFile()) throw new Error('Processing source is not a file.');
    const bucket = process.env.R2_BUCKET_RAW?.trim() || 'watchtube-raw-uploads';
    if (!isValidBucketName(bucket)) throw new Error('R2_BUCKET_RAW is not a valid bucket name.');
    await getStorageClient().send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: createReadStream(localPath),
        ContentType: contentType,
        ContentLength: stat.size,
    }));
}
