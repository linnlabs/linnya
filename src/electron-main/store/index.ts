/**
 * @file src/main/store/index.ts
 * @description 集中管理和导出 electron-store 实例，确保全局单例。
 */
import Store from 'electron-store';
import { app } from 'electron';
import path from 'path';

// 统一将所有配置文件存储在 AppData/Roaming/Linnya 目录下
const configDirectory = path.join(app.getPath('userData'), '..', 'Linnya');

const store = new Store({
  // 主配置文件，命名为 config.json
  name: 'config',
  // 指定存储目录
  cwd: configDirectory
});
console.log('Electron main store path (config.json):', store.path);


export { store };
