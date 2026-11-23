import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { getAuthHeaders } from './authToken';
import {
  ID_PATTERN,
  SCHEMA_LIMITS,
  type AnalyticsEventType,
  type CampusBuildingNode,
  type CampusGroup,
  type GroupMemberRole,
  type GroupMessage,
  type GroupType,
  type ModerationReason,
  type ModerationStatus,
  type ReactionKey,
  type ResourceType,
  type ThemePreference,
  type UserPrivateInfo,
  type UserPublicProfile,
  type UserRole,
} from '../types/campus';

export const CAMPUS_BUILDINGS: CampusBuildingNode[] = [
  {
    id: 'observatory-hub',
    name: 'Central Academic Observatory',
    shortCode: 'HUB-01',
    department: 'Interdisciplinary Syndicate',
    description: 'Primary MLS Key Authority & University Federation Core.',
    position: [0, 0, 0],
    accentHex: '#4f46e5',
    defaultGroupId: 'campus-general-commons',
  },
  {
    id: 'cs-engineering-wing',
    name: 'Turing Systems & Engineering Wing',
    shortCode: 'CS-402',
    department: 'Computer Science',
    description: 'Distributed consensus, backend architectures & cloud labs.',
    position: [-14, 0, -9],
    accentHex: '#6366f1',
    defaultGroupId: 'cs402-distributed-systems',
  },
  {
    id: 'cryptography-lab',
    name: 'Zero-Trust Cryptography Lab',
    shortCode: 'CRYPTO-510',
    department: 'Information Security',
    description: 'Signal/MLS protocol verification & key rotation research.',
    position: [14, 0, -9],
    accentHex: '#10b981',
    defaultGroupId: 'crypto510-zero-trust-lab',
  },
  {
    id: 'mathematics-hall',
    name: 'Euler Mathematical Sciences Hall',
    shortCode: 'MATH-308',
    department: 'Mathematics',
    description: 'Algebraic graph theory, lattice proofs & seminar rooms.',
    position: [-13, 0, 12],
    accentHex: '#f59e0b',
    defaultGroupId: 'math308-graph-theory',
  },
  {
    id: 'student-commons',
    name: 'Scholar Commons & Study Atrium',
    shortCode: 'COMMONS',
    department: 'Student Body',
    description: 'Cross-faculty study groups, project syndicates & announcements.',
    position: [13, 0, 12],
    accentHex: '#4f46e5',
    defaultGroupId: 'campus-general-commons',
  },
];

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, SCHEMA_LIMITS.idMax);
  return cleaned || `id-${Date.now()}`;
}

export function clampStr(val: string | undefined, max: number, fallback = ''): string {
  const s = (val ?? fallback).trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return sanitizeId(`${prefix}-${Date.now().toString(36)}-${rand}`);
}

export function generateKeyFingerprint(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const partA = (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const partB = ((hash ^ 0x9e3779b9) >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const partC = Date.now().toString(16).slice(-8).toUpperCase();
  return `${partA}-${partB}-${partC}`;
}

/**
 * Executes a Firestore write with zero-latency offline responsiveness.
 * When offline, Firestore persists immediately to IndexedDB and resolves on reconnect;
 * we avoid hanging the UI by settling locally after 280ms if navigator.onLine is false
 * or connection is intermittent, while still catching and surfacing real rule errors.
 */
async function executeOfflineSafeWrite(
  writePromise: Promise<void>,
  operationType: OperationType,
  path: string,
): Promise<{ queuedOffline: boolean; latencyMs: number }> {
  const started = performance.now();
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  if (isOffline) {
    writePromise.catch((err) => {
      handleFirestoreError(err, operationType, path);
    });
    return { queuedOffline: true, latencyMs: Math.round(performance.now() - started) };
  }

  try {
    const timeoutMarker = new Promise<'queued'>((resolve) => {
      setTimeout(() => resolve('queued'), 1800);
    });
    const result = await Promise.race([
      writePromise.then(() => 'committed' as const),
      timeoutMarker,
    ]);
    return {
      queuedOffline: result === 'queued',
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    handleFirestoreError(err, operationType, path);
  }
}

export async function recordEngagementMetric(params: {
  userId: string;
  userRole: string;
  eventType: AnalyticsEventType;
  groupId?: string;
  department?: string;
  latencyMs: number;
  wasOffline: boolean;
}) {
  if (!ID_PATTERN.test(params.userId)) return;
  const eventId = generateId('evt');
  const eventPath = `analyticsEvents/${eventId}`;

  const payload = {
    id: eventId,
    userId: params.userId,
    userRole: clampStr(params.userRole, SCHEMA_LIMITS.roleMax, 'student'),
    eventType: params.eventType,
    groupId: params.groupId ? clampStr(params.groupId, SCHEMA_LIMITS.idMax) : '',
    department: params.department ? clampStr(params.department, SCHEMA_LIMITS.departmentMax) : 'Computer Science',
    latencyMs: Math.max(0, Math.min(Math.round(params.latencyMs), 60000)),
    wasOffline: Boolean(params.wasOffline),
    createdAt: serverTimestamp(),
  };

  executeOfflineSafeWrite(
    setDoc(doc(db, 'analyticsEvents', eventId), payload),
    OperationType.CREATE,
    eventPath,
  ).catch(() => {
    // Error handled inside handleFirestoreError
  });

  if (typeof navigator === 'undefined' || navigator.onLine) {
    getAuthHeaders({ 'Content-Type': 'application/json' })
      .then((headers) =>
        fetch('/api/analytics/event', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type:
              params.eventType === 'message_sent'
                ? 'message-created'
                : params.eventType === 'resource_shared'
                  ? 'resource-shared'
                  : params.eventType === 'moderation_reported'
                    ? 'moderation-reported'
                    : params.eventType === 'announcement_posted'
                      ? 'announcement-created'
                      : 'analytics-recorded',
            userId: params.userId,
            userRole: params.userRole,
            groupId: params.groupId,
            department: params.department,
            latencyMs: params.latencyMs,
            wasOffline: params.wasOffline,
          }),
        }),
      )
      .catch(() => {
        // Non-fatal if offline
      });
  }
}

const DEFAULT_GROUPS_SEED: Array<{
  id: string;
  name: string;
  code: string;
  description: string;
  type: GroupType;
  buildingNode: string;
  mlsEpoch: number;
  sampleMessages: Array<{ senderName: string; senderRole: string; content: string }>;
  sampleResources: Array<{
    id: string;
    title: string;
    description: string;
    subject: string;
    topic: string;
    resourceType: ResourceType;
    url: string;
    fileSizeLabel: string;
  }>;
}> = [
  {
    id: 'cs402-distributed-systems',
    name: 'Distributed Systems & Consensus',
    code: 'CS-402',
    description: 'Raft consensus proofs, Express/Socket.IO microservices, and fault-tolerant replication.',
    type: 'subject',
    buildingNode: 'cs-engineering-wing',
    mlsEpoch: 14,
    sampleMessages: [
      {
        senderName: 'Dr. Elena Vance',
        senderRole: 'faculty',
        content: 'Welcome to CS-402. Review the Raft log-compaction handout in Resources before Thursday lab.',
      },
      {
        senderName: 'Campus Connect Syndicate',
        senderRole: 'group_admin',
        content: 'MLS Epoch 14 verified. All channel payloads sync automatically to IndexedDB when offline.',
      },
    ],
    sampleResources: [
      {
        id: 'res-cs402-raft-notes',
        title: 'Lecture 07: Raft Consensus & Leader Election Proofs',
        description: 'Annotated slides covering safety invariants, term monotonicity, and network partition recovery.',
        subject: 'Computer Science',
        topic: 'Distributed Consensus',
        resourceType: 'lecture_notes',
        url: 'https://raft.github.io/raft.pdf',
        fileSizeLabel: '2.4 MB PDF',
      },
      {
        id: 'res-cs402-socket-lab',
        title: 'Lab 04: Socket.IO EventEmitter & Idempotent Sync',
        description: 'Reference architecture for room-isolated WebSockets and MongoDB/Firestore persistence.',
        subject: 'Computer Science',
        topic: 'Real-Time Backend',
        resourceType: 'lab_guide',
        url: 'https://socket.io/docs/v4/',
        fileSizeLabel: '840 KB MD',
      },
    ],
  },
  {
    id: 'crypto510-zero-trust-lab',
    name: 'Zero-Trust MLS & Applied Cryptography',
    code: 'CRYPTO-510',
    description: 'Messaging Layer Security (RFC 9420), ratcheting trees, and verifiable academic credentials.',
    type: 'project',
    buildingNode: 'cryptography-lab',
    mlsEpoch: 29,
    sampleMessages: [
      {
        senderName: 'Ananya Rao',
        senderRole: 'faculty',
        content: 'Updated the key-schedule test vectors for Epoch 29. Verify your local fingerprint in Profile & Sync.',
      },
    ],
    sampleResources: [
      {
        id: 'res-crypto510-mls-rfc',
        title: 'RFC 9420: Messaging Layer Security Architecture',
        description: 'Official specification for asynchronous group key agreement with forward secrecy.',
        subject: 'Information Security',
        topic: 'Group Key Exchange',
        resourceType: 'research_paper',
        url: 'https://datatracker.ietf.org/doc/rfc9420/',
        fileSizeLabel: '1.9 MB SPEC',
      },
    ],
  },
  {
    id: 'math308-graph-theory',
    name: 'Algebraic Graph Theory Seminar',
    code: 'MATH-308',
    description: 'Spectral graph clustering, expander networks, and campus mesh topology optimization.',
    type: 'subject',
    buildingNode: 'mathematics-hall',
    mlsEpoch: 8,
    sampleMessages: [
      {
        senderName: 'Prof. Marcus Sterling',
        senderRole: 'faculty',
        content: 'Problem Set 5 Laplacian eigenvalue solutions have been posted to the group resource vault.',
      },
    ],
    sampleResources: [
      {
        id: 'res-math308-spectral',
        title: 'Spectral Bounds & Cheeger Inequalities Dataset',
        description: 'Benchmark campus adjacency matrices for Cheeger constant computation.',
        subject: 'Mathematics',
        topic: 'Spectral Graph Theory',
        resourceType: 'dataset',
        url: 'https://snap.stanford.edu/data/',
        fileSizeLabel: '14.2 MB CSV',
      },
    ],
  },
  {
    id: 'campus-general-commons',
    name: 'University Commons & Announcements',
    code: 'CAMPUS-GEN',
    description: 'Campus-wide research symposium notices, study commons schedules, and cross-department announcements.',
    type: 'activity',
    buildingNode: 'observatory-hub',
    mlsEpoch: 41,
    sampleMessages: [
      {
        senderName: 'University Administration',
        senderRole: 'platform_admin',
        content: 'Spring Capstone Symposium submissions open this Friday. Use the 3D Campus map to locate lab rooms.',
      },
    ],
    sampleResources: [
      {
        id: 'res-campus-capstone-rubric',
        title: 'Capstone Evaluation Rubric & Backend Architecture Guide',
        description: 'Complete guidelines for REST APIs, Socket.IO real-time modules, and EventEmitter pipelines.',
        subject: 'University Commons',
        topic: 'Capstone Guidelines',
        resourceType: 'code_repo',
        url: 'https://nodejs.org/en/docs',
        fileSizeLabel: '512 KB DOC',
      },
    ],
  },
];

export async function ensureUserProfilesAndDefaultGroups(
  user: User,
): Promise<{ publicProfile: UserPublicProfile; privateInfo: UserPrivateInfo }> {
  const uid = user.uid;
  const publicRef = doc(db, 'usersPublic', uid);
  const privateRef = doc(db, 'usersPrivate', uid);

  let existingPublic: UserPublicProfile | null = null;
  let existingPrivate: UserPrivateInfo | null = null;

  try {
    const pubSnap = await getDoc(publicRef);
    if (pubSnap.exists()) {
      existingPublic = pubSnap.data() as UserPublicProfile;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `usersPublic/${uid}`);
  }

  try {
    const privSnap = await getDoc(privateRef);
    if (privSnap.exists()) {
      existingPrivate = privSnap.data() as UserPrivateInfo;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `usersPrivate/${uid}`);
  }

  const isBootstrappedAdmin = user.email === 'aakarsh.singh8c@gmail.com' && user.emailVerified;
  const displayName = clampStr(user.displayName || user.email?.split('@')[0] || 'Campus Scholar', SCHEMA_LIMITS.displayNameMax);

  if (!existingPublic) {
    const newPublic = {
      uid,
      displayName,
      department: 'Computer Science',
      role: isBootstrappedAdmin ? 'platform_admin' : 'student',
      bio: 'Research collaborator on Campus Connect zero-trust academic channels.',
      avatarUrl: clampStr(user.photoURL || '', SCHEMA_LIMITS.avatarUrlMax),
      publicKeyFingerprint: generateKeyFingerprint(uid),
      statusMessage: 'In research lab',
      online: true,
      themePreference: 'light' as ThemePreference,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await executeOfflineSafeWrite(
      setDoc(publicRef, newPublic),
      OperationType.CREATE,
      `usersPublic/${uid}`,
    );
    existingPublic = {
      ...newPublic,
      role: newPublic.role as UserPublicProfile['role'],
      createdAt: undefined,
      updatedAt: undefined,
    };
  } else {
    executeOfflineSafeWrite(
      updateDoc(publicRef, {
        online: true,
        updatedAt: serverTimestamp(),
      }),
      OperationType.UPDATE,
      `usersPublic/${uid}`,
    ).catch(() => {});
  }

  if (!existingPrivate) {
    const newPrivate = {
      uid,
      email: clampStr(user.email || 'scholar@campus.edu', SCHEMA_LIMITS.emailMax),
      academicId: `CC-${uid.slice(0, 6).toUpperCase()}`,
      offlineSyncEnabled: true,
      notificationsEnabled: true,
      updatedAt: serverTimestamp(),
    };
    await executeOfflineSafeWrite(
      setDoc(privateRef, newPrivate),
      OperationType.CREATE,
      `usersPrivate/${uid}`,
    );
    existingPrivate = {
      ...newPrivate,
      updatedAt: undefined,
    };
  }

  const seededKey = `cc_defaults_seeded_${uid}`;
  const deletedRoomsKey = `cc_deleted_rooms_${uid}`;
  const alreadySeeded =
    typeof window !== 'undefined' && localStorage.getItem(seededKey) === '1';

  let deletedIds = new Set<string>();
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(deletedRoomsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          deletedIds = new Set(parsed.filter((v): v is string => typeof v === 'string'));
        }
      }
    } catch {
      deletedIds = new Set<string>();
    }
  }

  // Seed default Campus Connect public channels only on first initialization for this user
  if (!alreadySeeded) {
    for (const seed of DEFAULT_GROUPS_SEED) {
      if (deletedIds.has(seed.id)) continue;
      const groupRef = doc(db, 'groups', seed.id);
      const memberRef = doc(db, 'groups', seed.id, 'members', uid);
      try {
        const groupSnap = await getDoc(groupRef);
        if (!groupSnap.exists()) {
          const batch = writeBatch(db);
          batch.set(groupRef, {
            id: seed.id,
            name: seed.name,
            code: seed.code,
            description: seed.description,
            type: seed.type,
            buildingNode: seed.buildingNode,
            creatorId: uid,
            mlsEpoch: seed.mlsEpoch,
            keyFingerprint: generateKeyFingerprint(seed.id),
            isPrivate: false,
            memberCount: 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(memberRef, {
            uid,
            displayName,
            groupRole: 'owner',
            joinedAt: serverTimestamp(),
          });
          seed.sampleMessages.forEach((m, idx) => {
            const msgId = `${seed.id}-welcome-${idx + 1}`;
            batch.set(doc(db, 'groups', seed.id, 'messages', msgId), {
              id: msgId,
              groupId: seed.id,
              senderId: uid,
              senderName: m.senderName,
              senderRole: m.senderRole,
              content: m.content,
              mlsEpoch: seed.mlsEpoch,
              deliveryStatus: 'read',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
          seed.sampleResources.forEach((res) => {
            batch.set(doc(db, 'groups', seed.id, 'resources', res.id), {
              id: res.id,
              groupId: seed.id,
              title: res.title,
              description: res.description,
              subject: res.subject,
              topic: res.topic,
              resourceType: res.resourceType,
              url: res.url,
              fileSizeLabel: res.fileSizeLabel,
              authorId: uid,
              authorName: displayName,
              downloadsCount: 12,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
          await executeOfflineSafeWrite(batch.commit(), OperationType.WRITE, `groups/${seed.id}`);
        } else {
          const memberSnap = await getDoc(memberRef);
          if (!memberSnap.exists()) {
            const batch = writeBatch(db);
            batch.set(memberRef, {
              uid,
              displayName,
              groupRole: 'member',
              joinedAt: serverTimestamp(),
            });
            batch.update(groupRef, {
              memberCount: increment(1),
              updatedAt: serverTimestamp(),
            });
            await executeOfflineSafeWrite(
              batch.commit(),
              OperationType.WRITE,
              `groups/${seed.id}/members/${uid}`,
            );
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `groups/${seed.id}`);
      }
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem(seededKey, '1');
    }
  }

  return { publicProfile: existingPublic, privateInfo: existingPrivate };
}

export async function deleteCampusGroup(params: {
  groupId: string;
  uid: string;
}): Promise<void> {
  const { groupId, uid } = params;
  const groupPath = `groups/${groupId}`;

  // Record deletion locally first so default seed rooms are never recreated on refresh
  if (typeof window !== 'undefined') {
    localStorage.setItem(`cc_defaults_seeded_${uid}`, '1');
    const deletedRoomsKey = `cc_deleted_rooms_${uid}`;
    try {
      const existingRaw = localStorage.getItem(deletedRoomsKey);
      const list = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : [];
      const set = new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
      set.add(groupId);
      localStorage.setItem(deletedRoomsKey, JSON.stringify(Array.from(set)));
    } catch {
      localStorage.setItem(deletedRoomsKey, JSON.stringify([groupId]));
    }
  }

  const refsToDeleteBeforeGroup: ReturnType<typeof doc>[] = [];
  let hasOwnMemberDoc = false;

  try {
    const [msgsSnap, resSnap, membersSnap] = await Promise.all([
      getDocs(collection(db, 'groups', groupId, 'messages')),
      getDocs(collection(db, 'groups', groupId, 'resources')),
      getDocs(collection(db, 'groups', groupId, 'members')),
    ]);

    msgsSnap.docs.forEach((d) => refsToDeleteBeforeGroup.push(d.ref));
    resSnap.docs.forEach((d) => refsToDeleteBeforeGroup.push(d.ref));
    membersSnap.docs.forEach((d) => {
      if (d.id === uid) {
        hasOwnMemberDoc = true;
      } else {
        refsToDeleteBeforeGroup.push(d.ref);
      }
    });
  } catch (err) {
    // If subcollection read fails (e.g. non-member platform admin), proceed carefully
    if (err instanceof Error && err.message.toLowerCase().includes('permission')) {
      handleFirestoreError(err, OperationType.LIST, groupPath);
    }
  }

  // Delete messages, resources, and other members in chunks of <= 400 while group & owner member doc still exist
  const CHUNK_SIZE = 400;
  for (let i = 0; i < refsToDeleteBeforeGroup.length; i += CHUNK_SIZE) {
    const chunk = refsToDeleteBeforeGroup.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await executeOfflineSafeWrite(batch.commit(), OperationType.DELETE, groupPath);
  }

  // Delete the group doc while own member doc still exists so isGroupAdmin(groupId) passes
  await executeOfflineSafeWrite(
    deleteDoc(doc(db, 'groups', groupId)),
    OperationType.DELETE,
    groupPath,
  );

  // Finally delete current user's own member doc (permitted via isOwner(memberId))
  if (hasOwnMemberDoc) {
    await executeOfflineSafeWrite(
      deleteDoc(doc(db, 'groups', groupId, 'members', uid)),
      OperationType.DELETE,
      `groups/${groupId}/members/${uid}`,
    );
  }
}

export async function createCampusGroup(params: {
  name: string;
  code: string;
  description: string;
  type: GroupType;
  buildingNode: string;
  isPrivate: boolean;
  creatorUid: string;
  creatorName: string;
  creatorRole: string;
  department: string;
}): Promise<CampusGroup> {
  const groupId = generateId('grp');
  const batch = writeBatch(db);

  const groupDoc = {
    id: groupId,
    name: clampStr(params.name, SCHEMA_LIMITS.groupNameMax, 'Untitled Channel'),
    code: clampStr(params.code.toUpperCase(), SCHEMA_LIMITS.groupCodeMax, 'LAB-101'),
    description: clampStr(params.description, SCHEMA_LIMITS.groupDescMax),
    type: params.type,
    buildingNode: clampStr(params.buildingNode, SCHEMA_LIMITS.buildingNodeMax, 'observatory-hub'),
    creatorId: params.creatorUid,
    mlsEpoch: 1,
    keyFingerprint: generateKeyFingerprint(groupId),
    isPrivate: params.isPrivate,
    memberCount: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  batch.set(doc(db, 'groups', groupId), groupDoc);
  batch.set(doc(db, 'groups', groupId, 'members', params.creatorUid), {
    uid: params.creatorUid,
    displayName: clampStr(params.creatorName, SCHEMA_LIMITS.displayNameMax),
    groupRole: 'owner',
    joinedAt: serverTimestamp(),
  });

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    batch.commit(),
    OperationType.CREATE,
    `groups/${groupId}`,
  );

  await recordEngagementMetric({
    userId: params.creatorUid,
    userRole: params.creatorRole,
    eventType: 'channel_joined',
    groupId,
    department: params.department,
    latencyMs,
    wasOffline: queuedOffline,
  });

  return {
    ...groupDoc,
    createdAt: undefined,
    updatedAt: undefined,
  };
}

export async function joinPublicGroup(params: {
  groupId: string;
  uid: string;
  displayName: string;
  userRole: string;
  department: string;
}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', params.groupId, 'members', params.uid), {
    uid: params.uid,
    displayName: clampStr(params.displayName, SCHEMA_LIMITS.displayNameMax),
    groupRole: 'member',
    joinedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'groups', params.groupId), {
    memberCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    batch.commit(),
    OperationType.WRITE,
    `groups/${params.groupId}/members/${params.uid}`,
  );

  await recordEngagementMetric({
    userId: params.uid,
    userRole: params.userRole,
    eventType: 'channel_joined',
    groupId: params.groupId,
    department: params.department,
    latencyMs,
    wasOffline: queuedOffline,
  });
}

export async function sendGroupMessage(params: {
  groupId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  department: string;
  content: string;
  mlsEpoch: number;
  replyToId?: string;
  replyPreview?: string;
}) {
  const messageId = generateId('msg');
  const msgPath = `groups/${params.groupId}/messages/${messageId}`;
  const payload: Record<string, unknown> = {
    id: messageId,
    groupId: params.groupId,
    senderId: params.senderId,
    senderName: clampStr(params.senderName, SCHEMA_LIMITS.displayNameMax, 'Scholar'),
    senderRole: clampStr(params.senderRole, SCHEMA_LIMITS.roleMax, 'student'),
    content: clampStr(params.content, SCHEMA_LIMITS.messageContentMax),
    mlsEpoch: Math.max(1, params.mlsEpoch),
    deliveryStatus: typeof navigator !== 'undefined' && !navigator.onLine ? 'sent' : 'delivered',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.replyToId) {
    payload.replyToId = clampStr(params.replyToId, SCHEMA_LIMITS.idMax);
    payload.replyPreview = clampStr(params.replyPreview, SCHEMA_LIMITS.replyPreviewMax);
  }

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    setDoc(doc(db, 'groups', params.groupId, 'messages', messageId), payload),
    OperationType.CREATE,
    msgPath,
  );

  await recordEngagementMetric({
    userId: params.senderId,
    userRole: params.senderRole,
    eventType: 'message_sent',
    groupId: params.groupId,
    department: params.department,
    latencyMs,
    wasOffline: queuedOffline,
  });

  return { messageId, queuedOffline, latencyMs };
}

export async function shareAcademicResource(params: {
  groupId: string;
  title: string;
  description: string;
  subject: string;
  topic: string;
  resourceType: ResourceType;
  url: string;
  fileSizeLabel: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  department: string;
}) {
  const resourceId = generateId('res');
  const resPath = `groups/${params.groupId}/resources/${resourceId}`;

  const payload = {
    id: resourceId,
    groupId: params.groupId,
    title: clampStr(params.title, SCHEMA_LIMITS.resourceTitleMax, 'Academic Resource'),
    description: clampStr(params.description, SCHEMA_LIMITS.resourceDescMax),
    subject: clampStr(params.subject, SCHEMA_LIMITS.subjectMax, 'Computer Science'),
    topic: clampStr(params.topic, SCHEMA_LIMITS.topicMax, 'General'),
    resourceType: params.resourceType,
    url: clampStr(params.url, SCHEMA_LIMITS.urlMax, 'https://arxiv.org'),
    fileSizeLabel: clampStr(params.fileSizeLabel, SCHEMA_LIMITS.fileSizeLabelMax, '1.2 MB PDF'),
    authorId: params.authorId,
    authorName: clampStr(params.authorName, SCHEMA_LIMITS.displayNameMax),
    downloadsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    setDoc(doc(db, 'groups', params.groupId, 'resources', resourceId), payload),
    OperationType.CREATE,
    resPath,
  );

  await recordEngagementMetric({
    userId: params.authorId,
    userRole: params.authorRole,
    eventType: 'resource_shared',
    groupId: params.groupId,
    department: params.department,
    latencyMs,
    wasOffline: queuedOffline,
  });

  return { resourceId, queuedOffline, latencyMs };
}

export async function incrementResourceDownload(params: {
  groupId: string;
  resourceId: string;
  userId: string;
  userRole: string;
  department: string;
}) {
  const resPath = `groups/${params.groupId}/resources/${params.resourceId}`;
  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    updateDoc(doc(db, 'groups', params.groupId, 'resources', params.resourceId), {
      downloadsCount: increment(1),
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    resPath,
  );

  await recordEngagementMetric({
    userId: params.userId,
    userRole: params.userRole,
    eventType: 'resource_downloaded',
    groupId: params.groupId,
    department: params.department,
    latencyMs,
    wasOffline: queuedOffline,
  });
}

export async function sendGroupInvitation(params: {
  groupId: string;
  groupName: string;
  inviterId: string;
  inviterName: string;
  inviteeId: string;
}) {
  const invitationId = sanitizeId(`${params.groupId}_${params.inviteeId}`);
  const invPath = `invitations/${invitationId}`;

  const payload = {
    id: invitationId,
    groupId: params.groupId,
    groupName: clampStr(params.groupName, SCHEMA_LIMITS.groupNameMax),
    inviterId: params.inviterId,
    inviterName: clampStr(params.inviterName, SCHEMA_LIMITS.displayNameMax),
    inviteeId: params.inviteeId,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  return executeOfflineSafeWrite(
    setDoc(doc(db, 'invitations', invitationId), payload),
    OperationType.CREATE,
    invPath,
  );
}

export async function respondToGroupInvitation(params: {
  invitationId: string;
  groupId: string;
  uid: string;
  displayName: string;
  userRole: string;
  department: string;
  accept: boolean;
}) {
  const batch = writeBatch(db);
  const invRef = doc(db, 'invitations', params.invitationId);

  batch.update(invRef, {
    status: params.accept ? 'accepted' : 'declined',
    updatedAt: serverTimestamp(),
  });

  if (params.accept) {
    batch.set(doc(db, 'groups', params.groupId, 'members', params.uid), {
      uid: params.uid,
      displayName: clampStr(params.displayName, SCHEMA_LIMITS.displayNameMax),
      groupRole: 'member',
      joinedAt: serverTimestamp(),
    });
  }

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    batch.commit(),
    OperationType.WRITE,
    `invitations/${params.invitationId}`,
  );

  if (params.accept) {
    await recordEngagementMetric({
      userId: params.uid,
      userRole: params.userRole,
      eventType: 'channel_joined',
      groupId: params.groupId,
      department: params.department,
      latencyMs,
      wasOffline: queuedOffline,
    });
  }
}

export async function rotateGroupMlsEpoch(params: {
  groupId: string;
  currentEpoch: number;
}) {
  const nextEpoch = params.currentEpoch + 1;
  return executeOfflineSafeWrite(
    updateDoc(doc(db, 'groups', params.groupId), {
      mlsEpoch: nextEpoch,
      keyFingerprint: generateKeyFingerprint(`${params.groupId}-epoch-${nextEpoch}`),
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `groups/${params.groupId}`,
  );
}

export async function updateUserProfilesOfflineFirst(params: {
  uid: string;
  role: string;
  displayName: string;
  department: string;
  bio: string;
  statusMessage: string;
  themePreference: ThemePreference;
  publicKeyFingerprint: string;
  academicId: string;
  offlineSyncEnabled: boolean;
  notificationsEnabled: boolean;
}) {
  const batch = writeBatch(db);

  batch.update(doc(db, 'usersPublic', params.uid), {
    displayName: clampStr(params.displayName, SCHEMA_LIMITS.displayNameMax, 'Scholar'),
    department: clampStr(params.department, SCHEMA_LIMITS.departmentMax, 'Computer Science'),
    bio: clampStr(params.bio, SCHEMA_LIMITS.bioMax),
    statusMessage: clampStr(params.statusMessage, SCHEMA_LIMITS.statusMessageMax),
    themePreference: params.themePreference,
    publicKeyFingerprint: clampStr(params.publicKeyFingerprint, SCHEMA_LIMITS.fingerprintMax),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'usersPrivate', params.uid), {
    academicId: clampStr(params.academicId, SCHEMA_LIMITS.academicIdMax),
    offlineSyncEnabled: Boolean(params.offlineSyncEnabled),
    notificationsEnabled: Boolean(params.notificationsEnabled),
    updatedAt: serverTimestamp(),
  });

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    batch.commit(),
    OperationType.UPDATE,
    `usersPublic/${params.uid}`,
  );

  await recordEngagementMetric({
    userId: params.uid,
    userRole: params.role,
    eventType: 'profile_updated',
    department: params.department,
    latencyMs,
    wasOffline: queuedOffline,
  });

  return { queuedOffline, latencyMs };
}

export async function getOrCreateDirectMessage(params: {
  currentProfile: UserPublicProfile;
  peerProfile: UserPublicProfile;
}): Promise<CampusGroup> {
  const { currentProfile, peerProfile } = params;
  const sorted = [currentProfile.uid, peerProfile.uid].sort();
  const dmId = sanitizeId(`dm_${sorted[0].slice(0, 48)}_${sorted[1].slice(0, 48)}`);
  const groupRef = doc(db, 'groups', dmId);

  try {
    const existingSnap = await getDoc(groupRef);
    if (existingSnap.exists()) {
      return existingSnap.data() as CampusGroup;
    }
  } catch {
    // Proceed to create if not yet accessible
  }

  const peerShort = peerProfile.displayName.split(' ')[0] || 'Scholar';
  const selfShort = currentProfile.displayName.split(' ')[0] || 'Scholar';
  const groupDoc = {
    id: dmId,
    name: clampStr(`${selfShort} & ${peerShort}`, SCHEMA_LIMITS.groupNameMax, 'Direct Message'),
    code: clampStr(`DM-${peerShort.toUpperCase()}`, SCHEMA_LIMITS.groupCodeMax, 'DIRECT'),
    description: clampStr(
      `Private 1-to-1 encrypted academic conversation between ${currentProfile.displayName} and ${peerProfile.displayName}.`,
      SCHEMA_LIMITS.groupDescMax,
    ),
    type: 'direct' as GroupType,
    buildingNode: 'student-commons',
    creatorId: currentProfile.uid,
    participantIds: sorted,
    mlsEpoch: 1,
    keyFingerprint: generateKeyFingerprint(dmId),
    isPrivate: true,
    memberCount: 2,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(groupRef, groupDoc);
  batch.set(doc(db, 'groups', dmId, 'members', currentProfile.uid), {
    uid: currentProfile.uid,
    displayName: clampStr(currentProfile.displayName, SCHEMA_LIMITS.displayNameMax),
    groupRole: 'owner',
    joinedAt: serverTimestamp(),
  });
  if (peerProfile.uid !== currentProfile.uid) {
    batch.set(doc(db, 'groups', dmId, 'members', peerProfile.uid), {
      uid: peerProfile.uid,
      displayName: clampStr(peerProfile.displayName, SCHEMA_LIMITS.displayNameMax),
      groupRole: 'member',
      joinedAt: serverTimestamp(),
    });
  }

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    batch.commit(),
    OperationType.CREATE,
    `groups/${dmId}`,
  );

  await recordEngagementMetric({
    userId: currentProfile.uid,
    userRole: currentProfile.role,
    eventType: 'dm_started',
    groupId: dmId,
    department: currentProfile.department,
    latencyMs,
    wasOffline: queuedOffline,
  });

  return {
    ...groupDoc,
    createdAt: undefined,
    updatedAt: undefined,
  };
}

export async function addGroupMemberDirect(params: {
  groupId: string;
  memberUid: string;
  memberName: string;
  groupRole?: 'admin' | 'member';
}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', params.groupId, 'members', params.memberUid), {
    uid: params.memberUid,
    displayName: clampStr(params.memberName, SCHEMA_LIMITS.displayNameMax, 'Scholar'),
    groupRole: params.groupRole || 'member',
    joinedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'groups', params.groupId), {
    memberCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  return executeOfflineSafeWrite(
    batch.commit(),
    OperationType.WRITE,
    `groups/${params.groupId}/members/${params.memberUid}`,
  );
}

export async function removeGroupMember(params: {
  groupId: string;
  memberUid: string;
}) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'groups', params.groupId, 'members', params.memberUid));
  batch.update(doc(db, 'groups', params.groupId), {
    memberCount: increment(-1),
    updatedAt: serverTimestamp(),
  });

  return executeOfflineSafeWrite(
    batch.commit(),
    OperationType.DELETE,
    `groups/${params.groupId}/members/${params.memberUid}`,
  );
}

export async function updateGroupMemberRole(params: {
  groupId: string;
  memberUid: string;
  groupRole: GroupMemberRole;
}) {
  return executeOfflineSafeWrite(
    updateDoc(doc(db, 'groups', params.groupId, 'members', params.memberUid), {
      groupRole: params.groupRole,
    }),
    OperationType.UPDATE,
    `groups/${params.groupId}/members/${params.memberUid}`,
  );
}

export async function updateCampusGroupDetails(params: {
  groupId: string;
  name: string;
  description: string;
  isPrivate: boolean;
}) {
  return executeOfflineSafeWrite(
    updateDoc(doc(db, 'groups', params.groupId), {
      name: clampStr(params.name, SCHEMA_LIMITS.groupNameMax, 'Untitled Channel'),
      description: clampStr(params.description, SCHEMA_LIMITS.groupDescMax),
      isPrivate: Boolean(params.isPrivate),
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `groups/${params.groupId}`,
  );
}

export async function toggleMessageReaction(params: {
  groupId: string;
  messageId: string;
  reactionKey: ReactionKey;
  uid: string;
  currentReactions?: Partial<Record<ReactionKey, string[]>>;
}) {
  const nextReactions: Partial<Record<ReactionKey, string[]>> = {
    ...(params.currentReactions || {}),
  };
  const existing = Array.isArray(nextReactions[params.reactionKey])
    ? [...(nextReactions[params.reactionKey] as string[])]
    : [];
  const idx = existing.indexOf(params.uid);
  if (idx >= 0) {
    existing.splice(idx, 1);
  } else if (existing.length < 50) {
    existing.push(params.uid);
  }

  if (existing.length === 0) {
    delete nextReactions[params.reactionKey];
  } else {
    nextReactions[params.reactionKey] = existing;
  }

  return executeOfflineSafeWrite(
    updateDoc(doc(db, 'groups', params.groupId, 'messages', params.messageId), {
      reactions: nextReactions,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `groups/${params.groupId}/messages/${params.messageId}`,
  );
}

export async function markMessagesAsRead(params: {
  groupId: string;
  messageIds: string[];
}) {
  if (params.messageIds.length === 0) return;
  const batch = writeBatch(db);
  params.messageIds.slice(0, 25).forEach((mid) => {
    batch.update(doc(db, 'groups', params.groupId, 'messages', mid), {
      deliveryStatus: 'read',
      updatedAt: serverTimestamp(),
    });
  });
  return executeOfflineSafeWrite(
    batch.commit(),
    OperationType.UPDATE,
    `groups/${params.groupId}/messages`,
  );
}

export async function createModerationReport(params: {
  group: CampusGroup;
  message: GroupMessage;
  reporter: UserPublicProfile;
  reason: ModerationReason;
  details: string;
}): Promise<string> {
  const reportId = generateId('rep');
  const reportPath = `moderationReports/${reportId}`;

  const payload = {
    id: reportId,
    groupId: params.group.id,
    groupCode: clampStr(params.group.code, SCHEMA_LIMITS.groupCodeMax, 'ROOM'),
    messageId: params.message.id,
    messagePreview: clampStr(params.message.content, SCHEMA_LIMITS.reportPreviewMax, '[Message]'),
    reportedUserId: params.message.senderId,
    reportedUserName: clampStr(params.message.senderName, SCHEMA_LIMITS.displayNameMax, 'Scholar'),
    reporterId: params.reporter.uid,
    reporterName: clampStr(params.reporter.displayName, SCHEMA_LIMITS.displayNameMax, 'Scholar'),
    reason: params.reason,
    details: clampStr(params.details, SCHEMA_LIMITS.reportDetailsMax),
    status: 'open' as ModerationStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const { queuedOffline, latencyMs } = await executeOfflineSafeWrite(
    setDoc(doc(db, 'moderationReports', reportId), payload),
    OperationType.CREATE,
    reportPath,
  );

  await recordEngagementMetric({
    userId: params.reporter.uid,
    userRole: params.reporter.role,
    eventType: 'moderation_reported',
    groupId: params.group.id,
    department: params.reporter.department,
    latencyMs,
    wasOffline: queuedOffline,
  });

  return reportId;
}

export async function resolveModerationReport(params: {
  reportId: string;
  status: 'resolved' | 'dismissed';
  resolvedByUid: string;
  deleteMessage?: { groupId: string; messageId: string };
}) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'moderationReports', params.reportId), {
    status: params.status,
    resolvedBy: params.resolvedByUid,
    updatedAt: serverTimestamp(),
  });
  if (params.deleteMessage) {
    batch.delete(
      doc(db, 'groups', params.deleteMessage.groupId, 'messages', params.deleteMessage.messageId),
    );
  }
  return executeOfflineSafeWrite(
    batch.commit(),
    OperationType.UPDATE,
    `moderationReports/${params.reportId}`,
  );
}

export async function updateUserDirectoryRole(params: {
  targetUid: string;
  role: UserRole;
}) {
  return executeOfflineSafeWrite(
    updateDoc(doc(db, 'usersPublic', params.targetUid), {
      role: params.role,
      updatedAt: serverTimestamp(),
    }),
    OperationType.UPDATE,
    `usersPublic/${params.targetUid}`,
  );
}
