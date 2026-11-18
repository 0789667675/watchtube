"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const serviceEndpointSafety_1 = require("../src/config/serviceEndpointSafety");
const localOptions = {
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/watchtube',
    redisUrl: 'redis://localhost:6379',
    localOnly: true,
};
(0, node_test_1.test)('local-only mode accepts loopback PostgreSQL and Redis endpoints', () => {
    strict_1.default.doesNotThrow(() => (0, serviceEndpointSafety_1.assertSafeServiceEndpoints)(localOptions));
});
(0, node_test_1.test)('local-only mode rejects external PostgreSQL before a connection is attempted', () => {
    strict_1.default.throws(() => (0, serviceEndpointSafety_1.assertSafeServiceEndpoints)({
        ...localOptions,
        databaseUrl: 'postgresql://test:secret@db.example.invalid:5432/watchtube',
    }), (error) => {
        strict_1.default.ok(error instanceof Error);
        strict_1.default.match(error.message, /DATABASE_URL.*loopback/);
        strict_1.default.doesNotMatch(error.message, /secret|db\.example/);
        return true;
    });
});
(0, node_test_1.test)('local-only mode rejects external Redis endpoints and hosts', () => {
    strict_1.default.throws(() => (0, serviceEndpointSafety_1.assertSafeServiceEndpoints)({ ...localOptions, redisUrl: 'rediss://cache.example.invalid:6379' }), /Redis.*loopback/);
    strict_1.default.throws(() => (0, serviceEndpointSafety_1.assertSafeServiceEndpoints)({ ...localOptions, redisUrl: undefined, redisHost: 'cache.example.invalid' }), /Redis.*loopback/);
});
(0, node_test_1.test)('external opt-in works for ordinary development but cannot bypass local-only mode', () => {
    strict_1.default.doesNotThrow(() => (0, serviceEndpointSafety_1.assertSafeServiceEndpoints)({
        databaseUrl: 'postgresql://test:test@db.example.invalid:5432/watchtube',
        redisUrl: 'redis://cache.example.invalid:6379',
        allowExternal: true,
    }));
    strict_1.default.throws(() => (0, serviceEndpointSafety_1.assertSafeServiceEndpoints)({
        ...localOptions,
        databaseUrl: 'postgresql://test:test@db.example.invalid:5432/watchtube',
        allowExternal: true,
    }), /DATABASE_URL.*loopback/);
});
(0, node_test_1.test)('production startup is not subject to development endpoint restrictions', () => {
    strict_1.default.doesNotThrow(() => (0, serviceEndpointSafety_1.assertSafeServiceEndpoints)({
        databaseUrl: 'postgresql://test:test@db.example.invalid:5432/watchtube',
        redisUrl: 'rediss://cache.example.invalid:6379',
        nodeEnv: 'production',
    }));
});
