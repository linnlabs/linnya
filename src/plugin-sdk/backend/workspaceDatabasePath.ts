import path from 'node:path';
import { getWorkspaceDataPath } from 'src/shared/utils/pathManager';

/** standalone 插件进程读取 workspace 数据库位置的窄宿主门面。 */
export function getWorkspaceDatabasePath(): string {
  // command host 会注入主进程 db.name；未注入时才回到标准用户数据目录。
  const injectedDatabasePath = process.env.LINNYA_PLUGIN_RUNTIME_DATABASE_PATH?.trim();
  if (injectedDatabasePath) {
    return injectedDatabasePath;
  }
  return path.join(getWorkspaceDataPath(), 'workspace.sqlite');
}
