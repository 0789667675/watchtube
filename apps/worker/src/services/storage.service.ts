import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import * as fs from 'fs';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const rawBucket = process.env.R2_BUCKET_RAW || 'watchtube-raw-uploads';
const publicBucket = process.env.R2_BUCKET_PUBLIC || 'watchtube-media-public';

const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
    },
});

export async function downloadRawVideo(key: string, destinationPath: string) {
    const command = new GetObjectCommand({
        Bucket: rawBucket,
        Key: key,
    });
    const response = await s3Client.send(command);
    if (response.Body) {
        await pipeline(response.Body as Readable, createWriteStream(destinationPath));
    } else {
        throw new Error('No body in response');
    }
}

export async function uploadPublicFile(localPath: string, s3Key: string, contentType: string) {
    const fileStream = fs.createReadStream(localPath);
    const command = new PutObjectCommand({
        Bucket: publicBucket,
        Key: s3Key,
        Body: fileStream,
        ContentType: contentType,
    });
    await s3Client.send(command);
}
