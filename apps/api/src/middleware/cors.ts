import { RequestHandler } from 'express';

const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const allowedHeaders = new Set(['authorization', 'content-type']);
const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function parseAllowedOrigins(value: string | undefined, isProduction: boolean): Set<string> {
  const origins = (value || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!isProduction) {
    origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  }

  return new Set(origins.map((origin) => {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== origin ||
      origin.includes('*')
    ) {
      throw new Error('API_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.');
    }
    return origin;
  }));
}

export function createCorsMiddleware(origins: ReadonlySet<string>): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('Origin');
    const isAllowedOrigin = Boolean(origin && origins.has(origin));

    if (origin && isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.vary('Origin');
    }

    if (req.method === 'OPTIONS') {
      if (!isAllowedOrigin) {
        res.sendStatus(403);
        return;
      }

      const requestedMethod = req.get('Access-Control-Request-Method')?.toUpperCase();
      const requestedHeaders = (req.get('Access-Control-Request-Headers') || '')
        .split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      if (
        !requestedMethod ||
        !allowedMethods.has(requestedMethod) ||
        requestedHeaders.some((header) => !allowedHeaders.has(header))
      ) {
        res.sendStatus(403);
        return;
      }

      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.sendStatus(204);
      return;
    }

    if (origin && stateChangingMethods.has(req.method) && !isAllowedOrigin) {
      res.sendStatus(403);
      return;
    }
    next();
  };
}
