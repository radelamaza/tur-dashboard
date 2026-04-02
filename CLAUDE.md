# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Start dev server with nodemon (auto-reload)
npm start      # Start production server
node setup.js  # Print Google Apps Script code for sheet cleanup
```

There are no tests or linting configured.

## Architecture

**Tur Dashboard** is a real-time sales dashboard for Tur.com's Latin American operations. It is a Node.js/Express + Socket.IO app that reads sales data from a Google Sheets CSV export and broadcasts updates to browser clients via WebSocket.

### Data flow

1. `src/dataFetcher.js` fetches the Google Sheet as CSV every `DATA_REFRESH_INTERVAL` minutes, parses it with PapaParse, and filters only rows where the sale date matches the current Chilean day (UTC-3).
2. `src/server.js` calls the fetcher, computes analytics (revenue totals, product breakdown, country breakdown, hourly chart data), and emits an `update` event over Socket.IO to all connected clients.
3. `public/dashboard.js` receives the Socket.IO event and re-renders Chart.js charts and DOM elements.
4. At end-of-day, `src/sheetCleaner.js` saves a daily summary to SQLite and resets the working data.

### Key modules

| File | Role |
|------|------|
| `src/server.js` | Express app, Socket.IO server, all API route definitions, scheduler |
| `src/dataFetcher.js` | Google Sheets CSV fetch & parse, Chilean timezone filtering |
| `src/database.js` | SQLite manager for `daily_summaries` and `records` (historical milestones) |
| `src/userDatabase.js` | SQLite manager for `users` and `password_tokens` |
| `src/auth.js` | Login/logout routes, session middleware, admin guards |
| `src/sheetCleaner.js` | End-of-day snapshot logic |
| `public/dashboard.js` | Client-side Socket.IO listener + Chart.js rendering |

### Authentication & roles

- Session-based auth (`express-session`). All `/api/*` routes except `/api/auth/*` require an active session.
- Two roles: `admin` and `viewer`. Admin-only routes live under `/api/admin/*`.
- New users are invited by an admin; a password-reset token (48 h TTL) is emailed via Nodemailer. The token flow lives in `src/auth.js` and `public/set-password.html`.

### Databases

Two SQLite files are created on startup in the project root:
- **`sales.db`** (or `sales_history.db`) — `daily_summaries`, `records`, `countries_mapping`
- Same file (or separate) — `users`, `password_tokens`

### Environment variables

Copy `.env.example` to `.env`. Key variables:

```
GOOGLE_SHEETS_ID      # Spreadsheet ID to fetch as CSV
PORT                  # Default 3000
APP_URL               # Full URL used in invite emails
SESSION_SECRET
DATA_REFRESH_INTERVAL # Minutes between fetches (default 5)
EMAIL_HOST / EMAIL_PORT / EMAIL_USER / EMAIL_PASS / EMAIL_FROM
ADMIN_EMAIL           # Email for the initial admin account
DB_PATH               # SQLite file path
```

### Deployment

Deployed on Railway (`railway.toml`). The Dockerfile uses Node 18 Alpine on port 3000. IPv4 is forced for SMTP (`family: 4`) due to Railway's network constraints.
