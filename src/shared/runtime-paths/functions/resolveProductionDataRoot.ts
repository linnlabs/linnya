import path from 'node:path';

/** 正式版用户数据根的目录名：数据库与全部受管文件都在它下面。 */
export const PRODUCTION_DATA_DIRECTORY_NAME = 'Workspace';

export interface ProductionDataRootInput {
  readonly platform: NodeJS.Platform;
  /** Electron `userData`。它的末段是应用的目录名，测试与验收安装各自不同，数据也随之隔离。 */
  readonly userDataDirectory: string;
  readonly homeDirectory: string;
  /** Windows `%LOCALAPPDATA%`。 */
  readonly localAppDataDirectory?: string;
  /** Linux `$XDG_DATA_HOME`；未设置时按 XDG 规范使用 `~/.local/share`。 */
  readonly xdgDataHome?: string;
}

/**
 * 正式版把全部用户数据放在一个应用私有目录里：数据库、文档媒体、会话附件与工作目录、
 * 知识库、日志等。这样整套数据可以作为一个文件夹备份或搬走，也不会落进
 * “文稿”这类常被 iCloud / OneDrive 同步的目录。浏览器 profile 与凭据仍在 Electron `userData`。
 *
 * - macOS：`~/Library/Application Support/<应用>/Workspace`（即 `userData/Workspace`）；
 * - Windows：`%LOCALAPPDATA%\<应用>\Workspace`。不放 `%APPDATA%`（Roaming），
 *   漫游配置文件会在登录、注销时同步整个 Roaming 目录；
 * - 其他平台：`$XDG_DATA_HOME/<应用>/Workspace`。
 */
export function resolveProductionDataRoot(input: ProductionDataRootInput): string {
  // 按目标平台的路径规则取末段：Windows 路径用反斜杠分隔。
  const platformPath = input.platform === 'win32' ? path.win32 : path.posix;
  const applicationDirectoryName = platformPath.basename(input.userDataDirectory);
  if (!applicationDirectoryName) {
    throw new Error('Electron userData 目录缺少应用目录名');
  }
  if (input.platform === 'darwin') {
    return path.join(input.userDataDirectory, PRODUCTION_DATA_DIRECTORY_NAME);
  }
  if (input.platform === 'win32') {
    const localAppData = input.localAppDataDirectory?.trim();
    if (!localAppData || !path.win32.isAbsolute(localAppData)) {
      throw new Error('Windows 缺少绝对路径的 %LOCALAPPDATA%，无法确定 Linnya 数据目录');
    }
    return path.win32.join(localAppData, applicationDirectoryName, PRODUCTION_DATA_DIRECTORY_NAME);
  }
  const xdgDataHome = input.xdgDataHome?.trim();
  const dataHome = xdgDataHome && path.isAbsolute(xdgDataHome)
    ? xdgDataHome
    : path.join(input.homeDirectory, '.local', 'share');
  return path.join(dataHome, applicationDirectoryName, PRODUCTION_DATA_DIRECTORY_NAME);
}
