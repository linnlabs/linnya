import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeckSpec } from '@plugin/slides/shared/deckSpec';
import { hashPresentationSource } from '../../../features/presentationSourceHistory/functions/presentationSourceHash';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../../../persistence/schemas/presentation.schema';
import { PRESENTATION_IMAGE_BINDING_SCHEMAS } from '../../../persistence/schemas/presentationImageBinding.schema';
import { StandalonePresentationSnapshotReader } from '../infrastructure/StandalonePresentationSnapshotReader';
import { StandaloneSlidesCliExecutionRuntime } from './StandaloneSlidesCliExecutionRuntime';
import { SlidesCliExitCode } from '../definitions/slidesCli';

const SOURCE = [
  'const slide = createSlide();',
  'compose({ title: "Standalone", slides: [slide] });',
].join('\n');

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const DECK_SPEC: DeckSpec = {
  title: 'Standalone',
  layout: '16x9',
  slides: [
    {
      slideNumber: 1,
      spec: { type: 'structured', elements: [] },
    },
  ],
};

describe('StandaloneSlidesCliExecutionRuntime', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE workspace_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);
    for (const ddl of [...PRESENTATION_DOCUMENT_SCHEMAS, ...PRESENTATION_IMAGE_BINDING_SCHEMAS]) {
      db.exec(ddl);
    }
    seedPresentation(db);
  });

  afterEach(() => db.close());

  it('从单一只读投影加载 current document、项目与 draft 状态', () => {
    const snapshot = new StandalonePresentationSnapshotReader(db).read('deck-1');

    expect(snapshot).toMatchObject({
      projectId: 'project-1',
      hasCurrentDraft: false,
      currentDraft: null,
      document: {
        nodeId: 'deck-1',
        currentRevisionId: 'revision-1',
        currentRevision: 1,
        deckSource: SOURCE,
        title: 'Standalone',
      },
    });
  });

  it('复用生产渲染与诊断规则，并从 deck.js AST 给出页级源码位置', async () => {
    const result = await new StandaloneSlidesCliExecutionRuntime(db).inspectPresentation({
      presentationId: 'deck-1',
      selection: { kind: 'all' },
      includeHeuristics: false,
    });

    expect(result.versionId).toBe('revision-1');
    expect(result.renderModel.slides).toHaveLength(1);
    expect(result.feedback.pageSummaries[0]?.sourceLocation).toEqual({
      file: 'deck.js',
      slideNumber: 1,
      startLine: 1,
      endLine: 2,
    });
  });

  it('从持久化 DeckSpec 构建 RenderModel 时保留 canonical Paint', async () => {
    const backgroundPaint = { type: 'solid' as const, color: '#FBF8F2' };
    const shapePaint = { type: 'solid' as const, color: '#EEF2EE' };
    updateDeckSpec(db, {
      ...DECK_SPEC,
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { paint: backgroundPaint },
            elements: [
              {
                type: 'shape',
                geometry: 'roundRect',
                position: { x: 1, y: 1, w: 4, h: 2 },
                style: { paint: shapePaint, borderRadius: 0.12 },
              },
            ],
          },
        },
      ],
    });

    const result = await new StandaloneSlidesCliExecutionRuntime(db).inspectPresentation({
      presentationId: 'deck-1',
      selection: { kind: 'all' },
      includeHeuristics: false,
    });

    expect(result.renderModel.slides[0]?.background.paint).toEqual(backgroundPaint);
    expect(result.renderModel.slides[0]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'shape',
          fill: shapePaint,
          cornerRadius: 0.12,
        }),
      ])
    );
  });

  it('只读检查可重放未绑定的历史自包含图片，且不会补写 binding', async () => {
    updateDeckSpec(db, {
      ...DECK_SPEC,
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              {
                type: 'image',
                src: { kind: 'data_uri', dataUri: PNG_DATA_URI },
                position: { x: 1, y: 1, w: 2, h: 2 },
              },
            ],
          },
        },
      ],
    });

    const result = await new StandaloneSlidesCliExecutionRuntime(db).inspectPresentation({
      presentationId: 'deck-1',
      selection: { kind: 'all' },
      includeHeuristics: false,
    });

    expect(result.renderModel.slides[0]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          assetRef: { type: 'data', dataUri: PNG_DATA_URI },
        }),
      ])
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM presentation_image_bindings').get()).toEqual({
      count: 0,
    });
  });

  it('只读检查拒绝临时接管未绑定的本地图片', async () => {
    updateDeckSpec(db, {
      ...DECK_SPEC,
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              {
                type: 'image',
                src: { kind: 'local_path', path: '/tmp/unbound-history.png' },
                position: { x: 1, y: 1, w: 2, h: 2 },
              },
            ],
          },
        },
      ],
    });

    await expect(
      new StandaloneSlidesCliExecutionRuntime(db).inspectPresentation({
        presentationId: 'deck-1',
        selection: { kind: 'all' },
        includeHeuristics: false,
      })
    ).rejects.toMatchObject({
      failure: { code: 'slides.asset.local_source_unavailable' },
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presentation_image_bindings').get()).toEqual({
      count: 0,
    });
  });

  it('拒绝把 unresolved current draft 静默降级成旧 checkpoint', async () => {
    db.prepare(
      `
      INSERT INTO presentation_drafts (
        node_id, deck_source, source_hash, base_revision_id, base_revision,
        last_error_summary, last_error_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'deck-1',
      SOURCE,
      hashPresentationSource(SOURCE),
      'revision-1',
      1,
      'compile failed',
      'typecheck',
      1,
      1
    );

    await expect(
      new StandaloneSlidesCliExecutionRuntime(db).inspectPresentation({
        presentationId: 'deck-1',
        selection: { kind: 'all' },
        includeHeuristics: false,
      })
    ).rejects.toMatchObject({
      code: 'slides.cli.unresolved_draft',
      exitCode: SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
      message: expect.stringContaining('build_failure_code=slides.codegen.typecheck'),
    });
  });

  it('沿用 current document codec，显式拒绝源码 hash 损坏', () => {
    db.prepare("UPDATE presentation_documents SET source_hash = 'tampered' WHERE node_id = ?").run(
      'deck-1'
    );

    expect(() => new StandalonePresentationSnapshotReader(db).read('deck-1')).toThrow(
      'source hash 不一致'
    );
  });
});

function seedPresentation(db: Database.Database): void {
  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO workspace_nodes (id, project_id, type, name, created_at, updated_at)
      VALUES ('deck-1', 'project-1', 'presentation', 'deck.slides', 1, 1)
    `
    ).run();
    db.prepare(
      `
      INSERT INTO presentation_documents (
        node_id, current_revision_id, current_revision, deck_source, source_hash,
        deck_spec_json, pptx_buffer, title, slide_count, layout,
        created_at, updated_at, author_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'deck-1',
      'revision-1',
      1,
      SOURCE,
      hashPresentationSource(SOURCE),
      JSON.stringify(DECK_SPEC),
      Buffer.from('pptx'),
      'Standalone',
      1,
      '16x9',
      1,
      1,
      null
    );
    db.prepare(
      `
      INSERT INTO presentation_revisions (
        id, node_id, revision, parent_revision_id, base_source_hash, source_hash,
        storage_kind, source_checkpoint, source_patch, patch_bytes,
        created_at, author_id, origin
      ) VALUES (?, ?, ?, NULL, NULL, ?, 'checkpoint', ?, NULL, 0, 1, NULL, 'create')
    `
    ).run('revision-1', 'deck-1', 1, hashPresentationSource(SOURCE), SOURCE);
  })();
}

function updateDeckSpec(db: Database.Database, deckSpec: DeckSpec): void {
  db.prepare('UPDATE presentation_documents SET deck_spec_json = ? WHERE node_id = ?').run(
    JSON.stringify(deckSpec),
    'deck-1'
  );
}
