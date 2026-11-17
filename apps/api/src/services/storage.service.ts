import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_RAW;
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
