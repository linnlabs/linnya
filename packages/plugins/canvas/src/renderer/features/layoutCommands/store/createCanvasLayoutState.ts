import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasLayoutDiagnostic } from '@plugin/canvas/shared';
export function createCanvasLayoutState() {
  const treeKeyboard = shallowRef(false), direction = shallowRef<'right' | 'down'>('right'), busy = shallowRef(false), diagnostics = shallowRef<readonly CanvasLayoutDiagnostic[]>([]);
  return { treeKeyboard: shallowReadonly(treeKeyboard), direction: shallowReadonly(direction), busy: shallowReadonly(busy), diagnostics: shallowReadonly(diagnostics),
    setTreeKeyboard(value: boolean) { treeKeyboard.value = value; }, setDirection(value: 'right' | 'down') { direction.value = value; },
    begin() { busy.value = true; diagnostics.value = []; }, complete(value: readonly CanvasLayoutDiagnostic[]) { diagnostics.value = value; }, finish() { busy.value = false; },
  };
}
