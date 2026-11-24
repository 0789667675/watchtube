import type { Response } from 'express';

const DATABASE_UNAVAILABLE_CODES = new Set([
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1017',
  'P2021',
  'P2022',
  'P1000',
  'P2024',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  // PostgreSQL SQLSTATE codes indicating connectivity, missing schema/objects, or insufficient runtime privileges
  '08001',
  '08006',
  '28000',
  '28P01',
  '3D000',
  '42501',
  '42703',
  '42P01',
  '53300',
  '57P01',
]);

const POSTGRES_EMBEDDED_CODE_PATTERN = /PostgresError\s*\{[^}]*\bcode:\s*"([0-9A-Z]{5})"/;

export function extractDatabaseErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string' && record.code.length > 0) return record.code;
    if (typeof record.errorCode === 'string' && record.errorCode.length > 0) return record.errorCode;
    if (typeof record.meta === 'object' && record.meta !== null) {
      const metaCode = (record.meta as Record<string, unknown>).code;
      if (typeof metaCode === 'string' && metaCode.length > 0) return metaCode;
    }
    if (typeof record.message === 'string') {
      const embeddedMatch = POSTGRES_EMBEDDED_CODE_PATTERN.exec(record.message);
      if (embeddedMatch?.[1]) return embeddedMatch[1];
    }
    current = record.cause;
  }
  return undefined;
}

export function isDatabaseUnavailable(error: unknown): boolean {
  const code = extractDatabaseErrorCode(error);
  if (code && DATABASE_UNAVAILABLE_CODES.has(code)) {
    return true;
  }
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    const record = current as Record<string, unknown>;
    if (record.name === 'PrismaClientInitializationError') return true;
    current = record.cause;
  }
  return false;
}

export function sendDatabaseErrorResponse(
  response: Response,
  error: unknown,
  unavailableMessage: string,
): void {
  const code = extractDatabaseErrorCode(error);
  if (isDatabaseUnavailable(error)) {
    console.error(`[API] Database request unavailable${code ? ` (${code})` : ''}.`);
    response.status(503).json({ error: unavailableMessage });
    return;
  }
  console.error(`[API] Unexpected database route error${code ? ` (${code})` : ''}.`);
  response.status(500).json({ error: 'Internal server error' });
}
