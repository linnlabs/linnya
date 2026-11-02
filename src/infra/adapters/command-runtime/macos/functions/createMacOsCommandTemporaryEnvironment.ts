import fsp from 'node:fs/promises';
import path from 'node:path';

import type { CommandPermissionLevel } from '@app/schemas/commands';

const COMMAND_TEMPORARY_DIRECTORY = '.linnya-tmp';

/**
 * 标准档只能写当前对话目录，而 zsh here document（TMPPREFIX）和 mktemp 等
 * TMPDIR 使用者默认写系统临时目录。这里只把临时位置移进已允许的写入根，不放宽文件边界。
 * 目录无法创建时不覆盖，由命令如实报错。
 */
export async function createMacOsCommandTemporaryEnvironment(input: {
  readonly permissionLevel: CommandPermissionLevel;
  readonly conversationRoot: string;
}): Promise<Readonly<Record<string, string>>> {
  if (input.permissionLevel !== 'standard') return {};
  const temporaryDirectory = path.join(input.conversationRoot, COMMAND_TEMPORARY_DIRECTORY);
  try {
    await fsp.mkdir(temporaryDirectory, { recursive: true });
  } catch {
    return {};
  }
  return {
    TMPDIR: `${temporaryDirectory}${path.sep}`,
    TMPPREFIX: path.join(temporaryDirectory, 'zsh'),
  };
}
