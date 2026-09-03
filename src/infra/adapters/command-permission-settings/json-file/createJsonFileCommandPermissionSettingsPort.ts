import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';

export interface CreateJsonFileCommandPermissionSettingsPortOptions {
  readonly filePath: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createJsonFileCommandPermissionSettingsPort(
  options: CreateJsonFileCommandPermissionSettingsPortOptions,
): CommandPermissionSettingsPort {
  return {
    read() {
      try {
        return {
          status: 'found',
          serialized: fs.readFileSync(options.filePath, 'utf8'),
        };
      } catch (error: unknown) {
        if (
          error instanceof Error
          && 'code' in error
          && error.code === 'ENOENT'
        ) {
          return { status: 'missing' };
        }
        return {
          status: 'failed',
          message: `无法读取命令权限设置：${errorMessage(error)}`,
        };
      }
    },
    write(serialized) {
      const directory = path.dirname(options.filePath);
      const temporaryPath = `${options.filePath}.${randomUUID()}.tmp`;
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
        // 只有完整临时文件写入成功后才替换旧设置，进程中断不会留下半份正式 JSON。
        fs.renameSync(temporaryPath, options.filePath);
        return { status: 'written' };
      } catch (error: unknown) {
        let cleanupFailure: string | undefined;
        try {
          fs.rmSync(temporaryPath, { force: true });
        } catch (cleanupError: unknown) {
          cleanupFailure = errorMessage(cleanupError);
        }
        return {
          status: 'failed',
          message: `无法保存命令权限设置：${errorMessage(error)}${
            cleanupFailure ? `；临时文件清理也失败：${cleanupFailure}` : ''
          }`,
        };
      }
    },
  };
}
