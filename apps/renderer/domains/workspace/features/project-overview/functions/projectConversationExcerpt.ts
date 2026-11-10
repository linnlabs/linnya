/**
 * 命中片段已经完整出现在详情的“第一个问题”或“最后的答复”里时不再单独显示。
 * 片段是压成一行、两头可能带省略号的原文，比较前做同样的处理。
 */
export function isExcerptShown(excerpt: string, shownTexts: readonly (string | null | undefined)[]): boolean {
  const core = excerpt.replace(/^…|…$/gu, '').trim();
  if (!core) return true;
  return shownTexts.some(text => text !== null && text !== undefined && text.replace(/\s+/gu, ' ').includes(core));
}
