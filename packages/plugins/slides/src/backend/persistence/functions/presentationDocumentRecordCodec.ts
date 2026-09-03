import type { DeckSpec } from '@plugin/slides/shared/deckSpec';
import {
  normalizeDeckSpecLineSpacingInput,
  normalizeSlideLayout,
} from '@plugin/slides/shared/deckSpec';
import { normalizeDeckSpecColors } from '@plugin/slides/shared/visual';
import { PresentationSourceConsistencyError } from '../../features/presentationSourceHistory/definitions/presentationSourceRevision.js';
import { hashPresentationSource } from '../../features/presentationSourceHistory/functions/presentationSourceHash.js';
import type { PresentationDocumentRecord } from '../definitions/presentationRepository.js';

/** SQLite current document 的稳定行合同，供读写 repository 与 standalone 只读 adapter 共用。 */
export interface StoredPresentationDocumentRow {
  readonly node_id: string;
  readonly current_revision_id: string;
  readonly current_revision: number;
  readonly deck_source: string;
  readonly source_hash: string;
  readonly deck_spec_json: string;
  readonly pptx_buffer: Buffer;
  readonly title: string;
  readonly slide_count: number;
  readonly layout: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly author_id: string | null;
}

export function readPresentationDocumentRow(value: unknown): StoredPresentationDocumentRow {
  if (
    !isRecord(value)
    || typeof value.node_id !== 'string'
    || typeof value.current_revision_id !== 'string'
    || !isFiniteInteger(value.current_revision)
    || typeof value.deck_source !== 'string'
    || typeof value.source_hash !== 'string'
    || typeof value.deck_spec_json !== 'string'
    || !Buffer.isBuffer(value.pptx_buffer)
    || typeof value.title !== 'string'
    || !isFiniteInteger(value.slide_count)
    || !isNullableString(value.layout)
    || !isFiniteInteger(value.created_at)
    || !isFiniteInteger(value.updated_at)
    || !isNullableString(value.author_id)
  ) {
    throw new PresentationSourceConsistencyError('Slides current document 行结构非法。');
  }
  return {
    node_id: value.node_id,
    current_revision_id: value.current_revision_id,
    current_revision: value.current_revision,
    deck_source: value.deck_source,
    source_hash: value.source_hash,
    deck_spec_json: value.deck_spec_json,
    pptx_buffer: value.pptx_buffer,
    title: value.title,
    slide_count: value.slide_count,
    layout: value.layout,
    created_at: value.created_at,
    updated_at: value.updated_at,
    author_id: value.author_id,
  };
}

export function mapPresentationDocumentRow(
  row: StoredPresentationDocumentRow,
): PresentationDocumentRecord {
  assertPresentationDocumentSourceHash(row);
  return {
    nodeId: row.node_id,
    currentRevisionId: row.current_revision_id,
    currentRevision: row.current_revision,
    deckSource: row.deck_source,
    sourceHash: row.source_hash,
    deckSpec: parseStoredDeckSpec(row.deck_spec_json),
    pptxBuffer: row.pptx_buffer,
    title: row.title,
    slideCount: row.slide_count,
    layout: row.layout ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorId: row.author_id ?? undefined,
  };
}

export function parseStoredDeckSpec(json: string): DeckSpec {
  const parsed = normalizeDeckSpecLineSpacingInput(JSON.parse(json));
  if (!isDeckSpec(parsed)) {
    throw new Error('Stored Slides deck spec is invalid.');
  }
  return normalizeDeckSpecOrThrow(parsed);
}

export function normalizeDeckSpecOrThrow(deckSpec: DeckSpec): DeckSpec {
  const layoutResult = normalizeSlideLayout(deckSpec.layout ?? '16x9');
  if ('error' in layoutResult) throw new Error(layoutResult.error);
  const normalizedDeck = normalizeDeckSpecColors({
    ...deckSpec,
    ...(deckSpec.layout === undefined ? {} : { layout: layoutResult.value }),
  });
  if ('error' in normalizedDeck) {
    throw new Error(normalizedDeck.error);
  }
  return normalizedDeck.value;
}

function assertPresentationDocumentSourceHash(row: StoredPresentationDocumentRow): void {
  if (hashPresentationSource(row.deck_source) !== row.source_hash) {
    throw new PresentationSourceConsistencyError(
      `Slides current document ${row.node_id} 的 source hash 不一致。`,
    );
  }
}

function isDeckSpec(value: unknown): value is DeckSpec {
  return isRecord(value)
    && typeof value.title === 'string'
    && Array.isArray(value.slides)
    && value.slides.every((slide) => (
      isRecord(slide)
      && isFiniteInteger(slide.slideNumber)
      && isRecord(slide.spec)
      && (slide.spec.type === 'structured' || slide.spec.type === 'freeform')
      && Array.isArray(slide.spec.elements)
    ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}
