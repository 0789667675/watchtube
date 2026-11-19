import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Rendition {
    name: string;
    resolution: string;
    videoBitrate: string;
    audioBitrate: string;
    bitrate?: number;
}

async function ensureOutputDirectory(outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
}

export function getVideoMetadata(filePath: string): Promise<ffmpeg.FfprobeData> {
    if (!filePath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata);
        });
    });
}

export function extractThumbnails(inputPath: string, outputDir: string, timestamps: string[]): Promise<void> {
    if (!inputPath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    if (!timestamps.length) return Promise.reject(new Error('At least one thumbnail timestamp is required'));
    return ensureOutputDirectory(outputDir).then(() => new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .screenshots({
                timestamps,
                filename: 'thumbnail-%s.jpg',
                folder: outputDir,
                size: '1280x720' // Or based on source
            });
    }));
}

export function extractPoster(inputPath: string, outputDir: string): Promise<void> {
    if (!inputPath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    return ensureOutputDirectory(outputDir).then(() => new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .screenshots({
                timestamps: ['00:00:01'],
                filename: 'poster.jpg',
                folder: outputDir,
                size: '1280x720' // Or based on source
            });
    }));
}

export function createHLSRendition(inputPath: string, outputPath: string, rendition: Rendition): Promise<void> {
    if (!inputPath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    if (!outputPath || !rendition.resolution || !rendition.videoBitrate || !rendition.audioBitrate) {
        return Promise.reject(new Error('Invalid HLS rendition configuration'));
    }
    return ensureOutputDirectory(outputPath).then(() => new Promise<void>((resolve, reject) => {
        const segmentPattern = outputPath.replace(/\.m3u8$/i, '') + '_%03d.ts';
        ffmpeg(inputPath)
            .outputOptions([
                '-c:v h264',
                `-s ${rendition.resolution}`,
                `-b:v ${rendition.videoBitrate}`,
                '-c:a aac',
                `-b:a ${rendition.audioBitrate}`,
                '-af loudnorm=I=-14:LRA=11:TP=-1.5',
                '-hls_time 6',
                '-hls_list_size 0',
                `-hls_segment_filename ${segmentPattern}`
            ])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
    }));
}
