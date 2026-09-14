import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export interface ManualClickSelection {
  readonly target: ManualEditableTarget | null;
  readonly clickTarget: ManualEditableTarget | null;
}

/**
 * 点击同一路径时逐层深入；切换兄弟时停在共同祖先后的第一个分叉层。
 * 这样同一 Frame 下的兄弟可以直接切换，跨嵌套分支又不会跳过新的父级。
 */
export function resolveManualClickSelection(
  path: readonly ManualEditableTarget[],
  currentPath: readonly ManualEditableTarget[],
  selectedElementId: string | undefined,
): ManualClickSelection {
  const outermostTarget = path[0];
  if (!outermostTarget) return { target: null, clickTarget: null };

  const selectedIndex = selectedElementId
    ? path.findIndex(target => target.elementId === selectedElementId)
    : -1;
  if (selectedIndex >= 0) {
    const target = path[selectedIndex] ?? outermostTarget;
    return {
      target,
      clickTarget: path[Math.min(selectedIndex + 1, path.length - 1)] ?? target,
    };
  }

  const sharedPrefixLength = countSharedPrefix(currentPath, path);
  if (sharedPrefixLength > 0) {
    const target = path[Math.min(sharedPrefixLength, path.length - 1)] ?? outermostTarget;
    return { target, clickTarget: target };
  }

  return { target: outermostTarget, clickTarget: outermostTarget };
}

function countSharedPrefix(
  left: readonly ManualEditableTarget[],
  right: readonly ManualEditableTarget[],
): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index]?.elementId === right[index]?.elementId) index += 1;
  return index;
}
