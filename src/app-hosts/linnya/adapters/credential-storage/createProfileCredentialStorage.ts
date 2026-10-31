import path from 'node:path';
import { createFileCredentialStorage } from '../../../../infra/adapters/credential-storage/file/createFileCredentialStorage';
import type { RuntimePathRoots } from '../../../../shared/runtime-paths';
import type { CredentialStoragePort } from '../../../../shared/credential-storage';

/** App Server 与可信后台 Worker 共用 profile；不能把凭据派生到可导出的 Workspace。 */
export function createProfileCredentialStorage(roots: RuntimePathRoots): CredentialStoragePort {
  if (!roots.profileRoot) throw new Error('凭据存储缺少应用 profile 路径');
  return createFileCredentialStorage(
    path.join(roots.profileRoot, 'AIService', 'config', 'credentials.json')
  );
}
