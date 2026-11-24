"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const jwt_1 = require("../src/config/jwt");
(0, node_test_1.test)('production rejects the documented JWT secret placeholder', () => {
    strict_1.default.throws(() => (0, jwt_1.resolveJwtSecret)({
        nodeEnv: 'production',
        secret: 'replace_with_a_secure_random_jwt_secret_at_least_32_characters',
    }), /cannot use a known default, placeholder, or insecure fallback/);
});
(0, node_test_1.test)('non-local runtimes fail closed when no JWT secret is configured', () => {
    for (const nodeEnv of ['staging', undefined]) {
        strict_1.default.throws(() => (0, jwt_1.resolveJwtSecret)({ nodeEnv, secret: '' }), /JWT_SECRET is required outside explicit development or test mode/);
    }
    strict_1.default.throws(() => (0, jwt_1.resolveJwtSecret)({ nodeEnv: 'production', secret: '' }), /Production startup rejected: JWT_SECRET environment variable is missing or empty/);
});
(0, node_test_1.test)('only explicit development and test modes may use the fallback secret', () => {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
        strict_1.default.equal((0, jwt_1.resolveJwtSecret)({ nodeEnv: 'development', secret: '' }), 'supersecret');
        strict_1.default.equal((0, jwt_1.resolveJwtSecret)({ nodeEnv: 'test', secret: '' }), 'supersecret');
    }
    finally {
        console.warn = originalWarn;
    }
});
(0, node_test_1.test)('non-local runtimes accept a configured non-placeholder secret', () => {
    const secret = 'a-valid-test-only-jwt-secret-long-enough-123';
    strict_1.default.equal((0, jwt_1.resolveJwtSecret)({ nodeEnv: 'production', secret }), secret);
    strict_1.default.equal((0, jwt_1.resolveJwtSecret)({ nodeEnv: 'staging', secret }), secret);
});
