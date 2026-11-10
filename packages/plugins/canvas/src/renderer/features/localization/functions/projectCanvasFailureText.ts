import { isCanvasUserFailureCode } from '@plugin/canvas/shared';
import { canvasText } from './canvasText';

/** 后端回传的是失败编号时换成当前语言的文案，其余文字（宿主原文）原样保留。 */
export function projectCanvasFailureText(text: string): string {
  return isCanvasUserFailureCode(text) ? canvasText(`canvas.failure.${text}`) : text;
}
