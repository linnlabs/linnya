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
import type { DeckSpec, SlidesManualEditCommand } from '@plugin/slides/shared';
import { useManualEditQueue, useSlidesManualEditingStore } from '../../renderer/features/manualEditing';
import { PresentationRepository } from '../persistence/repositories/PresentationRepository';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../persistence/schemas/presentation.schema';
import { PRESENTATION_MANUAL_EDIT_SCHEMAS, PresentationManualEditingRuntime } from '../features/presentationManualEditing';
import { PresentationPptxArtifactRuntime } from '../features/presentationPptxArtifact';
import { createInProcessPresentationBuildExecution, materializePresentationPptx } from '../features/presentationBuildExecution';
import { CodegenDeckBuilder } from '../codegen/CodegenDeckBuilder';
import { pptComposeProfile } from '../sandbox/pptComposeProfile';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper';
import type { ManualEditQueueSnapshot } from '../../renderer/features/manualEditing/definitions/manualEditQueuePorts';

const source = `const slide = createSlide({ slideKey: 'overview' });
const badge = createShape({ editKey: 'badge', geometry: 'rect', content: 'Original', fill: '#224466' });
badge.position = 'absolute'; badge.x = 1; badge.y = 1; badge.w = 3; badge.h = 1;
slide.add(badge);
compose({ title: 'Save lifecycle', slides: [slide] });`;

const initialDeck: DeckSpec = { title: 'Save lifecycle', layout: '16x9', slides: [{ slideNumber: 1,
  spec: { type: 'freeform', elements: [{ type: 'shape', geometry: 'rect', content: 'Original',
    position: { x: 1, y: 1, w: 3, h: 1 }, style: { paint: { type: 'solid', color: '#224466' } },
    _authoringRef: { slideKey: 'overview', editKey: 'badge', targetKind: 'shape' },
  }] },
}] };
const materialize = async (deckSpec: DeckSpec) => Buffer.from(await materializePresentationPptx({ deckSpec, svgAssets: [], svgFallbacks: [] }));

it('连续编辑经真实编译与 SQLite 保存后，重开及延迟 PPTX 导出读取相同内容', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'slides-save-reopen-'));
  const path = join(directory, 'workspace.sqlite');
  let db = new Database(path);
  const scope = effectScope();
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY, project_id TEXT, type TEXT, name TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
      CREATE TABLE workspace_node_text_snapshots (node_id TEXT PRIMARY KEY, content_type TEXT NOT NULL, text TEXT NOT NULL,
        metadata_json TEXT, source_plugin_id TEXT, source_node_type TEXT, updated_at INTEGER NOT NULL);
      INSERT INTO workspace_nodes VALUES ('deck', 'project', 'presentation', 'save.slides', 1, 1, NULL);`);
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
      const model = new RenderModelMapper().fromGeneratedDeck('deck', saved.currentRevision, saved.title,
        saved.deckSpec, { width: 13.333, height: 7.5 });
      snapshot.value = { documentId: 'deck', presentationError: null, renderVersion: model.version, buildState: { state: 'ready',
        presentationId: 'deck', versionId: saved.currentRevisionId, versionNumber: saved.currentRevision, sourceHash: saved.sourceHash } };
      store.recordPresentedRevision(model.version);
    }
    await refresh();
    const commands: SlidesManualEditCommand[] = [];
    const queue = scope.run(() => useManualEditQueue({ readSnapshot: () => snapshot.value,
      createCommandId: () => crypto.randomUUID(), message: key => key, refreshDocument: refresh,
      submit: command => { commands.push(command); return backend.submit(command); },
    }));
    if (!queue) throw new Error('Missing queue');
    const target = { slideKey: 'overview', editKey: 'badge' };
    queue.enqueue({ operation: { op: 'set_text_content', target, targetKind: 'shape', content: 'Saved\nsecond line' } });
    queue.enqueue({ operation: { op: 'translate_by', target, targetKind: 'shape', delta: { dx: 0.5, dy: 0.25 } } });
    queue.enqueue({ operation: { op: 'set_fill_color', target, targetKind: 'shape', color: '#CC5500' } });
    await queue.flush();
    expect(commands.map(command => command.expectedBase.revision)).toEqual([1, 2, 3]);
    const saved = await repository.getPresentation('deck');
    expect(saved?.currentRevision).toBe(4);
    expect(saved?.pptxArtifact.state).toBe('deferred');
    scope.stop();
    db.close(); db = new Database(path);
    const reopened = new PresentationRepository(db);
    const read = await reopened.getPresentation('deck');
    expect(read?.deckSpec).toEqual(saved?.deckSpec);
    expect(read?.deckSource).toContain('Saved\\nsecond line');
    const artifact = new PresentationPptxArtifactRuntime({ repository: reopened,
      materialize: record => materialize(record.deckSpec) });
    const exported = await artifact.loadCurrent('deck');
    expect(exported.revision).toBe(4);
    const zip = await JSZip.loadAsync(exported.pptxBuffer);
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(xml).toContain('Saved'); expect(xml).toContain('second line');
    expect(xml).not.toContain('Original'); expect(xml).toContain('CC5500');
    expect(xml).toContain('x="1371600"'); // 1.5 in，确保位移也进入正式导出。
    expect(xml).toContain('y="1143000"'); // 1.25 in。
    expect((await reopened.getPresentation('deck'))?.pptxArtifact.state).toBe('ready');
  } finally {
    scope.stop(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
