# Archive Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix parser bugs (duplicates, encoding, stale types), add venue extraction, year-based homepage navigation, and fix listing display issues.

**Architecture:** Parser changes (clean output dirs, fix encoding, extract venue) happen first, then frontend changes (listing page fixes, year nav), then full re-parse + rebuild to verify everything together.

**Tech Stack:** Node.js 20+, Astro 6, Pagefind 1.5, vitest

**Important:** All commands must use Node 22: `source ~/.nvm/nvm.sh && nvm use 22 && <command>`

---

## File Structure

```
Modified files:
├── scripts/parse-emails.mjs          # Clean dirs, fix encoding, extract venue
├── tests/parse-emails.test.mjs       # Tests for new parser features
├── src/content.config.ts             # Add venue to listings schema
├── src/pages/index.astro             # Year navigation + filtered email list
├── src/pages/listings/[...slug].astro # Fix type badge, add venue metadata
├── src/styles/global.css             # Year nav styles
```

---

### Task 1: Parser Fixes (clean dirs, encoding, venue extraction)

**Files:**
- Modify: `scripts/parse-emails.mjs`
- Modify: `tests/parse-emails.test.mjs`

- [ ] **Step 1: Write test for fixEncoding**

Add to `tests/parse-emails.test.mjs`:

```javascript
import { extractBody, extractMetadata, parseListings, slugify, fixEncoding } from '../scripts/parse-emails.mjs';

// ... existing tests ...

describe('fixEncoding', () => {
  it('fixes double-encoded right single quote', () => {
    // â€™ is the mojibake for ' (U+2019)
    expect(fixEncoding('Vanderâ\u0080\u0099s work')).toBe('Vander\u2019s work');
  });

  it('fixes double-encoded em dash', () => {
    // â€" is mojibake for — (U+2014)
    expect(fixEncoding('Jan 15 â\u0080\u0094 Feb 28')).toBe('Jan 15 \u2014 Feb 28');
  });

  it('leaves clean ASCII text unchanged', () => {
    expect(fixEncoding('Hello world')).toBe('Hello world');
  });

  it('leaves correctly-encoded UTF-8 unchanged', () => {
    expect(fixEncoding('caf\u00e9')).toBe('caf\u00e9');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/parse-emails.test.mjs
```
Expected: FAIL — `fixEncoding` is not exported from parse-emails.mjs.

- [ ] **Step 3: Implement fixEncoding in parser**

Add to `scripts/parse-emails.mjs` after the `slugify` function (around line 49):

```javascript
export function fixEncoding(text) {
  // Fix UTF-8 text that was double-encoded (UTF-8 bytes misread as latin1/cp1252)
  // Telltale: sequences like â€™ â€" â€œ where chars are in U+00C0-U+00FF range
  return text.split('\n').map((line) => {
    if (!/[\u00c2-\u00c3][\u0080-\u00bf]/.test(line)) return line;
    try {
      const bytes = Buffer.from(line, 'latin1');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return line;
    }
  }).join('\n');
}
```

- [ ] **Step 4: Run tests to verify fixEncoding passes**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/parse-emails.test.mjs
```
Expected: All tests PASS.

- [ ] **Step 5: Write test for venue extraction**

Add to `tests/parse-emails.test.mjs` in the `parseListings` describe block:

```javascript
  it('extracts venue from typed listing', () => {
    const typedBody = `
----------------------------------------------------------------------
01. EXHIBITION | Western Front | Nina Davies - Image Syncers | JAN 10
----------------------------------------------------------------------
Join us for the opening reception.
`;
    const listings = parseListings(typedBody);
    expect(listings[0].venue).toBe('Western Front');
  });

  it('extracts venue from untyped listing', () => {
    const untypedBody = `
----------------------------------------------------------------------
01. Monte Clark Gallery | OWEN KYDD | APR 4
----------------------------------------------------------------------
Gallery presents OWEN KYDD.
`;
    const listings = parseListings(untypedBody);
    expect(listings[0].venue).toBe('Monte Clark Gallery');
  });
```

- [ ] **Step 6: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/parse-emails.test.mjs
```
Expected: FAIL — listings don't have a `venue` property yet.

- [ ] **Step 7: Add venue extraction to parseListings**

In `scripts/parse-emails.mjs`, modify the listing header parsing block inside `parseListings` (around line 95-113). Replace the current block:

```javascript
    // Check for listing header
    const match = trimmed.match(LISTING_HEADER_RE);
    if (match) {
      if (current) listings.push(current);
      const [, numStr, fullMatch] = match;
      // Try to extract type keyword from first pipe-delimited segment
      const segments = fullMatch.split('|').map((s) => s.trim());
      let type = '';
      let summary = fullMatch.trim();
      if (KNOWN_TYPES.has(segments[0])) {
        type = segments[0];
        summary = segments.slice(1).join(' | ');
      }
      current = {
        number: parseInt(numStr, 10),
        type,
        summary,
        bodyLines: [],
      };
      continue;
    }
```

With:

```javascript
    // Check for listing header
    const match = trimmed.match(LISTING_HEADER_RE);
    if (match) {
      if (current) listings.push(current);
      const [, numStr, fullMatch] = match;
      // Try to extract type keyword from first pipe-delimited segment
      const segments = fullMatch.split('|').map((s) => s.trim());
      let type = '';
      let venue = '';
      let summary = fullMatch.trim();
      if (KNOWN_TYPES.has(segments[0])) {
        type = segments[0];
        summary = segments.slice(1).join(' | ');
        if (segments.length > 1) venue = segments[1];
      } else {
        venue = segments[0];
      }
      current = {
        number: parseInt(numStr, 10),
        type,
        venue,
        summary,
        bodyLines: [],
      };
      continue;
    }
```

Also update the return map at the end of `parseListings` (around line 124-129) to include venue:

```javascript
  return listings.map((l) => ({
    number: l.number,
    type: l.type,
    venue: l.venue,
    summary: l.summary,
    body: l.bodyLines.join('\n').trim(),
  }));
```

- [ ] **Step 8: Run tests to verify venue extraction passes**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/parse-emails.test.mjs
```
Expected: All tests PASS.

- [ ] **Step 9: Add clean + encoding + venue to generateContent**

In `scripts/parse-emails.mjs`, modify `generateContent`:

1. Add `rm` import at top of file (line 1):

```javascript
import { readFile, writeFile, readdir, mkdir, rm } from 'fs/promises';
```

2. Add directory cleaning at the start of `generateContent` (after the function signature, before `await mkdir`):

```javascript
async function generateContent(rawDir, emailsDir, listingsDir) {
  // Clean old output to prevent stale files from previous parse runs
  await rm(emailsDir, { recursive: true, force: true });
  await rm(listingsDir, { recursive: true, force: true });
  await mkdir(emailsDir, { recursive: true });
  await mkdir(listingsDir, { recursive: true });
```

3. Apply `fixEncoding` after extracting the body (around line 188, after `const body = extractBody(raw.payload);`):

```javascript
    const rawBody = extractBody(raw.payload);

    if (!rawBody) {
      console.warn(`No plain text body in ${file}, skipping`);
      continue;
    }

    const body = fixEncoding(rawBody);
```

4. Add `venue` to listing frontmatter (around line 225, in the listingFrontmatter array):

```javascript
      const listingFrontmatter = [
        '---',
        `emailSlug: ${escapeYaml(emailSlug)}`,
        `emailSubject: ${escapeYaml(meta.subject)}`,
        `emailDate: ${escapeYaml(meta.date)}`,
        `number: ${listing.number}`,
        `type: ${escapeYaml(listing.type)}`,
        `venue: ${escapeYaml(listing.venue)}`,
        `summary: ${escapeYaml(listing.summary)}`,
        '---',
      ].join('\n');
```

- [ ] **Step 10: Run all tests**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run
```
Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add scripts/parse-emails.mjs tests/parse-emails.test.mjs
git commit -m "fix: parser — clean dirs, fix encoding, extract venue"
```

---

### Task 2: Listing Page Fixes

**Files:**
- Modify: `src/content.config.ts`
- Modify: `src/pages/listings/[...slug].astro`

- [ ] **Step 1: Add venue to content collection schema**

In `src/content.config.ts`, add `venue` to the listings schema:

```typescript
const listings = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/listings' }),
  schema: z.object({
    emailSlug: z.string(),
    emailSubject: z.string(),
    emailDate: z.string(),
    number: z.number(),
    type: z.string(),
    venue: z.string(),
    summary: z.string(),
  }),
});
```

- [ ] **Step 2: Fix listing page — type badge + venue metadata**

Replace the full content of `src/pages/listings/[...slug].astro`:

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

const KNOWN_TYPES = new Set([
  'OPENING', 'TALK', 'CALL', 'PERFORMANCE', 'EXHIBITION',
  'EVENT', 'EDUCATION', 'FUNDRAISER',
]);
const hasType = listing.data.type && KNOWN_TYPES.has(listing.data.type);
const pageTitle = hasType
  ? `${listing.data.type}: ${listing.data.summary}`
  : listing.data.summary;
---
<Base title={pageTitle}>
  <article data-pagefind-body>
    <a class="back-link" href={`/instant-coffee/emails/${listing.data.emailSlug}`} data-pagefind-ignore>
      &larr; {listing.data.emailSubject.replace(/^\(ic-vancouver\)\s*/i, '')}
    </a>

    {hasType && <span class="type-badge" data-pagefind-filter="type">{listing.data.type}</span>}
    <h1>{String(listing.data.number).padStart(2, '0')}. {listing.data.summary}</h1>
    {listing.data.venue && <p class="listing-venue">{listing.data.venue}</p>}
    <p class="listing-meta" data-pagefind-meta="date">{formatted}</p>

    <hr style="margin: 1.5rem 0;" />
    <div class="listing-body">
      <Content />
    </div>
  </article>
</Base>
```

- [ ] **Step 3: Add venue styling**

Add to `src/styles/global.css`:

```css
.listing-venue {
  font-size: 0.9rem;
  color: var(--color-muted);
  margin-bottom: 0.25rem;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/content.config.ts src/pages/listings/ src/styles/global.css
git commit -m "fix: listing page — hide empty type badge, show venue metadata"
```

---

### Task 3: Homepage Year Navigation

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add year navigation to homepage**

Replace the full content of `src/pages/index.astro`:

```astro
---
import { getCollection } from 'astro:content';
import Base from '../layouts/Base.astro';
import EmailCard from '../components/EmailCard.astro';
import Search from '../components/Search.astro';

const emails = await getCollection('emails');

// Sort by date descending (newest first)
emails.sort((a, b) => {
  const da = new Date(a.data.date);
  const db = new Date(b.data.date);
  return db.getTime() - da.getTime();
});

// Extract unique years from emails
const years = [...new Set(
  emails.map((e) => {
    const d = new Date(e.data.date);
    return isNaN(d.getTime()) ? null : d.getFullYear();
  }).filter(Boolean)
)].sort((a, b) => b - a);

// Build a year for each email (for data attribute)
function getYear(dateStr: string): number | null {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}
---
<Base title="Home">
  <h1>Instant Coffee Archive</h1>
  <p>ic-vancouver mailing list &middot; {emails.length} emails</p>

  <Search />

  <nav class="year-nav" aria-label="Filter by year">
    <button class="year-btn active" data-year="all">All</button>
    {years.map((year) => (
      <button class="year-btn" data-year={year}>{year}</button>
    ))}
  </nav>

  <ul class="email-list" id="email-list">
    {emails.map((email) => (
      <li data-year={getYear(email.data.date)}>
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

<script is:inline>
  document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.year-btn');
    const items = document.querySelectorAll('#email-list li');

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const year = btn.dataset.year;

        // Update active button
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Filter list
        items.forEach((li) => {
          if (year === 'all' || li.dataset.year === year) {
            li.style.display = '';
          } else {
            li.style.display = 'none';
          }
        });
      });
    });
  });
</script>
```

- [ ] **Step 2: Add year navigation styles**

Add to `src/styles/global.css`:

```css
/* Year navigation */
.year-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 1rem 0;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
}

.year-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0.2em 0.6em;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--color-text);
  font-family: var(--font-body);
}

.year-btn:hover {
  background: var(--color-tag-bg);
}

.year-btn.active {
  background: var(--color-text);
  color: var(--color-bg);
  border-color: var(--color-text);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro src/styles/global.css
git commit -m "feat: homepage year navigation — filter emails by year"
```

---

### Task 4: Re-parse, Rebuild, Verify

**Files:**
- Regenerated: `src/content/emails/`, `src/content/listings/`

- [ ] **Step 1: Run parser to regenerate all content**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run parse
```
Expected: Output like `Generated 619 email pages and XXXXX listing pages.`
The listing count may differ from the previous 34,300 since stale duplicates are now cleaned.

- [ ] **Step 2: Verify no stale files remain**

```bash
# Check that listing count is consistent
grep '^listingCount:' src/content/emails/*.md | sed 's/.*listingCount: //' | paste -sd+ | bc
```
Expected: Total should match the listing page count from the parse output.

```bash
# Check 0-listing emails (should be 2: subscription confirmation + Mesomonuments)
grep -l '^listingCount: 0$' src/content/emails/*.md
```

- [ ] **Step 3: Verify venue field present in listings**

```bash
head -10 src/content/listings/*.md | grep 'venue:' | head -5
```
Expected: `venue:` field present in listing frontmatter with venue names.

- [ ] **Step 4: Verify encoding fixes**

```bash
# Check for remaining mojibake
grep -r 'â€' src/content/emails/ | wc -l
grep -r 'â€' src/content/listings/ | wc -l
```
Expected: Count should be 0 or near-0 (some edge cases may remain).

- [ ] **Step 5: Build the site**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run build 2>&1 | tail -10
```
Expected: Build completes successfully. Pagefind indexes listing pages only.

- [ ] **Step 6: Start preview and verify in browser**

```bash
pkill -f "astro preview" 2>/dev/null
source ~/.nvm/nvm.sh && nvm use 22 && npm run preview &
sleep 3
```

Verify at http://localhost:4321/instant-coffee/:
- Year buttons appear and filter the email list
- Search returns individual listings
- Type filter dropdown contains only: OPENING, TALK, CALL, PERFORMANCE, EXHIBITION, EVENT, EDUCATION, FUNDRAISER (no venue names)
- Clicking a listing shows venue metadata and no empty type badge

- [ ] **Step 7: Commit all generated content**

```bash
git add src/content/ src/pages/ src/styles/ src/content.config.ts
git commit -m "content: re-parsed 619 emails — clean dirs, fixed encoding, added venue"
```

- [ ] **Step 8: Push**

```bash
git push
```
