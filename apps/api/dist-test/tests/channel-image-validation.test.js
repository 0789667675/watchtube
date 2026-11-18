"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const sharp_1 = __importDefault(require("sharp"));
const channel_image_service_1 = require("../src/services/channel-image.service");
async function createPng(width, height) {
    return (0, sharp_1.default)({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 12, g: 100, b: 220 },
        },
    }).png().toBuffer();
}
(0, node_test_1.test)('avatar images are decoded, normalized to WebP, and resized to 512 square', async () => {
    const output = await (0, channel_image_service_1.processChannelImage)(await createPng(800, 600), 'avatar', 'image/png');
    const metadata = await (0, sharp_1.default)(output).metadata();
    strict_1.default.equal(metadata.format, 'webp');
    strict_1.default.equal(metadata.width, 512);
    strict_1.default.equal(metadata.height, 512);
});
(0, node_test_1.test)('banner images are decoded, normalized to WebP, and resized to 1920 by 640', async () => {
    const output = await (0, channel_image_service_1.processChannelImage)(await createPng(1500, 500), 'banner', 'image/png');
    const metadata = await (0, sharp_1.default)(output).metadata();
    strict_1.default.equal(metadata.format, 'webp');
    strict_1.default.equal(metadata.width, 1920);
    strict_1.default.equal(metadata.height, 640);
});
(0, node_test_1.test)('banner dimensions account for EXIF orientation', async () => {
    const orientedJpeg = await (0, sharp_1.default)({
        create: {
            width: 400,
            height: 1600,
            channels: 3,
            background: { r: 12, g: 100, b: 220 },
        },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await (0, channel_image_service_1.processChannelImage)(orientedJpeg, 'banner', 'image/jpeg');
    const metadata = await (0, sharp_1.default)(output).metadata();
    strict_1.default.equal(metadata.width, 1920);
    strict_1.default.equal(metadata.height, 640);
});
(0, node_test_1.test)('image processing rejects unsupported, mislabeled, malformed, and undersized content', async () => {
    const validPng = await createPng(128, 128);
    await strict_1.default.rejects((0, channel_image_service_1.processChannelImage)(validPng, 'avatar', 'image/svg+xml'), channel_image_service_1.InvalidChannelImageError);
    await strict_1.default.rejects((0, channel_image_service_1.processChannelImage)(validPng, 'avatar', 'image/jpeg'), channel_image_service_1.InvalidChannelImageError);
    await strict_1.default.rejects((0, channel_image_service_1.processChannelImage)(Buffer.from('not an image'), 'avatar', 'image/png'), channel_image_service_1.InvalidChannelImageError);
    await strict_1.default.rejects((0, channel_image_service_1.processChannelImage)(await createPng(48, 48), 'avatar', 'image/png'), channel_image_service_1.InvalidChannelImageError);
    await strict_1.default.rejects((0, channel_image_service_1.processChannelImage)(await createPng(800, 400), 'banner', 'image/png'), channel_image_service_1.InvalidChannelImageError);
});
