import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue';

export interface UseBlockActivationOptions {
  isBlockVisible: Ref<boolean>;
  isBlockInViewport: Ref<boolean>;
  isBlockHistoryVisible: Ref<boolean>;
  isFocused: Ref<boolean>;
  isBlockSelected: Ref<boolean>;
  isHandleSelected: Ref<boolean>;
  isHovered: Ref<boolean>;
  isInHistoryMode: ComputedRef<boolean>;
  /** 强制保活：块内有活跃交互/操作（录音中、面板打开等） */
  isKeepAlive?: ComputedRef<boolean>;
}

export interface UseBlockActivationReturn {
  isUiActive: Ref<boolean>;
  activationMask: ComputedRef<number>;
  activationReasons: ComputedRef<string[]>;
  renderHandles: ComputedRef<boolean>;
  renderAnnotation: ComputedRef<boolean>;
  renderRevisionChrome: ComputedRef<boolean>;
  renderRevisionToolbar: ComputedRef<boolean>;
  renderHistory: ComputedRef<boolean>;
}

const UI_DEACTIVATE_DELAY_MS = 360;

export enum BlockActivationReason {
  Visible = 1 << 0,
  Focused = 1 << 1,
  BlockSelected = 1 << 2,
  HandleSelected = 1 << 3,
  Hovered = 1 << 4,
  HistoryMode = 1 << 5,
  KeepAlive = 1 << 6,
}

const activationReasonLabels: ReadonlyArray<[BlockActivationReason, string]> = [
  [BlockActivationReason.Visible, 'visible'],
  [BlockActivationReason.Focused, 'focused'],
  [BlockActivationReason.BlockSelected, 'block-selected'],
  [BlockActivationReason.HandleSelected, 'handle-selected'],
  [BlockActivationReason.Hovered, 'hovered'],
  [BlockActivationReason.HistoryMode, 'history-mode'],
  [BlockActivationReason.KeepAlive, 'keep-alive'],
];

function useStickyActivation(source: ComputedRef<boolean>): Ref<boolean> {
  const stickyState = ref(source.value);
  let deactivateTimer: ReturnType<typeof setTimeout> | null = null;

  watch(
    source,
    (active) => {
      if (deactivateTimer) {
        clearTimeout(deactivateTimer);
        deactivateTimer = null;
      }

      if (active) {
        stickyState.value = true;
        return;
      }

      deactivateTimer = setTimeout(() => {
        stickyState.value = false;
        deactivateTimer = null;
      }, UI_DEACTIVATE_DELAY_MS);
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    if (deactivateTimer) {
      clearTimeout(deactivateTimer);
      deactivateTimer = null;
    }
  });

  return stickyState;
}

export function useBlockActivation(options: UseBlockActivationOptions): UseBlockActivationReturn {
  const {
    isBlockVisible,
    isBlockInViewport,
    isBlockHistoryVisible,
    isFocused,
    isBlockSelected,
    isHandleSelected,
    isHovered,
    isInHistoryMode,
  } = options;

  const activationMask = computed(() => {
    let mask = 0;
    if (isBlockVisible.value) mask |= BlockActivationReason.Visible;
    if (isFocused.value) mask |= BlockActivationReason.Focused;
    if (isBlockSelected.value) mask |= BlockActivationReason.BlockSelected;
    if (isHandleSelected.value) mask |= BlockActivationReason.HandleSelected;
    if (isHovered.value) mask |= BlockActivationReason.Hovered;
    if (isInHistoryMode.value) mask |= BlockActivationReason.HistoryMode;
    if (options.isKeepAlive?.value ?? false) mask |= BlockActivationReason.KeepAlive;
    return mask;
  });

  const activationReasons = computed(() => {
    return activationReasonLabels
      .filter(([reason]) => (activationMask.value & reason) !== 0)
      .map(([, label]) => label);
  });

  const immediateActive = computed(() => activationMask.value !== 0);

  const historyImmediateActive = computed(() => {
    return isInHistoryMode.value || isBlockHistoryVisible.value;
  });

  const isUiActive = useStickyActivation(immediateActive);
  const isHistoryActive = useStickyActivation(historyImmediateActive);

  const renderHandles = computed(() => isUiActive.value);
  const renderAnnotation = computed(() => isUiActive.value);
  const renderRevisionChrome = computed(() => isUiActive.value);
  const renderRevisionToolbar = computed(() => {
    return (
      (isBlockInViewport.value || isFocused.value || isBlockSelected.value) &&
      (isHovered.value || isBlockSelected.value)
    );
  });
  const renderHistory = computed(() => isHistoryActive.value);

  return {
    isUiActive,
    activationMask,
    activationReasons,
    renderHandles,
    renderAnnotation,
    renderRevisionChrome,
    renderRevisionToolbar,
    renderHistory,
  };
}
