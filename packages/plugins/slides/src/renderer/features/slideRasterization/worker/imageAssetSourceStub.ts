export function canLoadRendererLocalImageAsDataUrl(): boolean {
  return false;
}

export function canStatRendererLocalImage(): boolean {
  return false;
}

export async function loadRendererLocalImageAsDataUrl(): Promise<{
  readonly success: false;
  readonly error: string;
}> {
  return {
    success: false,
    error: 'Local image loading is unavailable inside the Slides raster worker',
  };
}

export async function statRendererLocalImage(): Promise<{
  readonly success: false;
  readonly error: string;
}> {
  return {
    success: false,
    error: 'Local image stat is unavailable inside the Slides raster worker',
  };
}
