import path from 'node:path';

export interface LegacyWorkspaceMigrationPaths {
  readonly userDataDirectory: string;
  readonly documentsDirectory: string;
}

let installedPaths: LegacyWorkspaceMigrationPaths | null = null;

/** Backend 启动时安装 Desktop 冻结的旧数据根；迁移流程不能在 sidecar 中加载 Electron。 */
export function installLegacyWorkspaceMigrationPaths(
  userDataDirectory: string,
): LegacyWorkspaceMigrationPaths {
  if (!path.isAbsolute(userDataDirectory)) {
    throw new Error('Legacy Workspace migration userDataDirectory 必须是绝对路径');
  }
  const paths = Object.freeze({
    userDataDirectory,
    documentsDirectory: path.join(userDataDirectory, 'Documents'),
  });
  if (installedPaths && installedPaths.userDataDirectory !== paths.userDataDirectory) {
    throw new Error('当前运行域已经绑定另一份 Legacy Workspace migration paths');
  }
  installedPaths = paths;
  return paths;
}

export function readLegacyWorkspaceMigrationPaths(): LegacyWorkspaceMigrationPaths {
  if (!installedPaths) throw new Error('Legacy Workspace migration paths 尚未安装');
  return installedPaths;
}

