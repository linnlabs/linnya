import { computed, ref, watch } from 'vue';
import {
  selectSourceTargets,
  resolveSourceSelectionPromptPosition,
} from '../../features/sourceSelection';
import type { StageAiPrompt } from '../definitions/stageAiPrompt';

export function useStageAiPrompt(options: StageAiPrompt) {
  /** 交给 AI 的源码目标：作者对象选区优先，否则是只带源码定位的元素选区。 */
  const aiTargets = computed(() =>
    selectSourceTargets({
      nodes: options.displayedSlide.value?.elements ?? [],
      manualTargets: options.manualSelectedTargets.value,
      sourceElementIds: options.selectedSourceTargets.value.map(target => target.elementId),
    })
  );
  const canAskAi = computed(
    () => options.canSelectSourceElements.value && aiTargets.value.length > 0
  );
  const aiPromptOpen = ref(false);
  // 只带源码定位的元素没有属性可改，选中即展开 AI 输入；作者对象由浮条入口或 ⌘K 展开。
  const showAiPrompt = computed(
    () =>
      canAskAi.value &&
      (aiPromptOpen.value ||
        (options.manualSelectedTargets.value.length === 0 &&
          options.selectedSourceTargets.value.length > 0))
  );

  function openAiPrompt(): void {
    if (!canAskAi.value) return;
    options.finishText();
    aiPromptOpen.value = true;
  }

  function closeAiPrompt(): void {
    aiPromptOpen.value = false;
    options.clearSourceSelection();
    options.focusCanvas();
  }

  watch(
    () => aiTargets.value.map(target => target.elementId).join('\0'),
    () => {
      aiPromptOpen.value = false;
    }
  );

  const sourcePromptPosition = computed(() => {
    void options.stageOverlayGeometryRevision.value;
    const slideRect = options.canvasShellRef.value?.getBoundingClientRect();

    return resolveSourceSelectionPromptPosition({
      targets: aiTargets.value,
      renderScale: options.renderScale.value,
      slideSize: options.actualSlideSize.value,
      ...(slideRect
        ? {
            slideViewportRect: {
              left: slideRect.left,
              top: slideRect.top,
            },
            viewportSize: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
          }
        : {}),
    });
  });

  function handleSourceEditSubmit(instruction: string): void {
    const slideRender = options.displayedSlide.value;
    if (
      options.preparingSlideVisuals.value ||
      slideRender?.slideId !== options.activeSlideId.value ||
      aiTargets.value.length === 0
    ) {
      return;
    }

    options.submit({
      instruction,
      slideNumber: slideRender.index + 1,
      targets: aiTargets.value,
    });
    aiPromptOpen.value = false;
  }

  return {
    aiTargets,
    canAskAi,
    showAiPrompt,
    openAiPrompt,
    closeAiPrompt,
    sourcePromptPosition,
    handleSourceEditSubmit,
  };
}
