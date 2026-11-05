/**
 * @file src/main/store/index.ts
 * @description 集中管理和导出 electron-store 实例，确保全局单例。
 */
import Store from 'electron-store';
import { app } from 'electron';

/**
 * 主进程设置（更新安装标记、额度、最近文件）属于 Electron profile，与凭据同在 `userData`。
 * 每个安装与开发实例的 profile 各自独立，验收安装不会读写正式版的设置。
 * 正式版 macOS / Windows 的文件系统不区分大小写，旧位置 `userData/../Linnya` 与 `userData` 是同一目录。
 */
const store = new Store({
  name: 'config',
  cwd: app.getPath('userData'),
});
console.log('Electron main store path (config.json):', store.path);


export { store };
