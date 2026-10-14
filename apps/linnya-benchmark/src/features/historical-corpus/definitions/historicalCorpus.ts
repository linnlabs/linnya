import { z } from 'zod';

const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine(
    value => Number.isFinite(Date.parse(value)),
    'Timestamp must have a valid UTC offset and calendar value'
  );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const httpUrl = z
  .string()
  .url()
  .refine(value => {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash
    );
  }, 'An absolute HTTP(S) URL without credentials or fragment is required');
const file = z.object({ path: z.string().min(1), sha256: hash }).strict();
const identity = {
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  url: httpUrl,
  title: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1),
};
const candidate = z.discriminatedUnion('status', [
  z.object({ ...identity, status: z.literal('pending'), reason: z.string().min(1) }).strict(),
  z
    .object({
      ...identity,
      status: z.literal('verified'),
      availableAt: timestamp,
      original: file,
      projection: file,
      verification: z
        .object({
          kind: z.enum(['regulatory_archive', 'historical_capture', 'publisher_release_archive']),
          versionId: z.string().min(1),
          url: httpUrl,
          evidence: file,
          reviewer: z.string().min(1),
          rationale: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);

export const HistoricalCorpusManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    cutoffExclusive: timestamp,
    requiredCategories: z.array(z.string().min(1)).min(1),
    candidates: z.array(candidate).min(1),
  })
  .strict();
export type HistoricalCorpusManifest = z.infer<typeof HistoricalCorpusManifestSchema>;
export type HistoricalCandidate = HistoricalCorpusManifest['candidates'][number];

export interface HistoricalCorpusDocument {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly availableAt: string;
  readonly originalSha256: string;
  readonly projectionSha256: string;
  readonly text: string;
}

export interface CorpusIssue {
  readonly sourceId?: string;
  readonly code:
    | 'pending_version'
    | 'not_before_cutoff'
    | 'duplicate_identity'
    | 'invalid_file'
    | 'hash_mismatch'
    | 'invalid_projection'
    | 'missing_category';
  readonly detail: string;
}

export interface HistoricalCorpusPreflight {
  readonly schemaVersion: 1;
  readonly corpusId: string;
  readonly manifestSha256: string;
  readonly cutoffExclusive: string;
  readonly checkedAt: string;
  readonly status: 'blocked' | 'corpus_ready';
  readonly executionIsolation: 'not_checked';
  readonly eligibleSourceIds: readonly string[];
  readonly issues: readonly CorpusIssue[];
  readonly corpusSha256?: string;
}
