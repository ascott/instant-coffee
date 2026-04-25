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
