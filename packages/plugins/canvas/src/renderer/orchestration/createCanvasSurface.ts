import type { CanvasSurfaceOptions, CanvasSurfacePorts } from '../definitions/canvasSurface';
import { createPixiCanvasKernel, type CanvasKernelIntent } from '../kernel';
import { canvasKernelText } from '../features/localization';
import { createCanvasViewMemory, resolveCanvasOpeningCamera } from '../features/viewMemory';
import { watch } from 'vue';
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

/** 表面的组合根：初始化顺序明确，具体流程由相应能力 owner 负责。 */
export async function createCanvasSurface(
  options: CanvasSurfaceOptions,
  ports: CanvasSurfacePorts
) {
  const base = createCanvasSurfaceSession(options, ports);
  const { readonly, preferences, report, state, readAppearance } = base;
  const kernel = await createPixiCanvasKernel({
    host: options.host,
    text: canvasKernelText,
    readReadonly: () => readonly.value,
    readInteractionPreferences: () => preferences.preferences,
    onIntent: intent => {
      void handleIntent(intent).catch(report);
    },
  });
  if (options.descriptionId) kernel.canvas.setAttribute('aria-describedby', options.descriptionId);
  const rendering = createCanvasSurfaceRendering({ options, ports, base, kernel, handleIntent });
  const { refreshView } = rendering;
  // 回调在交互发生时读取 viewport；创建草稿/连线时不会提前读取尚未完成的装配。
  const readViewport = () => viewport;
  const drafts = createCanvasSurfaceDraftEditing({ options, ports, base, rendering, readViewport });
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
  const viewMemory = createCanvasViewMemory(options.documentId);
  try {
    kernel.setAppearance(readAppearance());
    await base.session.open(options.documentId);
    const opening = resolveCanvasOpeningCamera(
      viewMemory.read(),
      base.session.state.snapshot.value?.elements ?? [],
      { width: kernel.canvas.clientWidth, height: kernel.canvas.clientHeight }
    );
    if (opening) {
      kernel.setCamera(opening);
      state.setCamera(kernel.readCamera());
      refreshView();
    }
  } catch (failure) {
    report(failure);
  }
  // 打开后的每次平移缩放都记下来，下次打开回到这里。
  const stopViewMemory = watch(state.camera, camera => viewMemory.remember(camera));
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
  const dispose = createCanvasSurfaceDisposal({ base, rendering, drafts, selection, bindings });
  const destroy = () => {
    stopViewMemory();
    viewMemory.flush();
    dispose();
  };
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
