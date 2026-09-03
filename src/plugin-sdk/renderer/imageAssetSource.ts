/**
 * @file imageAssetSource.ts
 * @description 渲染端插件读取本地图片为 data URL 的宿主门面。
 *
 * 中文说明：
 * - 插件只表达“需要把本地图片路径转成浏览器可渲染 data URL”；
 * - 真实能力仍由 host preload 暴露的 electronAPI 提供；
 * - 插件不能直接 import 或假定 `window.electronAPI` 的完整结构。
 */

export type RendererLocalImageDataUrlResult =
  | { success: true; dataUrl: string }
  | { success: false; error: string };

export type RendererLocalImageStatResult =
  | { success: true; size: number; mtimeMs: number }
  | { success: false; error: string };

type LocalImageLoader = (filePath: string) => Promise<{
  success: boolean;
  dataUrl?: string;
  error?: string;
}>;

type LocalImageStatReader = (filePath: string) => Promise<{
  success: boolean;
  size?: number;
  mtimeMs?: number;
  error?: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLocalImageLoader(value: unknown): value is LocalImageLoader {
  return typeof value === 'function';
}

function isLocalImageStatReader(value: unknown): value is LocalImageStatReader {
  return typeof value === 'function';
}

function getLocalImageLoader(): LocalImageLoader | null {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (!isRecord(api)) {
    return null;
  }

  const loadImageAsDataURL = api.loadImageAsDataURL;
  return isLocalImageLoader(loadImageAsDataURL) ? loadImageAsDataURL : null;
}

function getLocalImageStatReader(): LocalImageStatReader | null {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (!isRecord(api)) {
    return null;
  }

  const statImageFile = api.statImageFile;
  return isLocalImageStatReader(statImageFile) ? statImageFile : null;
}

export function canLoadRendererLocalImageAsDataUrl(): boolean {
  return getLocalImageLoader() != null;
}

export function canStatRendererLocalImage(): boolean {
  return getLocalImageStatReader() != null;
}

export async function loadRendererLocalImageAsDataUrl(
  filePath: string,
): Promise<RendererLocalImageDataUrlResult> {
  const loadImageAsDataURL = getLocalImageLoader();
  if (!loadImageAsDataURL) {
    return {
      success: false,
      error: 'electronAPI.loadImageAsDataURL is not available',
    };
  }

  try {
    const result = await loadImageAsDataURL(filePath);
    if (result.success === true && typeof result.dataUrl === 'string' && result.dataUrl.length > 0) {
      return {
        success: true,
        dataUrl: result.dataUrl,
      };
    }
    return {
      success: false,
      error: result.error ?? `Failed to load local image: ${filePath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function statRendererLocalImage(
  filePath: string,
): Promise<RendererLocalImageStatResult> {
  const statImageFile = getLocalImageStatReader();
  if (!statImageFile) {
    return {
      success: false,
      error: 'electronAPI.statImageFile is not available',
    };
  }

  try {
    const result = await statImageFile(filePath);
    if (
      result.success === true &&
      typeof result.size === 'number' &&
      Number.isFinite(result.size) &&
      typeof result.mtimeMs === 'number' &&
      Number.isFinite(result.mtimeMs)
    ) {
      return {
        success: true,
        size: result.size,
        mtimeMs: result.mtimeMs,
      };
    }
    return {
      success: false,
      error: result.error ?? `Failed to stat local image: ${filePath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
