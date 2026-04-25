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

// Map cp1252-specific characters (0x80-0x9F range) back to their byte values.
// These characters get produced when UTF-8 bytes are misinterpreted as Windows-1252.
const CP1252_TO_BYTE = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

// Common mojibake sequences → correct characters (fallback for mixed lines)
const MOJIBAKE_REPLACEMENTS = [
  ['\u00e2\u20ac\u2122', '\u2019'],  // â€™ → '
  ['\u00e2\u20ac\u0153', '\u201c'],  // â€œ → "
  ['\u00e2\u20ac\u009d', '\u201d'],  // â€ → "
  ['\u00e2\u20ac\u201c', '\u2013'],  // â€" → –
  ['\u00e2\u20ac\u201d', '\u2014'],  // â€" → — (variant)
  ['\u00e2\u20ac\u00a6', '\u2026'],  // â€¦ → …
  ['\u00e2\u20ac\u2020', '\u2020'],  // â€† → †
  ['\u00e2\u20ac\u00a2', '\u2022'],  // â€¢ → •
  ['\u00e2\u20ac\u02dc', '\u2018'],  // â€˜ → '
  ['\u00c3\u00a9', '\u00e9'],        // Ã© → é
  ['\u00c3\u00a8', '\u00e8'],        // Ã¨ → è
  ['\u00c3\u00a0', '\u00e0'],        // Ã  → à
  ['\u00c3\u00a1', '\u00e1'],        // Ã¡ → á
  ['\u00c3\u00a2', '\u00e2'],        // Ã¢ → â
  ['\u00c3\u00a7', '\u00e7'],        // Ã§ → ç
  ['\u00c3\u00ab', '\u00eb'],        // Ã« → ë
  ['\u00c3\u00ae', '\u00ee'],        // Ã® → î
  ['\u00c3\u00af', '\u00ef'],        // Ã¯ → ï
  ['\u00c3\u00b1', '\u00f1'],        // Ã± → ñ
  ['\u00c3\u00b3', '\u00f3'],        // Ã³ → ó
  ['\u00c3\u00b4', '\u00f4'],        // Ã´ → ô
  ['\u00c3\u00b6', '\u00f6'],        // Ã¶ → ö
  ['\u00c3\u00b8', '\u00f8'],        // Ã¸ → ø
  ['\u00c3\u00ba', '\u00fa'],        // Ãº → ú
  ['\u00c3\u00bb', '\u00fb'],        // Ã» → û
  ['\u00c3\u00bc', '\u00fc'],        // Ã¼ → ü
  // Truncated 3-byte sequences (third byte lost)
  ['\u00e2\u20ac\u00a8', '\u2018'],  // â€¨ → '
  ['\u00e2\u20ac ', '\u201d '],      // â€  → " (followed by space)
  ['\u00e2\u20ac\r', '\u201d\r'],    // â€\r → "
  ['\u00e2\u20ac\n', '\u201d\n'],    // â€\n → "
];

export function fixEncoding(text) {
  // Pass 1: try full-line decode (works when entire line is double-encoded)
  let result = text.split('\n').map((line) => {
    if (!/[\u00c0-\u00ef]/.test(line)) return line;
    try {
      const bytes = new Uint8Array([...line].map((c) => {
        const code = c.codePointAt(0);
        if (code <= 0xFF) return code;
        const mapped = CP1252_TO_BYTE.get(code);
        if (mapped !== undefined) return mapped;
        throw new Error('unmappable');
      }));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return line;
    }
  }).join('\n');

  // Pass 2: substring replacement for any remaining mojibake
  for (const [bad, good] of MOJIBAKE_REPLACEMENTS) {
    result = result.replaceAll(bad, good);
  }

  // Pass 3: catch remaining corrupted sequences (â followed by non-printable/replacement chars)
  result = result.replace(/\u00e2[\ufffd\u0080-\u009f]{1,2}/g, '\u2019'); // best-guess: curly apostrophe
  result = result.replace(/\u00c3[\ufffd]/g, '');                          // strip unrecoverable Ã sequences

  return result;
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
