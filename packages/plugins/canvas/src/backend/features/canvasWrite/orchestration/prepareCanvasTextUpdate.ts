import type { CanvasElement, CanvasPatch } from '../../../../shared';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';
import type { CanvasWritePorts } from '../definitions/canvasWritePorts';

export async function prepareCanvasTextUpdate(operation: Extract<CanvasCliOperation, { op: 'update' }>, current: CanvasElement, ports: CanvasWritePorts): Promise<CanvasPatch | undefined> {
  const markdown = operation.text ?? operation.append;
  if (markdown === undefined) return undefined;
  if (current.type !== 'text') throw new CanvasWriteFailure('wrong_element_type', 'text/append 只适用于文字卡。');
  const mode = operation.text === undefined ? 'append' : 'replace';
  const parsed = await ports.parseText(markdown, { elementId: current.id, revision: operation.revision, mode });
  // 只解析新追加块；原有标签与图片attrs不能因Markdown往返被重新绑定。
  const content = mode === 'append' ? { ...current.data.content, content: [...current.data.content.content, ...parsed.content] } : parsed;
  return { data: { ...current.data, content } };
}
