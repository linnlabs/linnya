export const CANVAS_TEXT_AUTO_MAX_HEIGHT = 1800;
export function canvasAutomaticTextHeight(measured: number): number { return Math.max(64, Math.min(CANVAS_TEXT_AUTO_MAX_HEIGHT, measured)); }
export function canvasImageHeight(width: number, image: { readonly width: number; readonly height: number }): number { return width * image.height / image.width; }
