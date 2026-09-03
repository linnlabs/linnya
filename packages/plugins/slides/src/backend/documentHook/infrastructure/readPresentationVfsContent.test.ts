import { describe, expect, it } from 'vitest';
import type {
  DocumentTypeBackendReadDatabase,
  DocumentTypeBackendStatement,
} from '@plugin/backend/documentTypeBackendHook';

import { readPresentationVfsContent } from './readPresentationVfsContent';

const SOURCE = [
  'const cover = createSlide();',
  'createText({ content: "Cover" });',
  'const detail = createSlide();',
  'createText({ content: "Detail" });',
  'compose({ title: "Deck", slides: [cover, detail] });',
].join('\n');

interface PresentationDocumentRow {
  readonly current_revision_id: string;
  readonly node_id: string;
  readonly current_revision: number;
  readonly deck_source: string;
  readonly title: string;
  readonly slide_count: number;
}

interface PresentationDraftRow {
  readonly node_id: string;
  readonly deck_source: string;
  readonly source_hash: string;
  readonly base_revision_id: string;
  readonly base_revision: number;
  readonly last_error_summary: string | null;
  readonly last_error_kind: string | null;
  readonly updated_at: number;
}

class FakeStatement implements DocumentTypeBackendStatement {
  constructor(
    private readonly sql: string,
    private readonly db: FakeSlidesDatabase,
  ) {}

  get(...params: readonly unknown[]): unknown {
    const [nodeId, currentRevisionId, currentRevision] = params;
    if (typeof nodeId !== 'string') return undefined;
    if (this.sql.includes('FROM presentation_documents')) {
      return this.db.presentationDocuments.find((row) => row.node_id === nodeId);
    }
    if (this.sql.includes('FROM presentation_drafts')) {
      return this.db.presentationDrafts.find((row) => (
        row.node_id === nodeId
        && row.base_revision_id === currentRevisionId
        && row.base_revision === currentRevision
      ));
    }
    return undefined;
  }

  all(): unknown[] {
    return [];
  }

  run(): unknown {
    return { changes: 0 };
  }
}

class FakeSlidesDatabase implements DocumentTypeBackendReadDatabase {
  readonly presentationDocuments: PresentationDocumentRow[] = [];
  readonly presentationDrafts: PresentationDraftRow[] = [];

  prepare(sql: string): DocumentTypeBackendStatement {
    return new FakeStatement(sql, this);
  }
}

function seedDocument(db: FakeSlidesDatabase, params?: {
  readonly deckSource?: string;
  readonly title?: string;
}): void {
  const deckSource = params && 'deckSource' in params ? params.deckSource : SOURCE;
  db.presentationDocuments.push({
    current_revision_id: 'version-1',
    node_id: 'slides-1',
    current_revision: 1,
    deck_source: deckSource ?? SOURCE,
    title: params?.title ?? 'Deck',
    slide_count: 2,
  });
}

describe('readPresentationVfsContent', () => {
  it('reads compiled deck source with stable source metadata', () => {
    const db = new FakeSlidesDatabase();
    seedDocument(db);

    const result = readPresentationVfsContent({
      db,
      nodeId: 'slides-1',
      nodeName: 'deck.slides',
      nodePath: '/deck.slides',
    });

    expect(result?.contentType).toBe('text/plain');
    expect(result?.text).toBe(SOURCE);
    expect(result?.metadata).toEqual({
      versionNumber: 1,
      versionId: 'version-1',
      title: 'Deck',
      slideCount: 2,
      totalLines: 5,
      sourceOrigin: 'compiled',
      sourceKey: 'compiled:version-1',
    });
  });

  it('prefers pending draft source and exposes draft status', () => {
    const db = new FakeSlidesDatabase();
    seedDocument(db);
    const draftSource = SOURCE.replace('Detail', 'Draft Detail');
    db.presentationDrafts.push({
      node_id: 'slides-1',
      deck_source: draftSource,
      source_hash: 'draft-hash',
      base_revision_id: 'version-1',
      base_revision: 1,
      last_error_summary: 'Sandbox failed',
      last_error_kind: 'sandbox',
      updated_at: 2000,
    });

    const result = readPresentationVfsContent({
      db,
      nodeId: 'slides-1',
      nodeName: 'deck.slides',
      nodePath: '/deck.slides',
    });

    expect(result?.text).toBe(draftSource);
    expect(result?.metadata).toMatchObject({
      sourceOrigin: 'draft',
      sourceKey: 'draft:draft-hash',
      draftStatus: {
        baseVersionId: 'version-1',
        baseVersionNumber: 1,
        errorKind: 'sandbox',
        errorSummary: 'Sandbox failed',
        updatedAt: 2000,
      },
    });
  });

  it('reads a syntactically invalid pending draft as exact source text', () => {
    const db = new FakeSlidesDatabase();
    seedDocument(db);
    const invalidDraftSource = [
      'const slide = createSlide();',
      'compose({ title: "Broken", slides: [slide]',
    ].join('\n');
    db.presentationDrafts.push({
      node_id: 'slides-1',
      deck_source: invalidDraftSource,
      source_hash: 'invalid-draft-hash',
      base_revision_id: 'version-1',
      base_revision: 1,
      last_error_summary: 'Unexpected token',
      last_error_kind: 'slides.codegen.typecheck',
      updated_at: 3000,
    });

    const result = readPresentationVfsContent({
      db,
      nodeId: 'slides-1',
      nodeName: 'broken.slides',
      nodePath: '/broken.slides',
    });

    expect(result?.text).toBe(invalidDraftSource);
    expect(result?.metadata).toMatchObject({
      sourceOrigin: 'draft',
      sourceKey: 'draft:invalid-draft-hash',
      draftStatus: {
        errorKind: 'slides.codegen.typecheck',
        errorSummary: 'Unexpected token',
      },
    });
  });

  it('ignores a draft whose base revision is no longer current', () => {
    const db = new FakeSlidesDatabase();
    seedDocument(db);
    db.presentationDrafts.push({
      node_id: 'slides-1',
      deck_source: SOURCE.replace('Detail', 'Stale Draft Detail'),
      source_hash: 'stale-draft-hash',
      base_revision_id: 'older-version',
      base_revision: 0,
      last_error_summary: 'Sandbox failed',
      last_error_kind: 'sandbox',
      updated_at: 2000,
    });

    const result = readPresentationVfsContent({
      db,
      nodeId: 'slides-1',
      nodeName: 'deck.slides',
      nodePath: '/deck.slides',
    });

    expect(result?.text).toBe(SOURCE);
    expect(result?.metadata).toMatchObject({
      sourceOrigin: 'compiled',
      sourceKey: 'compiled:version-1',
    });
    expect(result?.metadata).not.toHaveProperty('draftStatus');
  });

  it('returns structure view as markdown while preserving metadata', () => {
    const db = new FakeSlidesDatabase();
    seedDocument(db, { title: 'Structure Deck' });

    const result = readPresentationVfsContent({
      db,
      nodeId: 'slides-1',
      nodeName: 'deck.slides',
      nodePath: '/deck.slides',
      viewKind: 'presentation_structure',
    });

    expect(result?.contentType).toBe('text/markdown');
    expect(result?.text).toContain('# Structure Deck');
    expect(result?.text).toContain('- source_origin: compiled');
    expect(result?.metadata).toMatchObject({
      title: 'Structure Deck',
      slideCount: 2,
      sourceOrigin: 'compiled',
    });
  });

  it('returns null when the current document does not exist', () => {
    const db = new FakeSlidesDatabase();

    const result = readPresentationVfsContent({
      db,
      nodeId: 'slides-1',
      nodeName: 'deck.slides',
      nodePath: '/deck.slides',
    });

    expect(result).toBeNull();
  });
});
