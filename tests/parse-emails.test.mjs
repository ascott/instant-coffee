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
