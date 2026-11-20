import type { DeckSpec } from './slideSpec';

/**
 * 生成稿的排版合同版本。同一份 deck.js 因排版规则变化而编译出不同外框时加一。
 * 已存物化（`presentation_documents.deck_spec_json`）版本不同，读取侧就从源码重编译并写回，
 * 见 backend/features/presentationLayoutRefresh。版本只在这里定义，不在别处写数字。
 *
 * - 1：2026-11-16 单倍行距改按 PowerPoint 的 1.2 倍字号，自动高度文字的外框随之变高。
 * - 2：2026-11-17 公式分式偏移与上下标缩放改用 PowerPoint 数学字体的常量，含分式的行变高。
 */
export const DECK_LAYOUT_VERSION = 2;

export function isDeckLayoutCurrent(deckSpec: Pick<DeckSpec, 'layoutVersion'>): boolean {
  return deckSpec.layoutVersion === DECK_LAYOUT_VERSION;
}
