import { readCanvasElementSearchText, type CanvasElement, type CanvasElementId } from '@plugin/canvas/shared';
const labels: Readonly<Record<CanvasElement['type'], string>> = { text: '文字卡', image: '图片卡', document: '文档卡', edge: '连线' };
/** 有界摘要供读屏与键盘选择共用，正文投影沿用搜索规则，绝不以内部文档ID代替标题。 */
export function describeCanvasSelection(elements: readonly CanvasElement[], selected: readonly CanvasElementId[], documentTitles: ReadonlyMap<string, string>): string {
  const ids = new Set(selected), items = elements.filter(element => ids.has(element.id));
  if (!items.length) return '未选择内容。按Tab逐张阅读卡片，Command或Control加方向键选择相邻卡片；加F搜索，按Enter定位结果，按Escape返回画布。';
  const descriptions = items.slice(0, 5).map(element => `${labels[element.type]}${element.locked ? '，已锁定' : ''}：${readCanvasElementSearchText(element, { documentTitles }).trim().slice(0, 240) || '无可读正文'}${element.type === 'edge' ? '' : `，位置${Math.round(element.x)},${Math.round(element.y)}`}`);
  return `已选择${items.length}项。${descriptions.join('；')}${items.length > descriptions.length ? '；其余内容可通过搜索逐项定位。' : ''}`;
}
