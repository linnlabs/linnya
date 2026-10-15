import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, shallowRef } from 'vue';
import { expect, it } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { SlideMarkerIndex, type DeckSpec } from '@plugin/slides/shared';
import { useManualEditQueue, useSlidesManualEditingStore } from '../../renderer/features/manualEditing';
import type { ManualEditQueueSnapshot } from '../../renderer/features/manualEditing/definitions/manualEditQueuePorts';
import { PresentationRepository } from '../persistence/repositories/PresentationRepository';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../persistence/schemas/presentation.schema';
import { PRESENTATION_MANUAL_EDIT_SCHEMAS, PresentationManualEditingRuntime } from '../features/presentationManualEditing';
import { PresentationPptxArtifactRuntime } from '../features/presentationPptxArtifact';
import { createInProcessPresentationBuildExecution, materializePresentationPptx } from '../features/presentationBuildExecution';
import { CodegenDeckBuilder } from '../codegen/CodegenDeckBuilder';
import { pptComposeProfile } from '../sandbox/pptComposeProfile';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper';

const source = `const cover = createSlide({ slideKey: 'cover', background: { color: '#0B0B0F' } });
cover.add(createText({ editKey: 'title', content: 'LUMA', color: '#F5F5F5' }));

// Closing page
const closing = createSlide({ slideKey: 'closing', background: { color: '#0B0B0F' } });
closing.add(createText({ editKey: 'thanks', content: 'Thanks', color: '#F5F5F5' }));

compose({
  title: 'Insert lifecycle',
  theme: { colors: { background: '#0B0B0F', text: '#F5F5F5' } },
  slides: [cover, closing],
});`;

const initialDeck: DeckSpec = {
  title: 'Insert lifecycle',
  layout: '16x9',
  theme: { colors: { background: '#0B0B0F', text: '#F5F5F5' } },
  slides: [1, 2].map(slideNumber => ({
    slideNumber,
    spec: { type: 'freeform' as const, elements: [], background: { paint: { type: 'solid' as const, color: '#0B0B0F' } } },
  })),
};
const materialize = async (deckSpec: DeckSpec) => Buffer.from(await materializePresentationPptx({ deckSpec, svgAssets: [], svgFallbacks: [] }));

it('界面新建空白页经真实编译、SQLite 保存与重开后，页序、主题背景和 PPTX 页数一致', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'slides-insert-reopen-'));
  const path = join(directory, 'workspace.sqlite');
  let db = new Database(path);
  const scope = effectScope();
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY, project_id TEXT, type TEXT, name TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
      CREATE TABLE workspace_node_text_snapshots (node_id TEXT PRIMARY KEY, content_type TEXT NOT NULL, text TEXT NOT NULL,
        metadata_json TEXT, source_plugin_id TEXT, source_node_type TEXT, updated_at INTEGER NOT NULL);
      INSERT INTO workspace_nodes VALUES ('deck', 'project', 'presentation', 'insert.slides', 1, 1, NULL);`);
    for (const ddl of [...PRESENTATION_DOCUMENT_SCHEMAS, ...PRESENTATION_MANUAL_EDIT_SCHEMAS]) db.exec(ddl);
    const repository = new PresentationRepository(db);
    await repository.createPresentation('deck', initialDeck, { deckSource: source, pptxBuffer: await materialize(initialDeck), origin: 'codegen' });
    const profiles = new SandboxProfileRegistry(); profiles.register(pptComposeProfile);
    const builder = new CodegenDeckBuilder({ presentationRepo: repository,
      sandbox: new SandboxService(profiles, createSandboxEvaluatorTestRunner()),
      engine: { assembleDeck: materialize }, buildExecution: createInProcessPresentationBuildExecution(),
    });
    const backend = new PresentationManualEditingRuntime({ presentationRepo: repository, builder });
    setActivePinia(createPinia());
    const store = useSlidesManualEditingStore();
    const snapshot = shallowRef<ManualEditQueueSnapshot>({ documentId: 'deck', presentationError: null, buildState: null, renderVersion: null });
    async function refresh() {
      const saved = await repository.getPresentation('deck');
      if (!saved) throw new Error('Missing saved presentation');
      snapshot.value = { documentId: 'deck', presentationError: null, renderVersion: saved.currentRevision, buildState: { state: 'ready',
        presentationId: 'deck', versionId: saved.currentRevisionId, versionNumber: saved.currentRevision, sourceHash: saved.sourceHash } };
      store.recordPresentedRevision(saved.currentRevision);
    }
    await refresh();
    const queue = scope.run(() => useManualEditQueue({ readSnapshot: () => snapshot.value,
      createCommandId: () => crypto.randomUUID(), message: key => key, refreshDocument: refresh,
      submit: command => backend.submit(command),
    }));
    if (!queue) throw new Error('Missing queue');

    const ticket = queue.enqueue({ operation: { op: 'insert_blank_slide', index: 1 } });
    await queue.flush();
    expect(await ticket.settled).toMatchObject({ status: 'presented', revision: 2 });
    scope.stop();

    db.close(); db = new Database(path);
    const reopened = new PresentationRepository(db);
    const read = await reopened.getPresentation('deck');
    if (!read) throw new Error('Missing reopened document');
    expect(read.currentRevision).toBe(2);
    expect(read.deckSpec.slides).toHaveLength(3);
    expect(read.deckSource).toContain('slides: [cover, blankSlide1, closing]');
    expect(read.deckSource).toContain('// Closing page');
    // 源码页码切片与 compose 顺序一致，Agent 读取第 2 页得到的正是新空白页。
    expect(SlideMarkerIndex.build(read.deckSource).sliceSlide(2)).toContain('slideKey: "blank-slide-1"');

    const model = new RenderModelMapper().fromGeneratedDeck('deck', read.currentRevision, read.title, read.deckSpec, { width: 13.333, height: 7.5 });
    expect(model.slides).toHaveLength(3);
    expect(model.slides[1]?.background).toMatchObject({ paint: { type: 'solid', color: '#0B0B0F' } });
    expect(model.slides[1]?.elements).toEqual([]);
    expect(model.slides[2]?.elements.some(node => node.authoringRef?.editKey === 'thanks')).toBe(true);

    const artifact = new PresentationPptxArtifactRuntime({ repository: reopened,
      materialize: record => materialize(record.deckSpec) });
    const exported = await artifact.loadCurrent('deck');
    const zip = await JSZip.loadAsync(exported.pptxBuffer);
    expect(zip.file('ppt/slides/slide3.xml')).not.toBeNull();
    expect(await zip.file('ppt/slides/slide2.xml')?.async('string')).toContain('0B0B0F');
    expect(await zip.file('ppt/slides/slide3.xml')?.async('string')).toContain('Thanks');
  } finally {
    scope.stop(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
