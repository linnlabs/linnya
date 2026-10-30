import * as z from 'zod';
import type { JsonValue } from '@app/schemas';
import type { DeckPreview } from '../../deckPreview';
import type { SlidesDocumentBuildState } from '../../documentSource';
import type { PresentationRenderModel } from '../../renderModel';
import type { ViewJsonRecord } from '../functions/pageContentCodec';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = { presentationId: z.string().min(1), versionId: z.string().min(1),
  versionNumber: z.number().finite().int().positive(), sourceHash: hash };
export const ViewBuildStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), ...identity }).strict(),
  z.object({ state: z.literal('draft'), ...identity, draftStatus: z.object({
    baseVersionId: z.string(), baseVersionNumber: z.number().finite().int(), updatedAt: z.number().finite(),
    errorKind: z.string().optional(), errorSummary: z.string().optional(),
  }).strict() }).strict(),
]);
const box = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() });
const asset = z.discriminatedUnion('type', [
  z.object({ type: z.literal('data'), dataUri: z.string() }),
  z.object({ type: z.literal('embedded'), partPath: z.string() }),
  z.object({ type: z.literal('external'), url: z.string() }),
]);
// chart 主题留在正式 preview 查询；导航只消费颜色、字体和作者摘要。
const PreviewSchema: z.ZodType<DeckPreview> = z.object({
  nodeId: z.string(), versionNumber: z.number().finite().int(), title: z.string(),
  slideSize: z.object({ width: z.number().finite().positive(), height: z.number().finite().positive() }),
  slides: z.array(z.object({ slideId: z.string(), number: z.number().finite().int(), layoutName: z.string().optional(),
    elements: z.array(z.object({ elementId: z.string(), type: z.enum(['text', 'chart', 'table', 'image', 'svgGraphic', 'formula', 'shape', 'group', 'other']),
      text: z.string().optional(), position: box.optional(), chartType: z.string().optional(), imageRef: asset.optional() })) })),
  theme: z.object({ colors: z.record(z.string(), z.string()), fonts: z.object({ major: z.string(), minor: z.string() }) }),
  warnings: z.array(z.object({ slideNumber: z.number().finite(), elementId: z.string().optional(),
    code: z.enum(['unsupported_element', 'parse_error', 'missing_asset', 'fidelity_fallback']), message: z.string() })),
});

export const ViewHeaderSchema = z.object({
  buildState: ViewBuildStateSchema, draftSourceHash: hash.optional(),
  preview: PreviewSchema.nullable(),
  render: z.object({ presentationId: z.string(), title: z.string(), version: z.number().finite().int(),
    sourceKind: z.enum(['generated', 'imported', 'patched']),
    slideSize: z.object({ width: z.number().finite().positive(), height: z.number().finite().positive(), unit: z.literal('in') }),
    capabilities: z.object({ hasSemanticRender: z.boolean(), hasReferencePreview: z.boolean(),
      hasHitTest: z.boolean(), hasSelection: z.boolean(), canEditSourceSelection: z.boolean().optional() }),
  }).strict().nullable(),
}).strict();
export type ViewHeader = z.infer<typeof ViewHeaderSchema>;
export const ViewManifestSchema = z.array(z.object({ slideId: z.string(), index: z.number().finite().int().nonnegative(),
  contentHash: hash, bindingHash: hash }).strict());
export type ViewManifest = z.infer<typeof ViewManifestSchema>;
export const ViewReadRequestSchema = z.object({ nodeId: z.string().min(1),
  knownHashes: z.array(hash).max(20_000),
  snapshotId: hash.optional(), offset: z.number().finite().int().nonnegative().optional(),
}).strict().refine(value => (value.snapshotId === undefined) === (value.offset === undefined), 'snapshotId and offset must be supplied together');
export type ViewReadRequest = z.infer<typeof ViewReadRequestSchema>;

function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value).every(isJson);
}
const record = z.custom<ViewJsonRecord>((value): value is ViewJsonRecord => isJson(value)
  && value !== null && typeof value === 'object' && !Array.isArray(value));
export const ViewReadResponseSchema = z.object({ formatVersion: z.literal(1), snapshotId: hash,
  nodeId: z.string(), header: ViewHeaderSchema.nullable(), manifest: ViewManifestSchema,
  blocks: z.array(z.object({ hash, value: record }).strict()), nextOffset: z.number().finite().int().nonnegative().nullable(),
}).strict();
export type ViewReadResponse = z.infer<typeof ViewReadResponseSchema>;
export interface InstalledPresentationView {
  readonly snapshotId: string;
  readonly buildState: SlidesDocumentBuildState;
  readonly preview: DeckPreview | null;
  readonly renderModel: PresentationRenderModel | null;
}
