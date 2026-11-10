import type {
  AppServerStartupFailure,
  AppServerStartupFailureReason,
} from '../../app-server-control';
import {
  HostMigrationStepError,
  HostSchemaVersionError,
} from '../../../../electron-main/services/database/hostSchemaErrors';

const MAX_CAUSE_DEPTH = 8;

/**
 * 把 App Server 启动失败归到 Desktop 能向用户说明的类别。
 *
 * 只看错误类别与错误码，不匹配文案：
 * - 数据版本不受支持（更早或更新）优先，它在任何写入之前就已拒绝；
 * - 其次是环境类错误码（磁盘已满、无法访问、I/O、被占用、文件损坏）。迁移途中遇到
 *   这类错误时，环境原因比“迁移失败”更能告诉用户该做什么，但仍保留迁移步骤；
 * - 剩下的迁移步骤错误才算迁移本身失败；其余为原因未知。
 */
export function describeAppServerStartupFailure(error: Error): AppServerStartupFailure {
  const chain = collectErrorChain(error);
  const versionError = chain.find(
    (candidate): candidate is HostSchemaVersionError => candidate instanceof HostSchemaVersionError,
  );
  if (versionError) {
    return freeze(versionError.relation === 'newer' ? 'newer_data' : 'older_data', null, null);
  }
  const migrationError = chain.find(
    (candidate): candidate is HostMigrationStepError => candidate instanceof HostMigrationStepError,
  );
  const migrationFromVersion = migrationError?.fromVersion ?? null;
  const code = findErrorCode(chain);
  const environmental = code === null ? null : reasonForErrorCode(code);
  if (environmental) return freeze(environmental, code, migrationFromVersion);
  if (migrationError) return freeze('migration_failed', code, migrationFromVersion);
  return freeze('unknown', code, null);
}

/** SQLite 扩展错误码按前缀归类；系统 errno 只收与数据目录直接相关的几种。 */
export function reasonForErrorCode(code: string): AppServerStartupFailureReason | null {
  if (code.startsWith('SQLITE_FULL') || code === 'ENOSPC' || code === 'EDQUOT') return 'disk_full';
  if (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB') return 'corrupt';
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) return 'busy';
  if (
    code.startsWith('SQLITE_CANTOPEN') ||
    code.startsWith('SQLITE_READONLY') ||
    code === 'SQLITE_PERM' ||
    code === 'SQLITE_AUTH' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EROFS'
  ) {
    return 'cannot_access';
  }
  if (code.startsWith('SQLITE_IOERR') || code === 'EIO') return 'io_error';
  return null;
}

function collectErrorChain(error: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && chain.length < MAX_CAUSE_DEPTH && !chain.includes(current)) {
    chain.push(current);
    current = Reflect.get(current, 'cause');
  }
  return chain;
}

/** 取链上第一个形如 SQLITE_FULL / ENOSPC 的错误码。better-sqlite3 与 Node fs 都放在 `code` 上。 */
function findErrorCode(chain: readonly Error[]): string | null {
  for (const candidate of chain) {
    const code: unknown = Reflect.get(candidate, 'code');
    if (typeof code === 'string' && ERROR_CODE_PATTERN.test(code)) return code;
  }
  return null;
}

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

function freeze(
  reason: AppServerStartupFailureReason,
  code: string | null,
  migrationFromVersion: number | null,
): AppServerStartupFailure {
  return Object.freeze({ reason, code, migration_from_version: migrationFromVersion });
}
