export interface CanvasPoint { readonly x: number; readonly y: number }
export interface CanvasRectangle extends CanvasPoint { readonly width: number; readonly height: number }
export interface CanvasCamera extends CanvasPoint { readonly zoom: number }
