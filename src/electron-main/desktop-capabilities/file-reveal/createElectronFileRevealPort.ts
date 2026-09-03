import { shell } from 'electron';

import type { DesktopFileRevealPort } from '../../../app-hosts/linnya/desktop-capabilities';

/** Electron 只拥有系统文件管理器调用；路径解析与准入始终在 Backend。 */
export function createElectronFileRevealPort(): DesktopFileRevealPort {
  return Object.freeze({
    async revealInFileManager(absolutePath: string): Promise<void> {
      shell.showItemInFolder(absolutePath);
    },
  });
}
