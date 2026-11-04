import type { CanvasToolTraceFacts } from '../definitions/canvasToolTrace';

/** 取最后一次实际模型读图对应的render序号，不能挑一个恰好匹配after的旧记录冒充最终检查。 */
export function readCanvasImageReadSequence(facts: CanvasToolTraceFacts): number | null | undefined {
  const read = [...facts.imageReads].sort((a, b) => b.order - a.order)[0];
  if (!read) return null;
  const render = facts.renders.filter(render => render.toolCallId === read.renderToolCallId && render.locator === read.locator && render.order < read.order)
    .sort((a, b) => b.order - a.order)[0];
  return render?.sequence;
}
