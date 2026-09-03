export type SlideStageRenderMode = 'konva' | 'loading' | 'empty' | 'error';

export interface SlideStageRenderStateInput {
  hasTargetSlideRender: boolean;
  hasDisplayedSlideRender: boolean;
  preparingVisualResources: boolean;
  visualResourcePreparationFailed: boolean;
  currentSlideKonvaCompatible: boolean;
  hasRenderSlideSize: boolean;
  sourceSelectionModeEnabled: boolean;
  canEditSourceSelection: boolean;
}

export interface SlideStageRenderState {
  shouldUseKonva: boolean;
  shouldRenderKonva: boolean;
  renderMode: SlideStageRenderMode;
  hasRenderableSlide: boolean;
  canSelectSourceElements: boolean;
  shouldShowSourcePrompt: boolean;
}

/**
 * 统一收敛 SlideStage 的渲染分支规则。
 * M6 后主舞台只允许 Konva render-model 路径，不再用 DeckPreview/DOM 分支重建布局。
 * 首帧资源准备属于加载过程；只有零页文稿是空态，合同或资源故障必须显式报错。
 */
export function resolveSlideStageRenderState(
  input: SlideStageRenderStateInput,
): SlideStageRenderState {
  const shouldUseKonva =
    input.hasDisplayedSlideRender
    && input.currentSlideKonvaCompatible;
  const shouldRenderKonva = shouldUseKonva && input.hasRenderSlideSize;
  const renderMode = resolveRenderMode(input, shouldRenderKonva);
  const canSelectSourceElements =
    input.sourceSelectionModeEnabled
    && shouldRenderKonva
    && input.canEditSourceSelection;

  return {
    shouldUseKonva,
    shouldRenderKonva,
    renderMode,
    hasRenderableSlide: renderMode === 'konva',
    canSelectSourceElements,
    shouldShowSourcePrompt: canSelectSourceElements,
  };
}

function resolveRenderMode(
  input: SlideStageRenderStateInput,
  shouldRenderKonva: boolean,
): SlideStageRenderMode {
  if (input.visualResourcePreparationFailed) {
    return 'error';
  }
  if (shouldRenderKonva) {
    return 'konva';
  }
  if (input.hasTargetSlideRender && input.preparingVisualResources) {
    return 'loading';
  }
  if (!input.hasTargetSlideRender) {
    return 'empty';
  }
  return 'error';
}
