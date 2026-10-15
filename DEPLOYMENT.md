# Deploying Finora

## What runs in production

1. **Web app**: `npm run build && npm start` (any Node 20+ host, container, or Vercel).
2. **PostgreSQL 14+**: a managed database such as Neon, Supabase, RDS or Cloud SQL, with encryption at rest and TLS enabled.
3. **Scheduled jobs**: recurring transactions, subscription roll-forward, notifications and retention. Pick one way to run them:
   - a long-running worker: `npm run worker` (systemd, PM2, or a second container), or
   - a scheduler calling `POST /api/cron` with `Authorization: Bearer $CRON_SECRET` every 15 minutes, or
   - a cron job running `npm run worker:once`.

   All job state lives in the database (unique occurrence keys, notification de-duplication keys, `JobRun` records), so passes are idempotent. They are safe to restart, retry, or overlap with the per-user maintenance that also runs when someone opens the app.
4. **Private storage** for encrypted receipts: `STORAGE_DIR` must be a persistent volume that is never served publicly. On serverless hosts, swap `src/lib/storage.ts` for an object store (S3, R2 or GCS) and keep the same encrypt-before-write approach.

## Steps

```bash
npm ci
npx prisma migrate deploy
npm run build
npm start                    # PORT defaults to 3000
npm run worker               # or configure /api/cron
```

`GET /api/health` returns `{ ok: true }` once the database is reachable. Use it for load-balancer and container health checks.

## Environment

Copy `.env.example` and set these in your host's secret manager. Never commit `.env`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Add `?sslmode=require` for managed databases |
| `AUTH_SECRET` | yes | 32+ random bytes, base64 |
| `AUTH_URL` | behind proxies | Public URL, e.g. `https://finora.example.com` |
| `ENCRYPTION_KEY` | yes | 64 hex characters (AES-256-GCM key for receipts). Rotating it makes existing receipts unreadable. |
| `STORAGE_DIR` | yes | Persistent, private path |
| `CRON_SECRET` | if using `/api/cron` | Long random string |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL` | optional | AI stays off for each user until they consent |
| `FX_PROVIDER`, `FX_API_URL` | optional | `frankfurter` (default) or `none` |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Email notifications |
| `RATE_LIMIT_SCALE` | optional | Keep at `1` in production |
| `WORKER_INTERVAL_MINUTES` | optional | Default 15 |

## Security summary

- **Authentication:** Auth.js credentials sign-in with bcrypt (cost 12), 7-day JWT sessions, rate limiting per IP and per email, a 15-minute lockout after repeated failures, and timing-equalized responses for unknown emails.
- **Authorization:** every query and mutation is scoped by the signed-in user's id on the server. Ownership is checked for every referenced account, category and receipt. API routes return 401 or 404 and never reveal whether another user's records exist.
- **Validation:** Zod on every server action, amount and date parsing with explicit formats, a ReDoS guard on regex rules, and protection against CSV/XLSX formula injection on export.
- **Headers:** CSP, HSTS, `X-Frame-Options: DENY`, `nosniff` and a referrer policy (see `next.config.ts`). Receipts are served with a sandboxed CSP.
- **Receipts:** file type is checked from the bytes, files are encrypted with AES-256-GCM before being written, and they're only served after an ownership check.
- **Audit log:** sign-ins, edits, deletions, imports, exports, consent changes and settings changes. Retention is configurable per user.
- **Data rights:** a full JSON export, and account deletion that cascades through every table and removes stored files.
- **Never stored:** bank passwords and card security codes. No bank provider is bundled, and the app never claims a bank connection exists.

### Before going live

- Swap the in-memory rate limiter (`src/lib/rate-limit.ts`) for a shared store such as Redis or Upstash if you run more than one instance.
- Put the app behind HTTPS (HSTS is already sent).
- Turn on database backups and point-in-time recovery.
- Set up an email provider if you want email alerts.

## Household sharing

Household sharing is optional and off by default. An owner creates a household, adds existing users as viewers or editors, and shares individual accounts. Members see only the shared accounts' balances and that month's totals. Every other record stays private to its owner.

## Tests in CI

```bash
docker compose up -d && npx prisma migrate deploy
npm test                           # unit + integration (uses DATABASE_URL)
npm run build && npx playwright install --with-deps chromium && npm run test:e2e
```

Integration and end-to-end tests create their own throwaway users. Point `DATABASE_URL` at a dedicated test database in CI.
