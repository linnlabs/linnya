export const CANVAS_TEXT_AUTO_MAX_HEIGHT = 1800;
export function canvasAutomaticTextHeight(measured: number): number { return Math.max(64, Math.min(CANVAS_TEXT_AUTO_MAX_HEIGHT, measured)); }
// 编码尺寸属于资产身份；画布等比框必须使用浏览器实际呈现的EXIF转正尺寸。
export function canvasImageHeight(width: number, image: { readonly displayWidth: number; readonly displayHeight: number }): number { return width * image.displayHeight / image.displayWidth; }
export function canvasDefaultImageSize(image: { readonly displayWidth: number; readonly displayHeight: number }): { readonly width: number; readonly height: number } {
  const width = Math.min(480, image.displayWidth); return { width, height: canvasImageHeight(width, image) };
}
