import { createApp, nextTick, type App } from 'vue';
import { JsonValueSchema } from '@app/schemas';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import type { CanvasSynchronization } from '@plugin/canvas/shared';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { readRendererPluginAvailability } from '@plugin/renderer/pluginRuntime';
import { CanvasEvaluationBridgeConnectionSchema, CanvasEvaluationCommandSchema, type CanvasEvaluationCommand, type CanvasEvaluationResult } from './bridge/definitions/canvasEvaluationBridge';
import CanvasEvaluationHarness from './CanvasEvaluationHarness.vue';
import type { createCanvasSurface } from '../../src/renderer/orchestration/createCanvasSurface';
import { createCanvasEvaluationFrameMetrics } from './createCanvasEvaluationFrameMetrics';
import { createCanvasEvaluationCommitMetrics } from './createCanvasEvaluationCommitMetrics';
import { readCanvasEvaluationLayout } from './readCanvasEvaluationLayout';
type Surface = Awaited<ReturnType<typeof createCanvasSurface>>;
const parameters = new URL(import.meta.url).searchParams;
const connection = CanvasEvaluationBridgeConnectionSchema.parse({ protocol: 1, host: '127.0.0.1', port: Number(parameters.get('port')), nonce: parameters.get('nonce'), projectId: parameters.get('projectId') });
const base = `http://${connection.host}:${connection.port}`, headers = { 'content-type': 'application/json', 'x-canvas-evaluation-token': connection.nonce };
let app: App | null = null, root: HTMLElement | null = null, surface: Surface | null = null, disposed = false;
const metrics = createCanvasEvaluationFrameMetrics();
let commits: ReturnType<typeof createCanvasEvaluationCommitMetrics> | null = null;
const requireSurface = () => { if (!surface) throw new Error('验收画布尚未挂载'); return surface; };
async function unmount(): Promise<void> {
  commits?.dispose(); commits = null;
  metrics.reset();
  await surface?.session.close(); app?.unmount(); root?.remove(); surface = null; app = null; root = null;
}
async function mount(documentId: string, projectId: string): Promise<unknown> {
  if (projectId !== connection.projectId) throw new Error('验收project不匹配');
  const identity = await readDocumentReference({ projectId, documentId });
  if (identity.status !== 'available' || identity.nodeType !== 'canvas') throw new Error('验收画布不在已授权project中');
  await unmount(); const container = document.createElement('div');
  // 全屏属于验收组合容器。不能让组件同权重class被后加载的产品.linnya-canvas样式覆盖。
  container.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:100000;background:var(--color-bg-default)';
  root = container; document.body.append(container);
  await new Promise<void>((resolve, reject) => {
    app = createApp(CanvasEvaluationHarness, { documentId, projectId, onReady: (value: Surface) => { surface = value; resolve(); }, onSynchronized: (update: CanvasSynchronization) => commits?.synchronized(update), onFailure: (message: string) => reject(new Error(message)) }); app.mount(container);
  });
  commits = createCanvasEvaluationCommitMetrics(requireSurface(), metrics);
  return { viewId: requireSurface().session.viewId, snapshot: requireSurface().session.state.snapshot.value };
}
async function presented(value: Surface, previousRenders: number): Promise<{ readonly status: string; readonly renderedAt?: number }> {
  await nextTick();
  if (document.visibilityState !== 'visible') return { status: 'not-visible' };
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (disposed || document.visibilityState !== 'visible') { resolve({ status: 'not-visible' }); return; }
      if (value.readPresentationStats().renders > previousRenders) { resolve({ status: 'presented', renderedAt: performance.now() }); return; }
      if (performance.now() - started > 5000) { resolve({ status: 'not-presented' }); return; }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}
async function execute(command: CanvasEvaluationCommand): Promise<unknown> {
  if (command.kind === 'mount') return mount(command.payload.documentId, command.payload.projectId);
  if (command.kind === 'unmount') { await unmount(); return null; }
  const value = requireSurface();
  switch (command.kind) {
    case 'seed': {
      const before = value.readPresentationStats().renders, requestedAt = performance.now(), commit = await value.session.commit(command.payload.operations), frame = await presented(value, before);
      return { commit, frame, ...(frame.renderedAt === undefined ? {} : { requestToFrameMs: frame.renderedAt - requestedAt }), source: 'user' };
    }
    case 'read': return { snapshot: value.session.state.snapshot.value, draft: value.editor.state.draft.value, creationDraft: value.creation.state.draft.value, error: value.error.value, presentation: value.readPresentationStats() };
    case 'edit': await value.focusElements([command.payload.elementId]); await value.edit(); return { viewId: value.session.viewId };
    case 'save': if (!(await value.editor.save(true))) throw new Error('草稿未保存'); return { snapshot: value.session.state.snapshot.value };
    case 'fit': {
      if (command.payload.elementIds) value.locate(command.payload.elementIds); else value.fit();
      // 必须在同一任务读相机与draw基线；相机更新本身不证明新视野已经绘制。
      return { camera: value.camera.value, renders: value.readPresentationStats().renders, observedAt: performance.timeOrigin + performance.now() };
    }
    case 'stats': if (command.payload.reset) { metrics.reset(); commits?.reset(); } return { presentation: value.readPresentationStats(), layout: readCanvasEvaluationLayout(root), frames: metrics.read(), commits: commits?.read() ?? null, sequence: value.session.state.snapshot.value?.sequence ?? null };
    case 'frame-window': return { documentId: value.session.state.snapshot.value?.documentId ?? null, frames: metrics.readWindow(command.payload.since, command.payload.until) };
    case 'readiness': {
      const style = getComputedStyle(document.body);
      return { documentId: value.session.state.snapshot.value?.documentId ?? null, sequence: value.session.state.snapshot.value?.sequence ?? null,
        readiness: value.readContentReadiness(command.payload.elementIds), renders: value.readPresentationStats().renders, observedAt: performance.timeOrigin + performance.now(),
        environment: { camera: value.camera.value, screenPixelRatio: window.devicePixelRatio, visibilityState: document.visibilityState,
          theme: document.documentElement.getAttribute(RENDERER_UI_THEME_ATTRIBUTE), fontFamily: style.fontFamily, fontSmoothing: style.getPropertyValue('-webkit-font-smoothing') },
      };
    }
  }
}
function hostInstalled(): boolean {
  const host: unknown = Reflect.get(globalThis, '__LINNYA_RENDERER_PLUGIN_HOST_MODULES__');
  if (typeof host !== 'object' || host === null) return false;
  const modules: unknown = Reflect.get(host, 'modules'); return typeof modules === 'object' && modules !== null && Reflect.has(modules, '@plugin/renderer/workspaceRuntime');
}
async function run(): Promise<void> {
  while (!hostInstalled()) { if (disposed) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  if (readRendererPluginAvailability('canvas') !== 'enabled') throw new Error('Canvas未启用，验收桥没有启动');
  while (!disposed) {
    const response = await fetch(`${base}/next`, { headers }); if (!response.ok) throw new Error(`验收桥轮询失败：${response.status}`);
    const raw: unknown = await response.json(); if (raw === null) continue;
    const command = CanvasEvaluationCommandSchema.parse(raw); let result: CanvasEvaluationResult;
    try { result = { id: command.id, ok: true, value: JsonValueSchema.parse(await execute(command)) }; }
    catch (error) { result = { id: command.id, ok: false, error: error instanceof Error ? error.message : String(error) }; }
    const submitted = await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify(result) }); if (!submitted.ok) throw new Error(`验收桥回执失败：${submitted.status}`);
  }
}
window.addEventListener('beforeunload', () => { disposed = true; metrics.dispose(); void unmount(); }, { once: true });
void run().catch(error => { console.error('[canvas-evaluation-bridge]', error instanceof Error ? error.message : String(error)); });
