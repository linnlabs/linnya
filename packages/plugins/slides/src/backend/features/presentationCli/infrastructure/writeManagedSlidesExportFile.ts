import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  SlidesCliError,
  SlidesCliExitCode,
  type WriteManagedSlidesExportFile,
} from '../definitions/slidesCli';

/**
 * 先写临时文件再改名：外部调用方或用户在写入过程中打开同名文件时，看到的要么是旧的完整文件，
 * 要么是新的完整文件，不会是写了一半的 PPTX。
 */
export const writeManagedSlidesExportFile: WriteManagedSlidesExportFile = async ({ root, fileName, bytes }) => {
  const target = path.join(root, fileName);
  const temporary = path.join(root, `.${fileName}.${randomUUID()}.tmp`);
  try {
    await mkdir(root, { recursive: true });
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } catch (error: unknown) {
    await rm(temporary, { force: true });
    // 路径属于会话目录，不进 stderr；只带系统错误码（磁盘满、无权限等）帮助判断原因。
    const reason = error instanceof Error && 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
    throw new SlidesCliError(
      'slides.cli.output_write_failed',
      SlidesCliExitCode.OUTPUT_FAILED,
      `Could not write the exported PPTX into the conversation directory${reason}`,
    );
  }
};
