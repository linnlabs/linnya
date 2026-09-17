import { EditorState, TextSelection } from '@tiptap/pm/state';
import { textContentToDocument, documentToTextContent, patchSelectedTextStyle } from '../../renderer/features/textEditing/functions/richTextDocument';
import { DOMParser } from '@xmldom/xmldom';
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
const caption = createText({ editKey: 'caption', content: [{ text: 'Revenue ', style: { bold: true } }, { text: '30%', style: { color: '#335577', fontSize: 18 } }] });
caption.position = 'absolute'; caption.x = 1; caption.y = 3; caption.w = 5; caption.h = 1;
slide.add(caption);
compose({ title: 'Save lifecycle', slides: [slide] });`;

const initialDeck: DeckSpec = { title: 'Save lifecycle', layout: '16x9', slides: [{ slideNumber: 1,
  spec: { type: 'freeform', elements: [{ type: 'shape', geometry: 'rect', content: 'Original',
    position: { x: 1, y: 1, w: 3, h: 1 }, style: { paint: { type: 'solid', color: '#224466' } },
    _authoringRef: { slideKey: 'overview', editKey: 'badge', targetKind: 'shape' },
  }, { type: 'text', content: [{ text: 'Revenue ', style: { bold: true } }, { text: '30%', style: { color: '#335577', fontSize: 18 } }],
    position: { x: 1, y: 3, w: 5, h: 1 }, _authoringRef: { slideKey: 'overview', editKey: 'caption', targetKind: 'text' },
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
    queue.enqueue({ operation: { op: 'set_visual_size', target, targetKind: 'shape',
      visualSize: { width: 3.5, height: 1.25 }, translationDelta: { dx: -0.5, dy: -0.25 } } });
    await queue.flush();
    expect(commands.map(command => command.expectedBase.revision)).toEqual([1, 2, 3, 4]);
    const saved = await repository.getPresentation('deck');
    expect(saved?.currentRevision).toBe(5);
    expect(saved?.pptxArtifact.state).toBe('deferred');
    const resizeCommand = commands[3];
    if (!resizeCommand || resizeCommand.operation.op !== 'set_visual_size') throw new Error('Missing resize command');
    // 同一缩放回执重放不能重复累计位移；换锚点位移必须判为不同载荷。
    expect(await backend.submit(resizeCommand)).toMatchObject({ status: 'committed', revision: 5 });
    expect(await backend.submit({ ...resizeCommand, operation: { ...resizeCommand.operation,
      translationDelta: { dx: -0.75, dy: -0.25 },
    } })).toMatchObject({ status: 'conflict', reason: 'command_reused' });

    // 同一正式队列接收前端选区事务产出的作者 runs，验证没有只改 DOM 而漏保存。
    const captionDoc = textContentToDocument([{ text: 'Revenue ', style: { bold: true } },
      { text: '30%', style: { color: '#335577', fontSize: 18 } }]);
    const captionState = EditorState.create({ doc: captionDoc, selection: TextSelection.create(captionDoc, 9, 12) });
    const captionContent = documentToTextContent(captionState.apply(patchSelectedTextStyle(captionState, { color: '#E11D48', fontSizePt: 28 })).doc);
    queue.enqueue({ operation: { op: 'set_text_content', targetKind: 'text', target: { slideKey: 'overview', editKey: 'caption' }, content: captionContent } });
    await queue.flush();
    const richSaved = await repository.getPresentation('deck');
    expect(richSaved?.currentRevision).toBe(6);
    const richCommand = commands[4];
    if (!richCommand || richCommand.operation.op !== 'set_text_content') throw new Error('Missing rich command');
    expect(await backend.submit({ ...richCommand, operation: { ...richCommand.operation, targetKind: 'text', content: [
      { text: 'Revenue ', style: { bold: true } }, { text: '30%', style: { fontSize: 28, color: '#E11D48' } },
    ] } })).toMatchObject({ status: 'committed', revision: 6 });
    scope.stop();
    db.close(); db = new Database(path);
    const reopened = new PresentationRepository(db);
    const read = await reopened.getPresentation('deck');
    expect(read?.deckSpec).toEqual(richSaved?.deckSpec);
    if (!read) throw new Error('Missing reopened document');
    const reopenedModel = new RenderModelMapper().fromGeneratedDeck('deck', read.currentRevision, read.title, read.deckSpec, { width: 13.333, height: 7.5 });
    const caption = reopenedModel.slides[0].elements.find(node => node.authoringRef?.editKey === 'caption');
    expect(caption?.authoringEdit).toMatchObject({ capabilities: expect.arrayContaining(['set_text_content']), text: { kind: 'rich_text', content: captionContent } });
    expect(read?.deckSource).toContain('Saved\\nsecond line');
    const artifact = new PresentationPptxArtifactRuntime({ repository: reopened,
      materialize: record => materialize(record.deckSpec) });
    const exported = await artifact.loadCurrent('deck');
    expect(exported.revision).toBe(6);
    const zip = await JSZip.loadAsync(exported.pptxBuffer);
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(xml).toContain('Saved'); expect(xml).toContain('second line');
    const document = new DOMParser().parseFromString(xml ?? '', 'application/xml');
    const textRuns = Array.from(document.getElementsByTagName('a:r'));
    const selectedRun = textRuns.find(run => run.getElementsByTagName('a:t')[0]?.textContent === '30%');
    expect(selectedRun?.getElementsByTagName('a:rPr')[0]?.getAttribute('sz')).toBe('2800');
    expect(selectedRun?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val')).toBe('E11D48');
    const retainedRun = textRuns.find(run => run.getElementsByTagName('a:t')[0]?.textContent === 'Revenue ');
    expect(retainedRun?.getElementsByTagName('a:rPr')[0]?.getAttribute('b')).toBe('1');
    expect(xml).not.toContain('Original'); expect(xml).toContain('CC5500');
    expect(xml).toContain('x="914400"'); // 从左上角拉伸，右下角固定，位置和尺寸一起写入。
    expect(xml).toContain('cx="3200400"');
    expect(xml).toContain('cy="1143000"');
    expect(xml).toContain('y="914400"');
    expect((await reopened.getPresentation('deck'))?.pptxArtifact.state).toBe('ready');
  } finally {
    scope.stop(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
