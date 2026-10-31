import type { JsonValue } from '@app/schemas';

/** 仅在 Backend 内流动。namespace 由业务 owner 定义，不能注册到 Renderer RPC。 */
export interface CredentialStoragePort {
  read(namespace: string): ReadonlyMap<string, JsonValue>;
  update(namespace: string, changes: ReadonlyMap<string, JsonValue | undefined>): Promise<void>;
}

export type CredentialStorageErrorCode = 'unreadable' | 'invalid_format' | 'write_failed';

export class CredentialStorageError extends Error {
  constructor(readonly code: CredentialStorageErrorCode) {
    // JSON.parse、系统命令的原始异常可能包含文件片段，禁止附加 cause 或原始消息。
    super(
      code === 'write_failed'
        ? '凭据保存失败，原文件未被替换。请检查应用数据目录的访问权限和可用空间。'
        : '凭据文件无法读取或格式损坏，已停止保存并保留原文件。请修复或备份后移走 credentials.json，再重启应用。'
    );
    this.name = 'CredentialStorageError';
  }
}
