import type { CanvasKernelText } from '../../../kernel/definitions/canvasKernelText';
import { canvasText } from './canvasText';

/** 交给内核的文字：每次显示时按当前语言取，语言切换后下一次绘制就是新语言。 */
export const canvasKernelText: CanvasKernelText = {
  surfaceLabel: () => canvasText('canvas.surface.label'),
  imageTitle: () => canvasText('canvas.card.image'),
  blankTitle: () => canvasText('canvas.card.blank'),
  documentTitle: () => canvasText('canvas.card.document'),
  restoring: () => canvasText('canvas.render.restoring'),
  titlesLimited: () => canvasText('canvas.render.titlesLimited'),
  software: () => canvasText('canvas.render.software'),
};
