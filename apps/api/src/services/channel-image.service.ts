import sharp from 'sharp';

export type ChannelImagePurpose = 'avatar' | 'banner';

export const CHANNEL_IMAGE_MAX_FILE_SIZE: Record<ChannelImagePurpose, number> = {
  avatar: 5 * 1024 * 1024,
  banner: 10 * 1024 * 1024,
};

const FORMAT_BY_CONTENT_TYPE: Record<string, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 8192;

export class InvalidChannelImageError extends Error {
  constructor(message = 'The uploaded file is not a valid supported image.') {
    super(message);
    this.name = 'InvalidChannelImageError';
  }
}

export async function processChannelImage(
  input: Buffer,
  purpose: ChannelImagePurpose,
  contentType: string,
): Promise<Buffer> {
  const expectedFormat = FORMAT_BY_CONTENT_TYPE[contentType];
  const maxFileSize = CHANNEL_IMAGE_MAX_FILE_SIZE[purpose];
  if (!expectedFormat || input.length === 0 || input.length > maxFileSize) {
    throw new InvalidChannelImageError();
  }

  try {
    const image = sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const { width, height } = metadata;
    if (!width || !height) throw new InvalidChannelImageError();
    const orientationSwapsDimensions = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    const displayWidth = orientationSwapsDimensions ? height : width;
    const displayHeight = orientationSwapsDimensions ? width : height;
    if (
      metadata.format !== expectedFormat
      || (metadata.pages !== undefined && metadata.pages > 1)
      || width > MAX_IMAGE_DIMENSION
      || height > MAX_IMAGE_DIMENSION
      || width * height > MAX_IMAGE_PIXELS
    ) {
      throw new InvalidChannelImageError();
    }

    if (purpose === 'avatar' && (displayWidth < 64 || displayHeight < 64)) {
      throw new InvalidChannelImageError('Avatar images must be at least 64 by 64 pixels.');
    }

    if (purpose === 'banner') {
      const aspectRatio = displayWidth / displayHeight;
      if (displayWidth < 960 || displayHeight < 240 || aspectRatio < 1.5 || aspectRatio > 5.5) {
        throw new InvalidChannelImageError(
          'Banner images must be at least 960 by 240 pixels with a wide aspect ratio.',
        );
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
  } catch (error) {
    if (error instanceof InvalidChannelImageError) throw error;
    throw new InvalidChannelImageError();
  }
}
