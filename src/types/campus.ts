import type { Timestamp } from 'firebase/firestore';

export const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

/**
 * Verbatim volumetric boundaries synced from firebase-blueprint.json
 */
export const SCHEMA_LIMITS = {
  idMax: 128,
  displayNameMax: 80,
  departmentMax: 80,
  bioMax: 280,
  avatarUrlMax: 500,
  fingerprintMax: 64,
  statusMessageMax: 100,
  emailMax: 160,
  academicIdMax: 40,
  groupNameMax: 80,
  groupCodeMax: 24,
  groupDescMax: 400,
  buildingNodeMax: 40,
  messageContentMax: 2000,
  replyPreviewMax: 140,
  resourceTitleMax: 120,
  resourceDescMax: 400,
  subjectMax: 60,
  topicMax: 60,
  urlMax: 500,
  fileSizeLabelMax: 32,
  roleMax: 30,
  reportPreviewMax: 280,
  reportDetailsMax: 300,
} as const;

export type UserRole = 'student' | 'faculty' | 'group_admin' | 'platform_admin';
export type ThemePreference = 'light' | 'dark' | 'system';
export type GroupType = 'subject' | 'project' | 'activity' | 'direct';
export type GroupMemberRole = 'owner' | 'admin' | 'member';
export type ResourceType = 'lecture_notes' | 'research_paper' | 'code_repo' | 'dataset' | 'lab_guide';
export type InvitationStatus = 'pending' | 'accepted' | 'declined';
export type ReactionKey = 'thumbs_up' | 'heart' | 'target' | 'fire' | 'bulb';
export type ModerationReason = 'spam' | 'harassment' | 'academic_integrity' | 'inappropriate';
export type ModerationStatus = 'open' | 'resolved' | 'dismissed';

export const REACTION_OPTIONS: Array<{ key: ReactionKey; emoji: string; label: string }> = [
  { key: 'thumbs_up', emoji: '👍', label: 'Endorse' },
  { key: 'heart', emoji: '❤️', label: 'Appreciate' },
  { key: 'bulb', emoji: '💡', label: 'Insightful' },
  { key: 'target', emoji: '🎯', label: 'Accurate' },
  { key: 'fire', emoji: '🔥', label: 'Important' },
];

export type AnalyticsEventType =
  | 'message_sent'
  | 'resource_shared'
  | 'resource_downloaded'
  | 'channel_joined'
  | 'profile_updated'
  | 'campus_3d_inspected'
  | 'offline_sync_flushed'
  | 'dm_started'
  | 'moderation_reported'
  | 'announcement_posted';

export type PrimaryPage =
  | 'messages'
  | 'resources'
  | 'campus3d'
  | 'analytics'
  | 'moderation'
  | 'profile';

export interface UserPublicProfile {
  uid: string;
  displayName: string;
  department: string;
  role: UserRole;
  bio?: string;
  avatarUrl?: string;
  publicKeyFingerprint: string;
  statusMessage?: string;
  online: boolean;
  themePreference: ThemePreference;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  academicId?: string;
  offlineSyncEnabled: boolean;
  notificationsEnabled: boolean;
  updatedAt?: Timestamp;
}

export interface CampusGroup {
  id: string;
  name: string;
  code: string;
  description?: string;
  type: GroupType;
  buildingNode: string;
  creatorId: string;
  participantIds?: string[];
  mlsEpoch: number;
  keyFingerprint: string;
  isPrivate: boolean;
  memberCount: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface GroupMember {
  uid: string;
  displayName: string;
  groupRole: GroupMemberRole;
  joinedAt?: Timestamp;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  replyToId?: string;
  replyPreview?: string;
  reactions?: Partial<Record<ReactionKey, string[]>>;
  mlsEpoch: number;
  deliveryStatus: 'sent' | 'delivered' | 'read';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  _pendingWrite?: boolean;
  _fromCache?: boolean;
}

export interface AcademicResource {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  subject: string;
  topic: string;
  resourceType: ResourceType;
  url: string;
  fileSizeLabel?: string;
  authorId: string;
  authorName: string;
  downloadsCount: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface GroupInvitation {
  id: string;
  groupId: string;
  groupName: string;
  inviterId: string;
  inviterName: string;
  inviteeId: string;
  status: InvitationStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ModerationReport {
  id: string;
  groupId: string;
  groupCode: string;
  messageId: string;
  messagePreview: string;
  reportedUserId: string;
  reportedUserName: string;
  reporterId: string;
  reporterName: string;
  reason: ModerationReason;
  details?: string;
  status: ModerationStatus;
  resolvedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EngagementEvent {
  id: string;
  userId: string;
  userRole: string;
  eventType: AnalyticsEventType;
  groupId?: string;
  department?: string;
  latencyMs: number;
  wasOffline: boolean;
  createdAt?: Timestamp;
}

export interface CampusBuildingNode {
  id: string;
  name: string;
  shortCode: string;
  department: string;
  description: string;
  position: [number, number, number];
  accentHex: string;
  defaultGroupId: string;
}
