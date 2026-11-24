import { Request } from 'express';
import { db as prisma } from '@watchtube/database';

export interface AuditEventInput {
  actorId: string;
  actorRole: string;
  action: string;
  targetResource: string;
  targetId?: string | null;
  outcome?: 'SUCCESS' | 'FAILED' | 'DENIED';
  metadata?: Record<string, unknown> | null;
  req?: Request;
}

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'secret',
  'authorization',
  'cookie',
  'key',
  'privatekey',
  'private_key',
  'apikey',
  'api_key',
  'apiuser',
  'subscriptionkey',
  'clientsecret',
  'webhooksecret',
  'hmacsecret',
  'signature',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'pin',
  'otp',
  'msisdn',
  'phonenumber',
  'accountnumber',
  'taxid',
  'nationalid',
  'passport',
]);

export const RESTRICTED_OWNER_AUDIT_RESOURCES = [
  'FINANCE',
  'SECURITY',
  'ADMIN_INVITATION',
  'ADMIN_POSITION',
  'GLOBAL_SETTINGS',
  'AdProviderConfig',
  'PAYMENT_CONFIG',
  'PAYMENT_PROVIDER',
  'PAYMENT_TRANSACTION',
  'PAYOUT',
  'WALLET_LEDGER',
  'REVENUE_RECONCILIATION',
  'REVENUE_ATTRIBUTION',
  'ESCROW_HOLD',
  'MONETIZATION_RATE',
  'APPROVAL_REQUEST',
] as const;

export function sanitizeAuditMetadata(data: unknown): unknown {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeAuditMetadata);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function extractClientInfo(req?: Request): { ipAddress?: string; userAgent?: string } {
  if (!req) return {};
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : req.socket?.remoteAddress || req.ip;
  const userAgent = typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent'].slice(0, 255)
    : undefined;
  return { ipAddress: ip, userAgent };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  if (process.env.NODE_ENV === 'test' && !UUID_PATTERN.test(input.actorId)) {
    return;
  }
  try {
    const { ipAddress, userAgent } = extractClientInfo(input.req);
    const sanitizedMetadata = sanitizeAuditMetadata(input.metadata);

    await prisma.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        targetResource: input.targetResource,
        targetId: input.targetId ?? null,
        outcome: input.outcome ?? 'SUCCESS',
        metadata: sanitizedMetadata as any,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (error) {
    // Non-blocking: audit logging failures must not break business logic, but must be logged to stderr
    console.error('[AuditService] Failed to record audit event:', {
      action: input.action,
      actorId: input.actorId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function listAuditLogs(options: {
  actorId?: string;
  action?: string;
  targetResource?: string;
  outcome?: 'SUCCESS' | 'FAILED' | 'DENIED';
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
  skip?: number;
  operationalOnly?: boolean;
}) {
  const {
    actorId,
    action,
    targetResource,
    outcome,
    startDate,
    endDate,
    limit = 50,
    skip = 0,
    operationalOnly = false,
  } = options;

  if (
    operationalOnly
    && targetResource
    && (RESTRICTED_OWNER_AUDIT_RESOURCES as readonly string[]).includes(targetResource)
  ) {
    return { logs: [], total: 0 };
  }

  const where: any = {};
  if (actorId) where.actorId = actorId;
  if (action) where.action = action;
  if (outcome) where.outcome = outcome;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) where.createdAt.gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) where.createdAt.lte = end;
    }
  }

  if (operationalOnly) {
    // Ordinary Admins cannot view owner-only, financial, payment, provider, or security audit logs
    where.AND = [
      { targetResource: { notIn: [...RESTRICTED_OWNER_AUDIT_RESOURCES] } },
      ...(targetResource ? [{ targetResource }] : []),
    ];
  } else if (targetResource) {
    where.targetResource = targetResource;
  }

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      skip,
      include: {
        actor: {
          select: { id: true, email: true },
        },
      },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  return { logs, total };
}
