export type RendererLocalImageDataUrlResult =
  | { readonly success: true; readonly dataUrl: string }
  | { readonly success: false; readonly error: string };

export type RendererLocalImageStatResult =
  | { readonly success: true; readonly size: number; readonly mtimeMs: number }
  | { readonly success: false; readonly error: string };

export declare function canLoadRendererLocalImageAsDataUrl(): boolean;
export declare function canStatRendererLocalImage(): boolean;
export declare function loadRendererLocalImageAsDataUrl(
  filePath: string,
): Promise<RendererLocalImageDataUrlResult>;
export declare function statRendererLocalImage(
  filePath: string,
): Promise<RendererLocalImageStatResult>;
