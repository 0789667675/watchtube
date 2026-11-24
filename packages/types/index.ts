export interface User {
  id: string;
  name: string;
}

export interface ViewerChannel {
  id?: string;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  description?: string | null;
  subscriberCount?: number;
  isVerified: boolean;
}

export interface ViewerVideo {
  id: string;
  isShort?: boolean;
  channelId?: string;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  duration?: number | null;
  viewsCount: number;
  createdAt: string;
  publishedAt?: string | null;
  channel: ViewerChannel;
  variants?: { playlistUrl: string; resolution: string }[];
}

export interface ViewerComment {
  id: string;
  content: string;
  createdAt: string;
  parentId?: string | null;
  user?: {
    channels?: { name: string; handle: string; avatarUrl?: string | null }[];
  };
  _count?: { replies: number };
}

export interface ViewerSession {
  id: string;
  email: string;
  role?: string;
  status?: string;
}

export interface ViewerSearchChannel {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  isVerified: boolean;
  subscriberCount: number;
}

export type PlatformRole = 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR' | 'CREATOR' | 'VIEWER' | 'USER';

export type AdminPositionNumber = 1 | 2 | 3;
export type AdminPositionStatus = 'VACANT' | 'OCCUPIED' | 'SUSPENDED';

export interface AdminPositionSummary {
  positionNumber: number;
  status: AdminPositionStatus;
  userId: string | null;
  assignment: string | null;
  assignedAt: string | null;
  permissions: string[];
  user?: {
    id: string;
    email: string;
    status: string;
    createdAt: string;
  } | null;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface AdminInvitationSummary {
  id: string;
  email: string;
  positionNumber: number;
  assignment: string;
  customPermissions: string[];
  status: InvitationStatus;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
}

export type SupportCaseCategory =
  | 'ONBOARDING'
  | 'CHANNEL_ISSUE'
  | 'STUDIO_SUPPORT'
  | 'UPLOAD_ISSUE'
  | 'PROCESSING_FAILURE'
  | 'METADATA_THUMBNAIL'
  | 'SUBSCRIPTION_INQUIRY'
  | 'MONETIZATION_SUPPORT'
  | 'USER_COMPLAINT'
  | 'CONTENT_REPORT'
  | 'PAYOUT_STATUS'
  | 'OTHER';

export type SupportCasePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type SupportCaseStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_USER'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED';

export interface SupportCaseSummary {
  id: string;
  caseReference: string;
  creatorOrUserId: string | null;
  channelId: string | null;
  videoId: string | null;
  reporterEmail: string | null;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  title: string;
  description: string;
  assignedAdminId: string | null;
  assignedPositionNumber: number | null;
  createdById: string | null;
  resolvedById: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  createdAt: string;
  updatedAt: string;
  assignedAdmin?: { id: string; email: string } | null;
  creatorOrUser?: { id: string; email: string } | null;
  channel?: { id: string; name: string; handle: string } | null;
  video?: { id: string; title: string } | null;
  _count?: { notes: number; activities: number };
}

export interface SupportCaseNoteSummary {
  id: string;
  caseId: string;
  authorId: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  author?: { id: string; email: string; role: string };
}

export interface SupportCaseActivitySummary {
  id: string;
  caseId: string;
  actorId: string;
  action: string;
  details: string | null;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
  actor?: { id: string; email: string };
}

export type ApprovalRequestType =
  | 'GLOBAL_MONETIZATION_CHANGE'
  | 'FINANCIAL_ADJUSTMENT'
  | 'SECURITY_POLICY_CHANGE'
  | 'PLATFORM_CONFIG_CHANGE'
  | 'OTHER';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ApprovalRequestSummary {
  id: string;
  requesterId: string;
  type: ApprovalRequestType;
  title: string;
  description: string;
  payload?: any;
  status: ApprovalStatus;
  reviewedById: string | null;
  reviewerNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester?: { id: string; email: string };
  reviewedBy?: { id: string; email: string } | null;
}

export interface AdminAuditLogSummary {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetResource: string;
  targetId: string | null;
  outcome: string;
  metadata?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  actor?: { id: string; email: string };
}
