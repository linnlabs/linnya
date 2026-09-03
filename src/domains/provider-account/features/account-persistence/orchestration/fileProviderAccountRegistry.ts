import fs from 'node:fs/promises';
import path from 'node:path';

import { pathManager } from 'src/shared/utils/pathManager';
import type {
  ProviderAccount,
  ProviderAccountCredentialCodec,
  ProviderAccountOAuthCredential,
  ProviderAccountRegistry,
} from '../../../definitions/providerAccount';
import {
  PROVIDER_ACCOUNT_FILE_VERSION,
  migrateProviderAccountFileV1,
  readProviderAccountFile,
  readProviderAccountOAuthCredential,
  type ProviderAccountFile,
  type StoredProviderAccount,
} from '../definitions/providerAccountFile';

export class FileProviderAccountRegistry implements ProviderAccountRegistry {
  private credentialCodec: ProviderAccountCredentialCodec | null = null;
  private filePath: string | null = null;
  private accounts = new Map<string, StoredProviderAccount>();
  private plaintextCredentials = new Map<string, ProviderAccountOAuthCredential>();

  installCredentialCodec(codec: ProviderAccountCredentialCodec): void {
    this.credentialCodec = codec;
  }

  async initialize(): Promise<void> {
    if (this.filePath) return;
    this.filePath = pathManager.getProviderAccountsConfigPath();
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const migrated = migrateProviderAccountFileV1(parsed);
      const accounts = new Map(
        (migrated ?? readProviderAccountFile(parsed)).map(account => [account.id, account])
      );
      const plaintextCredentials = await this.decryptCredentials(accounts);
      this.accounts = accounts;
      this.plaintextCredentials = plaintextCredentials;
      if (migrated) await this.write(accounts);
    } catch (error: unknown) {
      const code =
        error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
      if (code !== 'ENOENT') throw error;
      await this.write(new Map());
    }
  }

  list(): readonly ProviderAccount[] {
    return Array.from(this.accounts.values(), account => this.toAccount(account));
  }

  get(accountId: string): ProviderAccount | undefined {
    const account = this.accounts.get(accountId);
    return account ? this.toAccount(account) : undefined;
  }

  hasCredential(accountId: string): boolean {
    return this.accounts.has(accountId);
  }

  resolveOAuthCredential(accountId: string): ProviderAccountOAuthCredential {
    if (!this.accounts.has(accountId)) throw new Error(`Provider account 不存在: ${accountId}`);
    const credential = this.plaintextCredentials.get(accountId);
    if (!credential) throw new Error(`Provider account 凭据尚未完成初始化: ${accountId}`);
    return { ...credential };
  }

  async putOAuthCredential(
    input: Omit<ProviderAccount, 'created_at' | 'updated_at'>,
    credential: ProviderAccountOAuthCredential
  ): Promise<ProviderAccount> {
    if (!this.credentialCodec) throw new Error('Provider account credential codec 尚未安装');
    const encryptedCredential = await this.credentialCodec.encrypt(JSON.stringify(credential));
    const current = this.accounts.get(input.id);
    const updatedAt = new Date().toISOString();
    const stored: StoredProviderAccount = {
      ...input,
      created_at: current?.created_at ?? updatedAt,
      updated_at: updatedAt,
      encrypted_credential: encryptedCredential,
    };
    const next = new Map(this.accounts);
    next.set(stored.id, stored);
    await this.write(next);
    this.accounts = next;
    this.plaintextCredentials.set(stored.id, { ...credential });
    return this.toAccount(stored);
  }

  async remove(accountId: string): Promise<void> {
    const next = new Map(this.accounts);
    if (!next.delete(accountId)) return;
    await this.write(next);
    this.accounts = next;
    this.plaintextCredentials.delete(accountId);
  }

  private toAccount(stored: StoredProviderAccount): ProviderAccount {
    return {
      id: stored.id,
      provider_connection_definition_id: stored.provider_connection_definition_id,
      auth_method: stored.auth_method,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
    };
  }

  private async write(accounts: Map<string, StoredProviderAccount>): Promise<void> {
    const filePath = this.filePath ?? pathManager.getProviderAccountsConfigPath();
    this.filePath = filePath;
    const data: ProviderAccountFile = {
      version: PROVIDER_ACCOUNT_FILE_VERSION,
      last_updated: new Date().toISOString(),
      accounts: Array.from(accounts.values()),
    };
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  }

  private async decryptCredentials(
    accounts: ReadonlyMap<string, StoredProviderAccount>
  ): Promise<Map<string, ProviderAccountOAuthCredential>> {
    if (accounts.size === 0) return new Map();
    const codec = this.credentialCodec;
    if (!codec) throw new Error('Provider account credential codec 尚未安装');
    const decrypted = await Promise.all(Array.from(accounts.values(), async account => {
      const plaintext = await codec.decrypt(account.encrypted_credential);
      return [
        account.id,
        readProviderAccountOAuthCredential(JSON.parse(plaintext)),
      ] as const;
    }));
    return new Map(decrypted);
  }
}

export const providerAccountRegistry = new FileProviderAccountRegistry();
