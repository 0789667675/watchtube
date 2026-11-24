"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidChannelImageError = exports.VIDEO_THUMBNAIL_MAX_FILE_SIZE = exports.CHANNEL_IMAGE_MAX_FILE_SIZE = void 0;
exports.processChannelImage = processChannelImage;
exports.processVideoThumbnail = processVideoThumbnail;
const sharp_1 = __importDefault(require("sharp"));
exports.CHANNEL_IMAGE_MAX_FILE_SIZE = {
    avatar: 5 * 1024 * 1024,
    banner: 10 * 1024 * 1024,
};
const FORMAT_BY_CONTENT_TYPE = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
};
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 8192;
exports.VIDEO_THUMBNAIL_MAX_FILE_SIZE = 5 * 1024 * 1024;
const VIDEO_THUMBNAIL_FORMATS = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
};
class InvalidChannelImageError extends Error {
    constructor(message = 'The uploaded file is not a valid supported image.') {
        super(message);
        this.name = 'InvalidChannelImageError';
    }
}
exports.InvalidChannelImageError = InvalidChannelImageError;
async function processChannelImage(input, purpose, contentType) {
    const expectedFormat = FORMAT_BY_CONTENT_TYPE[contentType];
    const maxFileSize = exports.CHANNEL_IMAGE_MAX_FILE_SIZE[purpose];
    if (!expectedFormat || input.length === 0 || input.length > maxFileSize) {
        throw new InvalidChannelImageError();
    }
    try {
        const image = (0, sharp_1.default)(input, {
            failOn: 'error',
            limitInputPixels: MAX_IMAGE_PIXELS,
            sequentialRead: true,
        });
        const metadata = await image.metadata();
        const { width, height } = metadata;
        if (!width || !height)
            throw new InvalidChannelImageError();
        const orientationSwapsDimensions = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
        const displayWidth = orientationSwapsDimensions ? height : width;
        const displayHeight = orientationSwapsDimensions ? width : height;
        if (metadata.format !== expectedFormat
            || (metadata.pages !== undefined && metadata.pages > 1)
            || width > MAX_IMAGE_DIMENSION
            || height > MAX_IMAGE_DIMENSION
            || width * height > MAX_IMAGE_PIXELS) {
            throw new InvalidChannelImageError();
        }
        if (purpose === 'avatar' && (displayWidth < 64 || displayHeight < 64)) {
            throw new InvalidChannelImageError('Avatar images must be at least 64 by 64 pixels.');
        }
        if (purpose === 'banner') {
            const aspectRatio = displayWidth / displayHeight;
            if (displayWidth < 960 || displayHeight < 240 || aspectRatio < 1.5 || aspectRatio > 5.5) {
                throw new InvalidChannelImageError('Banner images must be at least 960 by 240 pixels with a wide aspect ratio.');
            }
        }
        const dimensions = purpose === 'avatar'
            ? { width: 512, height: 512 }
            : { width: 1920, height: 640 };
        return await image
            .rotate()
            .resize({ ...dimensions, fit: 'cover', position: 'centre' })
            .webp({ quality: 82, effort: 4 })
            .toBuffer();
    }
    catch (error) {
        if (error instanceof InvalidChannelImageError)
            throw error;
        throw new InvalidChannelImageError();
    }
}
async function processVideoThumbnail(input, contentType, isShort = false) {
    const expectedFormat = VIDEO_THUMBNAIL_FORMATS[contentType];
    if (!expectedFormat || input.length === 0 || input.length > exports.VIDEO_THUMBNAIL_MAX_FILE_SIZE) {
        throw new InvalidChannelImageError('Choose a JPEG, PNG, or WebP thumbnail no larger than 5 MB.');
    }
    const minimumWidth = isShort ? 180 : 320;
    const minimumHeight = isShort ? 320 : 180;
    try {
        const image = (0, sharp_1.default)(input, {
            failOn: 'error',
            limitInputPixels: MAX_IMAGE_PIXELS,
            sequentialRead: true,
        });
        const metadata = await image.metadata();
        const orientationSwapsDimensions = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
        const displayWidth = orientationSwapsDimensions ? metadata.height : metadata.width;
        const displayHeight = orientationSwapsDimensions ? metadata.width : metadata.height;
        if (metadata.format !== expectedFormat
            || !metadata.width
            || !metadata.height
            || (metadata.pages !== undefined && metadata.pages > 1)
            || metadata.width > MAX_IMAGE_DIMENSION
            || metadata.height > MAX_IMAGE_DIMENSION
            || metadata.width * metadata.height > MAX_IMAGE_PIXELS
            || !displayWidth
            || !displayHeight
            || displayWidth < minimumWidth
            || displayHeight < minimumHeight
            || (isShort
                && (displayWidth / displayHeight < 0.50625 || displayWidth / displayHeight > 0.61875))) {
            throw new InvalidChannelImageError(isShort
                ? 'Short thumbnails must be valid JPEG, PNG, or WebP portrait images with a 9:16 aspect ratio and at least 180 by 320 pixels.'
                : 'Thumbnail must be a valid JPEG, PNG, or WebP image at least 320 by 180 pixels.');
        }
        return await image
            .rotate()
            .resize({
            width: isShort ? 720 : 1280,
            height: isShort ? 1280 : 720,
            fit: 'cover',
            position: 'centre',
        })
            .webp({ quality: 82, effort: 4 })
            .toBuffer();
    }
    catch (error) {
        if (error instanceof InvalidChannelImageError)
            throw error;
        throw new InvalidChannelImageError();
    }
}
