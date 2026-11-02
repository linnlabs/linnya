import type { DeckSpec } from '@plugin/slides/shared';
import type { DeckAssembleOptions } from './types';
import { PreparedDeckAssembler } from './PreparedDeckAssembler';
import { prepareShapeTextAutofit } from './text/prepareShapeTextAutofit';

/** 字体能力只在 Host 准备阶段消费，不能进入纯计算 build Worker。 */
export class DeckAssembler extends PreparedDeckAssembler {
  async assemble(deckSpec: DeckSpec, options?: DeckAssembleOptions): Promise<Buffer> {
    return super.assemble(deckSpec, {
      ...options,
      shapeTextAutofit: await prepareShapeTextAutofit(deckSpec),
    });
  }
}
