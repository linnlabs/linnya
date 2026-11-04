/** Chromium150的原生paint record；关闭快照不转移/关闭独立tile位图。 */
export interface HtmlElementImage { readonly width: number; readonly height: number; close(): void }
export interface HtmlElementImageCanvas extends HTMLCanvasElement { captureElementImage(element: Element): HtmlElementImage }
export interface HtmlElementImageContext extends OffscreenCanvasRenderingContext2D { drawElementImage(element: HtmlElementImage, x: number, y: number): DOMMatrix }
