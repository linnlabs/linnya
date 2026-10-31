import fs from 'node:fs/promises';
import path from 'node:path';

import type { CommandInternalStorageBoundary } from '@app/schemas/commands';
import { inspectStaticShellArguments } from 'src/domains/commands';
import type { InternalStoragePathPolicy } from './definitions/internalStorageAccess';

/** 新建凭据或连接文件尚不存在时，仍解析现有祖先，避免目录别名绕开保护。 */
async function canonicalPath(value: string): Promise<string> {
  try {
    return await fs.realpath(value);
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const parent = path.dirname(value);
    if (parent === value) throw error;
    return path.join(await canonicalPath(parent), path.basename(value));
  }
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Host 文件工具与 Shell 预检共享路径事实，不能各自猜测 AppData 或 workspace。 */
export function createNodeInternalStoragePathPolicy(
  boundary: CommandInternalStorageBoundary,
): InternalStoragePathPolicy {
  async function isProtectedPath(absolutePath: string, conversationRoot: string): Promise<boolean> {
    const candidate = await canonicalPath(absolutePath);
    const protectedRoots = await Promise.all(boundary.protected_roots.map(canonicalPath));
    if (!protectedRoots.some(root => contains(root, candidate))) return false;
    const readableRoots = await Promise.all([conversationRoot, ...boundary.readable_roots].map(canonicalPath));
    return !readableRoots.some(root => contains(root, candidate));
  }
  return {
    isProtectedPath,
    async commandRequestsAccess(input) {
      if (await isProtectedPath(input.cwd, input.conversationRoot)) return true;
      const tokens = inspectStaticShellArguments(input.command, input.context);
      for (const token of tokens) {
        const argument = token.startsWith('-') && token.includes('=')
          ? token.slice(token.indexOf('=') + 1) : token;
        if (!argument.includes('/') && !argument.includes('\\')) continue;
        if (await isProtectedPath(path.resolve(input.cwd, argument), input.conversationRoot)) return true;
      }
      return false;
    },
  };
}
