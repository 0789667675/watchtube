import { db as prisma } from '@watchtube/database';
import { recordAuditEvent } from './audit.service';

export interface CreateSupportCaseInput {
  title: string;
  description: string;
  category?: string;
  priority?: string;
  channelId?: string | null;
  videoId?: string | null;
  reporterEmail?: string | null;
  creatorOrUserId?: string | null;
  createdById?: string | null;
  assignedAdminId?: string | null;
  assignedPositionNumber?: number | null;
}

export interface ListCasesOptions {
  status?: string;
  priority?: string;
  category?: string;
  assignedAdminId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Generates an auditable, human-friendly case reference code.
 * Example: CASE-202611-1042
 */
export async function generateCaseReference(): Promise<string> {
  const date = new Date();
  const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `CASE-${yearMonth}-${randomSuffix}`;
}

export async function listSupportCases(options: ListCasesOptions = {}) {
  const {
    status,
    priority,
    category,
    assignedAdminId,
    search,
    page = 1,
    limit = 25,
  } = options;

  const skip = (Math.max(1, page) - 1) * Math.min(limit, 100);
  const take = Math.min(limit, 100);

  const where: any = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (category) where.category = category;
  if (assignedAdminId) where.assignedAdminId = assignedAdminId;

  if (search?.trim()) {
    const q = search.trim();
    where.OR = [
      { caseReference: { contains: q, mode: 'insensitive' } },
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { reporterEmail: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [cases, total] = await Promise.all([
    prisma.supportCase.findMany({
      where,
      skip,
      take,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        assignedAdmin: {
          select: { id: true, email: true },
        },
        creatorOrUser: {
          select: { id: true, email: true },
        },
        channel: {
          select: { id: true, name: true, handle: true },
        },
        video: {
          select: { id: true, title: true },
        },
        _count: {
          select: { notes: true, activities: true },
        },
      },
    }),
    prisma.supportCase.count({ where }),
  ]);

  return {
    cases,
    total,
    page,
    limit: take,
    totalPages: Math.ceil(total / take) || 1,
  };
}

export async function getSupportCaseById(id: string) {
  const supportCase = await prisma.supportCase.findUnique({
    where: { id },
    include: {
      assignedAdmin: {
        select: { id: true, email: true },
      },
      creatorOrUser: {
        select: { id: true, email: true },
      },
      channel: {
        select: { id: true, name: true, handle: true, avatarUrl: true },
      },
      video: {
        select: { id: true, title: true, status: true, thumbnailUrl: true },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
        include: {
          author: {
            select: { id: true, email: true, role: true },
          },
        },
      },
      activities: {
        orderBy: { createdAt: 'asc' },
        include: {
          actor: {
            select: { id: true, email: true },
          },
        },
      },
    },
  });

  return supportCase;
}

export async function createSupportCase(input: CreateSupportCaseInput, actor: { id: string; role: string }) {
  if (!input.title?.trim() || !input.description?.trim()) {
    throw new Error('Title and description are required.');
  }

  const caseReference = await generateCaseReference();

  const supportCase = await prisma.$transaction(async (tx) => {
    const created = await tx.supportCase.create({
      data: {
        caseReference,
        title: input.title.trim(),
        description: input.description.trim(),
        category: (input.category as any) || 'OTHER',
        priority: (input.priority as any) || 'NORMAL',
        status: input.assignedAdminId ? 'ASSIGNED' : 'OPEN',
        channelId: input.channelId ?? null,
        videoId: input.videoId ?? null,
        reporterEmail: input.reporterEmail?.trim() ?? null,
        creatorOrUserId: input.creatorOrUserId ?? null,
        createdById: actor.id,
        assignedAdminId: input.assignedAdminId ?? null,
        assignedPositionNumber: input.assignedPositionNumber ?? null,
      },
      include: {
        assignedAdmin: { select: { id: true, email: true } },
        channel: { select: { id: true, name: true, handle: true } },
      },
    });

    await tx.supportCaseActivity.create({
      data: {
        caseId: created.id,
        actorId: actor.id,
        action: 'CREATED',
        details: `Case opened with priority ${created.priority} and category ${created.category}.`,
        newValue: created.status,
      },
    });

    return created;
  });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'CASE_CREATED',
    targetResource: 'SUPPORT_CASE',
    targetId: supportCase.id,
    metadata: {
      caseReference: supportCase.caseReference,
      category: supportCase.category,
      priority: supportCase.priority,
    },
  });

  return supportCase;
}

export async function assignSupportCase(
  caseId: string,
  input: { assignedAdminId: string; assignedPositionNumber?: number },
  actor: { id: string; role: string },
) {
  const current = await prisma.supportCase.findUnique({
    where: { id: caseId },
    include: { assignedAdmin: true },
  });

  if (!current) {
    throw new Error('Support case not found.');
  }

  const newAdmin = await prisma.user.findUnique({
    where: { id: input.assignedAdminId },
    select: { id: true, email: true, role: true },
  });

  if (!newAdmin || (newAdmin.role !== 'ADMIN' && newAdmin.role !== 'SUPER_ADMIN')) {
    throw new Error('Assigned user must be an ADMIN or SUPER_ADMIN.');
  }

  const previousAdminEmail = current.assignedAdmin?.email || 'Unassigned';
  const newStatus = current.status === 'OPEN' ? 'ASSIGNED' : current.status;

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.supportCase.update({
      where: { id: caseId },
      data: {
        assignedAdminId: input.assignedAdminId,
        assignedPositionNumber: input.assignedPositionNumber ?? null,
        status: newStatus,
      },
      include: {
        assignedAdmin: { select: { id: true, email: true } },
      },
    });

    await tx.supportCaseActivity.create({
      data: {
        caseId,
        actorId: actor.id,
        action: 'ASSIGNED',
        details: `Reassigned from ${previousAdminEmail} to ${newAdmin.email}.`,
        previousValue: previousAdminEmail,
        newValue: newAdmin.email,
      },
    });

    return res;
  });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'CASE_ASSIGNED',
    targetResource: 'SUPPORT_CASE',
    targetId: caseId,
    metadata: {
      caseReference: current.caseReference,
      previousAdmin: previousAdminEmail,
      assignedAdmin: newAdmin.email,
    },
  });

  return updated;
}

export async function updateSupportCaseStatus(
  caseId: string,
  input: { status: string; priority?: string; resolutionNotes?: string },
  actor: { id: string; role: string },
) {
  const current = await prisma.supportCase.findUnique({
    where: { id: caseId },
  });

  if (!current) {
    throw new Error('Support case not found.');
  }

  const isResolving = input.status === 'RESOLVED' || input.status === 'CLOSED';
  if (isResolving && !input.resolutionNotes?.trim() && !current.resolutionNotes) {
    throw new Error('Resolution notes are required when resolving or closing a support case.');
  }

  const updateData: any = {
    status: input.status,
  };

  if (input.priority) {
    updateData.priority = input.priority;
  }

  if (isResolving) {
    updateData.resolvedAt = new Date();
    updateData.resolvedById = actor.id;
    if (input.resolutionNotes?.trim()) {
      updateData.resolutionNotes = input.resolutionNotes.trim();
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.supportCase.update({
      where: { id: caseId },
      data: updateData,
      include: {
        assignedAdmin: { select: { id: true, email: true } },
      },
    });

    await tx.supportCaseActivity.create({
      data: {
        caseId,
        actorId: actor.id,
        action: 'STATUS_CHANGED',
        details: `Status updated from ${current.status} to ${input.status}.${input.resolutionNotes ? ` Resolution: ${input.resolutionNotes}` : ''}`,
        previousValue: current.status,
        newValue: input.status,
      },
    });

    return res;
  });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: isResolving ? 'CASE_RESOLVED' : 'CASE_STATUS_UPDATED',
    targetResource: 'SUPPORT_CASE',
    targetId: caseId,
    metadata: {
      caseReference: current.caseReference,
      previousStatus: current.status,
      newStatus: input.status,
      resolutionNotes: input.resolutionNotes,
    },
  });

  return updated;
}

export async function escalateSupportCase(
  caseId: string,
  input: { escalationReason: string },
  actor: { id: string; role: string },
) {
  if (!input.escalationReason?.trim()) {
    throw new Error('An escalation reason is required.');
  }

  const current = await prisma.supportCase.findUnique({
    where: { id: caseId },
  });

  if (!current) {
    throw new Error('Support case not found.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.supportCase.update({
      where: { id: caseId },
      data: {
        status: 'ESCALATED',
        priority: 'URGENT',
        escalatedAt: new Date(),
        escalationReason: input.escalationReason.trim(),
      },
      include: {
        assignedAdmin: { select: { id: true, email: true } },
      },
    });

    await tx.supportCaseActivity.create({
      data: {
        caseId,
        actorId: actor.id,
        action: 'ESCALATED',
        details: `Escalated to SUPER_ADMIN/Senior review: ${input.escalationReason.trim()}`,
        previousValue: current.status,
        newValue: 'ESCALATED',
      },
    });

    return res;
  });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'CASE_ESCALATED',
    targetResource: 'SUPPORT_CASE',
    targetId: caseId,
    metadata: {
      caseReference: current.caseReference,
      reason: input.escalationReason.trim(),
    },
  });

  return updated;
}

export async function addCaseNote(
  caseId: string,
  input: { content: string; isInternal?: boolean },
  actor: { id: string; role: string },
) {
  if (!input.content?.trim()) {
    throw new Error('Note content cannot be empty.');
  }

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.supportCaseNote.create({
      data: {
        caseId,
        authorId: actor.id,
        content: input.content.trim(),
        isInternal: input.isInternal !== false, // Default to true (internal staff note)
      },
      include: {
        author: { select: { id: true, email: true, role: true } },
      },
    });

    await tx.supportCaseActivity.create({
      data: {
        caseId,
        actorId: actor.id,
        action: 'NOTE_ADDED',
        details: created.isInternal ? 'Internal note added.' : 'Public response added.',
      },
    });

    return created;
  });

  return note;
}
