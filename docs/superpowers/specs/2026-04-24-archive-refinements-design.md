# Instant Coffee Archive Refinements - Design Spec

## Goal

Refine the ic-vancouver archive from a working prototype into a polished browsable, searchable archive. Fix parser bugs, add year-based navigation, improve search quality, and clean up display issues.

---

## Homepage

### Year Navigation
- Row of clickable year buttons at top of page: 2007, 2008, ... 2026, plus "All"
- "All" selected by default, showing all 619 emails
- Clicking a year filters the email list to only emails from that year (client-side JS, no page reload)
- Active year is visually highlighted
- Year buttons replace pagination. Each year has ~30-50 emails, a manageable list length.

### Search Bar
- Pagefind search at top, above the email list
- Returns individual listing entries, not whole emails
- Type filter dropdown only contains known event types: OPENING, TALK, CALL, PERFORMANCE, EXHIBITION, EVENT, EDUCATION, FUNDRAISER
- No venue names or other values in the type filter

### Email List
- Reverse chronological within the selected year (or across all years when "All")
- Each card: subject (stripped of `(ic-vancouver)` prefix), formatted date, listing count
- Click navigates to email detail page

---

## Email Detail Page

- Back link to homepage
- Subject as h1 (prefix stripped), date, sender
- Full email body in monospace (`white-space: pre-wrap`), preserving original plain text formatting
- Every numbered listing header in the body (TOC and expanded sections) is a clickable link to its listing page
- Works for both formats: `NN. Venue | Artist | DATE` and `NN. TYPE | Venue | Details | DATE`
- Footer content visible but not parsed as listings

---

## Listing Detail Page

- Back link to parent email
- Type badge shown only when type is a known event type (hidden when empty)
- Venue shown as metadata when extractable (first pipe-delimited segment of summary, when type is absent; second segment when type is present)
- Number + summary as h1
- Date metadata ("From email dated ...")
- Body in monospace, preserving original formatting
- Contains only content for this single listing, not adjacent ones

---

## Search

- Only listing pages are indexed (not homepage, not email pages)
- Each result shows: listing title, text snippet with keyword highlights, date badge
- Type filter populated only from known event types
- Venue/artist discovery is through full-text search, not dedicated browse pages

---

## Bug Fixes

### 1. Parse Script: Clean Before Regenerating
The parse script (`scripts/parse-emails.mjs`) must delete all files in `src/content/emails/` and `src/content/listings/` before generating new ones. Currently old files from previous parse runs persist, causing:
- Duplicate listing pages (same event with different slugs from old vs new parser output)
- Stale type values (venue names appearing as types from the old strict regex)

### 2. Type Filter: Only Known Event Types
The `data-pagefind-filter="type"` attribute must only render when `type` is a non-empty known event type. Currently empty-string and venue-name types pollute the filter dropdown.

### 3. Character Encoding
Some listing bodies show mojibake (`â€™` instead of `'`, `â€"` instead of `-`). The parser should detect and fix common double-encoded UTF-8 sequences when extracting the email body.

### 4. Empty Type Badge
The listing detail page renders an empty type badge for older listings. Condition rendering on type being non-empty.

### 5. Venue/Artist Metadata Extraction
Extract venue and artist from the listing header for display on listing pages:
- When type is present: `NN. TYPE | Venue | Artist/Details | DATE` - venue is segment after type
- When type is absent: `NN. Venue | Artist/Details | DATE` - venue is first segment
- Show as metadata below the title, not as structured/browsable fields
- Best-effort extraction, not guaranteed to be correct for all listings

---

## Pages Summary

| Page | URL | Content |
|------|-----|---------|
| Homepage | `/` | Year nav + search + email list |
| Email Detail | `/emails/[slug]` | Full email with linked listing headers |
| Listing Detail | `/listings/[slug]` | Single event listing with metadata |

---

## Navigation Flows

```
Homepage (year filter) -> Email Detail (click card)
Email Detail -> Homepage (back link)
Email Detail -> Listing Detail (click numbered header in body)
Listing Detail -> Email Detail (back link)
Search Result -> Listing Detail (click result)
```

---

## Out of Scope

- Dedicated venue or artist browse pages
- Auto-classification of types for older untyped listings
- Deduplication of listings that repeat across weekly emails (same event listed in multiple sends)
- Auto-update from Gmail (possible later, not this iteration)
