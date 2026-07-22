# Digital Logic Lab Companion

A class-only chatbot for Digital Logic Lab. It answers reference,
procedural, and safety questions directly, but **guides students through the
assessed derivation work (truth tables, simplifications, circuit/state designs)
instead of handing over finished answers** — see `SYSTEM_PROMPT.md` for how
that's enforced, and `server/system-prompt.txt` for the version the bot
actually runs on.

Students access it from a phone or laptop through a regular web page. No app
install required.

```
digital-logic-tutor/
├── public/              ← frontend (served as static files)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server/
│   ├── index.js         ← backend: calls the Claude API, checks passcode, rate-limits
│   ├── logger.js         ← writes each exchange to Google Sheets
│   └── system-prompt.txt← the prompt that controls bot behavior
├── SYSTEM_PROMPT.md      ← same prompt + notes on *why* it's written this way
├── package.json
└── .env.example
```

## 1. How it controls output

The frontend never talks to the Anthropic API directly. It only talks to the
own backend (`server/index.js`), which:

1. Checks a shared class passcode (`CLASS_PASSCODE`) so only your students can use it.
2. Applies a simple per-browser rate limit, so no one can loop the bot into
   grinding out an entire problem set, and to control your API costs.
3. Injects the system prompt on **every** request — this is what stops the bot
   from giving direct answers. The API key never reaches the browser, so
   students can't inspect or remove it.

The goal isn't to filter what a student types, and this app doesn't try to. All the
control lives in step 3.

## 2. Run it locally

Requirements: Node.js 18+.

```bash
cd digital-logic-tutor
npm install
cp .env.example .env
```

Edit `.env`:
- `ANTHROPIC_API_KEY` — from your Anthropic Console.
- `CLASS_PASSCODE` — pick something simple to say out loud in lecture, e.g. `logic-fall26`.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` — only
  needed if logging is enabled (see Section 5 below). Leave blank to run without logging.
- Leave the rest at their defaults to start.

```bash
npm start
```

Visit `http://localhost:3000`. It'll prompt for the passcode once per browser session.

## 3. Deploy it so students can reach it from anywhere

This is a small Node/Express app, so any of these work well.

### Render (simplest, recommended)
1. Push this folder to a GitHub repo (`.env` is gitignored — don't commit it).
2. On [render.com](https://render.com): **New → Web Service**, connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add `ANTHROPIC_API_KEY`, `CLASS_PASSCODE`, and
   optionally `ANTHROPIC_MODEL` / `RATE_LIMIT_MAX` — plus the three
   `GOOGLE_*` variables from Section 5 if you want logging enabled in production.
5. Deploy. Render gives you a URL like `digital-logic-tutor.onrender.com`
   That's what you share with students.

### Railway
Connect the repo, set the same environment variables in the
Railway dashboard, and it detects the Node app automatically.

### Your university's own server
If your department offers Node hosting, this runs the same way anywhere Node
18+ is available: `npm install && npm start`, with the environment variables
set however your school's system expects (a `.env` file or its own dashboard).

### Getting students in
- Share the URL (put it in a LMS, syllabus, or a QR code on a slide) and
  the passcode verbally in class or in a pinned course announcement.
- Because it's just a web page, it works identically on phones and laptops. There is
  no app store listing, no install step.

## 4. Tuning the bot's behavior over time

After the first week of real use:
1. Pull a few transcripts where students almost got a direct answer out of it.
2. Add those exact phrasings as new "bad response" examples in
   `server/system-prompt.txt`.
3. Redeploy. The few-shot examples are what keep this reliable, expect to
   revise them once or twice per term.

## 5. Conversation logging (Google Sheets)

Every exchange (browser client ID, student prompt, bot response, and
timestamp) is written to a Google Sheet in real time via `server/logger.js`.
This gives visibility into how students are actually using the bot, so you
can spot guardrail edge cases (see Section 4) and unusual usage patterns.

### Setup
1. In Google Cloud Console, create a project (or use an existing one) and
   enable the **Google Sheets API**.
2. Create a **service account**, generate a JSON key for it, and copy out:
   - the service account's client email
   - the private key
3. Create a Google Sheet to log to, and share it with the service account's
   client email (Editor access).
4. Copy the Sheet ID out of its URL (the long string between `/d/` and `/edit`).
5. Set these in `.env`:
   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   GOOGLE_SHEET_ID=your-sheet-id-here
   ```
   (Keep the private key's `\n` characters escaped — most hosts, including
   Render, need it as a single-line string exactly like this.)

### Notes
- Logging is best-effort: if the Sheets write fails, it's caught and logged
  server-side without blocking the student's response.
- Leaving the three `GOOGLE_*` variables blank disables logging entirely —
  the app runs fine without it.
- **Access control matters here**: whoever owns the Sheet, keep its sharing
  setting restricted (specific people, not "anyone with the link"), since it
  contains real student conversation data.
- For production, use a department-owned Google Cloud project and service
  account rather than a personal one, so log ownership and access sit with
  the institution, not an individual developer.

## 6. Prompt caching

The system prompt is marked as a cacheable block (`cache_control: { type: 'ephemeral' }`)
in `server/index.js`. Anthropic reuses the cached version of the system prompt across
requests instead of reprocessing it every time. Cache hits are billed at roughly 10% of
normal input pricing. Since the system prompt is identical on every message and this bot
will have near-continuous traffic during the school day, it stays "warm" almost
all the time class is in session.

To see the real savings, hit:

```
GET /api/cache-stats
```

This returns running totals of cache-read vs. cache-write vs. fresh tokens and a live
cache hit rate.

## 7. Cost and limits recap

- `RATE_LIMIT_MAX` (default 60 messages/hour per browser) is there to protect
  both the API budget and against someone trying to brute-force the bot into
  a full solution through sheer message volume.
- `MAX_HISTORY_TURNS` in `server/index.js` trims very long conversations
  before they're sent to the API, since token usage (and cost) grows with
  conversation length.
- Model pricing and current rate limits change — check
  [the Claude API pricing page](https://docs.claude.com/en/docs/about-claude/pricing)
