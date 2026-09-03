import { shell } from 'electron';

import type { ExternalAuthorizationBrowserPort } from '../../../app-hosts/linnya/application/provider-account-authorization';

/** Electron Main 是系统浏览器启动的唯一桌面 owner；Backend 只能请求打开已校验的授权 URL。 */
export function createElectronExternalAuthorizationBrowserPort(): ExternalAuthorizationBrowserPort {
  return Object.freeze({
    async open(url: string): Promise<void> {
      await shell.openExternal(url);
    },
  });
}
