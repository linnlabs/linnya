import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_APP_SERVER_FILES = [
  'app-server-entry.cjs',
  'app-server-backend.cjs',
] as const;

/** 独立 Node 不理解 Electron asar；发布态只能执行显式解包的 App Server 产物。 */
export function resolveAppServerBundleDirectory(input: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly developmentMainBundleDirectory: string;
}): string {
  const directory = input.packaged
    ? path.join(input.resourcesPath, 'app.asar.unpacked', 'dist', 'main')
    : input.developmentMainBundleDirectory;
  if (!path.isAbsolute(directory)) {
    throw new Error(`App Server bundle 目录必须是绝对路径: ${directory}`);
  }
  for (const fileName of REQUIRED_APP_SERVER_FILES) {
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`App Server bundle 缺少运行文件: ${filePath}`);
    }
  }
  return directory;
}
