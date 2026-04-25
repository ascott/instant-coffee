# Instant Coffee Archive - Acceptance Criteria

## Overview

Browsable, searchable static archive of the ic-vancouver Instant Coffee mailing list (2007-2026). 619 emails, ~34,000 event listings. Hosted on GitHub Pages.

---

## Pages

### Homepage (`/`)

- [ ] Shows site title "Instant Coffee Archive" and email count
- [ ] Search bar at top (Pagefind) returns **individual listings**, not emails
- [ ] Search has a Type filter dropdown (OPENING, TALK, CALL, etc.)
- [ ] Email list below search, reverse chronological (newest first)
- [ ] Each email card shows: subject (stripped of `(ic-vancouver)` prefix), formatted date, listing count
- [ ] Clicking an email card navigates to email detail page
- [ ] No "Test Email" placeholder entry appears

### Email Detail (`/emails/[slug]`)

- [ ] Back link "All emails" returns to homepage
- [ ] Email subject as h1 (stripped of prefix)
- [ ] Date and sender shown
- [ ] Full email body rendered in monospace, preserving original plain text formatting
- [ ] **Every numbered listing header** in the email body (both TOC and expanded sections) is a clickable link to its listing page
- [ ] Links work for both old format (`01. Venue | Artist | DATE`) and new format (`01. TYPE | Venue | Details | DATE`)
- [ ] Footer content (`:ic:`, subscription info) is visible but not parsed as a listing

### Listing Detail (`/listings/[slug]`)

- [ ] Back link returns to the parent email page
- [ ] Type badge shown when type exists (OPENING, TALK, etc.)
- [ ] Listing number + summary as h1
- [ ] Date metadata shown ("From email dated ...")
- [ ] Listing body rendered in monospace, preserving original formatting
- [ ] **Contains only the content for THIS listing** - not content from adjacent listings
- [ ] Links in the original listing text (URLs) are clickable

---

## Search

### Indexing

- [ ] Only listing pages are indexed (not homepage, not email pages)
- [ ] Search returns individual event entries, each linking to a listing page
- [ ] Search result shows: listing title, text snippet with highlights, date badge
- [ ] Type filter dropdown populated from listing types

### Search Quality

- [ ] Searching an artist name (e.g. "Nina Davies") returns their specific listings
- [ ] Searching a venue name (e.g. "Western Front") returns listings at that venue
- [ ] Searching a general term (e.g. "photography") returns relevant listings
- [ ] **No duplicate results** for the same listing (same event appearing twice with slight title variations)
- [ ] Results are relevant - not just every page that mentions the word once in passing

---

## Parser Correctness

### Email Format Coverage

- [ ] **New format (2015+):** `NN. TYPE | Venue | Details | DATE` - type extracted, summary is remainder
- [ ] **Old format (2008-2014):** `NN. Venue | Artist | DATE` - type is empty, full line is summary
- [ ] **Mixed format:** some emails contain both typed and untyped listings within the same email
- [ ] Only 2 emails should have 0 listings (subscription confirmation + Mesomonuments essay)

### Listing Splitting

- [ ] Each numbered listing becomes exactly one listing page
- [ ] Listing body starts after the header and ends before the next listing header or footer
- [ ] Footer markers are correctly excluded from listing bodies:
  - `instant coffee:` prefix
  - `Email vancouver@instantcoffee.org to post`
  - `:ic: = (instant coffee loves everyone)`
  - `Visit http://lists.instantcoffee.org`
  - `IC TORONTO:IC HALIFAX:IC VANCOUVER`
  - `Instant Coffee is a project`
  - `Instant Coffee is an artist collective`
  - `Lists are volunteer-run`

### Slug Uniqueness

- [ ] No two email pages share the same slug
- [ ] No two listing pages share the same slug
- [ ] Slugs are URL-safe (lowercase, hyphens, no special characters)

---

## Known Issues (to fix)

### Duplicate Listings
From the screenshot: searching "belkin" returns two results for the same event (one with type prefix "MUSIC |", one without). This suggests the same listing appears in multiple emails (e.g. repeated across weekly sends) and generates separate pages with slightly different headers. Needs deduplication or at minimum consistent titling.

### Listing Content Bleed
User reported some listing pages contain content from multiple listings. Root cause: some emails have non-standard formatting (missing separators, inconsistent numbering) that causes the parser to merge adjacent listings. Needs investigation with specific examples.

### Character Encoding
Some listing bodies show mojibake (`â€™` instead of `'`, `â€"` instead of `-`). The email body is UTF-8 but some characters are double-encoded. The parser should handle this or the display should normalize it.

### Empty Type Badges
Older format listings show an empty type badge (since type is empty string). Should either hide the badge when type is empty, or not render it.

---

## Navigation

- [ ] Homepage -> Email detail (click email card)
- [ ] Email detail -> Homepage (back link)
- [ ] Email detail -> Listing detail (click numbered listing in body)
- [ ] Listing detail -> Email detail (back link)
- [ ] Search result -> Listing detail (click search result)
- [ ] Listing detail -> Email detail -> Homepage (breadcrumb chain works)

---

## Deploy

- [ ] GitHub Actions workflow deploys on push to main
- [ ] Site accessible at `https://ascott.github.io/instant-coffee/`
- [ ] All internal links use `/instant-coffee/` base path
- [ ] Pagefind search index loads correctly at the deployed URL
- [ ] Static site, no server-side rendering needed

---

## Data Pipeline

```
npm run export    # Gmail API -> data/raw/*.json (619 emails)
npm run parse     # data/raw/ -> src/content/emails/*.md + src/content/listings/*.md
npm run build     # Astro build + Pagefind index -> dist/
```

- [ ] Export is idempotent (skips already-downloaded emails)
- [ ] Parse regenerates all content from raw data
- [ ] Build produces static HTML + Pagefind search index
- [ ] Credentials (credentials.json, token.json) are gitignored
- [ ] Raw email data (data/raw/) is gitignored
- [ ] Generated content (src/content/) IS committed for GitHub Pages builds
