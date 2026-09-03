import fs from 'node:fs/promises';
import path from 'node:path';

import { pathManager } from 'src/shared/utils/pathManager';

import type { EndpointCredentialCodec } from '../../../definitions/inferenceEndpoint';
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
      this.plaintextCredentials = await this.decryptCredentials(credentials);
      this.credentials = credentials;
    } catch (error: unknown) {
      const code =
        error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
      if (code !== 'ENOENT') throw error;
      await this.write(new Map());
    }
  }

  has(credentialId: string): boolean {
    return this.credentials.has(credentialId);
  }

  resolve(credentialId: string): string {
    if (!this.credentials.has(credentialId)) {
      throw new Error(`endpoint credential 不存在: ${credentialId}`);
    }
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
  }

  async remove(credentialId: string): Promise<void> {
    const next = new Map(this.credentials);
    if (!next.delete(credentialId)) return;
    await this.write(next);
    this.credentials = next;
    this.plaintextCredentials.delete(credentialId);
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
  ): Promise<Map<string, string>> {
    if (credentials.size === 0) return new Map();
    const codec = this.credentialCodec;
    if (!codec) throw new Error('endpoint credential codec 尚未安装');
    const decrypted = await Promise.all(Array.from(credentials.values(), async credential => [
      credential.id,
      await codec.decrypt(credential.encrypted_secret),
    ] as const));
    return new Map(decrypted);
  }
}

export const endpointCredentialStore = new EndpointCredentialStore();
