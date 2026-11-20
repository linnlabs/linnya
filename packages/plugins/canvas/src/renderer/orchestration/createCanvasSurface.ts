import type { CanvasSurfaceOptions, CanvasSurfacePorts } from '../definitions/canvasSurface';
import type { CanvasSurfaceRendering } from './definitions/canvasSurfaceComposition';
import { createPixiCanvasKernel, type CanvasKernel, type CanvasKernelIntent } from '../kernel';
import { canvasKernelText } from '../features/localization';
import { createCanvasSurfaceRendering } from './createCanvasSurfaceRendering';
import { createCanvasSurfaceCommands } from './createCanvasSurfaceCommands';
import { createCanvasSurfaceDisposal } from './createCanvasSurfaceDisposal';
import { createCanvasSurfaceDraftEditing } from './createCanvasSurfaceDraftEditing';
import { createCanvasSurfaceFacade } from './createCanvasSurfaceFacade';
import { createCanvasSurfaceIntentHandler } from './createCanvasSurfaceIntentHandler';
import { createCanvasSurfaceOperations } from './createCanvasSurfaceOperations';
import { createCanvasSurfacePresentation } from './createCanvasSurfacePresentation';
import { createCanvasSurfaceSelection } from './createCanvasSurfaceSelection';
import { createCanvasSurfaceSession } from './createCanvasSurfaceSession';
import { createCanvasViewportCommands } from './createCanvasViewportCommands';
import { installCanvasSurfaceBindings } from './installCanvasSurfaceBindings';
import { openCanvasSurfaceAtRememberedView } from './openCanvasSurfaceAtRememberedView';

/**
 * 表面的组合根：初始化顺序明确，具体流程由相应能力 owner 负责。
 * 装配中途抛错时按已完成的阶段回滚；否则 kernel 持有的 WebGL 上下文随抛错泄漏。
 */
export async function createCanvasSurface(
  options: CanvasSurfaceOptions,
  ports: CanvasSurfacePorts
) {
  let rollback = () => {};
  try {
    return await assembleCanvasSurface(options, ports, release => {
      rollback = release;
    });
  } catch (error) {
    rollback();
    throw error;
  }
}

/** 完整关闭序列装配好之前的回滚：只含已创建的 owner，顺序与显式关闭序列一致。 */
function releaseCreatedOwners(
  kernel: CanvasKernel,
  rendering?: Pick<CanvasSurfaceRendering, 'raster'>,
  drafts?: { readonly editable: { destroy(): void } }
) {
  drafts?.editable.destroy();
  rendering?.raster.dispose();
  kernel.destroy();
}

/** `track` 登记当前已装配范围的完整释放；装配完成后同一个释放就是 destroy。 */
async function assembleCanvasSurface(
  options: CanvasSurfaceOptions,
  ports: CanvasSurfacePorts,
  track: (release: () => void) => void
) {
  const base = createCanvasSurfaceSession(options, ports);
  const { readonly, preferences, report, state } = base;
  const kernel = await createPixiCanvasKernel({
    host: options.host,
    text: canvasKernelText,
    readReadonly: () => readonly.value,
    readInteractionPreferences: () => preferences.preferences,
    onIntent: intent => {
      void handleIntent(intent).catch(report);
    },
  });
  track(() => releaseCreatedOwners(kernel));
  if (options.descriptionId) kernel.canvas.setAttribute('aria-describedby', options.descriptionId);
  const rendering = createCanvasSurfaceRendering({ options, ports, base, kernel, handleIntent });
  track(() => releaseCreatedOwners(kernel, rendering));
  const { refreshView } = rendering;
  // 回调在交互发生时读取 viewport；创建草稿/连线时不会提前读取尚未完成的装配。
  const readViewport = () => viewport;
  const drafts = createCanvasSurfaceDraftEditing({ options, ports, base, rendering, readViewport });
  track(() => releaseCreatedOwners(kernel, rendering, drafts));
  const selection = createCanvasSurfaceSelection({
    options,
    ports,
    base,
    rendering,
    drafts,
    readViewport,
  });
  const viewport = createCanvasViewportCommands({
    kernel,
    setCamera: state.setCamera,
    refresh: refreshView,
    cards: base.cards,
    selected: base.selected,
    elements: () => base.session.state.snapshot.value?.elements ?? [],
    select: selection.trySelect,
    selectEdge: async id => {
      await selection.connections.select(id);
      return selection.connections.selected.value?.id === id;
    },
  });
  const dispatch = createCanvasSurfaceIntentHandler({
    base,
    rendering,
    drafts,
    selection,
    viewport,
  });
  function handleIntent(intent: CanvasKernelIntent): Promise<void> {
    // GPU 状态的首个通知来自初始化微任务，早于后续 DOM/编辑能力的安装。
    if (intent.kind === 'render-status') {
      state.setRenderNotice(intent.message);
      return Promise.resolve();
    }
    return dispatch(intent);
  }
  const bindings = installCanvasSurfaceBindings({
    options,
    ports,
    base,
    rendering,
    drafts,
    selection,
  });
  const dispose = createCanvasSurfaceDisposal({ base, rendering, drafts, selection, bindings });
  track(dispose);
  const presentation = createCanvasSurfacePresentation({
    options,
    ports,
    base,
    rendering,
    drafts,
    selection,
    bindings,
  });
  const userCommands = createCanvasSurfaceCommands({
    base,
    rendering,
    drafts,
    selection,
    bindings,
    viewport,
  });
  const closeViewMemory = await openCanvasSurfaceAtRememberedView({ options, base, rendering });
  const destroy = () => {
    closeViewMemory();
    dispose();
  };
  track(destroy);
  const operations = createCanvasSurfaceOperations({
    options,
    ports,
    base,
    rendering,
    drafts,
    selection,
    presentation,
    viewport,
  });
  return createCanvasSurfaceFacade({
    options,
    ports,
    base,
    rendering,
    drafts,
    selection,
    bindings,
    presentation,
    viewport,
    userCommands,
    operations,
    destroy,
  });
}
