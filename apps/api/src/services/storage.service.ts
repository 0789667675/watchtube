import {
    S3Client,
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { Readable } from 'node:stream';
import {
    CHANNEL_IMAGE_MAX_FILE_SIZE,
    InvalidChannelImageError,
    processChannelImage,
    processVideoThumbnail,
    VIDEO_THUMBNAIL_MAX_FILE_SIZE,
} from './channel-image.service';
import type { ChannelImagePurpose } from './channel-image.service';

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
export const ALLOWED_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export class StorageUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StorageUnavailableError';
    }
}

type StorageConfigurationStatus = {
    status: 'configured' | 'partial' | 'unconfigured';
    missing: string[];
};

const RAW_BUCKET_DEFAULT = 'watchtube-raw-uploads';
const PUBLIC_BUCKET_DEFAULT = 'watchtube-media-public';
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

export function getStorageConfigurationStatus(requirePublicMediaUrl = true): StorageConfigurationStatus {
    const missing: string[] = [];
    if (!isValidAccountId(process.env.CLOUDFLARE_ACCOUNT_ID)) missing.push('CLOUDFLARE_ACCOUNT_ID');
    for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
        if (!hasConfiguredValue(process.env[name])) missing.push(name);
    }
    if (requirePublicMediaUrl) {
        let publicMediaConfigured = false;
        try {
            const publicDomain = process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL;
            if (!hasConfiguredValue(publicDomain)) throw new Error('Public media URL is not configured.');
            getPublicMediaBaseUrl(publicDomain);
            publicMediaConfigured = true;
        } catch {
            publicMediaConfigured = false;
        }
        if (!publicMediaConfigured) {
            missing.push('R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL');
        }
    }
    if (process.env.R2_BUCKET_RAW?.trim() && !isValidBucketName(process.env.R2_BUCKET_RAW.trim())) {
        missing.push('R2_BUCKET_RAW');
    }
    if (process.env.R2_BUCKET_PUBLIC?.trim() && !isValidBucketName(process.env.R2_BUCKET_PUBLIC.trim())) {
        missing.push('R2_BUCKET_PUBLIC');
    }
    const credentialsConfigured = missing.every((name) =>
        name === 'R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL',
    );
    return {
        status: credentialsConfigured
            ? missing.length === 0 ? 'configured' : 'partial'
            : 'unconfigured',
        missing,
    };
}

function getStorageClient(): S3Client {
    if (s3Client) return s3Client;

    const missing = [
        ...(!isValidAccountId(process.env.CLOUDFLARE_ACCOUNT_ID) ? ['CLOUDFLARE_ACCOUNT_ID'] : []),
        ...(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
            .filter((name) => !hasConfiguredValue(process.env[name]))),
    ];
    if (missing.length) {
        throw new StorageUnavailableError(
            `Cloud storage is not configured. Missing environment variables: ${missing.join(', ')}.`,
        );
    }

    s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID!,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
    });
    return s3Client;
}

function getRawBucket(): string {
    return getBucketName('R2_BUCKET_RAW', RAW_BUCKET_DEFAULT);
}

function getBucketName(name: string, fallback: string): string {
    const configured = process.env[name]?.trim();
    if (!configured) return fallback;
    if (!isValidBucketName(configured)) {
        throw new StorageUnavailableError(`Cloud storage bucket configuration ${name} is invalid.`);
    }
    return configured;
}

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
        Bucket: getRawBucket(),
        Key: fileKey,
        ContentType: contentType,
        ContentLength: fileSize,
    });

    const uploadUrl = await getSignedUrl(getStorageClient(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });

    return { uploadUrl, fileKey, expiresIn: UPLOAD_URL_TTL_SECONDS };
}

export async function inspectRawObject(key: string): Promise<{ contentLength?: number; contentType?: string } | null> {
    try {
        const command = new HeadObjectCommand({
            Bucket: getRawBucket(),
            Key: key,
        });
        const result = await getStorageClient().send(command);
        return { contentLength: result.ContentLength, contentType: result.ContentType };
    } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
    }
}

function getPublicObjectContentType(key: string): string {
    if (key.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (key.endsWith('.ts')) return 'video/MP2T';
    if (key.endsWith('.webp')) return 'image/webp';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
    throw new Error('Unsupported processed media file type.');
}

export async function publishProcessedVideoAssets(
    videoId: string,
    selectedThumbnailKey?: string,
): Promise<{
    thumbnailUrl: string;
    playlistUrls: Record<string, string>;
}> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) {
        throw new Error('Invalid video id.');
    }

    const rawBucket = getRawBucket();
    const publicBucket = getBucketName('R2_BUCKET_PUBLIC', PUBLIC_BUCKET_DEFAULT);
    const prefix = `processing/${videoId}/`;
    const publicPrefix = `media/${videoId}/`;
    const publicDomain = process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL || '';
    const uploadedKeys: string[] = [];
    let continuationToken: string | undefined;
    let posterUrl: string | undefined;
    let customThumbnailUrl: string | undefined;
    const playlistUrls: Record<string, string> = {};
    if (
        selectedThumbnailKey
        && (
            !selectedThumbnailKey.startsWith(prefix)
            || !/^custom-thumbnail-[0-9a-f-]{36}\.webp$/i.test(selectedThumbnailKey.slice(prefix.length))
        )
    ) {
        throw new Error('Invalid video thumbnail storage key.');
    }

    try {
        do {
            const page = await getStorageClient().send(new ListObjectsV2Command({
                Bucket: rawBucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }));
            for (const object of page.Contents ?? []) {
                if (!object.Key || object.Size === undefined) continue;
                const filename = object.Key.slice(prefix.length);
                if (!filename || filename.includes('/')) continue;
                const isCustomThumbnail = /^custom-thumbnail-[0-9a-f-]{36}\.webp$/i.test(filename);
                if (isCustomThumbnail && object.Key !== selectedThumbnailKey) continue;
                const publicKey = `${publicPrefix}${filename}`;
                await getStorageClient().send(new CopyObjectCommand({
                    Bucket: publicBucket,
                    Key: publicKey,
                    CopySource: `${rawBucket}/${object.Key.split('/').map(encodeURIComponent).join('/')}`,
                    ContentType: getPublicObjectContentType(filename),
                    CacheControl: 'public, max-age=31536000, immutable',
                    MetadataDirective: 'REPLACE',
                }));
                uploadedKeys.push(publicKey);
                if (filename === 'poster.jpg') posterUrl = getPublicMediaUrl(publicDomain, publicKey);
                if (isCustomThumbnail) {
                    customThumbnailUrl = getPublicMediaUrl(publicDomain, publicKey);
                }
                const rendition = /^(360p|720p|1080p)\.m3u8$/.exec(filename)?.[1];
                if (rendition) playlistUrls[rendition] = getPublicMediaUrl(publicDomain, publicKey);
            }
            continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (continuationToken);

        const thumbnailUrl = customThumbnailUrl || posterUrl;
        if (!uploadedKeys.length || !thumbnailUrl || Object.keys(playlistUrls).length === 0) {
            throw new StorageUnavailableError('Processed video assets are incomplete.');
        }
        return { thumbnailUrl, playlistUrls };
    } catch (error) {
        for (const key of uploadedKeys) {
            try {
                await getStorageClient().send(new DeleteObjectCommand({ Bucket: publicBucket, Key: key }));
            } catch (cleanupError) {
                console.error('Failed to remove a partially published video asset.', {
                    name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
                });
            }
        }
        throw error;
    }
}

export async function deletePublishedVideoAssets(videoId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) {
        throw new Error('Invalid video id.');
    }
    const bucket = getBucketName('R2_BUCKET_PUBLIC', PUBLIC_BUCKET_DEFAULT);
    const prefix = `media/${videoId}/`;
    let continuationToken: string | undefined;
    do {
        const page = await getStorageClient().send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        for (const object of page.Contents ?? []) {
            if (object.Key) {
                await getStorageClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
            }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
}

export async function createVideoThumbnailUploadTarget(
    videoId: string,
    contentType: string,
    fileSize: number,
): Promise<{ uploadUrl: string; storageKey: string; expiresIn: number }> {
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)
        || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
        || !Number.isInteger(fileSize)
        || fileSize <= 0
        || fileSize > VIDEO_THUMBNAIL_MAX_FILE_SIZE
    ) {
        throw new InvalidChannelImageError('Invalid video thumbnail upload metadata.');
    }

    const storageKey = `processing/${videoId}/custom-thumbnail-${randomUUID()}.webp`;
    const uploadUrl = await getSignedUrl(getStorageClient(), new PutObjectCommand({
        Bucket: getRawBucket(),
        Key: storageKey,
        ContentType: contentType,
        ContentLength: fileSize,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS });
    return { uploadUrl, storageKey, expiresIn: UPLOAD_URL_TTL_SECONDS };
}

export async function normalizeUploadedVideoThumbnail(
    storageKey: string,
    contentType: string,
    fileSize: number,
): Promise<boolean> {
    if (
        !/^processing\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/custom-thumbnail-[0-9a-f-]{36}\.webp$/i.test(storageKey)
        || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
        || !Number.isInteger(fileSize)
        || fileSize <= 0
        || fileSize > VIDEO_THUMBNAIL_MAX_FILE_SIZE
    ) {
        throw new InvalidChannelImageError('Invalid video thumbnail upload metadata.');
    }

    const object = await getStorageClient().send(new GetObjectCommand({
        Bucket: getRawBucket(),
        Key: storageKey,
    }));
    if (!object.Body) return false;
    if (!(object.Body instanceof Readable)) {
        throw new Error('Storage returned an unsupported image stream.');
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of object.Body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > fileSize || totalBytes > VIDEO_THUMBNAIL_MAX_FILE_SIZE) {
            object.Body.destroy();
            throw new InvalidChannelImageError('Uploaded thumbnail size does not match the authorized upload.');
        }
        chunks.push(bytes);
    }
    if (totalBytes !== fileSize || object.ContentLength !== fileSize || object.ContentType !== contentType) {
        throw new InvalidChannelImageError('Uploaded thumbnail metadata does not match the authorized upload.');
    }

    const normalized = await processVideoThumbnail(Buffer.concat(chunks, totalBytes), contentType);
    await getStorageClient().send(new PutObjectCommand({
        Bucket: getRawBucket(),
        Key: storageKey,
        Body: normalized,
        ContentType: 'image/webp',
        ContentLength: normalized.length,
    }));
    return true;
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
    if (!hasConfiguredValue(configuredDomain)) {
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
            if (!config.rawBucket || !isValidBucketName(config.rawBucket)) {
                throw new StorageUnavailableError('Raw upload storage is not configured.');
            }
            if (!config.publicBucket || !isValidBucketName(config.publicBucket)) {
                throw new StorageUnavailableError('Public media storage is not configured.');
            }
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
            if (!config.rawBucket || !isValidBucketName(config.rawBucket)) {
                throw new StorageUnavailableError('Raw upload storage is not configured.');
            }
            if (!config.publicBucket || !isValidBucketName(config.publicBucket)) {
                throw new StorageUnavailableError('Public media storage is not configured.');
            }

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
        return getSignedUrl(getStorageClient(), command, { expiresIn: input.expiresIn });
    },
    async getObjectMetadata(bucket, key) {
        try {
            const result = await getStorageClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            return { contentLength: result.ContentLength, contentType: result.ContentType };
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    },
    async getObjectBytes(bucket, key, maxBytes) {
        try {
            const result = await getStorageClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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
        await getStorageClient().send(new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
            ContentLength: input.body.length,
            CacheControl: input.cacheControl,
        }));
    },
}, {
    rawBucket: process.env.R2_BUCKET_RAW?.trim() || RAW_BUCKET_DEFAULT,
    publicBucket: process.env.R2_BUCKET_PUBLIC?.trim() || PUBLIC_BUCKET_DEFAULT,
    publicDomain: process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL || '',
});

export const createChannelImageUploadTarget = channelImageStorage.createUploadTarget;
export const publishVerifiedChannelImage = channelImageStorage.publishUploadedImage;
