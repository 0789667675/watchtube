"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentProviderError = void 0;
class PaymentProviderError extends Error {
    code;
    statusCode;
    constructor(message, code = 'PAYMENT_ERROR', statusCode = 500) {
        super(message);
        this.name = 'PaymentProviderError';
        this.code = code;
        this.statusCode = statusCode;
    }
}
exports.PaymentProviderError = PaymentProviderError;
