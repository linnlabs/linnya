import { z } from 'zod';
import { createHash } from 'node:crypto';

const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine(value => Number.isFinite(Date.parse(value)));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const document = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    title: z.string().min(1),
    availableAt: timestamp,
    originalSha256: hash,
    projectionSha256: hash,
    text: z.string().min(1),
  })
  .strict();

// 消费离线 preflight 的数据文件，不把 benchmark 编排或私有研究记录导入 Host。
export const FrozenCorpusSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusId: z.string().min(1),
    cutoffExclusive: timestamp,
    documents: z.array(document).min(1),
  })
  .strict()
  .superRefine((corpus, context) => {
    const urls = new Set<string>();
    const ids = new Set<string>();
    for (const source of corpus.documents) {
      const url = new URL(source.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        urls.has(url.href) ||
        ids.has(source.id) ||
        Date.parse(source.availableAt) >= Date.parse(corpus.cutoffExclusive) ||
        digest(source.text) !== source.projectionSha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid frozen source: ${source.id}`,
        });
      }
      urls.add(url.href);
      ids.add(source.id);
    }
  });
export type FrozenCorpus = z.infer<typeof FrozenCorpusSchema>;
export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
