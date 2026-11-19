"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDatabaseUnavailable = isDatabaseUnavailable;
exports.sendDatabaseErrorResponse = sendDatabaseErrorResponse;
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
]);
function isDatabaseUnavailable(error) {
    let current = error;
    for (let depth = 0; depth < 4; depth += 1) {
        if (typeof current !== 'object' || current === null)
            return false;
        const record = current;
        if (record.name === 'PrismaClientInitializationError')
            return true;
        if ((typeof record.code === 'string' && DATABASE_UNAVAILABLE_CODES.has(record.code))
            || (typeof record.errorCode === 'string' && DATABASE_UNAVAILABLE_CODES.has(record.errorCode)))
            return true;
        current = record.cause;
    }
    return false;
}
function sendDatabaseErrorResponse(response, error, unavailableMessage) {
    if (isDatabaseUnavailable(error)) {
        response.status(503).json({ error: unavailableMessage });
        return;
    }
    response.status(500).json({ error: 'Internal server error' });
}
