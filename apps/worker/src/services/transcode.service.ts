import ffmpeg from 'fluent-ffmpeg';

export function getVideoMetadata(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata);
        });
    });
}

export function extractThumbnails(inputPath: string, outputDir: string, timestamps: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .screenshots({
                timestamps,
                filename: 'thumbnail-%s.jpg',
                folder: outputDir,
                size: '1280x720' // Or based on source
            });
    });
}

export function extractPoster(inputPath: string, outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .screenshots({
                timestamps: ['00:00:01'],
                filename: 'poster.jpg',
                folder: outputDir,
                size: '1280x720' // Or based on source
            });
    });
}

interface Rendition {
    name: string;
    resolution: string;
    videoBitrate: string;
    audioBitrate: string;
}

export function createHLSRendition(inputPath: string, outputPath: string, rendition: Rendition): Promise<void> {
    return new Promise((resolve, reject) => {
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
                `-hls_segment_filename ${outputPath.replace('.m3u8', '')}_%03d.ts`
            ])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
    });
}
