import {
    S3Client,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { Readable } from 'node:stream';
import {
    CHANNEL_IMAGE_MAX_FILE_SIZE,
    InvalidChannelImageError,
    processChannelImage,
} from './channel-image.service';
import type { ChannelImagePurpose } from './channel-image.service';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_RAW;
const publicBucketName = process.env.R2_BUCKET_PUBLIC || 'watchtube-media-public';
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
export const ALLOWED_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    console.warn("Storage credentials are not fully configured in environment variables.");
}

const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
    },
});

function isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const metadata = '$metadata' in error ? error.$metadata : undefined;
    const statusCode = typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata
        ? metadata.httpStatusCode
        : undefined;
    const name = 'name' in error ? error.name : undefined;
    return statusCode === 404 || name === 'NotFound' || name === 'NoSuchKey';
}

export async function generatePresignedUploadUrl(
    userId: string,
    contentType: string,
    fileSize: number,
    fileKey = `uploads/${userId}/${randomUUID()}`,
) {
    if (!ALLOWED_UPLOAD_CONTENT_TYPES.includes(contentType)) {
        throw new Error('Invalid content type. Only video/mp4, video/webm, and video/quicktime are allowed.');
    }

    if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_SIZE) {
        throw new Error('File size exceeds the 2GB limit.');
    }

    if (!fileKey.startsWith(`uploads/${userId}/`)) {
        throw new Error('Upload key does not belong to this user.');
    }

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ContentType: contentType,
        ContentLength: fileSize,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });

    return { uploadUrl, fileKey, expiresIn: UPLOAD_URL_TTL_SECONDS };
}

export async function inspectRawObject(key: string): Promise<{ contentLength?: number; contentType?: string } | null> {
    try {
        const command = new HeadObjectCommand({
            Bucket: bucketName,
            Key: key,
        });
        const result = await s3Client.send(command);
        return { contentLength: result.ContentLength, contentType: result.ContentType };
    } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
    }
}

export interface ChannelImageUploadInput {
    channelId: string;
    purpose: ChannelImagePurpose;
    contentType: string;
    fileSize: number;
}

export interface ChannelImageConfirmationInput extends ChannelImageUploadInput {
    uploadId: string;
}

export interface ChannelImageStorageAdapter {
    createSignedUploadUrl(input: {
        bucket: string;
        key: string;
        contentType: string;
        fileSize: number;
        expiresIn: number;
    }): Promise<string>;
    getObjectMetadata(bucket: string, key: string): Promise<{
        contentLength?: number;
        contentType?: string;
    } | null>;
    getObjectBytes(bucket: string, key: string, maxBytes: number): Promise<Buffer | null>;
    putPublicObject(input: {
        bucket: string;
        key: string;
        body: Buffer;
        contentType: string;
        cacheControl: string;
    }): Promise<void>;
}

export interface ChannelImageStorageConfig {
    rawBucket: string | undefined;
    publicBucket: string;
    publicDomain: string;
}

function getPublicMediaBaseUrl(publicDomain: string): URL {
    const configuredDomain = publicDomain.trim().split(/\s+/)[0];
    if (!configuredDomain) {
        throw new Error('Public media URL is not configured.');
    }

    const httpsDomain = configuredDomain.replace(/^http:\/\//i, 'https://');
    const baseUrl = new URL(httpsDomain.includes('://') ? httpsDomain : `https://${httpsDomain}`);
    if (
        baseUrl.protocol !== 'https:'
        || baseUrl.username
        || baseUrl.password
        || baseUrl.search
        || baseUrl.hash
    ) {
        throw new Error('Public media URL configuration is invalid.');
    }
    return baseUrl;
}

function getPublicMediaUrl(publicDomain: string, objectKey: string): string {
    const baseUrl = getPublicMediaBaseUrl(publicDomain);
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    return `${baseUrl.origin}${basePath}/${encodedKey}`;
}

export function createChannelImageStorageService(
    adapter: ChannelImageStorageAdapter,
    config: ChannelImageStorageConfig,
) {
    return {
        async createUploadTarget(input: ChannelImageUploadInput): Promise<{
            uploadUrl: string;
            uploadId: string;
            expiresIn: number;
        }> {
            if (
                !['image/jpeg', 'image/png', 'image/webp'].includes(input.contentType)
                || !Number.isInteger(input.fileSize)
                || input.fileSize <= 0
                || input.fileSize > CHANNEL_IMAGE_MAX_FILE_SIZE[input.purpose]
            ) {
                throw new InvalidChannelImageError('Invalid channel image upload metadata.');
            }
            if (!config.rawBucket) throw new Error('Raw upload storage is not configured.');
            if (!config.publicBucket) throw new Error('Public media storage is not configured.');
            getPublicMediaBaseUrl(config.publicDomain);

            const uploadId = randomUUID();
            const key = `channel-image-uploads/${input.channelId}/${input.purpose}/${uploadId}`;
            const uploadUrl = await adapter.createSignedUploadUrl({
                bucket: config.rawBucket,
                key,
                contentType: input.contentType,
                fileSize: input.fileSize,
                expiresIn: UPLOAD_URL_TTL_SECONDS,
            });
            return { uploadUrl, uploadId, expiresIn: UPLOAD_URL_TTL_SECONDS };
        },

        async publishUploadedImage(input: ChannelImageConfirmationInput): Promise<string | null> {
            const { channelId, purpose, contentType, fileSize, uploadId } = input;
            const maxFileSize = CHANNEL_IMAGE_MAX_FILE_SIZE[purpose];
            if (
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)
                || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
                || !Number.isInteger(fileSize)
                || fileSize <= 0
                || fileSize > maxFileSize
            ) {
                throw new InvalidChannelImageError();
            }
            if (!config.rawBucket) throw new Error('Raw upload storage is not configured.');
            if (!config.publicBucket) throw new Error('Public media storage is not configured.');

            const uploadKey = `channel-image-uploads/${channelId}/${purpose}/${uploadId}`;
            const metadata = await adapter.getObjectMetadata(config.rawBucket, uploadKey);
            if (!metadata) return null;
            if (metadata.contentLength !== fileSize || metadata.contentType !== contentType) {
                throw new InvalidChannelImageError(
                    'Uploaded image metadata does not match the authorized upload.',
                );
            }

            const uploadedBytes = await adapter.getObjectBytes(config.rawBucket, uploadKey, fileSize);
            if (!uploadedBytes) return null;
            if (uploadedBytes.length !== fileSize) {
                throw new InvalidChannelImageError(
                    'Uploaded image size does not match the authorized upload.',
                );
            }

            const processedBytes = await processChannelImage(uploadedBytes, purpose, contentType);
            const publicKey = `channel-images/${channelId}/${purpose}/${randomUUID()}.webp`;
            const publicUrl = getPublicMediaUrl(config.publicDomain, publicKey);
            await adapter.putPublicObject({
                bucket: config.publicBucket,
                key: publicKey,
                body: processedBytes,
                contentType: 'image/webp',
                cacheControl: 'public, max-age=31536000, immutable',
            });
            return publicUrl;
        },
    };
}

const channelImageStorage = createChannelImageStorageService({
    async createSignedUploadUrl(input) {
        const command = new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            ContentType: input.contentType,
            ContentLength: input.fileSize,
        });
        return getSignedUrl(s3Client, command, { expiresIn: input.expiresIn });
    },
    async getObjectMetadata(bucket, key) {
        try {
            const result = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            return { contentLength: result.ContentLength, contentType: result.ContentType };
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    },
    async getObjectBytes(bucket, key, maxBytes) {
        try {
            const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            if (!result.Body) return null;
            if (!(result.Body instanceof Readable)) {
                throw new Error('Storage returned an unsupported image stream.');
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;
            for await (const chunk of result.Body) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalBytes += bytes.length;
                if (totalBytes > maxBytes) {
                    result.Body.destroy();
                    throw new InvalidChannelImageError(
                        'Uploaded image size does not match the authorized upload.',
                    );
                }
                chunks.push(bytes);
            }
            return Buffer.concat(chunks, totalBytes);
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    },
    async putPublicObject(input) {
        await s3Client.send(new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
            ContentLength: input.body.length,
            CacheControl: input.cacheControl,
        }));
    },
}, {
    rawBucket: bucketName,
    publicBucket: publicBucketName,
    publicDomain: process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL || '',
});

export const createChannelImageUploadTarget = channelImageStorage.createUploadTarget;
export const publishVerifiedChannelImage = channelImageStorage.publishUploadedImage;
