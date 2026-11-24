"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFinancialNotificationListener = registerFinancialNotificationListener;
exports.clearFinancialNotificationListeners = clearFinancialNotificationListeners;
exports.emitFinancialNotificationEvent = emitFinancialNotificationEvent;
const listeners = new Set();
function registerFinancialNotificationListener(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function clearFinancialNotificationListeners() {
    listeners.clear();
}
/**
 * Emits a financial event to all registered notification listeners.
 * Guarantees fail-safe execution: notification failures are caught and logged
 * and will NEVER abort, rollback, or alter the underlying financial transaction.
 */
async function emitFinancialNotificationEvent(event) {
    const promises = [];
    for (const listener of listeners) {
        try {
            const res = listener.onFinancialEvent(event);
            if (res && typeof res.then === 'function') {
                promises.push(res.catch((err) => {
                    console.error(`[FinanceNotification] Listener failed on ${event.eventType} for channel ${event.channelId}:`, err instanceof Error ? err.message : err);
                }));
            }
        }
        catch (err) {
            console.error(`[FinanceNotification] Sync listener threw on ${event.eventType} for channel ${event.channelId}:`, err instanceof Error ? err.message : err);
        }
    }
    if (promises.length > 0) {
        await Promise.allSettled(promises);
    }
}
