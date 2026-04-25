import { describe, it, expect } from 'vitest';
import { extractBody, extractMetadata, parseListings, slugify, fixEncoding, linkifyUrls } from '../scripts/parse-emails.mjs';
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

  it('extracts listing number and type for typed listings', () => {
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

  it('handles older format without type keyword', () => {
    const olderBody = `
----------------------------------------------------------------------
01. Monte Clark Gallery | OWEN KYDD | APR 4
----------------------------------------------------------------------
Monte Clark Gallery presents OWEN KYDD.

----------------------------------------------------------------------
02. CSA space | Jack Brindley | APR 4
----------------------------------------------------------------------
CSA space presents Jack Brindley.

----------------------------------------------------------------------
instant coffee: test
----------------------------------------------------------------------
:ic: = (instant coffee loves everyone)
`;
    const listings = parseListings(olderBody);
    expect(listings.length).toBe(2);
    expect(listings[0].number).toBe(1);
    expect(listings[0].type).toBe('');
    expect(listings[0].summary).toContain('Monte Clark Gallery');
    expect(listings[0].summary).toContain('OWEN KYDD');
    expect(listings[0].body).toContain('Monte Clark Gallery presents');
    expect(listings[1].summary).toContain('CSA space');
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
});

describe('fixEncoding', () => {
  it('fixes double-encoded right single quote', () => {
    expect(fixEncoding('Vander\u00e2\u0080\u0099s work')).toBe('Vander\u2019s work');
  });

  it('fixes double-encoded em dash', () => {
    expect(fixEncoding('Jan 15 \u00e2\u0080\u0094 Feb 28')).toBe('Jan 15 \u2014 Feb 28');
  });

  it('leaves clean ASCII text unchanged', () => {
    expect(fixEncoding('Hello world')).toBe('Hello world');
  });

  it('leaves correctly-encoded UTF-8 unchanged', () => {
    expect(fixEncoding('caf\u00e9')).toBe('caf\u00e9');
  });
});

describe('linkifyUrls', () => {
  it('converts bare http URL to markdown link', () => {
    expect(linkifyUrls('Visit http://example.com for info'))
      .toBe('Visit [http://example.com](http://example.com) for info');
  });

  it('converts bare https URL to markdown link', () => {
    expect(linkifyUrls('See https://westernfront.ca/events/image-syncers'))
      .toBe('See [https://westernfront.ca/events/image-syncers](https://westernfront.ca/events/image-syncers)');
  });

  it('handles multiple URLs on separate lines', () => {
    const input = 'Visit https://a.com\nAlso https://b.org/page';
    const expected = 'Visit [https://a.com](https://a.com)\nAlso [https://b.org/page](https://b.org/page)';
    expect(linkifyUrls(input)).toBe(expected);
  });

  it('leaves text without URLs unchanged', () => {
    expect(linkifyUrls('No links here')).toBe('No links here');
  });

  it('does not double-linkify existing markdown links', () => {
    const input = 'Check [site](https://example.com) for details';
    expect(linkifyUrls(input)).toBe(input);
  });

  it('handles URL at end of line with trailing punctuation', () => {
    expect(linkifyUrls('Info at https://example.com.'))
      .toBe('Info at [https://example.com](https://example.com).');
  });

  it('rejoins line-wrapped URLs starting with digits', () => {
    const input = 'Link:\nhttps://smithfoundation.co/exhibitions-items/one-hundred-artists-deep-april-11th-june-20th-\n2026/?portfolioCats=59%2C60%2C58';
    const expected = 'Link:\n[https://smithfoundation.co/exhibitions-items/one-hundred-artists-deep-april-11th-june-20th-2026/?portfolioCats=59%2C60%2C58](https://smithfoundation.co/exhibitions-items/one-hundred-artists-deep-april-11th-june-20th-2026/?portfolioCats=59%2C60%2C58)';
    expect(linkifyUrls(input)).toBe(expected);
  });

  it('does not rejoin URL with following sentence', () => {
    const input = 'Visit https://example.com\nAlso check this out';
    const expected = 'Visit [https://example.com](https://example.com)\nAlso check this out';
    expect(linkifyUrls(input)).toBe(expected);
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
