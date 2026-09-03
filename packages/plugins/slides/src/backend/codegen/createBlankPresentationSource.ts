/**
 * 生成可立即物化的一页空白 Slides 基线。
 *
 * 初次源码编译失败时，真实源码会另存为 draft；这份基线只负责建立稳定的
 * presentation document / revision 外键关系，不能冒充用户源码的编译结果。
 */
export function createBlankPresentationSource(title: string): string {
  const normalizedTitle = title.trim() || '未命名演示文稿';
  return [
    "const slide = createSlide({ background: { color: '#FFFFFF' } });",
    `compose({ title: ${JSON.stringify(normalizedTitle)}, layout: '16x9', slides: [slide] });`,
  ].join('\n');
}
