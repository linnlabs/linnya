import { readCanvasCardCssPalette, type CanvasColor } from '../../../../shared';
import '../styles/canvasCardInk.css';

/** 正文、嵌入编辑器和离屏正文共用；作者显式设置的行内颜色仍可覆盖继承色。 */
export function installCanvasCardInk(element: HTMLElement, color: CanvasColor, dark: boolean): void {
  const palette = readCanvasCardCssPalette(color, dark);
  element.classList.add('canvas-card-ink'); element.style.color = palette.body;
  element.style.setProperty('--canvas-card-title-color', palette.title);
  element.style.setProperty('--canvas-card-muted-color', palette.muted);
  element.style.setProperty('--canvas-card-paper-color', palette.paper);
}
