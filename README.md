# Chismisa 💬

Anonymous real-time group chat. Create a group, share the invite code, and start chismisan!

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19**
- **Prisma 7** with PostgreSQL
- **Tailwind CSS 4**
- **JWT** session auth (jose)
- **bcryptjs** password hashing

## Getting Started

### Prerequisites

- Node.js 22.12+ (pinned to satisfy the Prisma 7.9.1 preinstall check)
- PostgreSQL database (local or hosted — e.g. Supabase, Neon, Vercel Postgres)

### Local Development

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/biro-dev/chismisa.git
cd chismisa
npm install
```

2. Create a `.env` file (see `.env.example`):

```env
# Postgres connection string (e.g. from Supabase/Neon/Vercel Postgres)
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public"

# JWT session secret — generate a strong value with: openssl rand -base64 32
SESSION_SECRET="your-strong-secret"

# Master admin secret for /chismis-admin
ADMIN_SECRET="your-admin-master-key"

# Pusher (real-time messaging) — optional; without it the app falls
# back to 30s polling for new messages
PUSHER_APP_ID=""
PUSHER_SECRET=""
NEXT_PUBLIC_PUSHER_KEY=""
NEXT_PUBLIC_PUSHER_CLUSTER=""

# Firebase Cloud Messaging (push notifications) — optional
FIREBASE_SERVICE_ACCOUNT=""
NEXT_PUBLIC_FIREBASE_VAPID_KEY=""
```

3. Run migrations:

```bash
npx prisma migrate dev
```

4. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

The project uses [Vitest](https://vitest.dev/) with Testing Library. Tests run in CI (GitHub Actions) on every push/PR to `main` — lint, type-check, tests, and build.

```bash
npm test        # run the full test suite once
npx vitest      # watch mode during development
```

Coverage highlights:

- **Server actions** — auth (auto-register login), groups (create/join/leave/delete), messages (send/reply/react/delete/poll), admin (secret verification, member removal)
- **Libs** — session JWT round-trip, sliding-window rate limiter
- **Components** (`jsdom` via `// @vitest-environment jsdom`) — `MessageBubble` (rendering, reactions, deletion, read receipts) and `GroupSidebar` (selection, modals, theme toggle)

Server-only code is tested without a live database by mocking `@/lib/db` (see `src/test/setup.ts` and the stubs in `src/test/stubs/`).

## Deployment on Vercel

1. Push this repo to GitHub.
2. Import the repo in [Vercel](https://vercel.com/new).
3. Add the following **Environment Variables** in Vercel project settings:
   - `DATABASE_URL` — your Postgres connection string
   - `SESSION_SECRET` — a strong random secret
   - `ADMIN_SECRET` — your admin master key
   - `PUSHER_*` / `NEXT_PUBLIC_PUSHER_*` — optional, enables real-time messaging
   - `FIREBASE_SERVICE_ACCOUNT` / `NEXT_PUBLIC_FIREBASE_VAPID_KEY` — optional, enables push notifications
4. Deploy!

Vercel will automatically run `npm install` (which runs `prisma generate`) and `next build`.

> **Note:** You must migrate your Postgres database. Run `npx prisma migrate deploy` against your production database, or use `prisma db push` from your terminal/CI.

## Features

- 🔐 **Auto-register login** — just pick a username and password
- 👥 **Group chat** — create or join groups with invite codes (shareable `/join/{code}` links)
- 💬 **Real-time messaging** — Pusher channels with a 30s polling fallback; 200 latest messages per group
- ✏️ **Message editing** — edit your own messages inline; updates broadcast in real time with an "(edited)" marker
- ↩️ **Replies & reactions** — threaded quoting and per-user emoji reactions
- ✅ **Read receipts & unread badges** — per-group unread counts, updated instantly over real-time
- ⌨️ **Typing indicators** — shows who's typing, per-user timeouts
- 🔔 **Push notifications** — FCM on Android (Capacitor) and web, with tap-through to the group
- 🌓 **Dark/light theme**, toasts, jump-to-bottom, and sliding session renewal (active users stay logged in)
- 🛡️ **Admin panel** — `/chismis-admin` with secret-key access to view/delete groups & messages