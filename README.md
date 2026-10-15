# Finora

A personal finance app for tracking accounts, transactions, budgets, subscriptions, bills, savings goals, debts and net worth, with reports, a cash-flow forecast and an assistant that answers from your own data.

Built with Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, Radix/shadcn-style components, Recharts, Prisma 6 and PostgreSQL, with Auth.js for sign-in.

## Quick start

Requirements: Node.js 20+ (22 recommended) and Docker (or any PostgreSQL 14+).

```bash
# 1. Database
docker volume create finora-pgdata
docker compose up -d

# 2. Configuration
cp .env.example .env
# Fill in AUTH_SECRET, ENCRYPTION_KEY and CRON_SECRET (generation commands are in the file)

# 3. Install, migrate, seed
npm install
npx prisma migrate deploy
npm run db:seed            # optional demo account, see below

# 4. Run
npm run dev                # http://localhost:3000
npm run worker             # background jobs, in a second terminal
```

### Demo account

`npm run db:seed` creates a separate user, **demo@finora.app / FinoraDemo2026**, with six months of synthetic data in INR. Every demo account and transaction is flagged as sample data and shows a "sample" badge. The seed never touches other users, and new accounts start empty. Sample data can be removed under **Settings → Your data**.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run worker` | Background worker (a pass every `WORKER_INTERVAL_MINUTES`, default 15) |
| `npm run worker:once` | One worker pass, then exit (for cron / scheduled tasks) |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Create or refresh the demo user |
| `npm test` | Unit and integration tests (Vitest; needs the database) |
| `npm run test:e2e` | End-to-end tests (Playwright; builds must exist: run `npm run build` first) |
| `npm run typecheck` | TypeScript check |

First-time Playwright setup: `npx playwright install chromium`.

## Features

- **Overview**: available balance, income, net spending, net cash flow, savings rate, net worth, liabilities, budget use, comparison with the same point last period, cash-flow chart, spending by category, budgets, insights, unusual-spending alerts, bills, goals, subscriptions, accounts and an activity timeline. Widgets can be reordered or hidden, and every period preset plus custom ranges are supported.
- **Transactions**: create, edit (with undo), duplicate and delete (with undo); search, filters, sorting and pagination; bulk categorize, tag, move, status and delete; splits; refunds, reimbursements and adjustments; tags, notes and receipts; possible-duplicate detection; keyboard quick-add (`N`).
- **Accounts**: cash, checking, savings, cards, wallets, investments, loans and custom accounts. Balances are calculated from transactions, with reconciliation and manual balance updates (both recorded as auditable adjustments).
- **Categories**: defaults plus custom categories and subcategories, icons, colours, monthly targets and an essential flag. Categorization runs rules (with a preview before applying), then learned merchants (only after you approve), then your history, then optional AI suggestions with a confidence score.
- **Budgets**: by category (including subcategories), account, merchant or overall spending; fixed, zero-based, envelope, percentage-of-income and rollover methods; weekly, monthly or custom periods. Each budget shows its daily allowance, forecast and alert thresholds, and you can override a single period.
- **Subscriptions**: tracking, detection of recurring charges (you confirm before anything is added), price-change detection, monthly and annual totals, and trends.
- **Bills & recurring**: due dates, reminders, a calendar, mark-as-paid (which records the payment; Finora never pays anything), late indicators, recurring income such as salary (auto-recorded or expected), and expected-vs-received income.
- **Savings goals**: progress from a linked account's real balance or from manual contributions, projected completion, the monthly amount needed, and a contribution simulator.
- **Debts**: payment history, and avalanche, snowball and custom-order payoff comparisons, all clearly labelled as estimates. Unknown interest rates are flagged.
- **Net worth**: actual account balances kept separate from estimated asset values, liabilities without double counting, monthly history and a monthly report.
- **Reports**: cash flow, categories with drill-down to transactions, merchants, weekly and year-over-year trends, essential vs discretionary, recurring vs one-off, income sources, an income forecast from your own assumptions, budget adherence and debt progress. Export as PDF, CSV or XLSX.
- **Forecast**: 30, 60 or 90 days built from schedules plus typical spending, with toggleable sources, your own adjustments, shortfall warnings and the assumptions listed.
- **Import & export**: CSV, XLSX and OFX/QFX files, with column mapping, date and number-format detection, duplicate detection, category mapping, preview, error reports, import history and rollback. Nothing is imported while rows are invalid unless you choose to skip them. A CSV template and a full JSON export are included.
- **Receipts**: encrypted upload; optional OCR whose results land in an editable form; linking a receipt to a transaction.
- **Assistant**: read-only tools that compute figures in the database. Every answer shows its period, currency and calculation. Without an AI provider (or without your consent) it runs an offline mode that answers common questions from templates.
- **Notifications**: budget thresholds, unusual spending, bills, renewals, low balance, missing income, goal milestones and duplicates. Shown in the app, with optional email and quiet hours.
- **Settings**: preferences, theme, notifications, manual exchange rates, AI consent, password change, an activity log, retention, data export, account deletion, integration status and optional household sharing.

## How amounts are calculated

- Money is stored as `Decimal(19,4)` and calculated with decimal.js. Floating-point numbers are never used for totals.
- Each transaction's `amount` is signed from its account's point of view. **Transfers** and **adjustments** never count as income or spending. **Refunds, reimbursements and chargebacks** reduce spending in their category instead of counting as income.
- Every transaction stores its amount converted to your base currency, along with the rate, rate date and source. When no rate is available the conversion is left empty, the transaction is excluded from totals, and a warning is shown.
- Date ranges follow your time zone, including daylight-saving changes.

## Optional integrations

| Integration | Configure with | Without it |
| --- | --- | --- |
| AI (assistant, categorization, receipt OCR) | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-opus-5-5`) | Offline assistant only; no OCR or AI categories |
| Exchange rates | `FX_PROVIDER=frankfurter` (ECB reference rates, no key needed) | Manual rates only |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | In-app notifications only |
| Bank sync | Not bundled | Manual entry, import and reconciliation |

Even when an AI provider is configured, nothing is sent to it until the user turns AI on under **Settings → Privacy**. That screen lists exactly what is shared.

## Project layout

```
prisma/              schema, migrations, seed
src/app/             routes: (auth), (app) pages, api/ handlers
src/components/      ui/ primitives, shell, charts, feature views
src/lib/             money, dates, fx, auth, storage, validators
src/lib/finance/     pure calculation modules (tested in isolation)
src/server/          services, queries, server actions, AI tools
worker/              background worker entry point
tests/               unit/, integration/, e2e/
scripts/qa/          screenshot helpers for visual QA
```

Deployment, security and operations are covered in [DEPLOYMENT.md](DEPLOYMENT.md).
