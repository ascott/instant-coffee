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
    venue: z.string(),
    summary: z.string(),
  }),
});

export const collections = { emails, listings };
