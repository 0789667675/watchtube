interface WorkerEndpointOptions {
    databaseUrl?: string;
    redisUrl?: string;
    redisHost?: string;
    nodeEnv?: string;
    localOnly?: boolean;
    allowExternal?: boolean;
}

function isLoopbackHost(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function getUrlHost(value: string, variableName: string, protocols: string[]): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`[Worker] ${variableName} must be a valid service URL.`);
    }
    if (!protocols.includes(url.protocol)) {
        throw new Error(`[Worker] ${variableName} must use a supported service URL scheme.`);
    }
    return url.hostname;
}

export function assertSafeWorkerEndpoints(options: WorkerEndpointOptions): void {
    if (!options.localOnly && (options.nodeEnv === 'production' || options.allowExternal)) return;

    if (
        options.databaseUrl
        && !isLoopbackHost(getUrlHost(options.databaseUrl, 'DATABASE_URL', ['postgres:', 'postgresql:']))
    ) {
        throw new Error('[Worker] Local development requires DATABASE_URL to use a loopback host; external connections are blocked.');
    }

    const redisHost = options.redisUrl
        ? getUrlHost(options.redisUrl, 'REDIS_URL', ['redis:', 'rediss:'])
        : options.redisHost || '127.0.0.1';
    if (!isLoopbackHost(redisHost)) {
        throw new Error('[Worker] Local development requires Redis to use a loopback host; external connections are blocked.');
    }
}
