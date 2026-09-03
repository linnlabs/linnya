import type { DesktopHiddenWorkerHostPort } from '../../../app-hosts/linnya/desktop-capabilities';
import { electronDesktopHiddenWorkerHost } from '../../hidden-worker/hiddenWorkerRuntime';

/**
 * Electron 是当前 hidden worker 的 Desktop adapter；Backend 只持有窄端口，
 * 不知道 worker 由 BrowserWindow 和 ipcMain 托管。
 */
export function createElectronDesktopHiddenWorkerHostPort(): DesktopHiddenWorkerHostPort {
  return electronDesktopHiddenWorkerHost;
}
