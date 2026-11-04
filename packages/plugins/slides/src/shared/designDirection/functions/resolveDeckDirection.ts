import type { DirectionDeclaration } from '../definitions/directionContract';

/** 只有生成稿由 Agent 声明方向；导入稿与改稿不对照方向。 */
export function resolveDeckDirection(
  sourceKind: 'generated' | 'imported' | 'patched',
  theme: { readonly direction?: DirectionDeclaration } | undefined,
): DirectionDeclaration | undefined {
  return sourceKind === 'generated' ? theme?.direction : undefined;
}
