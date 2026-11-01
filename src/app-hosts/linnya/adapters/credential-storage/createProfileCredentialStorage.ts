import path from 'node:path';
import { createFileCredentialStorage } from '../../../../infra/adapters/credential-storage/file/createFileCredentialStorage';
import type { RuntimePathRoots } from '../../../../shared/runtime-paths';
import type { CredentialStoragePort } from '../../../../shared/credential-storage';

/** App Server 与可信后台 Worker 共用 profile；不能把凭据派生到可导出的 Workspace。 */
export function createProfileCredentialStorage(roots: RuntimePathRoots): CredentialStoragePort {
  return createFileCredentialStorage(resolveProfileCredentialFilePath(roots));
}

/** 存储与命令风险提示共享同一位置，不能在另一处猜测凭据目录。 */
export function resolveProfileCredentialFilePath(roots: RuntimePathRoots): string {
  if (!roots.profileRoot) throw new Error('凭据存储缺少应用 profile 路径');
  return path.join(roots.profileRoot, 'AIService', 'config', 'credentials.json');
}
