/**
 * @file apps/renderer/shared/utils/openExternalUrl.ts
 *
 * 中文说明：
 * - 统一的“外部打开链接”入口：通过主进程 shell.openExternal 使用系统默认浏览器打开；
 * - 避免在 Electron 内用 window.open / <a target="_blank"> 直接加载远程网页，带来安全与体验问题。
 */

/**
 * 在系统默认浏览器中打开外部链接。
 *
 * 注意：
 * - 主进程会进一步校验协议（仅允许 http/https）；
 * - 这里也做最小的 URL 前缀过滤，减少无效 IPC 调用与控制台噪音。
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (typeof url !== 'string' || url.trim().length === 0) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  const api = window.electronAPI;
  if (!api || typeof api.openExternalUrl !== 'function') {
    console.error('[openExternalUrl] electronAPI.openExternalUrl 不可用，无法打开链接:', url);
    return;
  }

  try {
    const result = await api.openExternalUrl(url);
    if (!result || result.success !== true) {
      console.error('[openExternalUrl] 打开外部链接失败:', { url, error: result?.error });
    }
  } catch (error) {
    console.error('[openExternalUrl] 打开外部链接异常:', { url, error });
  }
}

