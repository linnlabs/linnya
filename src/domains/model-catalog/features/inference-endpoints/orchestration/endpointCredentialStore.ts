import fs from 'node:fs/promises';
import path from 'node:path';

import { pathManager } from 'src/shared/utils/pathManager';
import {
  readCredentialProtectionErrorCode,
  type CredentialProtectionErrorCode,
} from 'src/shared/credential-protection';

import {
  EndpointCredentialUnavailableError,
  type EndpointCredentialCodec,
  type EndpointCredentialStatus,
} from '../../../definitions/inferenceEndpoint';
import {
  ENDPOINT_CREDENTIAL_FILE_VERSION,
  readEndpointCredentialFile,
  type EndpointCredentialFile,
  type StoredEndpointCredential,
} from '../definitions/endpointCredentialFile';

export class EndpointCredentialStore {
  private credentialCodec: EndpointCredentialCodec | null = null;
  private credentialFilePath: string | null = null;
  private credentials = new Map<string, StoredEndpointCredential>();
  private plaintextCredentials = new Map<string, string>();
  private credentialStatuses = new Map<string, EndpointCredentialStatus>();

  installCodec(codec: EndpointCredentialCodec): void {
    this.credentialCodec = codec;
  }

  async initialize(): Promise<void> {
    if (this.credentialFilePath) return;
    this.credentialFilePath = pathManager.getEndpointCredentialsConfigPath();
    await fs.mkdir(path.dirname(this.credentialFilePath), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.credentialFilePath, 'utf8'));
      const credentials = new Map(
        readEndpointCredentialFile(parsed).map(item => [item.id, item])
      );
      const decrypted = await this.decryptCredentials(credentials);
      this.plaintextCredentials = decrypted.plaintext;
      this.credentialStatuses = decrypted.statuses;
      this.credentials = credentials;
    } catch (error: unknown) {
      const code =
        error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
      if (code !== 'ENOENT') throw error;
      await this.write(new Map());
    }
  }

  has(credentialId: string): boolean {
    return this.credentialStatuses.get(credentialId) === 'available';
  }

  getStatus(credentialId: string): EndpointCredentialStatus | 'missing' {
    return this.credentialStatuses.get(credentialId) ?? 'missing';
  }

  resolve(credentialId: string): string {
    if (!this.credentials.has(credentialId)) {
      throw new Error(`endpoint credential 不存在: ${credentialId}`);
    }
    const status = this.credentialStatuses.get(credentialId);
    if (!status) throw new Error(`endpoint credential 尚未完成初始化: ${credentialId}`);
    if (status !== 'available') throw new EndpointCredentialUnavailableError(status);
    const plaintext = this.plaintextCredentials.get(credentialId);
    if (plaintext === undefined) {
      throw new Error(`endpoint credential 尚未完成初始化: ${credentialId}`);
    }
    return plaintext;
  }

  async put(credentialId: string, plaintext: string): Promise<void> {
    if (!this.credentialCodec) throw new Error('endpoint credential codec 尚未安装');
    const encryptedSecret = await this.credentialCodec.encrypt(plaintext);
    const next = new Map(this.credentials);
    next.set(credentialId, {
      id: credentialId,
      encrypted_secret: encryptedSecret,
    });
    await this.write(next);
    this.credentials = next;
    this.plaintextCredentials.set(credentialId, plaintext);
    this.credentialStatuses.set(credentialId, 'available');
  }

  async remove(credentialId: string): Promise<void> {
    const next = new Map(this.credentials);
    if (!next.delete(credentialId)) return;
    await this.write(next);
    this.credentials = next;
    this.plaintextCredentials.delete(credentialId);
    this.credentialStatuses.delete(credentialId);
  }

  private async write(credentials: Map<string, StoredEndpointCredential>): Promise<void> {
    const filePath = this.credentialFilePath ?? pathManager.getEndpointCredentialsConfigPath();
    this.credentialFilePath = filePath;
    const data: EndpointCredentialFile = {
      version: ENDPOINT_CREDENTIAL_FILE_VERSION,
      last_updated: new Date().toISOString(),
      credentials: Array.from(credentials.values()),
    };
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  }

  private async decryptCredentials(
    credentials: ReadonlyMap<string, StoredEndpointCredential>
  ): Promise<{
    readonly plaintext: Map<string, string>;
    readonly statuses: Map<string, EndpointCredentialStatus>;
  }> {
    if (credentials.size === 0) {
      return { plaintext: new Map(), statuses: new Map() };
    }
    const codec = this.credentialCodec;
    if (!codec) throw new Error('endpoint credential codec 尚未安装');
    const decrypted = await Promise.all(Array.from(credentials.values(), async credential => {
      try {
        return {
          id: credential.id,
          plaintext: await codec.decrypt(credential.encrypted_secret),
          status: 'available' as const,
        };
      } catch (error: unknown) {
        const code: CredentialProtectionErrorCode = readCredentialProtectionErrorCode(error);
        return { id: credential.id, status: code };
      }
    }));
    return {
      plaintext: new Map(
        decrypted.flatMap(item => item.status === 'available'
          ? [[item.id, item.plaintext] as const]
          : []),
      ),
      statuses: new Map(decrypted.map(item => [item.id, item.status])),
    };
  }
}

export const endpointCredentialStore = new EndpointCredentialStore();
