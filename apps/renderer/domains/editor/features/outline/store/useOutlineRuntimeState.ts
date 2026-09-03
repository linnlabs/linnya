import { computed, ref } from 'vue';

const hasHeadings = ref(false);
const outlineReady = ref(false);
const outlineHandleHovered = ref(false);
const outlineHandleFocused = ref(false);
const outlinePanelHovered = ref(false);
const outlinePanelFocused = ref(false);
const outlineHostLeft = ref(0);
const outlineHostTop = ref(0);
const outlineHostHeight = ref(0);
const outlineHostGeometryReady = ref(false);

export interface OutlineHostGeometry {
  left: number;
  top: number;
  height: number;
}

const outlinePreviewVisible = computed(() => (
  outlineHandleHovered.value ||
  outlineHandleFocused.value ||
  outlinePanelHovered.value ||
  outlinePanelFocused.value
));

export function setOutlineHasHeadings(value: boolean): void {
  if (hasHeadings.value !== value) {
    hasHeadings.value = value;
  }

  if (!outlineReady.value) {
    outlineReady.value = true;
  }
}

export function resetOutlinePresence(): void {
  hasHeadings.value = false;
  outlineReady.value = false;
  resetOutlineInteractionState();
  resetOutlineHostGeometry();
}

export function setOutlineHandleHovered(value: boolean): void {
  outlineHandleHovered.value = value;
}

export function setOutlineHandleFocused(value: boolean): void {
  outlineHandleFocused.value = value;
}

export function setOutlinePanelHovered(value: boolean): void {
  outlinePanelHovered.value = value;
}

export function setOutlinePanelFocused(value: boolean): void {
  outlinePanelFocused.value = value;
}

export function resetOutlineInteractionState(): void {
  outlineHandleHovered.value = false;
  outlineHandleFocused.value = false;
  outlinePanelHovered.value = false;
  outlinePanelFocused.value = false;
}

export function setOutlineHostGeometry(value: OutlineHostGeometry): void {
  outlineHostLeft.value = value.left;
  outlineHostTop.value = value.top;
  outlineHostHeight.value = value.height;
  outlineHostGeometryReady.value = true;
}

export function resetOutlineHostGeometry(): void {
  outlineHostLeft.value = 0;
  outlineHostTop.value = 0;
  outlineHostHeight.value = 0;
  outlineHostGeometryReady.value = false;
}

export function useOutlineRuntimeState() {
  return {
    hasHeadings,
    outlineReady,
    outlinePreviewVisible,
    outlineHostLeft,
    outlineHostTop,
    outlineHostHeight,
    outlineHostGeometryReady,
    setHasHeadings: setOutlineHasHeadings,
    setHandleHovered: setOutlineHandleHovered,
    setHandleFocused: setOutlineHandleFocused,
    setPanelHovered: setOutlinePanelHovered,
    setPanelFocused: setOutlinePanelFocused,
    setHostGeometry: setOutlineHostGeometry,
    resetPresence: resetOutlinePresence,
    resetInteractionState: resetOutlineInteractionState,
    resetHostGeometry: resetOutlineHostGeometry,
  };
}
