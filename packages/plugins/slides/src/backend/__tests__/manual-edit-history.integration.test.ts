import { SlideMarkerIndex } from '@plugin/slides/shared';
import { copyManualObjects } from '../features/presentationManualEditing';
import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema';
import type { SlidesManualEditCommand, SlidesManualEditCommandOperation } from '@plugin/slides/shared';
import { PresentationRepository } from '../persistence/repositories/PresentationRepository';
import { PRESENTATION_DOCUMENT_SCHEMAS } from '../persistence/schemas/presentation.schema';
import { PRESENTATION_IMAGE_BINDING_SCHEMAS } from '../persistence/schemas/presentationImageBinding.schema';
import { PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS } from '../persistence/schemas/presentationSvgGraphicBinding.schema';
import { PRESENTATION_HISTORY_SCHEMAS } from '../features/presentationSourceHistory/definitions/presentationHistorySchema';
import { PresentationHistoryRepository, PresentationHistoryRuntime, PresentationRevisionScope } from '../features/presentationSourceHistory';
import { ManualEditHistoryStore, retainedManualEditHistoryVersions, PRESENTATION_MANUAL_EDIT_SCHEMAS, PresentationManualEditingRuntime } from '../features/presentationManualEditing';
import { createInProcessPresentationBuildExecution } from '../features/presentationBuildExecution';
import { CodegenDeckBuilder } from '../codegen/CodegenDeckBuilder';
import { pptComposeProfile } from '../sandbox/pptComposeProfile';
import { observeRevisionImageBindings } from '../features/presentationSourceHistory';
import { createPresentationImageSourceResolver, PresentationImageBindingRepository } from '../features/presentationImageOwnership';
import { resolveImageSources } from '../engine/assets/imageSourceResolver';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import JSZip from 'jszip';

/** 同一真实源码/编译/SQLite 流程验证批量原子性、撤销分支、压缩和可复跑的编辑延迟。 */
it('30 页连续编辑、批量与源码撤销在历史压缩后仍保持一致', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const sql of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...PRESENTATION_DOCUMENT_SCHEMAS,
    ...PRESENTATION_MANUAL_EDIT_SCHEMAS, ...PRESENTATION_HISTORY_SCHEMAS, ...PRESENTATION_IMAGE_BINDING_SCHEMAS,
    ...PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS]) db.exec(sql);
  db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('p', 'Test', 1, 1);
  db.prepare("INSERT INTO workspace_nodes(id,project_id,type,name,created_at,updated_at) VALUES ('deck','p','presentation','Editing',1,1)").run();
  const scope = new PresentationRevisionScope();
  const historyRepo = new PresentationHistoryRepository(db);
  const historyStore = new ManualEditHistoryStore();
  const imageBindings = observeRevisionImageBindings(new PresentationImageBindingRepository(db), scope);
  const imageSourceResolver = createPresentationImageSourceResolver({ bindingRepository: imageBindings,
    documentImageAssets: {
      adoptLocalImage: async () => { throw new Error('Already imported asset must not be readopted'); },
      adoptImageBytes: async () => { throw new Error('Already imported asset must not be readopted'); },
      readOwnedImage: async ({ assetId }) => ({ assetId, mediaType: 'image/png', width: 1, height: 1, byteLength: 1,
        sha256: 'fixture', dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' }),
    },
  });
  const repo = new PresentationRepository(db, {
    recordRevisionContext: (documentId, versionId) => historyRepo.recordContext(versionId, scope.readSourceTheme(), scope.read(documentId)),
    inheritRevisionContext: (from, to) => historyRepo.inheritContext(from, to),
  });
  const profiles = new SandboxProfileRegistry(); profiles.register(pptComposeProfile);
  const profilesService = new SandboxService(profiles, createSandboxEvaluatorTestRunner());
  const execution = createInProcessPresentationBuildExecution();
  const phaseTimes: { sandbox: number[]; layout: number[] } = { sandbox: [], layout: [] };
  const builder = new CodegenDeckBuilder({ presentationRepo: repo,
    imageSourceResolver,
    recordSourceTheme: theme => scope.recordSourceTheme(theme),
    sandbox: { async execute(request) {
      const start = performance.now(); const result = await profilesService.execute(request);
      phaseTimes.sandbox.push(performance.now() - start); return result;
    } },
    engine: { assembleDeck: async () => { throw new Error('Manual editing must defer PPTX'); } },
    buildExecution: { async compileComposePayload(payload) {
      const start = performance.now(); const result = await execution.compileComposePayload(payload);
      phaseTimes.layout.push(performance.now() - start); return result;
    } },
  });
  const history = new PresentationHistoryRuntime({ history: historyRepo, documents: repo, scope,
    requiredVersions: (documentId, currentId) => retainedManualEditHistoryVersions(historyStore.read(documentId), currentId),
    compile: input => builder.buildHistoricalDeckSpec(input),
    render: async () => { throw new Error('Not used by editing history'); },
    assemble: async () => { throw new Error('Undo must defer PPTX'); }, release: () => undefined,
    reportFailure: (_documentId, error) => { throw error; },
  });
  const paths: (string | undefined)[] = [];
  const runtime = new PresentationManualEditingRuntime({ presentationRepo: repo, builder, revisionScope: scope,
    historyStore, restoreRevision: input => history.commitDeferredRestore(input),
    trace: { record: event => { if (event.stage === 'source_rewritten') paths.push(event.path); } } });
  const source = Array.from({ length: 30 }, (_, i) => `const slide${i} = createSlide({ slideKey: 'page${i}' });
const caption${i} = createText({ editKey: 'title', content: 'Page ${i}', fontSize: 24 });
caption${i}.position = 'absolute'; caption${i}.x = 1; caption${i}.y = 1; caption${i}.w = 5; caption${i}.h = 1;
slide${i}.add(caption${i});
const shape${i} = createShape({ editKey: 'badge', geometry: 'rect', fill: '#224466' });
shape${i}.position = 'absolute'; shape${i}.x = 2; shape${i}.y = 3; shape${i}.w = 2; shape${i}.h = 1;
slide${i}.add(shape${i});`).join('\n') + `\ncompose({ title: '30 page editing', slides: [${Array.from({ length: 30 }, (_, i) => `slide${i}`).join(', ')}] });`;
  async function current() { const value = await repo.getPresentation('deck'); if (!value) throw new Error('Missing document'); return value; }
  const timings: Record<string, number[]> = {};
  async function submit(operation: SlidesManualEditCommandOperation) {
    const base = await current();
    const command: SlidesManualEditCommand = { commandId: crypto.randomUUID(), documentId: 'deck',
      expectedBase: { revisionId: base.currentRevisionId, revision: base.currentRevision, sourceHash: base.sourceHash }, operation };
    const start = performance.now(); const result = await runtime.submit(command);
    const elapsed = performance.now() - start;
    (timings[operation.op] ??= []).push(elapsed);
    expect(result.status).toBe('committed');
    return { command, result };
  }
  try {
    await scope.run('deck', async () => {
      const deckSpec = await builder.buildDeckSpecFromSource({ nodeId: 'deck', source });
      await repo.createPresentation('deck', deckSpec, { deckSource: source, pptxBuffer: Buffer.from('fixture'), origin: 'codegen' });
    });
    const initial = await current();
    // 冷启动单独记录，后续统计只包含 warm 编辑路径。
    const cold = { sandbox: phaseTimes.sandbox.shift(), layout: phaseTimes.layout.shift() };
    for (let i = 0; i < 5; i++) await submit({ op: 'set_text_content', targetKind: 'text', target: { slideKey: 'page15', editKey: 'title' }, content: `Edited ${i}` });
    const beforeBatch = await current();
    const { command: batch, result: batchResult } = await submit({ op: 'batch', operations: [
      { op: 'translate_by', targetKind: 'text', target: { slideKey: 'page15', editKey: 'title' }, delta: { dx: 0.5, dy: 0.25 } },
      { op: 'translate_by', targetKind: 'shape', target: { slideKey: 'page15', editKey: 'badge' }, delta: { dx: 0.5, dy: 0.25 } },
    ] });
    const afterBatch = await current();
    expect(afterBatch.currentRevision).toBe(beforeBatch.currentRevision + 1);
    expect(await runtime.submit(batch)).toEqual(batchResult); // 幂等重试不增加撤销深度。
    expect((await runtime.readHistoryStatus('deck')).undoDepth).toBe(6);
    const undoBatch = await submit({ op: 'undo' });
    // 撤销带回受影响的页与对象，Renderer 据此跳页并重新选中。
    expect(undoBatch.result).toMatchObject({ focus: { slideIndex: 15, targets: [
      { slideKey: 'page15', editKey: 'title' }, { slideKey: 'page15', editKey: 'badge' },
    ] } });
    expect((await current()).deckSpec).toEqual(beforeBatch.deckSpec);
    expect((await current()).deckSource).toBe(beforeBatch.deckSource);
    await history.compact('deck');
    await submit({ op: 'redo' });
    expect((await current()).deckSpec).toEqual(afterBatch.deckSpec);
    await submit({ op: 'undo' });
    for (let i = 0; i < 5; i++) await submit({ op: 'undo' });
    expect((await current()).deckSource).toBe(initial.deckSource);
    expect((await current()).deckSpec).toEqual(initial.deckSpec);
    await submit({ op: 'set_fill_color', targetKind: 'shape', target: { slideKey: 'page0', editKey: 'badge' }, color: '#CC5500' });
    expect((await runtime.readHistoryStatus('deck')).redoDepth).toBe(0);
    const base = await current();
    const invalid = await runtime.submit({ ...batch, commandId: crypto.randomUUID(), expectedBase: {
      revisionId: base.currentRevisionId, revision: base.currentRevision, sourceHash: base.sourceHash,
    }, operation: { op: 'batch', operations: [
      { op: 'translate_by', targetKind: 'shape', target: { slideKey: 'page0', editKey: 'badge' }, delta: { dx: 2, dy: 1 } },
      { op: 'delete_target', targetKind: 'shape', target: { slideKey: 'page0', editKey: 'missing' } },
    ] } });
    expect(invalid.status).toBe('build_failed');
    expect((await current()).currentRevisionId).toBe(base.currentRevisionId);
    // 插入、改样式、宽度、层序和重排走正式编译；源码定位必须仍指向新增作者 literal。
    await submit({ op: 'insert_blank_slide', index: 0 });
    await submit({ op: 'insert_objects', index: 0, objects: [
      { kind: 'text', editKey: 'new-title', heightMode: 'content', box: { x: 1, y: 1, w: 4, h: 1 }, content: 'New title', style: { fontSize: 28, bold: true, color: '#113355' } },
      { kind: 'shape', editKey: 'new-shape', box: { x: 1, y: 2, w: 2, h: 1 }, geometry: 'rect', fill: '#336699', content: '' },
    ] });
    await submit({ op: 'set_text_style', target: { slideKey: 'blank-slide-1', editKey: 'new-title' }, bold: false, italic: true, underline: true, align: 'right' });
    await submit({ op: 'set_text_width', target: { slideKey: 'blank-slide-1', editKey: 'new-title' }, targetKind: 'text', width: 3 });
    const edited = await current();
    const title = edited.deckSpec.slides[0].spec.elements.find(element => element._authoringRef?.editKey === 'new-title');
    expect(title?.position.w).toBe(3);
    expect(title?.position.h).toBeLessThan(1);
    expect(title?.style).toMatchObject({ italic: true, underline: true, align: 'right' });
    expect(title?.style?.bold).not.toBe(true);
    expect(title?._sourceSpan).toBeDefined();
    const span = title?._sourceSpan;
    if (!span) throw new Error('Missing new object source location');
    expect(edited.deckSource.split('\n').slice(span.startLine - 1, span.endLine).join('\n')).toContain('"editKey": "new-title"');
    expect(edited.deckSource).toContain('"heightMode": "content"');
    // 左侧宽度手柄：同一对象在一个批次里先平移再改宽，按顺序生效，一次撤销。
    const newTitle = { slideKey: 'blank-slide-1', editKey: 'new-title' };
    await submit({ op: 'batch', operations: [
      { op: 'translate_by', target: newTitle, targetKind: 'text', delta: { dx: 1, dy: 0 } },
      { op: 'set_text_width', target: newTitle, targetKind: 'text', width: 2 },
    ] });
    const widened = (await current()).deckSpec.slides[0].spec.elements.find(element => element._authoringRef?.editKey === 'new-title');
    expect(widened?.position).toMatchObject({ x: (title?.position.x ?? 0) + 1, w: 2 });
    const afterWiden = await current();
    const deleteThenEdit = await runtime.submit({ commandId: crypto.randomUUID(), documentId: 'deck',
      expectedBase: { revisionId: afterWiden.currentRevisionId, revision: afterWiden.currentRevision, sourceHash: afterWiden.sourceHash },
      operation: { op: 'batch', operations: [
        { op: 'delete_target', target: newTitle, targetKind: 'text' },
        { op: 'translate_by', target: newTitle, targetKind: 'text', delta: { dx: 1, dy: 0 } },
      ] } });
    expect(deleteThenEdit).toMatchObject({ status: 'validation_failed', message: '同一批次里已删除的对象不能再修改。' });
    await submit({ op: 'undo' });
    expect((await current()).deckSpec.slides[0].spec.elements.find(element => element._authoringRef?.editKey === 'new-title')?.position)
      .toEqual(title?.position);
    await submit({ op: 'redo' });
    const objects = copyManualObjects(edited.deckSpec, [{ slideKey: 'blank-slide-1', editKey: 'new-title' }]);
    await submit({ op: 'insert_objects', index: 0, objects });
    const beforeLayer = await current();
    await submit({ op: 'set_layer', target: { slideKey: 'blank-slide-1', editKey: 'new-title' }, direction: 'front' });
    const afterLayer = await current();
    expect(afterLayer.deckSpec.slides[0].spec.elements.at(-1)?._authoringRef?.editKey).toBe('new-title');
    for (const element of beforeLayer.deckSpec.slides[0].spec.elements) expect(afterLayer.deckSpec.slides[0].spec.elements.find(next => next._authoringRef?.editKey === element._authoringRef?.editKey)?.position).toEqual(element.position);
    // 文稿有插入对象时，整格平移仍走快照投影；插入对象的源码定位随 manualEdits 改写同步移动。
    await submit({ op: 'translate_by', targetKind: 'text', target: { slideKey: 'blank-slide-1', editKey: 'new-title' }, delta: { dx: 0.1042, dy: -0.0521 } });
    await submit({ op: 'batch', operations: [
      { op: 'translate_by', targetKind: 'shape', target: { slideKey: 'page3', editKey: 'badge' }, delta: { dx: 0.25, dy: 0 } },
      { op: 'translate_by', targetKind: 'text', target: { slideKey: 'page3', editKey: 'title' }, delta: { dx: 0.25, dy: 0 } },
    ] });
    expect(paths.slice(-2)).toEqual(['projected_edit', 'projected_edit']);
    const projected = await current();
    expect(await scope.run('deck', () => builder.buildDeckSpecFromSource({ nodeId: 'deck', source: projected.deckSource }))).toEqual(projected.deckSpec);
    await submit({ op: 'move_slide', index: 0, toIndex: 10 });
    const reordered = await current();
    expect(reordered.deckSpec.slides[10].spec.elements.at(-1)?._authoringRef?.slideKey).toBe('blank-slide-1');
    expect(SlideMarkerIndex.build(reordered.deckSource).sliceSlide(11)).toContain('blankSlide1');
    await submit({ op: 'duplicate_slide', index: 10 });
    expect((await current()).deckSpec.slides[11].spec.elements).toHaveLength(3);
    await submit({ op: 'delete_slide', index: 10 });
    expect((await submit({ op: 'undo' })).result).toMatchObject({ focus: { slideIndex: 10, targets: [] } });
    expect((await current()).deckSpec.slides[10].spec.elements).toHaveLength(3);
    // 连续 96 个 1 px 动作精确累计 1 inch；50 个会话恢复点在压缩后仍可读。
    for (let i = 0; i < 96; i++) await submit({ op: 'translate_by', targetKind: 'shape', target: { slideKey: 'page0', editKey: 'badge' }, delta: { dx: 1 / 96, dy: 0 } });
    const nudged = await current();
    const shape = nudged.deckSpec.slides.flatMap(slide => slide.spec.elements).find(element => element._authoringRef?.slideKey === 'page0' && element._authoringRef.editKey === 'badge');
    expect(shape?.position.x).toBe(3);
    expect(await scope.run('deck', () => builder.buildDeckSpecFromSource({ nodeId: 'deck', source: nudged.deckSource }))).toEqual(nudged.deckSpec);
    expect((await runtime.readHistoryStatus('deck')).undoDepth).toBe(50);
    await history.compact('deck');
    for (let i = 0; i < 50; i++) await submit({ op: 'undo' });
    expect((await runtime.readHistoryStatus('deck')).undoDepth).toBe(0);
    const beforeExternal = await current();
    // AI/源码/历史面板等外部提交使会话栈失效，不能跨未知编辑撤销。
    await scope.run('deck', () => builder.commitManualEditFromSource({ nodeId: 'deck', source: beforeExternal.deckSource + '\n// external edit' }));
    expect(await runtime.readHistoryStatus('deck')).toMatchObject({ undoDepth: 0, redoDepth: 0 });
    const performanceReport = { fixture: '30 pages / 60 objects, real compiler + SQLite, in-process test sandbox', cold,
      warm: Object.fromEntries(Object.entries({ ...timings, ...phaseTimes }).map(([name, values]) => [name, {
        count: values.length, medianMs: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)], maxMs: Math.max(...values),
      }])) };
    if (process.env.SLIDES_EDITING_BENCHMARK_OUTPUT) writeFileSync(process.env.SLIDES_EDITING_BENCHMARK_OUTPUT, JSON.stringify(performanceReport, null, 2));
    // 新图片只引用已归属的资产；替换/删除后旧资源必须由撤销记录保活。
    for (const assetId of ['image-original', 'image-replacement']) imageBindings.bind({ presentationId: 'deck', sourceIdentity: `document_asset:${assetId}`, assetId });
    await submit({ op: 'insert_objects', index: 1, objects: [{ kind: 'image', editKey: 'new-image', assetId: 'image-original', fit: 'contain', alt: 'fixture', box: { x: 1, y: 1, w: 3, h: 2 } }] });
    const imageSlideKey = (await current()).deckSpec.slides[1].spec.elements.find(element => element._authoringRef?.editKey === 'new-image')?._authoringRef?.slideKey;
    if (!imageSlideKey) throw new Error('Missing inserted image');
    const imageTarget = { slideKey: imageSlideKey, editKey: 'new-image' };
    const imageRevision = await current();
    const assetsAt = (versionId: string) => db.prepare<[string], { asset_id: string }>('SELECT asset_id FROM presentation_revision_assets WHERE revision_id = ?').all(versionId).map(row => row.asset_id);
    expect(assetsAt(imageRevision.currentRevisionId)).toEqual(['image-original']);
    await submit({ op: 'set_image', target: imageTarget, targetKind: 'image', assetId: 'image-replacement', fit: 'cover' });
    expect(assetsAt((await current()).currentRevisionId)).toEqual(['image-replacement']);
    await submit({ op: 'delete_target', target: imageTarget, targetKind: 'image' });
    expect(assetsAt((await current()).currentRevisionId)).toEqual([]);
    await history.compact('deck');
    expect(imageBindings.find({ presentationId: 'deck', sourceIdentity: 'document_asset:image-original' })).not.toBeNull();
    expect(imageBindings.find({ presentationId: 'deck', sourceIdentity: 'document_asset:image-replacement' })).not.toBeNull();
    await submit({ op: 'undo' });
    expect(assetsAt((await current()).currentRevisionId)).toEqual(['image-replacement']);
    await submit({ op: 'undo' });
    expect((await current()).deckSpec).toEqual(imageRevision.deckSpec);
    expect(assetsAt((await current()).currentRevisionId)).toEqual(['image-original']);
    await expect(imageSourceResolver.resolveImageSource({ kind: 'document_asset', assetId: 'image-original' }, { documentId: 'another-deck' })).rejects.toThrow();
    // 用新的 repository 读取持久值，再按正式导出链物化，验证新增内容没有只停留在编辑预览。
    const reopened = await new PresentationRepository(db).getPresentation('deck');
    if (!reopened) throw new Error('Missing reopened document');
    expect(reopened.deckSource).toBe((await current()).deckSource);
    expect(await scope.run('deck', () => builder.buildDeckSpecFromSource({ nodeId: 'deck', source: reopened.deckSource }))).toEqual(reopened.deckSpec);
    const exported = structuredClone(reopened.deckSpec);
    await resolveImageSources(exported, imageSourceResolver, { documentId: 'deck' });
    const zip = await JSZip.loadAsync(await materializePresentationPptx({ deckSpec: exported, svgAssets: [], svgFallbacks: [] }));
    const slideXml = await Promise.all(Object.entries(zip.files).filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).map(([, file]) => file.async('string')));
    expect(slideXml).toHaveLength(reopened.deckSpec.slides.length);
    const insertedXml = slideXml.find(xml => xml.includes('New title'));
    expect(insertedXml).toContain('i="1"');
    expect(insertedXml).toContain('u="sng"');
    expect(insertedXml).toContain('algn="r"');
    expect(Object.keys(zip.files).some(name => /^ppt\/media\/image/u.test(name))).toBe(true);
  } finally { await history.dispose(); db.close(); }
}, 30000);
