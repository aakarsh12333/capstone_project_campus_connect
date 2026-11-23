# Campus Connect — Real-Time Campus Collaboration & Communication Platform

A full-stack, real-time academic collaboration and communication platform built for **Project 3: Real-Time Campus Collaboration and Communication Platform**. Campus Connect enables students, faculty members, group administrators, and platform administrators to communicate via group channels and private 1-to-1 direct messages, share academic resources (links and local file uploads), explore a 3D campus topology, monitor engagement analytics, and moderate campus conversations with offline-first persistence.

---

## Key Features

### 1. Authentication, Profiles & Role-Based Access Control (RBAC)
- **Firebase Authentication** with cryptographic Firebase ID token verification on protected Express REST endpoints and Socket.IO handshakes.
- **Role Hierarchy**: `student`, `faculty`, `group_admin`, and `platform_admin`.
- **Zero-Latency Profile Management**: Offline-first profile updates (display name, department, bio, status message, theme preference, notification toggles) with automatic state synchronization via Firestore persistence.
- **PII Isolation**: Public directory data (`usersPublic`) is separated from private user settings and email (`usersPrivate`).

### 2. Group Conversations & 1-to-1 Direct Messaging
- **Academic Channels**: Create channels for subjects, projects, or student activities with public or private visibility.
- **Private 1-to-1 Direct Messages**: Deterministic participant-isolated DM threads (`dm_<uidA>_<uidB>`) accessible only to the two participants.
- **Group Administration**: Invite users, accept/decline invitations, directly add or remove members, promote/demote group administrators, edit room details/privacy, and delete active rooms.

### 3. Real-Time Communication, Presence & Message State
- **Socket.IO Real-Time Layer**: Authenticated socket connections with live online/offline presence tracking and per-room typing indicators.
- **Persisted-Before-Broadcast**: Messages are saved in Firestore prior to real-time Socket.IO dispatch, with server-side and client-side ID deduplication across reconnects.
- **Paginated Chronological History**: Load earlier messages on demand without duplicating existing thread history.
- **Read Receipts, Unread Badges & Reactions**: Automatic `sent` / `delivered` / `read` status tracking, per-room unread counters respecting notification settings, and persistent inline reactions (`👍`, `❤️`, `💡`, `🎯`, `🔥`).

### 4. Academic Resource Sharing & Offline File Cache
- **Dual Resource Modes**: Share external academic URLs or upload files directly from a local computer.
- **File Security Validation**: Client- and server-side academic format allowlisting (`.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`, `.txt`, `.md`, `.csv`, `.json`, `.ipynb`, `.py`, `.js`, `.ts`, `.zip`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`) and a **20 MB** size cap.
- **Categorization & Access Control**: Organize by subject, topic, and resource type (`lecture_notes`, `research_paper`, `code_repo`, `dataset`, `lab_guide`) with membership-gated access and IndexedDB offline caching.

### 5. Moderation, Governance & Campus-Wide Announcements
- **Message Reporting**: Any channel or DM member can report inappropriate messages for spam, harassment, academic integrity, or policy violations.
- **Platform Admin Moderation Queue**: Review, dismiss, resolve, or delete reported messages, and manage user directory roles.
- **Campus-Wide Announcements**: Faculty and Platform Administrators can broadcast urgent announcements in real time via Node `EventEmitter` and Socket.IO.

### 6. 3D Campus Topology, Engagement Analytics & Dark Mode
- **Interactive 3D Campus Map**: Explore campus buildings and active academic channels powered by Three.js.
- **Engagement Analytics Dashboard**: Track message latency, offline sync flushes, active channels, and campus event pipelines over `24h`, `7d`, and `30d` windows.
- **Responsive UI & Theme Support**: Seamless Light and Dark modes with smooth page transitions across desktop and mobile viewports.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS v4, Motion, Lucide React, Three.js |
| **Real-Time & Backend** | Node.js, Express 4, Socket.IO 4, Node `EventEmitter`, `tsx` |
| **Database & Auth** | Firebase Authentication, Cloud Firestore (offline persistence + custom security rules), IndexedDB (local file cache) |
| **Security & Validation** | Cryptographic JWT verification (Google x509 public certs via `node:crypto`), ESLint Firebase Security Rules validation |

---

## Project Structure

```text
.
├── server.ts                       # Express + Socket.IO server entry point (port 3000)
├── server/
│   ├── controllers/
│   │   ├── reportsController.ts    # Health, engagement analytics, and API catalog handlers
│   │   └── resourcesController.ts  # Authenticated local academic file upload & download
│   ├── events/
│   │   └── campusEmitter.ts        # Node EventEmitter for internal domain events
│   └── middleware/
│       ├── errorHandler.ts         # Standardized JSON error handling
│       └── firebaseAuth.ts         # Firebase ID token verification for REST & Socket.IO
├── src/
│   ├── App.tsx                     # Root application state, listeners, and page transitions
│   ├── firebase.ts                 # Firebase App, Auth, and offline-persistent Firestore setup
│   ├── components/                 # UI views (Messages, Resources, 3D Campus, Analytics, Moderation, Profile)
│   ├── hooks/
│   │   └── useCampusSocket.ts      # Authenticated Socket.IO client hook
│   ├── services/                   # Firestore CRUD, auth token helper, and IndexedDB file store
│   └── types/                      # Shared TypeScript interfaces and enums
├── firestore.rules                 # Hardened Firestore RBAC & schema validation rules
├── firebase-blueprint.json         # Firestore entity & collection schema blueprint
├── security_spec.md                # Security invariants and threat-model specification
├── package.json
└── vite.config.ts
```

---

## REST API & Socket.IO Reference

### REST Endpoints
| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Server & Socket.IO health check |
| `GET` | `/api/architecture/endpoints` | Public | Live REST API & Socket.IO event catalog |
| `POST` | `/api/resources/upload` | Bearer JWT | Upload local academic file (allowlisted formats, 20 MB max) |
| `GET` | `/api/resources/files/:fileId` | Bearer JWT | Download authenticated academic resource file |
| `GET` | `/api/reports/engagement?range=24h\|7d\|30d` | Bearer JWT | Aggregated engagement metrics & channel pipelines |
| `POST` | `/api/analytics/event` | Bearer JWT | Emit internal `EventEmitter` analytics event |

### Socket.IO Events
- **Handshake Auth**: Client passes Firebase ID token via Socket.IO `auth`; server verifies JWT before allowing connection.
- `presence:identify` — Register authenticated user online presence and role.
- `room:join` / `room:leave` — Join or leave academic channel or 1-to-1 DM rooms.
- `typing:start` / `typing:stop` — Broadcast real-time typing indicators.
- `message:broadcast` / `message:read` — Persisted-first message delivery, unread counts, and read receipts.
- `invitation:notify` — Real-time group invitation alerts.
- `announcement:broadcast` — Faculty/Admin real-time campus announcements.
- `moderation:alert` — Real-time moderation queue alerts for Platform Administrators.

---

## Getting Started

### Prerequisites
- **Node.js** v20+ (with `npm`)
- A **Firebase project** with Authentication (Email/Password or Google) and Cloud Firestore enabled.

### Installation & Local Development

1. **Clone the repository and install dependencies**
   ```bash
   git clone <your-repository-url>
   cd <your-project-folder>
   npm install
   ```

2. **Configure environment variables**
   Copy `.env.example` to `.env` and populate any required keys:
   ```bash
   cp .env.example .env
   ```
   Ensure `firebase-applet-config.json` contains your Firebase project configuration (`apiKey`, `authDomain`, `projectId`, `firestoreDatabaseId`, etc.).

3. **Deploy Firestore Security Rules**
   Review `firestore.rules` (and lint them with `npx eslint firestore.rules`) before deploying to your Firebase project via the Firebase CLI:
   ```bash
   firebase deploy --only firestore:rules
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```
   The full-stack Express + Socket.IO + Vite application runs on `http://localhost:3000`.

### Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run Express + Socket.IO + Vite dev server on port 3000 |
| `npm run build` | Build production frontend bundle to `dist/` |
| `npm run start` | Start production Node server (`server.ts`) |
| `npm run lint` | Run TypeScript type checking (`tsc --noEmit`) |
| `npx eslint firestore.rules` | Lint Firestore security rules |

---

## Security & Compliance Highlights

- **Default-Deny Firestore Rules**: All collections enforce authentication, ownership or group membership checks, field allowlists, immutable audit timestamps, and terminal state locking on invitations and moderation reports.
- **Authenticated File Transfers**: Local uploads validate file extensions and size limits on both client and server and require a verified Firebase Bearer token for upload and download.
- **Production Note**: Review and customize `firestore.rules` (including your institutional admin email/claims) before deploying to a public production environment.

---

## License

This project was developed as a university Backend & Full-Stack Development Capstone Project.
