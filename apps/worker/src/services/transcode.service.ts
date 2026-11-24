import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawnSync } from 'node:child_process';

export interface Rendition {
    name: string;
    resolution: string;
    videoBitrate: string;
    audioBitrate: string;
    bitrate?: number;
}

export type MediaToolStatus = {
    ffmpeg: boolean;
    ffprobe: boolean;
};

export function getFfmpegCommand(): string {
    return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

export function getFfprobeCommand(): string {
    return process.env.FFPROBE_PATH?.trim() || 'ffprobe';
}

export function applyConfiguredMediaPaths(): void {
    try {
        ffmpeg.setFfmpegPath(getFfmpegCommand());
    } catch {
        // Safe fallback
    }
    try {
        ffmpeg.setFfprobePath(getFfprobeCommand());
    } catch {
        // Safe fallback
    }
}

applyConfiguredMediaPaths();

export function getMediaToolStatus(): MediaToolStatus {
    applyConfiguredMediaPaths();
    const ffmpegCmd = getFfmpegCommand();
    const ffprobeCmd = getFfprobeCommand();
    const ffmpegResult = spawnSync(ffmpegCmd, ['-version'], { stdio: 'ignore' });
    const ffprobeResult = spawnSync(ffprobeCmd, ['-version'], { stdio: 'ignore' });
    return {
        ffmpeg: ffmpegResult.error === undefined && ffmpegResult.status === 0,
        ffprobe: ffprobeResult.error === undefined && ffprobeResult.status === 0,
    };
}

async function ensureOutputDirectory(outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
}

export function getVideoMetadata(filePath: string): Promise<ffmpeg.FfprobeData> {
    if (!filePath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    applyConfiguredMediaPaths();
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata);
        });
    });
}

export function extractThumbnails(inputPath: string, outputDir: string, timestamps: string[], size = '1280x720'): Promise<void> {
    if (!inputPath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    if (!timestamps.length) return Promise.reject(new Error('At least one thumbnail timestamp is required'));
    applyConfiguredMediaPaths();
    return fs.mkdir(outputDir, { recursive: true }).then(() => new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .screenshots({
                timestamps,
                filename: 'thumbnail-%s.jpg',
                folder: outputDir,
                size
            });
    }));
}

export function extractPoster(
    inputPath: string,
    outputDir: string,
    size = '1280x720',
    timestamp = '00:00:01',
): Promise<void> {
    if (!inputPath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    applyConfiguredMediaPaths();
    return fs.mkdir(outputDir, { recursive: true }).then(() => new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
            .on('end', async () => {
                try {
                    const posterPath = path.join(outputDir, 'poster.jpg');
                    const stat = await fs.stat(posterPath);
                    if (!stat.isFile() || stat.size <= 0) {
                        reject(new Error('FFmpeg finished without writing a valid poster image.'));
                        return;
                    }
                    resolve();
                } catch (err) {
                    reject(err);
                }
            })
            .on('error', (err) => reject(err))
            .screenshots({
                timestamps: [timestamp || '0'],
                filename: 'poster.jpg',
                folder: outputDir,
                size
            });
    }));
}

export function createHLSRendition(
    inputPath: string,
    outputPath: string,
    rendition: Rendition,
    options: { hasAudio?: boolean } = {},
): Promise<void> {
    if (!inputPath?.trim()) return Promise.reject(new Error('FFmpeg input path is required'));
    if (!outputPath || !rendition.resolution || !rendition.videoBitrate || !rendition.audioBitrate) {
        return Promise.reject(new Error('Invalid HLS rendition configuration'));
    }
    applyConfiguredMediaPaths();
    const hasAudio = options.hasAudio !== false;
    return ensureOutputDirectory(outputPath).then(() => new Promise<void>((resolve, reject) => {
        const segmentPattern = outputPath.replace(/\.m3u8$/i, '') + '_%03d.ts';
        const outputOptions = [
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-s', rendition.resolution,
            '-b:v', rendition.videoBitrate,
            ...(hasAudio
                ? ['-c:a', 'aac', '-b:a', rendition.audioBitrate, '-af', 'loudnorm=I=-14:LRA=11:TP=-1.5']
                : ['-an']),
            '-f', 'hls',
            '-hls_time', '6',
            '-hls_list_size', '0',
            '-hls_segment_filename', segmentPattern,
        ];
        ffmpeg(inputPath)
            .outputOptions(outputOptions)
            .output(outputPath)
            .on('end', async () => {
                try {
                    const stat = await fs.stat(outputPath);
                    if (!stat.isFile() || stat.size <= 0) {
                        reject(new Error(`FFmpeg finished without writing playlist ${path.basename(outputPath)}`));
                        return;
                    }
                    resolve();
                } catch (err) {
                    reject(err);
                }
            })
            .on('error', (err) => reject(err))
            .run();
    }));
}
