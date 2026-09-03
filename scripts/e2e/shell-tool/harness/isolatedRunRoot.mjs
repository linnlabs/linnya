import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const RUN_ROOT_PREFIX = 'linnya-shell-tool-e2e-';

export async function createIsolatedRunRoot() {
  const createdRootPath = await mkdtemp(path.join(os.tmpdir(), RUN_ROOT_PREFIX));
  // macOS 的 /var 是 /private/var 的符号链接；统一返回真实路径，避免打包器把同一目录误判为包外文件。
  const rootPath = await realpath(createdRootPath);
  let cleanupPromise;

  return {
    path: rootPath,
    cleanup() {
      // 同一轮测试只能清理由 mkdtemp 返回的精确目录，重复收尾复用同一个结果。
      cleanupPromise ??= rm(rootPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      return cleanupPromise;
    },
  };
}
