import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  PhysicalFileReadError,
  type PhysicalFileReadScope,
} from 'src/app-hosts/linnya/application/file-read';

function readNodeErrorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export function projectNodePhysicalFileError(error: unknown, operation: string): never {
  const osCode = readNodeErrorCode(error);
  if (osCode === 'ENOENT' || osCode === 'ENOTDIR') {
    throw new PhysicalFileReadError('READ_FILE_NOT_FOUND', '物理文件不存在。', {
      operation,
      ...(osCode ? { osCode } : {}),
    });
  }
  if (osCode === 'EACCES' || osCode === 'EPERM') {
    throw new PhysicalFileReadError('READ_FILE_OS_ACCESS_DENIED', '操作系统拒绝读取物理文件。', {
      operation,
      ...(osCode ? { osCode } : {}),
    });
  }
  if (osCode === 'EISDIR' || osCode === 'ELOOP') {
    throw new PhysicalFileReadError(
      'READ_FILE_NOT_REGULAR_FILE',
      '物理路径不是可读取的普通文件。',
      { operation, osCode },
    );
  }
  throw error;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

/**
 * `read_file` 与回答链接定位必须共享同一物理 identity 规则；否则会出现 Agent
 * 能读取、用户却无法定位，或反过来绕开 conversation root 的分叉。
 */
export async function resolveNodePhysicalFileSource(input: {
  readonly absolutePath: string;
  readonly scope: PhysicalFileReadScope;
}): Promise<string> {
  if (!path.isAbsolute(input.absolutePath) || input.absolutePath.includes('\0')) {
    throw new PhysicalFileReadError(
      'READ_FILE_LOCATOR_INVALID',
      '物理文件只接受不含 NUL 的宿主绝对路径。',
    );
  }

  if (input.scope.kind === 'conversation') {
    let requestedStat;
    try {
      requestedStat = await fsp.lstat(input.absolutePath);
    } catch (error: unknown) {
      projectNodePhysicalFileError(error, 'lstat');
    }
    if (requestedStat.isSymbolicLink()) {
      throw new PhysicalFileReadError(
        'READ_FILE_NOT_REGULAR_FILE',
        'conversation 文件不能是符号链接。',
      );
    }
  }

  let resolvedPath: string;
  try {
    resolvedPath = await fsp.realpath(input.absolutePath);
  } catch (error: unknown) {
    projectNodePhysicalFileError(error, 'realpath');
  }

  if (input.scope.kind === 'conversation') {
    let canonicalRoot: string;
    try {
      canonicalRoot = await fsp.realpath(input.scope.rootPath);
    } catch (error: unknown) {
      projectNodePhysicalFileError(error, 'realpath_conversation_root');
    }
    if (!isInside(canonicalRoot, resolvedPath)) {
      throw new PhysicalFileReadError(
        'READ_FILE_LOCATOR_INVALID',
        'conversation locator 解析后的目标越过当前 conversation root。',
      );
    }
  }
  return resolvedPath;
}

export async function inspectNodePhysicalRegularFile(input: {
  readonly absolutePath: string;
  readonly scope: PhysicalFileReadScope;
}): Promise<{
  readonly resolvedPath: string;
  readonly fileName: string;
  readonly byteLength: number;
}> {
  const resolvedPath = await resolveNodePhysicalFileSource(input);
  try {
    const stat = await fsp.lstat(resolvedPath);
    if (!stat.isFile()) {
      throw new PhysicalFileReadError(
        'READ_FILE_NOT_REGULAR_FILE',
        '只支持普通文件，目录、FIFO、socket 和设备文件均不支持。',
      );
    }
    return {
      resolvedPath,
      fileName: path.basename(input.absolutePath),
      byteLength: stat.size,
    };
  } catch (error: unknown) {
    if (error instanceof PhysicalFileReadError) throw error;
    projectNodePhysicalFileError(error, 'lstat_resolved_target');
  }
}
