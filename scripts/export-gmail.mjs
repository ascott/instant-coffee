import { google } from 'googleapis';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { authorize } from './auth.mjs';

const RAW_DIR = path.join(process.cwd(), 'data/raw');
const QUERY = 'from:vancouver@instantcoffee.org';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAndSave(gmail, messageId) {
  const outPath = path.join(RAW_DIR, `${messageId}.json`);
  if (existsSync(outPath)) {
    return false; // Already exported, skip
  }

  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    await writeFile(outPath, JSON.stringify(res.data, null, 2));
    return true;
  } catch (err) {
    if (err.status === 429) {
      console.warn(`\nRate limited on ${messageId}, waiting 10s...`);
      await sleep(10000);
      return fetchAndSave(gmail, messageId); // retry once
    }
    console.error(`\nFailed to fetch ${messageId}: ${err.message}`);
    return false;
  }
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
