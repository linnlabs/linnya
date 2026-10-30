import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, shallowRef } from 'vue';
import { expect, it, vi } from 'vitest';
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
import { createSlideThumbnailSources } from '../../renderer/features/deckNavigator/functions/createSlideThumbnailSources';

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
    const profiles = new SandboxProfileRegistry(); profiles.register(pptComposeProfile);
    const builder = new CodegenDeckBuilder({ presentationRepo: repository,
      sandbox: new SandboxService(profiles, createSandboxEvaluatorTestRunner()),
      engine: { assembleDeck: materialize }, buildExecution: createInProcessPresentationBuildExecution(),
    });
    const initialDeck = await builder.buildDeckSpecFromSource({ nodeId: 'deck', source });
    const thumbnailKeys = (deck: DeckSpec) => createSlideThumbnailSources(new RenderModelMapper()
      .fromGeneratedDeck('deck', 1, 'Deck', deck, { width: 13.333, height: 7.5 }))
      .map(page => page.contentKey);
    const initialThumbnailKeys = thumbnailKeys(initialDeck);
    await repository.createPresentation('deck', initialDeck, { deckSource: source, pptxBuffer: await materialize(initialDeck), origin: 'codegen' });
    const compile = vi.spyOn(builder, 'commitManualEditFromSource');
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
    expect(compile).not.toHaveBeenCalled();
    const inserted = await repository.getPresentation('deck');
    if (!inserted) throw new Error('Missing inserted revision');
    // 快速路径与真实 sandbox + Yoga 全量编译逐字段相等，包含源码行号与布局诊断。
    expect(inserted.deckSpec).toEqual(await builder.buildDeckSpecFromSource({ nodeId: 'deck', source: inserted.deckSource }));
    expect(thumbnailKeys(inserted.deckSpec).filter((_key, index) => index !== 1)).toEqual(initialThumbnailKeys);
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

    const reopenedBuilder = new CodegenDeckBuilder({ presentationRepo: reopened,
      sandbox: new SandboxService(profiles, createSandboxEvaluatorTestRunner()),
      engine: { assembleDeck: materialize }, buildExecution: createInProcessPresentationBuildExecution(),
    });
    const edits = new PresentationManualEditingRuntime({ presentationRepo: reopened, builder: reopenedBuilder });
    async function edit(operation: import('@plugin/slides/shared').SlidesManualEditCommand['operation']) {
      const current = await reopened.getPresentation('deck');
      if (!current) throw new Error('Missing current document');
      const command = { commandId: crypto.randomUUID(), documentId: 'deck', operation,
        expectedBase: { revisionId: current.currentRevisionId, revision: current.currentRevision, sourceHash: current.sourceHash } };
      const result = await edits.submit(command);
      expect(result).toMatchObject({ status: 'committed' });
      // 同一命令重试不能再增加一页或再次删除。
      expect(await edits.submit(command)).toEqual(result);
    }
    await edit({ op: 'set_text_content', targetKind: 'text', target: { slideKey: 'cover', editKey: 'title' }, content: 'Edited cover' });
    await edit({ op: 'duplicate_slide', index: 0 });
    let copied = await reopened.getPresentation('deck');
    expect(copied?.deckSpec.slides).toHaveLength(4);
    expect(copied?.deckSpec.slides[1]?.spec.elements[0]).toMatchObject({ content: 'Edited cover', _authoringRef: { slideKey: 'copied-slide-1' } });
    if (!copied) throw new Error('Missing copied revision');
    expect(thumbnailKeys(copied.deckSpec)[1]).toBe(thumbnailKeys(copied.deckSpec)[0]);
    await edit({ op: 'set_text_content', targetKind: 'text', target: { slideKey: 'copied-slide-1', editKey: 'title' }, content: 'Independent copy' });
    copied = await reopened.getPresentation('deck');
    expect(copied?.deckSpec.slides[0]?.spec.elements[0]).toMatchObject({ content: 'Edited cover' });
    expect(copied?.deckSpec.slides[1]?.spec.elements[0]).toMatchObject({ content: 'Independent copy' });
    // 原页删除后副本仍可独立重建，原页人工记录也同步清除。
    await edit({ op: 'delete_slide', index: 0 });
    const deleted = await reopened.getPresentation('deck');
    if (!deleted) throw new Error('Missing deleted revision');
    expect(deleted.deckSpec.slides).toHaveLength(3);
    expect(deleted.deckSpec).toEqual(await reopenedBuilder.buildDeckSpecFromSource({ nodeId: 'deck', source: deleted.deckSource }));
    const finalZip = await JSZip.loadAsync((await artifact.loadCurrent('deck')).pptxBuffer);
    expect(await finalZip.file('ppt/slides/slide1.xml')?.async('string')).toContain('Independent copy');
    expect(finalZip.file('ppt/slides/slide4.xml')).toBeNull();
    db.close(); db = new Database(path);
    expect((await new PresentationRepository(db).getPresentation('deck'))?.deckSpec).toEqual(deleted.deckSpec);
  } finally {
    scope.stop(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
