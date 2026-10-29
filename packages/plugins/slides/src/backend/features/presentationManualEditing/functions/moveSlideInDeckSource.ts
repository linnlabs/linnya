import { readSlideSourceStructure, SlidesSlideInsertionSourceError } from './insertBlankSlideIntoDeckSource';
/** 重排只改 compose 顺序，不搬移有词法依赖的作者语句。 */
export function moveSlideInDeckSource(source: string, count: number, index: number, toIndex: number): string {
  const { list, sourceFile } = readSlideSourceStructure(source, count);
  if (![index, toIndex].every(value => Number.isSafeInteger(value) && value >= 0 && value < count)) throw new SlidesSlideInsertionSourceError('slide_structure_invalid', '页面重排位置无效。');
  const names = list.elements.map(entry => entry.text);
  const moved = names.splice(index, 1)[0];
  names.splice(toIndex, 0, moved);
  return source.slice(0, list.array.getStart(sourceFile)) + `[${names.join(', ')}]` + source.slice(list.array.end);
}
