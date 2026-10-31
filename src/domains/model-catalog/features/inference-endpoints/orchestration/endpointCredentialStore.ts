import { CredentialStorageError, type CredentialStoragePort } from 'src/shared/credential-storage';
import type { EndpointCredentialStatus } from '../../../definitions/inferenceEndpoint';

const NAMESPACE = 'model-endpoints';

export class EndpointCredentialStore {
  private storage: CredentialStoragePort | null = null;

  installStorage(storage: CredentialStoragePort): void {
    this.storage = storage;
  }

  async initialize(): Promise<void> {
    this.read();
  }

  private requireStorage(): CredentialStoragePort {
    if (!this.storage) throw new Error('endpoint credential storage 尚未安装');
    return this.storage;
  }

  private read(): ReadonlyMap<string, string> {
    const entries = new Map<string, string>();
    for (const [id, value] of this.requireStorage().read(NAMESPACE)) {
      if (typeof value !== 'string') throw new CredentialStorageError('invalid_format');
      entries.set(id, value);
    }
    return entries;
  }

  has(credentialId: string): boolean {
    return this.read().has(credentialId);
  }

  getStatus(credentialId: string): EndpointCredentialStatus | 'missing' {
    return this.has(credentialId) ? 'available' : 'missing';
  }

  resolve(credentialId: string): string {
    const value = this.read().get(credentialId);
    if (value === undefined) throw new Error(`endpoint credential 不存在: ${credentialId}`);
    return value;
  }

  async put(credentialId: string, plaintext: string): Promise<void> {
    this.read();
    await this.requireStorage().update(NAMESPACE, new Map([[credentialId, plaintext]]));
  }

  async remove(credentialId: string): Promise<void> {
    this.read();
    await this.requireStorage().update(NAMESPACE, new Map([[credentialId, undefined]]));
  }

  /** 只撤回目录事务涉及的记录，不把其他业务刚写入的凭据回滚到旧快照。 */
  captureRollback(credentialId: string): () => Promise<void> {
    const previous = this.read().get(credentialId);
    return () => this.requireStorage().update(NAMESPACE, new Map([[credentialId, previous]]));
  }
}

export const endpointCredentialStore = new EndpointCredentialStore();
