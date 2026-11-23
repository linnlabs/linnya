import { readlink } from 'node:fs/promises';
import { getMainWindow } from '../../window-manager';

export async function readDesktopTimezone(): Promise<string> {
  if (process.platform === 'darwin') {
    // macOS 更新这个链接；直接取宿主事实，避免驻留 Node 的 ICU 默认时区缓存。
    const link = await readlink('/etc/localtime').catch(() => null);
    const name = link?.split('/zoneinfo/').pop();
    if (link && name && name !== link) return name;
  }
  // Windows 的 Chromium 持续接收系统时区变化。隔离 world 不依赖页面脚本或 preload。
  const contents = getMainWindow()?.webContents;
  if (contents && !contents.isDestroyed() && !contents.isLoadingMainFrame()) {
    const zone: unknown = await contents.executeJavaScriptInIsolatedWorld(1101, [
      { code: 'Intl.DateTimeFormat().resolvedOptions().timeZone' },
    ]);
    if (typeof zone === 'string' && zone.length > 0) return zone;
  }
  // 首次启动时一般尚无窗口，Main 自己也是刚启动的。
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
