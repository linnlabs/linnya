import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export const PLUGIN_INPUT_MAX_BYTES = 50 * 1024 * 1024;

/** HTTP 上传和 CLI 导入共用同一暂存归属：正式接纳前由 Host 清理，之后由任务清理。 */
export async function createPluginFileStage(directory: string) {
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, randomUUID());
  let accepted = false;
  return {
    filePath,
    get accepted() {
      return accepted;
    },
    acceptFile() {
      accepted = true;
    },
    async dispose() {
      if (!accepted) await rm(filePath, { force: true });
    },
  };
}
