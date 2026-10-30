import { beforeEach, expect, it, vi } from 'vitest';
import { PresentationViewSnapshotRuntime } from './orchestration/PresentationViewSnapshotRuntime';
import { makePresentationView } from '../../../shared/presentationViewSnapshot/testing/viewFixture';
import { readPresentationView } from '../../../renderer/features/documentRuntime/orchestration/readPresentationView';
import { ViewReadRequestSchema, type InstalledPresentationView, type ViewHeader, type ViewReadResponse } from '../../../shared/presentationViewSnapshot';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@plugin/renderer/pluginIpcClient', () => ({ invokeRendererPluginIpc: invoke }));
let view: InstalledPresentationView;
let responses: ViewReadResponse[];
beforeEach(() => { view = makePresentationView(); responses = []; invoke.mockReset(); });
function connect() {
  const runtime = new PresentationViewSnapshotRuntime(async () => {
    const model = view.renderModel;
    if (!model) return { header: { buildState: view.buildState, preview: null, render: null }, renderModel: null };
    const render = { presentationId: model.presentationId, title: model.title, version: model.version,
      sourceKind: model.sourceKind, slideSize: model.slideSize, capabilities: model.capabilities };
    const header: ViewHeader = { buildState: view.buildState, preview: view.preview, render };
    return { header, renderModel: model };
  });
  invoke.mockImplementation(async (_plugin, _channel, request) => {
    const data = await runtime.read(ViewReadRequestSchema.parse(request)); responses.push(data);
    // 真正跨 JSON 边界，禁止原型仅在内存对象间传引用。
    const copied: unknown = JSON.parse(JSON.stringify(data)); return { success: true, data: copied };
  });
  return runtime;
}

it('round-trips the complete view and reuses unchanged page objects with zero new blocks', async () => {
  connect(); const first = await readPresentationView('deck', new Map(), new Map());
  expect(first.installed.renderModel).toEqual(view.renderModel);
  const second = await readPresentationView('deck', first.blocks, first.pages);
  expect(responses.at(-1)?.blocks).toHaveLength(0);
  expect(second.installed.renderModel?.slides[0]).toBe(first.installed.renderModel?.slides[0]);
});

it('reuses duplicated content while replacing page identities and source positions', async () => {
  connect(); const first = await readPresentationView('deck', new Map(), new Map());
  const base = view.renderModel;
  if (!base) throw new Error('Missing fixture');
  const pages = [base.slides[0], base.slides[0], ...base.slides.slice(1)].map((slide, index) => ({
    ...slide, slideId: `s${index + 1}`, index, elements: slide.elements.map(node => ({ ...node,
      id: `s${index + 1}-new`, sourceSpan: { startLine: index * 6 + 2, endLine: index * 6 + 3 },
      authoringRef: { slideKey: `page-${index}`, editKey: 'title', targetKind: 'text' as const },
    })),
  }));
  view = { ...makePresentationView('deck', 2, 4), renderModel: { ...base, version: 2, slides: pages } };
  const second = await readPresentationView('deck', first.blocks, first.pages);
  expect(second.installed.renderModel).toEqual(view.renderModel);
  expect(responses.at(-1)?.blocks.every(block => 'contentHash' in block.value)).toBe(true);
  expect(second.installed.renderModel?.slides[0].elements[0].authoringRef?.slideKey).toBe('page-0');
  expect(second.installed.renderModel?.slides[1].elements[0].authoringRef?.slideKey).toBe('page-1');
});

it('batches cold loads against one immutable snapshot even when another revision is committed between batches', async () => {
  view = makePresentationView('deck', 1, 100);
  if (!view.renderModel) throw new Error('Missing fixture');
  for (const slide of view.renderModel.slides) {
    const node = slide.elements[0]; if (node.kind === 'text') node.paragraphs[0].runs[0].text += 'x'.repeat(4_000);
  }
  const expected = view.renderModel; connect();
  const original = invoke.getMockImplementation();
  if (!original) throw new Error('Missing transport');
  invoke.mockImplementation(async (...args) => {
    const result = await original(...args); view = makePresentationView('deck', 2); return result;
  });
  const result = await readPresentationView('deck', new Map(), new Map());
  expect(responses.length).toBeGreaterThan(1);
  expect(new Set(responses.map(item => item.snapshotId)).size).toBe(1);
  expect(responses.slice(1).every(item => item.header === null && item.manifest.length === 0)).toBe(true);
  expect(result.installed.renderModel).toEqual(expected);
});

it('rejects a missing or mismatched binding instead of installing a partial revision', async () => {
  connect(); const original = invoke.getMockImplementation(); if (!original) throw new Error('Missing transport');
  invoke.mockImplementation(async (...args) => {
    const response = await original(...args);
    const data = responses[0]; return { ...response, data: { ...data, blocks: data.blocks.slice(1) } };
  });
  await expect(readPresentationView('deck', new Map(), new Map())).rejects.toThrow('content/binding mismatch');
});
