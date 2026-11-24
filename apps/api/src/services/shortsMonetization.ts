const RATE_PERCENT_PATTERN = /^(?:100(?:\.0{1,2})?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/;
const MAX_RATE_BASIS_POINTS = 10_000;

export function ratePercentToBasisPoints(value: string): number | null {
  if (!RATE_PERCENT_PATTERN.test(value)) return null;

  const [whole, fractional = ''] = value.split('.');
  return Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
}

export function formatRateBasisPoints(rateBasisPoints: number): string {
  if (
    !Number.isInteger(rateBasisPoints)
    || rateBasisPoints < 0
    || rateBasisPoints > MAX_RATE_BASIS_POINTS
  ) {
    throw new RangeError('Shorts monetization rate must be between 0 and 100 percent.');
  }

  return `${Math.floor(rateBasisPoints / 100)}.${String(rateBasisPoints % 100).padStart(2, '0')}`;
}

export function calculateShortsCreatorEarningsRwf(
  standardCreatorEarningsRwf: bigint,
  rateBasisPoints: number,
): bigint {
  if (
    !Number.isInteger(rateBasisPoints)
    || rateBasisPoints < 0
    || rateBasisPoints > MAX_RATE_BASIS_POINTS
  ) {
    throw new RangeError('Shorts monetization rate must be between 0 and 100 percent.');
  }

  const sign = standardCreatorEarningsRwf < 0n ? -1n : 1n;
  const absoluteEarnings = standardCreatorEarningsRwf * sign;
  const roundedEarnings = (absoluteEarnings * BigInt(rateBasisPoints) + 5_000n) / 10_000n;
  return roundedEarnings * sign;
}
