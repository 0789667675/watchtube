"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishVerifiedChannelImage = exports.createChannelImageUploadTarget = exports.StorageUnavailableError = exports.ALLOWED_UPLOAD_CONTENT_TYPES = exports.MAX_UPLOAD_SIZE = void 0;
exports.getStorageConfigurationStatus = getStorageConfigurationStatus;
exports.generatePresignedUploadUrl = generatePresignedUploadUrl;
exports.inspectRawObject = inspectRawObject;
exports.publishProcessedVideoAssets = publishProcessedVideoAssets;
exports.deletePublishedVideoAssets = deletePublishedVideoAssets;
exports.createVideoThumbnailUploadTarget = createVideoThumbnailUploadTarget;
exports.normalizeUploadedVideoThumbnail = normalizeUploadedVideoThumbnail;
exports.createChannelImageStorageService = createChannelImageStorageService;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = require("crypto");
const node_stream_1 = require("node:stream");
const channel_image_service_1 = require("./channel-image.service");
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
exports.MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
exports.ALLOWED_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
class StorageUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StorageUnavailableError';
    }
}
exports.StorageUnavailableError = StorageUnavailableError;
const RAW_BUCKET_DEFAULT = 'watchtube-raw-uploads';
const PUBLIC_BUCKET_DEFAULT = 'watchtube-media-public';
let s3Client = null;
function hasConfiguredValue(value) {
    if (!value?.trim())
        return false;
    return !/(your[_-]|replace.?with|placeholder|x{4,})/i.test(value.trim());
}
function isValidBucketName(bucket) {
    return hasConfiguredValue(bucket)
        && bucket.length >= 3
        && bucket.length <= 63
        && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
        && !bucket.includes('..');
}
function isValidAccountId(accountId) {
    return hasConfiguredValue(accountId) && /^[a-f0-9]{32}$/i.test(accountId.trim());
}
function getStorageConfigurationStatus(requirePublicMediaUrl = true) {
    const missing = [];
    if (!isValidAccountId(process.env.CLOUDFLARE_ACCOUNT_ID))
        missing.push('CLOUDFLARE_ACCOUNT_ID');
    for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
        if (!hasConfiguredValue(process.env[name]))
            missing.push(name);
    }
    if (requirePublicMediaUrl) {
        let publicMediaConfigured = false;
        try {
            const publicDomain = process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL;
            if (!hasConfiguredValue(publicDomain))
                throw new Error('Public media URL is not configured.');
            getPublicMediaBaseUrl(publicDomain);
            publicMediaConfigured = true;
        }
        catch {
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
    const credentialsConfigured = missing.every((name) => name === 'R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL');
    return {
        status: credentialsConfigured
            ? missing.length === 0 ? 'configured' : 'partial'
            : 'unconfigured',
        missing,
    };
}
function getStorageClient() {
    if (s3Client)
        return s3Client;
    const missing = [
        ...(!isValidAccountId(process.env.CLOUDFLARE_ACCOUNT_ID) ? ['CLOUDFLARE_ACCOUNT_ID'] : []),
        ...(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
            .filter((name) => !hasConfiguredValue(process.env[name]))),
    ];
    if (missing.length) {
        throw new StorageUnavailableError(`Cloud storage is not configured. Missing environment variables: ${missing.join(', ')}.`);
    }
    s3Client = new client_s3_1.S3Client({
        region: 'auto',
        endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    return s3Client;
}
function getRawBucket() {
    return getBucketName('R2_BUCKET_RAW', RAW_BUCKET_DEFAULT);
}
function getBucketName(name, fallback) {
    const configured = process.env[name]?.trim();
    if (!configured)
        return fallback;
    if (!isValidBucketName(configured)) {
        throw new StorageUnavailableError(`Cloud storage bucket configuration ${name} is invalid.`);
    }
    return configured;
}
function isNotFoundError(error) {
    if (typeof error !== 'object' || error === null)
        return false;
    const metadata = '$metadata' in error ? error.$metadata : undefined;
    const statusCode = typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata
        ? metadata.httpStatusCode
        : undefined;
    const name = 'name' in error ? error.name : undefined;
    return statusCode === 404 || name === 'NotFound' || name === 'NoSuchKey';
}
async function generatePresignedUploadUrl(userId, contentType, fileSize, fileKey = `uploads/${userId}/${(0, crypto_1.randomUUID)()}`) {
    if (!exports.ALLOWED_UPLOAD_CONTENT_TYPES.includes(contentType)) {
        throw new Error('Invalid content type. Only video/mp4, video/webm, and video/quicktime are allowed.');
    }
    if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > exports.MAX_UPLOAD_SIZE) {
        throw new Error('File size exceeds the 2GB limit.');
    }
    if (!fileKey.startsWith(`uploads/${userId}/`)) {
        throw new Error('Upload key does not belong to this user.');
    }
    const command = new client_s3_1.PutObjectCommand({
        Bucket: getRawBucket(),
        Key: fileKey,
        ContentType: contentType,
        ContentLength: fileSize,
    });
    const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(getStorageClient(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
    return { uploadUrl, fileKey, expiresIn: UPLOAD_URL_TTL_SECONDS };
}
async function inspectRawObject(key) {
    try {
        const command = new client_s3_1.HeadObjectCommand({
            Bucket: getRawBucket(),
            Key: key,
        });
        const result = await getStorageClient().send(command);
        return { contentLength: result.ContentLength, contentType: result.ContentType };
    }
    catch (error) {
        if (isNotFoundError(error))
            return null;
        throw error;
    }
}
function getPublicObjectContentType(key) {
    if (key.endsWith('.m3u8'))
        return 'application/vnd.apple.mpegurl';
    if (key.endsWith('.ts'))
        return 'video/MP2T';
    if (key.endsWith('.webp'))
        return 'image/webp';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg'))
        return 'image/jpeg';
    throw new Error('Unsupported processed media file type.');
}
async function publishProcessedVideoAssets(videoId, selectedThumbnailKey) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) {
        throw new Error('Invalid video id.');
    }
    const rawBucket = getRawBucket();
    const publicBucket = getBucketName('R2_BUCKET_PUBLIC', PUBLIC_BUCKET_DEFAULT);
    const prefix = `processing/${videoId}/`;
    const publicPrefix = `media/${videoId}/`;
    const publicDomain = process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL || '';
    const uploadedKeys = [];
    let continuationToken;
    let posterUrl;
    let customThumbnailUrl;
    const playlistUrls = {};
    if (selectedThumbnailKey
        && (!selectedThumbnailKey.startsWith(prefix)
            || !/^custom-thumbnail-[0-9a-f-]{36}\.webp$/i.test(selectedThumbnailKey.slice(prefix.length)))) {
        throw new Error('Invalid video thumbnail storage key.');
    }
    try {
        do {
            const page = await getStorageClient().send(new client_s3_1.ListObjectsV2Command({
                Bucket: rawBucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }));
            for (const object of page.Contents ?? []) {
                if (!object.Key || object.Size === undefined)
                    continue;
                const filename = object.Key.slice(prefix.length);
                if (!filename || filename.includes('/'))
                    continue;
                const isCustomThumbnail = /^custom-thumbnail-[0-9a-f-]{36}\.webp$/i.test(filename);
                if (isCustomThumbnail && object.Key !== selectedThumbnailKey)
                    continue;
                const publicKey = `${publicPrefix}${filename}`;
                await getStorageClient().send(new client_s3_1.CopyObjectCommand({
                    Bucket: publicBucket,
                    Key: publicKey,
                    CopySource: `${rawBucket}/${object.Key.split('/').map(encodeURIComponent).join('/')}`,
                    ContentType: getPublicObjectContentType(filename),
                    CacheControl: 'public, max-age=31536000, immutable',
                    MetadataDirective: 'REPLACE',
                }));
                uploadedKeys.push(publicKey);
                if (filename === 'poster.jpg')
                    posterUrl = getPublicMediaUrl(publicDomain, publicKey);
                if (isCustomThumbnail) {
                    customThumbnailUrl = getPublicMediaUrl(publicDomain, publicKey);
                }
                const rendition = /^(360p|720p|1080p)\.m3u8$/.exec(filename)?.[1];
                if (rendition)
                    playlistUrls[rendition] = getPublicMediaUrl(publicDomain, publicKey);
            }
            continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (continuationToken);
        const thumbnailUrl = customThumbnailUrl || posterUrl;
        if (!uploadedKeys.length || !thumbnailUrl || Object.keys(playlistUrls).length === 0) {
            throw new StorageUnavailableError('Processed video assets are incomplete.');
        }
        return { thumbnailUrl, playlistUrls };
    }
    catch (error) {
        for (const key of uploadedKeys) {
            try {
                await getStorageClient().send(new client_s3_1.DeleteObjectCommand({ Bucket: publicBucket, Key: key }));
            }
            catch (cleanupError) {
                console.error('Failed to remove a partially published video asset.', {
                    name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
                });
            }
        }
        throw error;
    }
}
async function deletePublishedVideoAssets(videoId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) {
        throw new Error('Invalid video id.');
    }
    const bucket = getBucketName('R2_BUCKET_PUBLIC', PUBLIC_BUCKET_DEFAULT);
    const prefix = `media/${videoId}/`;
    let continuationToken;
    do {
        const page = await getStorageClient().send(new client_s3_1.ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        for (const object of page.Contents ?? []) {
            if (object.Key) {
                await getStorageClient().send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
            }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
}
async function createVideoThumbnailUploadTarget(videoId, contentType, fileSize) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)
        || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
        || !Number.isInteger(fileSize)
        || fileSize <= 0
        || fileSize > channel_image_service_1.VIDEO_THUMBNAIL_MAX_FILE_SIZE) {
        throw new channel_image_service_1.InvalidChannelImageError('Invalid video thumbnail upload metadata.');
    }
    const storageKey = `processing/${videoId}/custom-thumbnail-${(0, crypto_1.randomUUID)()}.webp`;
    const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(getStorageClient(), new client_s3_1.PutObjectCommand({
        Bucket: getRawBucket(),
        Key: storageKey,
        ContentType: contentType,
        ContentLength: fileSize,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS });
    return { uploadUrl, storageKey, expiresIn: UPLOAD_URL_TTL_SECONDS };
}
async function normalizeUploadedVideoThumbnail(storageKey, contentType, fileSize) {
    if (!/^processing\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/custom-thumbnail-[0-9a-f-]{36}\.webp$/i.test(storageKey)
        || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
        || !Number.isInteger(fileSize)
        || fileSize <= 0
        || fileSize > channel_image_service_1.VIDEO_THUMBNAIL_MAX_FILE_SIZE) {
        throw new channel_image_service_1.InvalidChannelImageError('Invalid video thumbnail upload metadata.');
    }
    const object = await getStorageClient().send(new client_s3_1.GetObjectCommand({
        Bucket: getRawBucket(),
        Key: storageKey,
    }));
    if (!object.Body)
        return false;
    if (!(object.Body instanceof node_stream_1.Readable)) {
        throw new Error('Storage returned an unsupported image stream.');
    }
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of object.Body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > fileSize || totalBytes > channel_image_service_1.VIDEO_THUMBNAIL_MAX_FILE_SIZE) {
            object.Body.destroy();
            throw new channel_image_service_1.InvalidChannelImageError('Uploaded thumbnail size does not match the authorized upload.');
        }
        chunks.push(bytes);
    }
    if (totalBytes !== fileSize || object.ContentLength !== fileSize || object.ContentType !== contentType) {
        throw new channel_image_service_1.InvalidChannelImageError('Uploaded thumbnail metadata does not match the authorized upload.');
    }
    const normalized = await (0, channel_image_service_1.processVideoThumbnail)(Buffer.concat(chunks, totalBytes), contentType);
    await getStorageClient().send(new client_s3_1.PutObjectCommand({
        Bucket: getRawBucket(),
        Key: storageKey,
        Body: normalized,
        ContentType: 'image/webp',
        ContentLength: normalized.length,
    }));
    return true;
}
function getPublicMediaBaseUrl(publicDomain) {
    const configuredDomain = publicDomain.trim().split(/\s+/)[0];
    if (!hasConfiguredValue(configuredDomain)) {
        throw new Error('Public media URL is not configured.');
    }
    const httpsDomain = configuredDomain.replace(/^http:\/\//i, 'https://');
    const baseUrl = new URL(httpsDomain.includes('://') ? httpsDomain : `https://${httpsDomain}`);
    if (baseUrl.protocol !== 'https:'
        || baseUrl.username
        || baseUrl.password
        || baseUrl.search
        || baseUrl.hash) {
        throw new Error('Public media URL configuration is invalid.');
    }
    return baseUrl;
}
function getPublicMediaUrl(publicDomain, objectKey) {
    const baseUrl = getPublicMediaBaseUrl(publicDomain);
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    return `${baseUrl.origin}${basePath}/${encodedKey}`;
}
function createChannelImageStorageService(adapter, config) {
    return {
        async createUploadTarget(input) {
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.contentType)
                || !Number.isInteger(input.fileSize)
                || input.fileSize <= 0
                || input.fileSize > channel_image_service_1.CHANNEL_IMAGE_MAX_FILE_SIZE[input.purpose]) {
                throw new channel_image_service_1.InvalidChannelImageError('Invalid channel image upload metadata.');
            }
            if (!config.rawBucket || !isValidBucketName(config.rawBucket)) {
                throw new StorageUnavailableError('Raw upload storage is not configured.');
            }
            if (!config.publicBucket || !isValidBucketName(config.publicBucket)) {
                throw new StorageUnavailableError('Public media storage is not configured.');
            }
            getPublicMediaBaseUrl(config.publicDomain);
            const uploadId = (0, crypto_1.randomUUID)();
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
        async publishUploadedImage(input) {
            const { channelId, purpose, contentType, fileSize, uploadId } = input;
            const maxFileSize = channel_image_service_1.CHANNEL_IMAGE_MAX_FILE_SIZE[purpose];
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)
                || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
                || !Number.isInteger(fileSize)
                || fileSize <= 0
                || fileSize > maxFileSize) {
                throw new channel_image_service_1.InvalidChannelImageError();
            }
            if (!config.rawBucket || !isValidBucketName(config.rawBucket)) {
                throw new StorageUnavailableError('Raw upload storage is not configured.');
            }
            if (!config.publicBucket || !isValidBucketName(config.publicBucket)) {
                throw new StorageUnavailableError('Public media storage is not configured.');
            }
            const uploadKey = `channel-image-uploads/${channelId}/${purpose}/${uploadId}`;
            const metadata = await adapter.getObjectMetadata(config.rawBucket, uploadKey);
            if (!metadata)
                return null;
            if (metadata.contentLength !== fileSize || metadata.contentType !== contentType) {
                throw new channel_image_service_1.InvalidChannelImageError('Uploaded image metadata does not match the authorized upload.');
            }
            const uploadedBytes = await adapter.getObjectBytes(config.rawBucket, uploadKey, fileSize);
            if (!uploadedBytes)
                return null;
            if (uploadedBytes.length !== fileSize) {
                throw new channel_image_service_1.InvalidChannelImageError('Uploaded image size does not match the authorized upload.');
            }
            const processedBytes = await (0, channel_image_service_1.processChannelImage)(uploadedBytes, purpose, contentType);
            const publicKey = `channel-images/${channelId}/${purpose}/${(0, crypto_1.randomUUID)()}.webp`;
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
        const command = new client_s3_1.PutObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            ContentType: input.contentType,
            ContentLength: input.fileSize,
        });
        return (0, s3_request_presigner_1.getSignedUrl)(getStorageClient(), command, { expiresIn: input.expiresIn });
    },
    async getObjectMetadata(bucket, key) {
        try {
            const result = await getStorageClient().send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: key }));
            return { contentLength: result.ContentLength, contentType: result.ContentType };
        }
        catch (error) {
            if (isNotFoundError(error))
                return null;
            throw error;
        }
    },
    async getObjectBytes(bucket, key, maxBytes) {
        try {
            const result = await getStorageClient().send(new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key }));
            if (!result.Body)
                return null;
            if (!(result.Body instanceof node_stream_1.Readable)) {
                throw new Error('Storage returned an unsupported image stream.');
            }
            const chunks = [];
            let totalBytes = 0;
            for await (const chunk of result.Body) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalBytes += bytes.length;
                if (totalBytes > maxBytes) {
                    result.Body.destroy();
                    throw new channel_image_service_1.InvalidChannelImageError('Uploaded image size does not match the authorized upload.');
                }
                chunks.push(bytes);
            }
            return Buffer.concat(chunks, totalBytes);
        }
        catch (error) {
            if (isNotFoundError(error))
                return null;
            throw error;
        }
    },
    async putPublicObject(input) {
        await getStorageClient().send(new client_s3_1.PutObjectCommand({
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
exports.createChannelImageUploadTarget = channelImageStorage.createUploadTarget;
exports.publishVerifiedChannelImage = channelImageStorage.publishUploadedImage;
