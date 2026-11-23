# Campus Connect Security Specification (Phase 0)

## 1. Data Invariants
1. **PII Isolation**: Private user emails and academic IDs reside strictly in `/usersPrivate/{userId}` and are readable/writable only by `request.auth.uid == userId` or verified platform admins. Public directory listings use `/usersPublic/{userId}` with zero PII.
2. **No Self-Privilege Escalation**: Users creating their own `/usersPublic/{userId}` profile must default to `role == 'student'` (unless verified against `/admins/{uid}` or the bootstrapped admin email with `email_verified == true`), and cannot mutate `role` on update.
3. **Master Gate on Group Subcollections**: Reading or writing `/groups/{groupId}/messages/{messageId}` and `/groups/{groupId}/resources/{resourceId}` requires verified membership in `/groups/{groupId}/members/{request.auth.uid}` (or platform admin), or public group read rules where `isPrivate == false`.
4. **Immutable Ownership & Temporal Integrity**: `createdAt`, `senderId`, `creatorId`, `authorId`, and `userId` are immutable after creation; `createdAt == request.time` on create, `updatedAt == request.time` on update.
5. **Terminal State Locking**: `/invitations/{invitationId}` cannot be updated once `status` reaches `'accepted'` or `'declined'`.
6. **Path Variable Hardening & Payload Size Bounds**: Every single-doc path parameter enforces `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars), and all strings enforce explicit `.size()` boundaries.
7. **Secure List Queries**: Every `allow list` rule evaluates `resource.data` directly against `request.auth.uid` or public non-PII flags (`isPrivate == false`) without `get()`/`exists()` O(n) lookups.
8. **Bounded Direct Messaging & Reactions**: `CampusGroup.participantIds` is bounded strictly to `size() <= 2` for 1-to-1 DMs; `GroupMessage.reactions` allows only fixed reaction keys (`thumbs_up`, `heart`, `target`, `fire`, `bulb`), each bounded to `<= 50` UIDs.
9. **Moderation Terminal Locking**: `/moderationReports/{reportId}` can only be created by verified members of the target group with `status == 'open'`, and only verified platform admins can resolve or dismiss an open report.

## 2. The "Dirty Dozen" Attack Payloads
1. **Self-Role Escalation**: `POST /usersPublic/{uid}` with `role: "platform_admin"` by non-admin user -> `PERMISSION_DENIED`.
2. **Shadow Ghost Field**: `PATCH /usersPublic/{uid}` adding `isVerified: true` -> `PERMISSION_DENIED` (`hasOnly` check).
3. **PII Cross-Read**: `GET /usersPrivate/{otherUid}` by another signed-in user -> `PERMISSION_DENIED`.
4. **Unverified Email Spoof**: Write attempt when `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
5. **Sender Impersonation**: `CREATE /groups/{g}/messages/{m}` with `senderId: "victimUid"` -> `PERMISSION_DENIED`.
6. **Non-Member Private Message Injection**: `CREATE /groups/{privateGroup}/messages/{m}` by non-member -> `PERMISSION_DENIED`.
7. **Oversized Message Flood**: `CREATE /groups/{g}/messages/{m}` with 50KB `content` string -> `PERMISSION_DENIED`.
8. **Invalid ID Poisoning**: `CREATE /groups/../../etc/passwd` -> `PERMISSION_DENIED` (`isValidId`).
9. **Client Timestamp Forgery**: `CREATE /groups/{g}/messages/{m}` with backdated `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
10. **Terminal Invitation Mutation**: `UPDATE /invitations/{id}` changing `status` from `'accepted'` back to `'pending'` -> `PERMISSION_DENIED`.
11. **Analytics Query Scraping**: `LIST /analyticsEvents` without `where('userId', '==', auth.uid)` -> `PERMISSION_DENIED`.
12. **Resource Author Hijack**: `UPDATE /groups/{g}/resources/{r}` attempting to change `authorId` -> `PERMISSION_DENIED`.
13. **Moderation Self-Resolution**: Non-admin attempting `UPDATE /moderationReports/{id}` to set `status: 'dismissed'` -> `PERMISSION_DENIED`.
14. **Reaction Key Injection**: `UPDATE /groups/{g}/messages/{m}` adding arbitrary reaction key `hacked: ['uid']` -> `PERMISSION_DENIED`.
