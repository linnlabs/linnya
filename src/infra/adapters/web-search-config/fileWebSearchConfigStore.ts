import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  WEB_SEARCH_ENGINE_IDS,
  WebSearchConfigurationError,
  type WebSearchConfig,
  type WebSearchSettings,
} from '../../../tools/web/websearch/definitions/webSearchConfig';
import {
  normalizeWebSearchConfig,
  normalizeWebSearchSettings,
} from '../../../tools/web/websearch/functions/normalizeWebSearchConfig';
import { projectActiveWebSearchConfig } from '../../../tools/web/websearch/functions/projectActiveWebSearchConfig';
import { resolveWebSearchConfigUpdate } from '../../../tools/web/websearch/functions/resolveWebSearchConfigUpdate';
import type { WebSearchConfigReader } from '../../../tools/web/websearch/ports/webSearchConfigReader';

export interface WebSearchCredentialCodec {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

type StoreState =
  | { readonly ok: true; readonly settings: WebSearchSettings }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class FileWebSearchConfigStore implements WebSearchConfigReader {
  private saveQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private readonly credentialCodec: WebSearchCredentialCodec,
    private state: StoreState,
  ) {}

  /** 凭据解密可能经 Desktop reverse RPC 完成，因此必须在 Backend ready 前显式等待。 */
  static async open(
    filePath: string,
    credentialCodec: WebSearchCredentialCodec,
  ): Promise<FileWebSearchConfigStore> {
    const store = new FileWebSearchConfigStore(
      filePath,
      credentialCodec,
      { ok: true, settings: DEFAULT_WEB_SEARCH_SETTINGS },
    );
    store.state = await store.load();
    return store;
  }

  read(): WebSearchConfig {
    return projectActiveWebSearchConfig(this.readSettings());
  }

  readSettings(): WebSearchSettings {
    if (!this.state.ok) {
      throw new WebSearchConfigurationError('invalid_config', this.state.message);
    }
    return this.state.settings;
  }

  preview(input: unknown): WebSearchConfig {
    const settings = resolveWebSearchConfigUpdate(
      input,
      this.state.ok ? this.state.settings : DEFAULT_WEB_SEARCH_SETTINGS,
    );
    return projectActiveWebSearchConfig(settings);
  }

  save(input: unknown): Promise<WebSearchSettings> {
    const operation = this.saveQueue.then(() => this.persist(input));
    this.saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persist(input: unknown): Promise<WebSearchSettings> {
    const settings = resolveWebSearchConfigUpdate(
      input,
      this.state.ok ? this.state.settings : DEFAULT_WEB_SEARCH_SETTINGS,
    );
    const storedSlots: Record<string, unknown> = {};
    for (const engine of WEB_SEARCH_ENGINE_IDS) {
      const slot = settings.slots[engine];
      if (!slot) continue;
      storedSlots[engine] = {
        ...(slot.keySource ? { keySource: slot.keySource } : {}),
        ...(slot.searxngBaseUrl ? { searxngBaseUrl: slot.searxngBaseUrl } : {}),
        ...(slot.byokKey
          ? { encryptedByokKey: await this.credentialCodec.encrypt(slot.byokKey) }
          : {}),
      };
    }
    const document = `${JSON.stringify({
      version: 3,
      settings: { engine: settings.engine, slots: storedSlots },
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
      return { ok: true, settings: DEFAULT_WEB_SEARCH_SETTINGS };
    }
    try {
      const document: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!isRecord(document)) {
        throw new Error('文件结构或版本不受支持。');
      }
      const settings = document.version === 3
        ? await this.loadCurrentVersion(document)
        : undefined;
      if (!settings) throw new Error('文件结构或版本不受支持。');
      return { ok: true, settings };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `网络搜索配置文件无法读取：${reason}。请在设置页重新保存配置。`,
      };
    }
  }

  private async loadCurrentVersion(
    document: Record<string, unknown>,
  ): Promise<WebSearchSettings | undefined> {
    if (!isRecord(document.settings) || !isRecord(document.settings.slots)) return undefined;
    const slots: Record<string, unknown> = {};
    for (const engine of WEB_SEARCH_ENGINE_IDS) {
      const storedSlot = document.settings.slots[engine];
      if (storedSlot === undefined) continue;
      if (!isRecord(storedSlot)) throw new Error(`搜索引擎 ${engine} 的配置槽格式无效。`);
      const encryptedByokKey = storedSlot.encryptedByokKey;
      if (encryptedByokKey !== undefined && typeof encryptedByokKey !== 'string') {
        throw new Error('加密凭证字段格式错误。');
      }
      slots[engine] = {
        keySource: storedSlot.keySource,
        searxngBaseUrl: storedSlot.searxngBaseUrl,
        ...(encryptedByokKey
          ? { byokKey: await this.credentialCodec.decrypt(encryptedByokKey) }
          : {}),
      };
    }
    return normalizeWebSearchSettings({ engine: document.settings.engine, slots });
  }
}
