"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishVerifiedChannelImage = exports.createChannelImageUploadTarget = exports.ALLOWED_UPLOAD_CONTENT_TYPES = exports.MAX_UPLOAD_SIZE = void 0;
exports.generatePresignedUploadUrl = generatePresignedUploadUrl;
exports.inspectRawObject = inspectRawObject;
exports.createChannelImageStorageService = createChannelImageStorageService;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = require("crypto");
const node_stream_1 = require("node:stream");
const channel_image_service_1 = require("./channel-image.service");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_RAW;
const publicBucketName = process.env.R2_BUCKET_PUBLIC || 'watchtube-media-public';
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
exports.MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
exports.ALLOWED_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    console.warn("Storage credentials are not fully configured in environment variables.");
}
const s3Client = new client_s3_1.S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
    },
});
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
        Bucket: bucketName,
        Key: fileKey,
        ContentType: contentType,
        ContentLength: fileSize,
    });
    const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
    return { uploadUrl, fileKey, expiresIn: UPLOAD_URL_TTL_SECONDS };
}
async function inspectRawObject(key) {
    try {
        const command = new client_s3_1.HeadObjectCommand({
            Bucket: bucketName,
            Key: key,
        });
        const result = await s3Client.send(command);
        return { contentLength: result.ContentLength, contentType: result.ContentType };
    }
    catch (error) {
        if (isNotFoundError(error))
            return null;
        throw error;
    }
}
function getPublicMediaBaseUrl(publicDomain) {
    const configuredDomain = publicDomain.trim().split(/\s+/)[0];
    if (!configuredDomain) {
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
            if (!config.rawBucket)
                throw new Error('Raw upload storage is not configured.');
            if (!config.publicBucket)
                throw new Error('Public media storage is not configured.');
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
            if (!config.rawBucket)
                throw new Error('Raw upload storage is not configured.');
            if (!config.publicBucket)
                throw new Error('Public media storage is not configured.');
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
        return (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn: input.expiresIn });
    },
    async getObjectMetadata(bucket, key) {
        try {
            const result = await s3Client.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: key }));
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
            const result = await s3Client.send(new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key }));
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
        await s3Client.send(new client_s3_1.PutObjectCommand({
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
exports.createChannelImageUploadTarget = channelImageStorage.createUploadTarget;
exports.publishVerifiedChannelImage = channelImageStorage.publishUploadedImage;
