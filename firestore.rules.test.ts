/**
 * Phase 0 Payload-First Security TDD Spec Verification Matrix
 * Documents and validates all 12 Dirty Dozen adversarial payloads against firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update';
  payload: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
  enforcedByRule: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Self-Role Escalation',
    collectionPath: 'usersPublic/attackerUid',
    operation: 'create',
    payload: { uid: 'attackerUid', role: 'platform_admin', displayName: 'Attacker' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().role == "student" || isAdmin()',
  },
  {
    id: 2,
    name: 'Shadow Ghost Field Injection',
    collectionPath: 'usersPublic/user1',
    operation: 'update',
    payload: { displayName: 'Alice', isVerified: true },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidUserPublic hasOnly() + affectedKeys().hasOnly()',
  },
  {
    id: 3,
    name: 'PII Cross-User Read',
    collectionPath: 'usersPrivate/victimUid',
    operation: 'get',
    payload: {},
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isOwner(userId) || isAdmin()',
  },
  {
    id: 4,
    name: 'Unverified Email Spoof',
    collectionPath: 'groups/cs402/messages/m1',
    operation: 'create',
    payload: { senderId: 'attackerUid', content: 'spoof' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isVerifiedUser() requires email_verified == true',
  },
  {
    id: 5,
    name: 'Sender Impersonation',
    collectionPath: 'groups/cs402/messages/m2',
    operation: 'create',
    payload: { id: 'm2', groupId: 'cs402', senderId: 'facultyUid', content: 'impersonated' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().senderId == request.auth.uid',
  },
  {
    id: 6,
    name: 'Non-Member Private Message Injection',
    collectionPath: 'groups/privateLab/messages/m3',
    operation: 'create',
    payload: { id: 'm3', groupId: 'privateLab', senderId: 'outsiderUid', content: 'leak' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isGroupMember(groupId) || isAdmin()',
  },
  {
    id: 7,
    name: 'Oversized Message Flood (Denial of Wallet)',
    collectionPath: 'groups/cs402/messages/m4',
    operation: 'create',
    payload: { id: 'm4', groupId: 'cs402', content: 'A'.repeat(50000) },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'data.content.size() <= 2000',
  },
  {
    id: 8,
    name: 'Invalid Path ID Poisoning',
    collectionPath: 'groups/..%2F..%2Fetc%2Fpasswd',
    operation: 'create',
    payload: { id: '../../etc/passwd' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidId(groupId) regex ^[a-zA-Z0-9_\\-]+$',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery',
    collectionPath: 'groups/cs402/messages/m5',
    operation: 'create',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().createdAt == request.time',
  },
  {
    id: 10,
    name: 'Terminal Invitation State Reversal',
    collectionPath: 'invitations/grp1_u2',
    operation: 'update',
    payload: { status: 'pending' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'existing().status == "pending"',
  },
  {
    id: 11,
    name: 'Analytics Cross-Tenant Query Scraping',
    collectionPath: 'analyticsEvents',
    operation: 'list',
    payload: {},
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'resource.data.userId == request.auth.uid || isAdmin()',
  },
  {
    id: 12,
    name: 'Resource Author Hijack',
    collectionPath: 'groups/cs402/resources/res1',
    operation: 'update',
    payload: { authorId: 'attackerUid' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().authorId == existing().authorId',
  },
];
