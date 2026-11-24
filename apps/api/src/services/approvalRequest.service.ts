import { db as prisma } from '@watchtube/database';
import { recordAuditEvent } from './audit.service';

export interface CreateApprovalInput {
  type: 'GLOBAL_MONETIZATION_CHANGE' | 'FINANCIAL_ADJUSTMENT' | 'SECURITY_POLICY_CHANGE' | 'PLATFORM_CONFIG_CHANGE' | 'OTHER';
  title: string;
  description: string;
  payload?: any;
  requesterId: string;
}

export async function createApprovalRequest(input: CreateApprovalInput) {
  if (!input.title?.trim() || !input.description?.trim()) {
    throw new Error('Title and description are required.');
  }

  const requester = await prisma.user.findUnique({
    where: { id: input.requesterId },
    select: { id: true, email: true, role: true },
  });

  if (!requester) {
    throw new Error('Requester account not found.');
  }

  const request = await prisma.approvalRequest.create({
    data: {
      requesterId: input.requesterId,
      type: input.type,
      title: input.title.trim(),
      description: input.description.trim(),
      payload: input.payload ?? null,
      status: 'PENDING',
    },
    include: {
      requester: { select: { id: true, email: true } },
    },
  });

  await recordAuditEvent({
    actorId: input.requesterId,
    actorRole: requester.role,
    action: 'APPROVAL_REQUESTED',
    targetResource: 'APPROVAL_REQUEST',
    targetId: request.id,
    metadata: {
      type: input.type,
      title: input.title,
    },
  });

  return request;
}

export async function listApprovalRequests(user: { id: string; role: string }, status?: string) {
  const where: any = {};
  if (status) where.status = status;

  // Non-super-admins can only see their own requests
  if (user.role !== 'SUPER_ADMIN') {
    where.requesterId = user.id;
  }

  return prisma.approvalRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      requester: { select: { id: true, email: true } },
      reviewedBy: { select: { id: true, email: true } },
    },
  });
}

export async function reviewApprovalRequest(
  requestId: string,
  input: { status: 'APPROVED' | 'REJECTED'; reviewerNotes?: string },
  actor: { id: string; role: string },
) {
  if (actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only the SUPER_ADMIN (CEO/Owner) may approve or reject sensitive operational requests.');
  }

  const current = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { requester: { select: { email: true } } },
  });

  if (!current) {
    throw new Error('Approval request not found.');
  }

  if (current.status !== 'PENDING') {
    throw new Error(`This request has already been ${current.status.toLowerCase()}.`);
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: {
      status: input.status,
      reviewerNotes: input.reviewerNotes?.trim() ?? null,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
    include: {
      requester: { select: { id: true, email: true } },
      reviewedBy: { select: { id: true, email: true } },
    },
  });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: 'SUPER_ADMIN',
    action: input.status === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
    targetResource: 'APPROVAL_REQUEST',
    targetId: requestId,
    metadata: {
      type: current.type,
      title: current.title,
      requesterEmail: current.requester.email,
      reviewerNotes: input.reviewerNotes,
    },
  });

  return updated;
}
