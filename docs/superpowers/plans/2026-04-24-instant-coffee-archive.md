# Instant Coffee Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browsable, searchable static archive of the ic-vancouver Instant Coffee mailing list, with full-email pages and individual event listing breakout pages, rendered close to the original plain text formatting.

**Architecture:** Gmail API exports emails as JSON to `data/raw/` → Node.js parser splits each email into structured email + listing markdown files → Astro reads content collections and generates static pages → Pagefind adds client-side full-text search → deployed to GitHub Pages.

**Tech Stack:** Node.js 20, Astro 6, Pagefind 1.5, `googleapis` + `@google-cloud/local-auth` for Gmail export, GitHub Pages for hosting.

---

## File Structure

```
instant-coffee/
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Pages deploy workflow
├── package.json
├── astro.config.mjs
├── tsconfig.json
├── scripts/
│   ├── auth.mjs                    # Gmail OAuth helper (reusable)
│   ├── export-gmail.mjs            # Fetches all ic-vancouver emails → data/raw/
│   ├── parse-emails.mjs            # Parses raw JSON → content collection .md files
│   ├── credentials.json            # (gitignored) Google OAuth client credentials
│   └── token.json                  # (gitignored) Saved OAuth refresh token
├── data/
│   └── raw/                        # (gitignored) One JSON file per Gmail message
├── src/
│   ├── content.config.ts           # Astro content collection schemas
│   ├── content/
│   │   ├── emails/                 # Generated: one .md per email
│   │   └── listings/               # Generated: one .md per event listing
│   ├── layouts/
│   │   └── Base.astro              # Shared HTML shell
│   ├── components/
│   │   ├── EmailCard.astro         # Email summary card for list view
│   │   ├── ListingCard.astro       # Listing summary for email detail page
│   │   └── Search.astro            # Pagefind search widget
│   ├── pages/
│   │   ├── index.astro             # Homepage: search + email list (reverse chron)
│   │   ├── emails/
│   │   │   └── [...slug].astro     # Individual email page
│   │   └── listings/
│   │       └── [...slug].astro     # Individual listing page
│   └── styles/
│       └── global.css              # Minimal plain-text-inspired styling
├── tests/
│   ├── parse-emails.test.mjs       # Parser unit tests
│   └── fixtures/
│       └── sample-email.json       # Sample raw Gmail API response for testing
└── public/
    └── favicon.svg
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `astro.config.mjs`, `tsconfig.json`, `src/pages/index.astro`, `src/layouts/Base.astro`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/alannascott/code/instant-coffee
git init
```

- [ ] **Step 2: Create .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
.astro/
data/raw/
scripts/credentials.json
scripts/token.json
.DS_Store
```

- [ ] **Step 3: Initialize Astro project**

```bash
npm create astro@latest -- . --template minimal --no-install --typescript strict
```

If the interactive prompt blocks, create manually:

Create `package.json`:
```json
{
  "name": "instant-coffee-archive",
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "export": "node scripts/export-gmail.mjs",
    "parse": "node scripts/parse-emails.mjs"
  },
  "dependencies": {
    "astro": "^6.1.9"
  }
}
```

Create `astro.config.mjs`:
```javascript
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://<github-username>.github.io',
  base: '/instant-coffee',
  output: 'static',
});
```

Create `tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict"
}
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
npm install googleapis @google-cloud/local-auth
npm install -D vitest
```

- [ ] **Step 5: Create placeholder index page**

Create `src/layouts/Base.astro`:
```astro
---
interface Props {
  title: string;
}
const { title } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title} | Instant Coffee Archive</title>
    <link rel="stylesheet" href="/instant-coffee/styles/global.css" />
  </head>
  <body>
    <header>
      <nav>
        <a href="/instant-coffee/">Instant Coffee Archive</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer>
      <p>:ic: = (instant coffee loves everyone)</p>
    </footer>
  </body>
</html>
```

Create `src/pages/index.astro`:
```astro
---
import Base from '../layouts/Base.astro';
---
<Base title="Home">
  <h1>Instant Coffee Archive</h1>
  <p>ic-vancouver mailing list archive</p>
</Base>
```

- [ ] **Step 6: Verify dev server starts**

```bash
npm run dev
```
Expected: Astro dev server starts, page renders at localhost:4321.
Kill the server after verifying.

- [ ] **Step 7: Create data and test directories**

```bash
mkdir -p data/raw tests/fixtures src/content/emails src/content/listings src/styles src/components
```

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "scaffold: astro project with gmail export deps"
```

---

## Task 2: Gmail API Auth & Export Script

**Files:**
- Create: `scripts/auth.mjs`, `scripts/export-gmail.mjs`

**Prerequisites (manual steps — must complete before running export):**

1. Go to https://console.cloud.google.com/ and create a new project (e.g. "instant-coffee-archive")
2. Enable the Gmail API: APIs & Services → Library → search "Gmail API" → Enable
3. Configure OAuth consent screen: APIs & Services → OAuth consent screen → External → fill in app name ("IC Archive"), your email, save
4. Create credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID → Desktop app → Download JSON
5. Save the downloaded JSON as `scripts/credentials.json`

- [ ] **Step 1: Write auth helper module**

Create `scripts/auth.mjs`:
```javascript
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export async function authorize() {
  // Try saved token first
  if (existsSync(TOKEN_PATH)) {
    const content = await readFile(TOKEN_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  }

  // No token — run browser-based OAuth flow
  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  // Save token for future runs
  const keys = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf-8'));
  const key = keys.installed || keys.web;
  await writeFile(TOKEN_PATH, JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  }));

  return client;
}
```

- [ ] **Step 2: Write export script**

Create `scripts/export-gmail.mjs`:
```javascript
import { google } from 'googleapis';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { authorize } from './auth.mjs';

const RAW_DIR = path.join(process.cwd(), 'data/raw');
const QUERY = 'list:ic-vancouver@instantcoffee.org';

async function listAllMessages(gmail) {
  const messages = [];
  let pageToken = undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: QUERY,
      maxResults: 100,
      pageToken,
    });
    if (res.data.messages) {
      messages.push(...res.data.messages);
    }
    pageToken = res.data.nextPageToken;
    process.stdout.write(`\rFound ${messages.length} messages...`);
  } while (pageToken);

  console.log(`\nTotal: ${messages.length} messages`);
  return messages;
}

async function fetchAndSave(gmail, messageId) {
  const outPath = path.join(RAW_DIR, `${messageId}.json`);
  if (existsSync(outPath)) {
    return false; // Already exported, skip
  }

  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  await writeFile(outPath, JSON.stringify(res.data, null, 2));
  return true;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Authenticating...');
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  console.log(`Searching: ${QUERY}`);
  const messages = await listAllMessages(gmail);

  if (dryRun) {
    console.log('Dry run — not fetching message bodies.');
    return;
  }

  await mkdir(RAW_DIR, { recursive: true });

  let fetched = 0;
  let skipped = 0;
  for (const msg of messages) {
    const isNew = await fetchAndSave(gmail, msg.id);
    if (isNew) fetched++;
    else skipped++;
    process.stdout.write(`\rFetched: ${fetched}  Skipped: ${skipped}`);
  }
  console.log('\nExport complete.');
}

main().catch(console.error);
```

- [ ] **Step 3: Test auth with dry run**

```bash
node scripts/export-gmail.mjs --dry-run
```
Expected: Opens browser for Google consent (first run), then prints message count.
This verifies credentials are set up correctly without fetching all data.

- [ ] **Step 4: Run full export**

```bash
node scripts/export-gmail.mjs
```
Expected: Fetches all messages into `data/raw/`. Skips already-exported messages on re-run.
Note the total count — this informs how many emails the archive will contain.

- [ ] **Step 5: Commit**

```bash
git add scripts/auth.mjs scripts/export-gmail.mjs
git commit -m "feat: gmail export script for ic-vancouver emails"
```

---

## Task 3: Email Parser (TDD)

**Files:**
- Create: `tests/fixtures/sample-email.json`, `tests/parse-emails.test.mjs`, `scripts/parse-emails.mjs`

- [ ] **Step 1: Create test fixture from real data**

After export completes, pick one raw JSON file and copy it as the test fixture:

```bash
# Pick the first file in data/raw/
SAMPLE=$(ls data/raw/ | head -1)
cp "data/raw/$SAMPLE" tests/fixtures/sample-email.json
```

If export hasn't run yet, create a synthetic fixture. Use this minimal structure based on the Gmail API response format:

Create `tests/fixtures/sample-email.json`:
```json
{
  "id": "test123",
  "threadId": "thread123",
  "labelIds": ["INBOX"],
  "snippet": "instant coffee listings",
  "internalDate": "1736726400000",
  "payload": {
    "mimeType": "multipart/alternative",
    "headers": [
      { "name": "Subject", "value": "(ic-vancouver) INSTANT COFFEE: Friendly Reminder" },
      { "name": "From", "value": "ic-vancouver <vancouver@instantcoffee.org>" },
      { "name": "Date", "value": "Mon, 12 Jan 2026 19:40:00 -0800" },
      { "name": "To", "value": "ascott@eciad.ca" }
    ],
    "parts": [
      {
        "mimeType": "text/plain",
        "body": {
          "data": ""
        }
      }
    ]
  }
}
```

The `body.data` field needs to be base64url-encoded email text. Generate it:

```bash
node -e "
const text = \`instant coffee listings / send us your art posts for free

----------------------------------------------------------------------
01. CALL | 778-825-0778 | Voicemail Art Thingy | Till eternity or bankruptcy
----------------------------------------------------------------------
People who have already called 778-825-0778 say that it is by far the best voicemail art
thingy they've ever etc. etc.

To learn more, please call 778-825-0778.

----------------------------------------------------------------------
02. EXHIBITION | Western Front | Nina Davies - Image Syncers | JAN 10
----------------------------------------------------------------------
Join us for the opening reception of Image Syncers, a solo exhibition by Canadian-British
artist Nina Davies.

To learn more, visit https://westernfront.ca/events/image-syncers

----------------------------------------------------------------------
03. OPENING | Wil Aballe | CATHY BUSBY & GARRY NEILL KENNEDY | 6PM | JAN 15
----------------------------------------------------------------------
CATHY BUSBY & GARRY NEILL KENNEDY
UH-HUH/SORRY

Opening reception: Thurs, Jan 15, 6-8PM
Exhibition: Jan 15 - Feb 28, 2026

Wil Aballe
1375 Railspur Alley, Vancouver, BC

----------------------------------------------------------------------
instant coffee: Friendly Reminder
----------------------------------------------------------------------
Email vancouver@instantcoffee.org to post announcements to the list

:ic: = (instant coffee loves everyone)
\`;
process.stdout.write(Buffer.from(text).toString('base64url'));
" > /tmp/ic-body.txt
```

Then insert the base64url string into the fixture's `parts[0].body.data` field.

- [ ] **Step 2: Write parser tests**

Create `tests/parse-emails.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { extractBody, extractMetadata, parseListings, slugify } from '../scripts/parse-emails.mjs';
import { readFile } from 'fs/promises';
import path from 'path';

const fixture = JSON.parse(
  await readFile(path.join(import.meta.dirname, 'fixtures/sample-email.json'), 'utf-8')
);

describe('extractBody', () => {
  it('extracts plain text from multipart message', () => {
    const body = extractBody(fixture.payload);
    expect(body).toContain('instant coffee listings');
  });
});

describe('extractMetadata', () => {
  it('extracts subject, date, and from headers', () => {
    const meta = extractMetadata(fixture);
    expect(meta.subject).toContain('INSTANT COFFEE');
    expect(meta.from).toContain('instantcoffee.org');
    expect(meta.date).toBeTruthy();
    expect(meta.gmailId).toBe('test123');
  });
});

describe('parseListings', () => {
  it('splits email body into numbered listings', () => {
    const body = extractBody(fixture.payload);
    const listings = parseListings(body);
    expect(listings.length).toBe(3);
  });

  it('extracts listing number and type', () => {
    const body = extractBody(fixture.payload);
    const listings = parseListings(body);
    expect(listings[0].number).toBe(1);
    expect(listings[0].type).toBe('CALL');
    expect(listings[1].number).toBe(2);
    expect(listings[1].type).toBe('EXHIBITION');
  });

  it('extracts listing summary from header line', () => {
    const body = extractBody(fixture.payload);
    const listings = parseListings(body);
    expect(listings[0].summary).toContain('Voicemail Art Thingy');
    expect(listings[1].summary).toContain('Western Front');
  });

  it('extracts listing body text', () => {
    const body = extractBody(fixture.payload);
    const listings = parseListings(body);
    expect(listings[0].body).toContain('778-825-0778');
    expect(listings[1].body).toContain('opening reception');
  });

  it('excludes footer from listings', () => {
    const body = extractBody(fixture.payload);
    const listings = parseListings(body);
    const allBodies = listings.map(l => l.body).join('\n');
    expect(allBodies).not.toContain(':ic: = (instant coffee loves everyone)');
  });
});

describe('slugify', () => {
  it('converts title to url-safe slug', () => {
    expect(slugify('INSTANT COFFEE: Friendly Reminder')).toBe('instant-coffee-friendly-reminder');
  });

  it('strips parenthetical prefix', () => {
    expect(slugify('(ic-vancouver) INSTANT COFFEE: Test')).toBe('instant-coffee-test');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/parse-emails.test.mjs
```
Expected: FAIL — `parse-emails.mjs` doesn't exist yet.

- [ ] **Step 4: Implement parser**

Create `scripts/parse-emails.mjs`:
```javascript
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import path from 'path';

// --- Exported helpers (used by tests) ---

export function extractBody(payload) {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result;
    }
  }
  return null;
}

export function extractMetadata(message) {
  const headers = message.payload.headers || [];
  const getHeader = (name) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  return {
    gmailId: message.id,
    subject: getHeader('Subject'),
    from: getHeader('From'),
    date: getHeader('Date'),
    to: getHeader('To'),
    internalDate: message.internalDate,
  };
}

export function slugify(text) {
  return text
    .replace(/^\(ic-vancouver\)\s*/i, '')  // Strip list prefix
    .replace(/[^\w\s-]/g, '')              // Remove punctuation
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const SEPARATOR_RE = /^-{5,}$/;
const LISTING_HEADER_RE = /^(\d{1,2})\.\s+([A-Z]+)\s*\|\s*(.+)$/;
const FOOTER_MARKERS = [
  'instant coffee:',
  'Email vancouver@instantcoffee.org to post',
  ':ic: = (instant coffee loves everyone)',
  'Visit http://lists.instantcoffee.org',
  'IC TORONTO:IC HALIFAX:IC VANCOUVER',
  'Posts to these lists are FREE',
  'Instant Coffee is a project',
  'Instant Coffee is an artist collective',
  'Lists are volunteer-run',
];

function isFooterLine(line) {
  const trimmed = line.trim();
  return FOOTER_MARKERS.some((marker) => trimmed.startsWith(marker));
}

export function parseListings(body) {
  const lines = body.split('\n');
  const listings = [];
  let current = null;
  let inFooter = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Detect footer — stop parsing listings
    if (isFooterLine(trimmed)) {
      inFooter = true;
    }
    if (inFooter) continue;

    // Skip separator lines
    if (SEPARATOR_RE.test(trimmed)) continue;

    // Check for listing header
    const match = trimmed.match(LISTING_HEADER_RE);
    if (match) {
      if (current) listings.push(current);
      const [, numStr, type, rest] = match;
      current = {
        number: parseInt(numStr, 10),
        type,
        summary: rest.trim(),
        bodyLines: [],
      };
      continue;
    }

    // Accumulate body lines for current listing
    if (current) {
      current.bodyLines.push(lines[i]);
    }
  }

  if (current) listings.push(current);

  // Trim leading/trailing blank lines from each listing body
  return listings.map((l) => ({
    number: l.number,
    type: l.type,
    summary: l.summary,
    body: l.bodyLines.join('\n').trim(),
  }));
}

// --- Content generation ---

function escapeYaml(str) {
  if (/[:#\[\]{}|>&*!?,]/.test(str) || str.startsWith("'") || str.startsWith('"')) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `"${str}"`;
}

function emailDateSlug(dateStr, internalDate) {
  // Try parsing the Date header, fall back to internalDate (ms epoch)
  let d = new Date(dateStr);
  if (isNaN(d.getTime()) && internalDate) {
    d = new Date(parseInt(internalDate, 10));
  }
  if (isNaN(d.getTime())) return 'undated';
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function generateContent(rawDir, emailsDir, listingsDir) {
  await mkdir(emailsDir, { recursive: true });
  await mkdir(listingsDir, { recursive: true });

  const files = (await readdir(rawDir)).filter((f) => f.endsWith('.json'));
  console.log(`Processing ${files.length} raw email files...`);

  let totalListings = 0;

  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(rawDir, file), 'utf-8'));
    const meta = extractMetadata(raw);
    const body = extractBody(raw.payload);

    if (!body) {
      console.warn(`No plain text body in ${file}, skipping`);
      continue;
    }

    const dateSlug = emailDateSlug(meta.date, meta.internalDate);
    const subjectSlug = slugify(meta.subject);
    const emailSlug = `${dateSlug}-${subjectSlug}`.slice(0, 80);
    const listings = parseListings(body);

    // Write email markdown
    const emailFrontmatter = [
      '---',
      `subject: ${escapeYaml(meta.subject)}`,
      `date: ${escapeYaml(meta.date)}`,
      `dateSlug: ${escapeYaml(dateSlug)}`,
      `from: ${escapeYaml(meta.from)}`,
      `gmailId: ${escapeYaml(meta.gmailId)}`,
      `listingCount: ${listings.length}`,
      '---',
    ].join('\n');

    await writeFile(
      path.join(emailsDir, `${emailSlug}.md`),
      `${emailFrontmatter}\n\n${body}`
    );

    // Write listing markdown files
    for (const listing of listings) {
      const listingSlug = `${dateSlug}-${String(listing.number).padStart(2, '0')}-${slugify(listing.summary).slice(0, 60)}`;
      const listingFrontmatter = [
        '---',
        `emailSlug: ${escapeYaml(emailSlug)}`,
        `emailSubject: ${escapeYaml(meta.subject)}`,
        `emailDate: ${escapeYaml(meta.date)}`,
        `number: ${listing.number}`,
        `type: ${escapeYaml(listing.type)}`,
        `summary: ${escapeYaml(listing.summary)}`,
        '---',
      ].join('\n');

      await writeFile(
        path.join(listingsDir, `${listingSlug}.md`),
        `${listingFrontmatter}\n\n${listing.body}`
      );
    }

    totalListings += listings.length;
  }

  console.log(`Generated ${files.length} email pages and ${totalListings} listing pages.`);
}

// --- CLI entry point ---
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain || process.argv[1]?.endsWith('parse-emails.mjs')) {
  const rawDir = path.join(process.cwd(), 'data/raw');
  const emailsDir = path.join(process.cwd(), 'src/content/emails');
  const listingsDir = path.join(process.cwd(), 'src/content/listings');
  generateContent(rawDir, emailsDir, listingsDir).catch(console.error);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/parse-emails.test.mjs
```
Expected: All tests PASS.

- [ ] **Step 6: Add vitest config**

Add to `package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 7: Run parser on real exported data**

```bash
npm run parse
```
Expected: Generates `.md` files in `src/content/emails/` and `src/content/listings/`.
Verify a few files look correct:
```bash
ls src/content/emails/ | head -5
ls src/content/listings/ | head -10
head -20 src/content/emails/*.md | head -40
```

- [ ] **Step 8: Commit**

```bash
git add scripts/parse-emails.mjs tests/
git commit -m "feat: email parser with TDD — splits emails into listings"
```

---

## Task 4: Astro Content Collections & Layout

**Files:**
- Create: `src/content.config.ts`, `src/styles/global.css`
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: Define content collection schemas**

Create `src/content.config.ts`:
```typescript
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const emails = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/emails' }),
  schema: z.object({
    subject: z.string(),
    date: z.string(),
    dateSlug: z.string(),
    from: z.string(),
    gmailId: z.string(),
    listingCount: z.number(),
  }),
});

const listings = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/listings' }),
  schema: z.object({
    emailSlug: z.string(),
    emailSubject: z.string(),
    emailDate: z.string(),
    number: z.number(),
    type: z.string(),
    summary: z.string(),
  }),
});

export const collections = { emails, listings };
```

- [ ] **Step 2: Create global styles**

Create `src/styles/global.css`:
```css
:root {
  --max-width: 720px;
  --font-mono: 'Courier New', Courier, monospace;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --color-bg: #ffffff;
  --color-text: #1a1a1a;
  --color-muted: #666666;
  --color-border: #dddddd;
  --color-link: #0055aa;
  --color-tag-bg: #f0f0f0;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-body);
  color: var(--color-text);
  background: var(--color-bg);
  line-height: 1.6;
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 1rem;
}

header {
  border-bottom: 2px solid var(--color-text);
  padding-bottom: 0.5rem;
  margin-bottom: 2rem;
}

header nav a {
  font-weight: bold;
  text-decoration: none;
  color: var(--color-text);
  font-size: 1.1rem;
}

main { min-height: 60vh; }

footer {
  border-top: 1px solid var(--color-border);
  margin-top: 3rem;
  padding-top: 1rem;
  color: var(--color-muted);
  font-size: 0.85rem;
}

a { color: var(--color-link); }

/* Email body — preserve original plain text formatting */
.email-body {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.5;
}

.listing-body {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.5;
}

/* Type badges */
.type-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: bold;
  padding: 0.15em 0.5em;
  background: var(--color-tag-bg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Card list */
.email-list, .listing-list {
  list-style: none;
}

.email-list li, .listing-list li {
  border-bottom: 1px solid var(--color-border);
  padding: 0.75rem 0;
}

.email-list a, .listing-list a {
  text-decoration: none;
  color: var(--color-text);
  display: block;
}

.email-list a:hover, .listing-list a:hover {
  background: #f8f8f8;
}

.email-date, .listing-meta {
  font-size: 0.8rem;
  color: var(--color-muted);
}

.back-link {
  display: inline-block;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

h1 { font-size: 1.4rem; margin-bottom: 1rem; }
h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
```

- [ ] **Step 3: Verify build works with content collections**

```bash
npm run build
```
Expected: Build succeeds. If content directories are empty (no exported data yet), create at least one placeholder `.md` file in each to verify schemas work:

Create `src/content/emails/_placeholder.md`:
```markdown
---
subject: "Test Email"
date: "Mon, 1 Jan 2026 00:00:00 -0800"
dateSlug: "2026-01-01"
from: "test@example.com"
gmailId: "placeholder"
listingCount: 0
---

Placeholder content.
```

Create `src/content/listings/_placeholder.md`:
```markdown
---
emailSlug: "2026-01-01-test-email"
emailSubject: "Test Email"
emailDate: "Mon, 1 Jan 2026 00:00:00 -0800"
number: 1
type: "TEST"
summary: "Test Venue | Test Event"
---

Placeholder listing content.
```

Run build again. Delete placeholders once real data exists.

- [ ] **Step 4: Commit**

```bash
git add src/content.config.ts src/styles/global.css
git commit -m "feat: content collection schemas and archive styling"
```

---

## Task 5: Email & Listing Pages

**Files:**
- Create: `src/components/EmailCard.astro`, `src/components/ListingCard.astro`, `src/pages/emails/[...slug].astro`, `src/pages/listings/[...slug].astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Create EmailCard component**

Create `src/components/EmailCard.astro`:
```astro
---
interface Props {
  slug: string;
  subject: string;
  date: string;
  listingCount: number;
}
const { slug, subject, date, listingCount } = Astro.props;

// Parse and format date
const d = new Date(date);
const formatted = isNaN(d.getTime()) ? date : d.toLocaleDateString('en-CA', {
  year: 'numeric', month: 'short', day: 'numeric'
});
---
<a href={`/instant-coffee/emails/${slug}`}>
  <strong>{subject.replace(/^\(ic-vancouver\)\s*/i, '')}</strong>
  <span class="email-date">{formatted} &middot; {listingCount} listing{listingCount !== 1 ? 's' : ''}</span>
</a>
```

- [ ] **Step 2: Create ListingCard component**

Create `src/components/ListingCard.astro`:
```astro
---
interface Props {
  slug: string;
  number: number;
  type: string;
  summary: string;
}
const { slug, number, type, summary } = Astro.props;
---
<a href={`/instant-coffee/listings/${slug}`}>
  <span class="type-badge">{type}</span>
  <span>{String(number).padStart(2, '0')}. {summary}</span>
</a>
```

- [ ] **Step 3: Build homepage — email list (reverse chronological)**

Modify `src/pages/index.astro`:
```astro
---
import { getCollection } from 'astro:content';
import Base from '../layouts/Base.astro';
import EmailCard from '../components/EmailCard.astro';

const emails = await getCollection('emails');

// Sort by date descending (newest first)
emails.sort((a, b) => {
  const da = new Date(a.data.date);
  const db = new Date(b.data.date);
  return db.getTime() - da.getTime();
});
---
<Base title="Home">
  <h1>Instant Coffee Archive</h1>
  <p>ic-vancouver mailing list &middot; {emails.length} emails</p>

  <div id="search" style="margin: 1.5rem 0;"></div>

  <ul class="email-list">
    {emails.map((email) => (
      <li>
        <EmailCard
          slug={email.id}
          subject={email.data.subject}
          date={email.data.date}
          listingCount={email.data.listingCount}
        />
      </li>
    ))}
  </ul>
</Base>
```

- [ ] **Step 4: Build email detail page**

Create `src/pages/emails/[...slug].astro`:
```astro
---
import { getCollection, render } from 'astro:content';
import Base from '../../layouts/Base.astro';
import ListingCard from '../../components/ListingCard.astro';

export async function getStaticPaths() {
  const emails = await getCollection('emails');
  return emails.map((email) => ({
    params: { slug: email.id },
    props: { email },
  }));
}

const { email } = Astro.props;
const { Content } = await render(email);

// Get listings for this email
const allListings = await getCollection('listings');
const listings = allListings
  .filter((l) => l.data.emailSlug === email.id)
  .sort((a, b) => a.data.number - b.data.number);

const d = new Date(email.data.date);
const formatted = isNaN(d.getTime()) ? email.data.date : d.toLocaleDateString('en-CA', {
  year: 'numeric', month: 'long', day: 'numeric'
});
---
<Base title={email.data.subject}>
  <a class="back-link" href="/instant-coffee/">&larr; All emails</a>

  <h1>{email.data.subject.replace(/^\(ic-vancouver\)\s*/i, '')}</h1>
  <p class="email-date">{formatted} &middot; from {email.data.from}</p>

  {listings.length > 0 && (
    <details open style="margin: 1.5rem 0;">
      <summary><strong>{listings.length} listing{listings.length !== 1 ? 's' : ''}</strong></summary>
      <ul class="listing-list">
        {listings.map((listing) => (
          <li>
            <ListingCard
              slug={listing.id}
              number={listing.data.number}
              type={listing.data.type}
              summary={listing.data.summary}
            />
          </li>
        ))}
      </ul>
    </details>
  )}

  <hr style="margin: 1.5rem 0;" />
  <div class="email-body">
    <Content />
  </div>
</Base>
```

- [ ] **Step 5: Build listing detail page**

Create `src/pages/listings/[...slug].astro`:
```astro
---
import { getCollection, render } from 'astro:content';
import Base from '../../layouts/Base.astro';

export async function getStaticPaths() {
  const listings = await getCollection('listings');
  return listings.map((listing) => ({
    params: { slug: listing.id },
    props: { listing },
  }));
}

const { listing } = Astro.props;
const { Content } = await render(listing);

const d = new Date(listing.data.emailDate);
const formatted = isNaN(d.getTime()) ? listing.data.emailDate : d.toLocaleDateString('en-CA', {
  year: 'numeric', month: 'short', day: 'numeric'
});
---
<Base title={`${listing.data.type}: ${listing.data.summary}`}>
  <a class="back-link" href={`/instant-coffee/emails/${listing.data.emailSlug}`}>
    &larr; {listing.data.emailSubject.replace(/^\(ic-vancouver\)\s*/i, '')}
  </a>

  <span class="type-badge">{listing.data.type}</span>
  <h1>{String(listing.data.number).padStart(2, '0')}. {listing.data.summary}</h1>
  <p class="listing-meta">From email dated {formatted}</p>

  <hr style="margin: 1.5rem 0;" />
  <div class="listing-body">
    <Content />
  </div>
</Base>
```

- [ ] **Step 6: Verify locally**

```bash
npm run dev
```
Check:
- Homepage lists all emails reverse-chronologically
- Clicking an email shows the full email with a listing index
- Clicking a listing shows the individual listing detail
- Back links navigate correctly

- [ ] **Step 7: Run build**

```bash
npm run build
```
Expected: Build completes, static output in `dist/`.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ src/components/
git commit -m "feat: email list, email detail, and listing detail pages"
```

---

## Task 6: Pagefind Search & GitHub Pages Deploy

**Files:**
- Create: `src/components/Search.astro`, `.github/workflows/deploy.yml`
- Modify: `src/pages/index.astro`, `package.json`, `astro.config.mjs`

- [ ] **Step 1: Install Pagefind**

```bash
npm install -D pagefind
```

Add post-build script to `package.json`:
```json
"scripts": {
  "build": "astro build && npx pagefind --site dist",
  "dev": "astro dev",
  "preview": "astro preview",
  "export": "node scripts/export-gmail.mjs",
  "parse": "node scripts/parse-emails.mjs",
  "test": "vitest run"
}
```

- [ ] **Step 2: Add Pagefind data attributes**

Pagefind indexes by default based on `<main>` content, which is already set up in Base.astro. Add `data-pagefind-body` to the main element for explicit control:

Modify `src/layouts/Base.astro` — change `<main>` to:
```html
<main data-pagefind-body>
```

On the listing detail page, add searchable metadata. Modify `src/pages/listings/[...slug].astro` — add after the `<h1>`:
```html
<span data-pagefind-meta="type">{listing.data.type}</span>
```

- [ ] **Step 3: Create search component**

Create `src/components/Search.astro`:
```astro
<div id="search"></div>

<link href="/instant-coffee/pagefind/pagefind-ui.css" rel="stylesheet" />

<script>
  import '/pagefind/pagefind-ui.js';

  window.addEventListener('DOMContentLoaded', () => {
    new PagefindUI({
      element: '#search',
      showSubResults: true,
      baseUrl: '/instant-coffee/',
    });
  });
</script>
```

- [ ] **Step 4: Add search to homepage**

Modify `src/pages/index.astro` — replace the `<div id="search"...>` placeholder with the component:

```astro
---
import { getCollection } from 'astro:content';
import Base from '../layouts/Base.astro';
import EmailCard from '../components/EmailCard.astro';
import Search from '../components/Search.astro';

const emails = await getCollection('emails');
emails.sort((a, b) => {
  const da = new Date(a.data.date);
  const db = new Date(b.data.date);
  return db.getTime() - da.getTime();
});
---
<Base title="Home">
  <h1>Instant Coffee Archive</h1>
  <p>ic-vancouver mailing list &middot; {emails.length} emails</p>

  <Search />

  <ul class="email-list">
    {emails.map((email) => (
      <li>
        <EmailCard
          slug={email.id}
          subject={email.data.subject}
          date={email.data.date}
          listingCount={email.data.listingCount}
        />
      </li>
    ))}
  </ul>
</Base>
```

- [ ] **Step 5: Build and verify search works**

```bash
npm run build
npm run preview
```
Expected: Search box appears on homepage. Typing an artist name, venue, or event type returns matching pages.

- [ ] **Step 6: Create GitHub Actions deploy workflow**

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 7: Update astro.config.mjs with correct GitHub username**

After creating the GitHub repo, update `astro.config.mjs`:
```javascript
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://<your-username>.github.io',
  base: '/instant-coffee',
  output: 'static',
});
```

Replace `<your-username>` with the actual GitHub username.

- [ ] **Step 8: Commit content and deploy config**

Note: Generated content files (`src/content/emails/`, `src/content/listings/`) should be committed so GitHub Pages can build without needing Gmail API access.

```bash
git add .
git commit -m "feat: pagefind search + github pages deploy"
```

- [ ] **Step 9: Create GitHub repo and push**

```bash
gh repo create instant-coffee --public --source=. --push
```

Then enable GitHub Pages in repo Settings → Pages → Source: GitHub Actions.

- [ ] **Step 10: Verify deployment**

After the action completes, visit `https://<username>.github.io/instant-coffee/` and verify:
- Homepage loads with email list and search
- Search finds events by name, venue, artist
- Email pages render with listing index
- Listing pages render with back-link to email

---

## Pipeline Summary (day-to-day workflow)

To refresh the archive with new emails:

```bash
npm run export    # Fetch new emails from Gmail (skips existing)
npm run parse     # Re-generate content from all raw data
npm run build     # Build static site with search index
git add . && git commit -m "update: new emails" && git push
```
