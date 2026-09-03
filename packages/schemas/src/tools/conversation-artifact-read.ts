import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const NonNegativeIntegerSchema = z.number().int().nonnegative();

/** 以下合同只接纳历史 Conversation 事件，不对应 live Agent 工具。 */
export const HistoricalConversationArtifactReadSourceSchema = z.enum([
  'shared_memory',
  'evidence',
  'citation_snapshot',
]);
export type HistoricalConversationArtifactReadSource = z.infer<
  typeof HistoricalConversationArtifactReadSourceSchema
>;

export const HistoricalSharedMemoryUriSchema = NonEmptyStringSchema.refine(
  uri => uri.startsWith('shared_memory://docs/') && uri.toLowerCase().endsWith('.md'),
  'SharedMemory URI must use shared_memory://docs/<name>.md'
);
const EvidenceBundleUriSchema = NonEmptyStringSchema.refine(
  uri => uri.startsWith('evidence://bundles/'),
  'Evidence URI must use evidence://bundles/<bundle_id>'
);
const CitationSnapshotBundleUriSchema = NonEmptyStringSchema.refine(
  uri => uri.startsWith('citation_snapshot://bundles/'),
  'Citation snapshot URI must use citation_snapshot://bundles/<bundle_id>'
);

export const HistoricalConversationArtifactResourceUriSchema = z.union([
  HistoricalSharedMemoryUriSchema,
  EvidenceBundleUriSchema,
  CitationSnapshotBundleUriSchema,
]);

/** 历史 resource_read 进入 artifact projector 时允许的完整参数合同。 */
export const HistoricalConversationArtifactResourceReadArgsSchema = z
  .object({
    uri: HistoricalConversationArtifactResourceUriSchema,
    offset: NonNegativeIntegerSchema.optional(),
    limit: z.number().int().positive().optional(),
    view: z.enum(['full', 'overview']).optional(),
    variant: z.enum(['preview', 'base']).optional(),
    range: NonEmptyStringSchema.optional(),
  })
  .strict();

/** 旧版 sharedmemory_read 参数，只允许 Renderer 回放已落盘事件。 */
export const HistoricalSharedMemoryReadArgsSchema = z
  .object({
    doc_name: NonEmptyStringSchema,
  })
  .strict();

export const HistoricalSharedMemoryArtifactReadDataSchema = z
  .object({
    source: z.literal('shared_memory'),
    uri: HistoricalSharedMemoryUriSchema,
    doc_name: NonEmptyStringSchema,
    conversation_id: NonEmptyStringSchema,
    instance_id: NonEmptyStringSchema,
    version: z.number().int().positive(),
    updated_at_ms: NonNegativeIntegerSchema.nullable(),
    size_chars: NonNegativeIntegerSchema,
    content: z.string(),
  })
  .strict();

export const HistoricalEvidenceArtifactReadDataSchema = z
  .object({
    source: z.literal('evidence'),
    uri: EvidenceBundleUriSchema,
    bundle_id: NonEmptyStringSchema,
    evidence_instance_id: NonEmptyStringSchema,
    item_count: NonNegativeIntegerSchema,
    size_chars: NonNegativeIntegerSchema,
    content: z.string(),
  })
  .strict();

export const HistoricalCitationSnapshotArtifactReadDataSchema = z
  .object({
    source: z.literal('citation_snapshot'),
    uri: CitationSnapshotBundleUriSchema,
    bundle_id: NonEmptyStringSchema,
    citation_count: NonNegativeIntegerSchema,
    size_chars: NonNegativeIntegerSchema,
    content: z.string(),
  })
  .strict();

export const HistoricalConversationArtifactReadDataSchema = z.discriminatedUnion('source', [
  HistoricalSharedMemoryArtifactReadDataSchema,
  HistoricalEvidenceArtifactReadDataSchema,
  HistoricalCitationSnapshotArtifactReadDataSchema,
]);
export type HistoricalConversationArtifactReadData = z.infer<
  typeof HistoricalConversationArtifactReadDataSchema
>;

const HistoricalSharedMemoryArtifactReadResultSchema = z
  .object({
    data: HistoricalSharedMemoryArtifactReadDataSchema,
    observation: NonEmptyStringSchema,
    observationPreviewMeta: z.object({ doc_name: NonEmptyStringSchema }).strict(),
  })
  .strict();

const HistoricalEvidenceArtifactReadResultSchema = z
  .object({
    data: HistoricalEvidenceArtifactReadDataSchema,
    observation: NonEmptyStringSchema,
    observationPreviewMeta: z.object({ document_name: NonEmptyStringSchema }).strict(),
  })
  .strict();

const HistoricalCitationSnapshotArtifactReadResultSchema = z
  .object({
    data: HistoricalCitationSnapshotArtifactReadDataSchema,
    observation: NonEmptyStringSchema,
    observationPreviewMeta: z.object({ document_name: NonEmptyStringSchema }).strict(),
  })
  .strict();

export const HistoricalConversationArtifactReadResultSchema = z.union([
  HistoricalSharedMemoryArtifactReadResultSchema,
  HistoricalEvidenceArtifactReadResultSchema,
  HistoricalCitationSnapshotArtifactReadResultSchema,
]);
export type HistoricalConversationArtifactReadResult = z.infer<
  typeof HistoricalConversationArtifactReadResultSchema
>;

export function parseHistoricalConversationArtifactReadResult(
  value: unknown
): HistoricalConversationArtifactReadResult {
  return HistoricalConversationArtifactReadResultSchema.parse(value);
}
