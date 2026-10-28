import type { DeckSpec } from '@plugin/slides/shared';

/** 只有可证明等价的确定性作者操作才能直接复用编译结果。 */
export type ManualEditDeckProjection =
  | { readonly kind: 'projected'; readonly deckSpec: DeckSpec }
  | { readonly kind: 'requires_full_compile' };
