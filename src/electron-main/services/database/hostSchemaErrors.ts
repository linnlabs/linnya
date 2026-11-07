/**
 * Host Schema 准入与迁移的有类别错误。
 *
 * 启动失败时，App Server 按这些类别（以及 SQLite / 系统错误码）告诉用户原因，不匹配错误文案。
 * 文案本身仍面向用户，保持原有措辞。
 */

/** 数据格式不在当前程序支持的范围内：比基线更早，或比当前版本更新。检查发生在任何写入之前。 */
export class HostSchemaVersionError extends Error {
  constructor(
    readonly relation: 'older' | 'newer',
    readonly dataVersion: number,
    message: string,
  ) {
    super(message);
    this.name = 'HostSchemaVersionError';
  }
}

/**
 * 一步 Host 迁移失败。该步事务已回滚，之前完成的步骤保留；`cause` 是原始错误，
 * 用来区分磁盘已满等环境问题和迁移代码本身的问题。
 */
export class HostMigrationStepError extends Error {
  constructor(
    readonly fromVersion: number,
    readonly cause: unknown,
  ) {
    super(
      `Database migration failed at v${fromVersion} -> v${fromVersion + 1}: ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = 'HostMigrationStepError';
  }
}
