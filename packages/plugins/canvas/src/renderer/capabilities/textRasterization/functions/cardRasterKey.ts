import type { CardRasterKey } from '../definitions/cardRasterization';

/** key 同时表达正文与排版环境；不能只按卡片 ID 复用旧图。 */
export function cardRasterKey(key: CardRasterKey): string {
  return JSON.stringify([key.revision, key.theme, key.dpr, key.material, key.lod, key.font, key.uiScale]);
}
