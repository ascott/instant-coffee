import { readFile, writeFile, readdir, mkdir, rm } from 'fs/promises';
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

export function fixEncoding(text) {
  // Fix UTF-8 text that was double-encoded (UTF-8 bytes misread as latin1/cp1252)
  // Telltale: sequences where latin1-interpreted UTF-8 lead bytes appear in the string.
  // 2-byte sequences start with 0xC2-0xC3 (U+00C2-U+00C3), followed by 0x80-0xBF continuation.
  // 3-byte sequences start with 0xE0-0xEF (U+00E0-U+00EF), e.g. â (0xE2) for curly quotes/em-dash.
  return text.split('\n').map((line) => {
    if (!/[\u00c2-\u00c3\u00e0-\u00ef][\u0080-\u00bf]/.test(line)) return line;
    try {
      const bytes = Buffer.from(line, 'latin1');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return line;
    }
  }).join('\n');
}

const SEPARATOR_RE = /^-{5,}$/;
// Match any line starting with NN. that contains at least one pipe
const LISTING_HEADER_RE = /^(\d{1,2})\.\s+(.+\|.+)$/;
const KNOWN_TYPES = new Set([
  'OPENING', 'TALK', 'CALL', 'PERFORMANCE', 'EXHIBITION',
  'EVENT', 'EDUCATION', 'FUNDRAISER',
]);
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
    venue: l.venue,
    summary: l.summary,
    body: l.bodyLines.join('\n').trim(),
  }));
}

// --- Linkify listing headers in email body ---

export function linkifyListingHeaders(body, listings, dateSlug) {
  // Build map of listing number → listing page slug
  const slugMap = {};
  for (const l of listings) {
    const listingSlug = `${dateSlug}-${String(l.number).padStart(2, '0')}-${slugify(l.summary).slice(0, 60)}`;
    slugMap[l.number] = listingSlug;
  }

  // Replace every numbered header line (with a pipe) with an HTML link
  return body.replace(
    /^(\d{1,2})\.\s+(.+\|.+)$/gm,
    (match, numStr) => {
      const num = parseInt(numStr, 10);
      if (slugMap[num]) {
        return `<a href="/instant-coffee/listings/${slugMap[num]}">${match}</a>`;
      }
      return match;
    }
  );
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
  // Clean old output to prevent stale files from previous parse runs
  await rm(emailsDir, { recursive: true, force: true });
  await rm(listingsDir, { recursive: true, force: true });
  await mkdir(emailsDir, { recursive: true });
  await mkdir(listingsDir, { recursive: true });

  const files = (await readdir(rawDir)).filter((f) => f.endsWith('.json'));
  console.log(`Processing ${files.length} raw email files...`);

  let totalListings = 0;

  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(rawDir, file), 'utf-8'));
    const meta = extractMetadata(raw);
    const rawBody = extractBody(raw.payload);

    if (!rawBody) {
      console.warn(`No plain text body in ${file}, skipping`);
      continue;
    }

    const body = fixEncoding(rawBody);

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

    const linkedBody = linkifyListingHeaders(body, listings, dateSlug);

    await writeFile(
      path.join(emailsDir, `${emailSlug}.md`),
      `${emailFrontmatter}\n\n${linkedBody}`
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
        `venue: ${escapeYaml(listing.venue)}`,
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
