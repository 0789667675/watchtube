import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_RAW;

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

const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

const ALLOWED_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export async function generatePresignedUploadUrl(userId: string, contentType: string, fileSize: number) {
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        throw new Error('Invalid content type. Only video/mp4, video/webm, and video/quicktime are allowed.');
    }

    if (fileSize > MAX_UPLOAD_SIZE) {
        throw new Error('File size exceeds the 2GB limit.');
    }

    const fileKey = `uploads/${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ContentType: contentType,
        ContentLength: fileSize,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return { uploadUrl, fileKey };
}

export async function verifyObjectExists(key: string) {
    try {
        const command = new HeadObjectCommand({
            Bucket: bucketName,
            Key: key,
        });
        await s3Client.send(command);
        return true;
    } catch (error) {
        return false;
    }
}
