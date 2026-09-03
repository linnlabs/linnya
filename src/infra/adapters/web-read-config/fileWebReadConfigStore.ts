import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_WEB_READ_SETTINGS,
  WebReadConfigurationError,
  type WebReadConfig,
  type WebReadCredentialReaderId,
  type WebReadSettings,
} from '../../../tools/web/webread/definitions/webReadConfig';
import { normalizeWebReadSettings } from '../../../tools/web/webread/functions/normalizeWebReadConfig';
import { projectActiveWebReadConfig } from '../../../tools/web/webread/functions/projectActiveWebReadConfig';
import { resolveWebReadConfigUpdate } from '../../../tools/web/webread/functions/resolveWebReadConfigUpdate';
import type { WebReadConfigReader } from '../../../tools/web/webread/ports/webReadConfigReader';

const CREDENTIAL_READER_IDS: readonly WebReadCredentialReaderId[] = [
  'metaso_reader',
  'jina_reader',
];

export interface WebReadCredentialCodec {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

type StoreState =
  | { readonly ok: true; readonly settings: WebReadSettings }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class FileWebReadConfigStore implements WebReadConfigReader {
  private saveQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private readonly credentialCodec: WebReadCredentialCodec,
    private state: StoreState,
  ) {}

  /** 凭据解密可能经 Desktop reverse RPC 完成，因此必须在 Backend ready 前显式等待。 */
  static async open(
    filePath: string,
    credentialCodec: WebReadCredentialCodec,
  ): Promise<FileWebReadConfigStore> {
    const store = new FileWebReadConfigStore(
      filePath,
      credentialCodec,
      { ok: true, settings: DEFAULT_WEB_READ_SETTINGS },
    );
    store.state = await store.load();
    return store;
  }

  read(): WebReadConfig {
    return projectActiveWebReadConfig(this.readSettings());
  }

  readSettings(): WebReadSettings {
    if (!this.state.ok) {
      throw new WebReadConfigurationError('invalid_config', this.state.message);
    }
    return this.state.settings;
  }

  preview(input: unknown): WebReadConfig {
    return projectActiveWebReadConfig(resolveWebReadConfigUpdate(
      input,
      this.state.ok ? this.state.settings : DEFAULT_WEB_READ_SETTINGS,
    ));
  }

  save(input: unknown): Promise<WebReadSettings> {
    const operation = this.saveQueue.then(() => this.persist(input));
    this.saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persist(input: unknown): Promise<WebReadSettings> {
    const settings = resolveWebReadConfigUpdate(
      input,
      this.state.ok ? this.state.settings : DEFAULT_WEB_READ_SETTINGS,
    );
    const storedSlots: Record<string, unknown> = {};
    for (const reader of CREDENTIAL_READER_IDS) {
      const byokKey = settings.slots[reader]?.byokKey;
      if (!byokKey) continue;
      storedSlots[reader] = {
        encryptedByokKey: await this.credentialCodec.encrypt(byokKey),
      };
    }
    const document = `${JSON.stringify({
      version: 1,
      settings: {
        renderEnabled: settings.renderEnabled,
        managedReader: settings.managedReader,
        slots: storedSlots,
      },
    }, null, 2)}\n`;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, document, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error: unknown) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
    this.state = { ok: true, settings };
    return settings;
  }

  private async load(): Promise<StoreState> {
    if (!fs.existsSync(this.filePath)) {
      return { ok: true, settings: DEFAULT_WEB_READ_SETTINGS };
    }
    try {
      const document: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!isRecord(document)
        || document.version !== 1
        || !isRecord(document.settings)
        || !isRecord(document.settings.slots)) {
        throw new Error('文件结构或版本不受支持。');
      }
      const slots: Record<string, unknown> = {};
      for (const reader of CREDENTIAL_READER_IDS) {
        const storedSlot = document.settings.slots[reader];
        if (storedSlot === undefined) continue;
        if (!isRecord(storedSlot)
          || typeof storedSlot.encryptedByokKey !== 'string'
          || storedSlot.encryptedByokKey.length === 0) {
          throw new Error(`网络读取 ${reader} 加密凭证格式错误。`);
        }
        slots[reader] = {
          byokKey: await this.credentialCodec.decrypt(storedSlot.encryptedByokKey),
        };
      }
      return {
        ok: true,
        settings: normalizeWebReadSettings({
          renderEnabled: document.settings.renderEnabled,
          managedReader: document.settings.managedReader,
          slots,
        }),
      };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `网络读取配置文件无法读取：${reason}。请在设置页重新保存配置。`,
      };
    }
  }
}
