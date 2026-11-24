"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratePercentToBasisPoints = ratePercentToBasisPoints;
exports.formatRateBasisPoints = formatRateBasisPoints;
exports.calculateShortsCreatorEarningsRwf = calculateShortsCreatorEarningsRwf;
const RATE_PERCENT_PATTERN = /^(?:100(?:\.0{1,2})?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/;
const MAX_RATE_BASIS_POINTS = 10_000;
function ratePercentToBasisPoints(value) {
    if (!RATE_PERCENT_PATTERN.test(value))
        return null;
    const [whole, fractional = ''] = value.split('.');
    return Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
}
function formatRateBasisPoints(rateBasisPoints) {
    if (!Number.isInteger(rateBasisPoints)
        || rateBasisPoints < 0
        || rateBasisPoints > MAX_RATE_BASIS_POINTS) {
        throw new RangeError('Shorts monetization rate must be between 0 and 100 percent.');
    }
    return `${Math.floor(rateBasisPoints / 100)}.${String(rateBasisPoints % 100).padStart(2, '0')}`;
}
function calculateShortsCreatorEarningsRwf(standardCreatorEarningsRwf, rateBasisPoints) {
    if (!Number.isInteger(rateBasisPoints)
        || rateBasisPoints < 0
        || rateBasisPoints > MAX_RATE_BASIS_POINTS) {
        throw new RangeError('Shorts monetization rate must be between 0 and 100 percent.');
    }
    const sign = standardCreatorEarningsRwf < 0n ? -1n : 1n;
    const absoluteEarnings = standardCreatorEarningsRwf * sign;
    const roundedEarnings = (absoluteEarnings * BigInt(rateBasisPoints) + 5000n) / 10000n;
    return roundedEarnings * sign;
}
