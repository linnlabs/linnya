import { JsonValueSchema } from '@app/schemas';
import { CredentialStorageError, type CredentialStoragePort } from 'src/shared/credential-storage';
import type {
  ProviderAccount,
  ProviderAccountOAuthCredential,
  ProviderAccountCredentialStatus,
  ProviderAccountRegistry,
} from '../../../definitions/providerAccount';
import {
  readStoredProviderAccount,
  type StoredProviderAccount,
} from '../definitions/providerAccountCredential';

const NAMESPACE = 'provider-accounts';

export class FileProviderAccountRegistry implements ProviderAccountRegistry {
  private storage: CredentialStoragePort | null = null;

  installCredentialStorage(storage: CredentialStoragePort): void {
    this.storage = storage;
  }

  async initialize(): Promise<void> {
    this.read();
  }

  private requireStorage(): CredentialStoragePort {
    if (!this.storage) throw new Error('Provider account credential storage 尚未安装');
    return this.storage;
  }

  private read(): ReadonlyMap<string, StoredProviderAccount> {
    const accounts = new Map<string, StoredProviderAccount>();
    for (const [id, value] of this.requireStorage().read(NAMESPACE)) {
      const stored = readStoredProviderAccount(value);
      if (stored.account.id !== id) throw new CredentialStorageError('invalid_format');
      accounts.set(id, stored);
    }
    return accounts;
  }

  list(): readonly ProviderAccount[] {
    return Array.from(this.read().values(), stored => stored.account);
  }

  get(accountId: string): ProviderAccount | undefined {
    return this.read().get(accountId)?.account;
  }

  hasCredential(accountId: string): boolean {
    return this.read().has(accountId);
  }

  getCredentialStatus(accountId: string): ProviderAccountCredentialStatus | 'missing' {
    return this.hasCredential(accountId) ? 'available' : 'missing';
  }

  resolveOAuthCredential(accountId: string): ProviderAccountOAuthCredential {
    const stored = this.read().get(accountId);
    if (!stored) throw new Error(`Provider account 不存在: ${accountId}`);
    return stored.credential;
  }

  async putOAuthCredential(
    input: Omit<ProviderAccount, 'created_at' | 'updated_at'>,
    credential: ProviderAccountOAuthCredential
  ): Promise<ProviderAccount> {
    const current = this.read().get(input.id);
    const updatedAt = new Date().toISOString();
    const stored = readStoredProviderAccount({
      account: {
        ...input,
        created_at: current?.account.created_at ?? updatedAt,
        updated_at: updatedAt,
      },
      credential,
    });
    await this.requireStorage().update(
      NAMESPACE,
      new Map([[input.id, JsonValueSchema.parse(stored)]])
    );
    return stored.account;
  }

  async remove(accountId: string): Promise<void> {
    this.read();
    await this.requireStorage().update(NAMESPACE, new Map([[accountId, undefined]]));
  }
}

export const providerAccountRegistry = new FileProviderAccountRegistry();
