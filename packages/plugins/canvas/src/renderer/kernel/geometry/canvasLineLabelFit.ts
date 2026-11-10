import { canvasFitText } from './canvasFitText';

/** 连线标签在画布上的排版：单行、12px 系统字体，超过最大宽度用省略号截断。 */
export const CANVAS_LINE_LABEL_FONT = '12px system-ui';
export const CANVAS_LINE_LABEL_MAX_WIDTH = 200;

export function canvasFitLineLabel(label: string, measure: (text: string) => number): string {
  return canvasFitText(label, measure, CANVAS_LINE_LABEL_MAX_WIDTH);
}

/** 画布上看不全（被截断或含换行）的标签才需要悬停看全文。 */
export function canvasLineLabelTruncated(
  label: string,
  measure: (text: string) => number
): boolean {
  return /\n/.test(label) || canvasFitLineLabel(label, measure) !== label;
}
