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

## Deployment on Vercel

1. Push this repo to GitHub.
2. Import the repo in [Vercel](https://vercel.com/new).
3. Add the following **Environment Variables** in Vercel project settings:
   - `DATABASE_URL` — your Postgres connection string
   - `SESSION_SECRET` — a strong random secret
   - `ADMIN_SECRET` — your admin master key
4. Deploy!

Vercel will automatically run `npm install` (which runs `prisma generate`) and `next build`.

> **Note:** You must migrate your Postgres database. Run `npx prisma migrate deploy` against your production database, or use `prisma db push` from your terminal/CI.

## Features

- 🔐 **Auto-register login** — just pick a username and password
- 👥 **Group chat** — create or join groups with invite codes
- 💬 **Real-time messaging** — 200 latest messages per group
- 🛡️ **Admin panel** — `/chismis-admin` with secret-key access to view/delete groups & messages