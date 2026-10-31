import fs from 'node:fs';
import { z } from 'zod';
import { JsonValueSchema } from '@app/schemas';
import {
  CredentialStorageError,
  type CredentialStoragePort,
} from '../../../shared/credential-storage';
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  WEB_SEARCH_ENGINE_IDS,
  WEB_SEARCH_KEY_SOURCES,
  type WebSearchConfig,
  type WebSearchSettings,
} from '../../../tools/web/websearch/definitions/webSearchConfig';
import { normalizeWebSearchSettings } from '../../../tools/web/websearch/functions/normalizeWebSearchConfig';
import { projectActiveWebSearchConfig } from '../../../tools/web/websearch/functions/projectActiveWebSearchConfig';
import { resolveWebSearchConfigUpdate } from '../../../tools/web/websearch/functions/resolveWebSearchConfigUpdate';
import type { WebSearchConfigReader } from '../../../tools/web/websearch/ports/webSearchConfigReader';

const NAMESPACE = 'web-search';
const SettingsSchema = z
  .object({
    engine: z.enum(WEB_SEARCH_ENGINE_IDS),
    slots: z.partialRecord(
      z.enum(WEB_SEARCH_ENGINE_IDS),
      z
        .object({
          keySource: z.enum(WEB_SEARCH_KEY_SOURCES).optional(),
          byokKey: z.string().min(1).optional(),
          searxngBaseUrl: z.string().optional(),
        })
        .strict()
    ),
  })
  .strict();

export class FileWebSearchConfigStore implements WebSearchConfigReader {
  private saveQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly storage: CredentialStoragePort,
    private readonly initialSettings: WebSearchSettings
  ) {}

  static async open(
    filePath: string,
    storage: CredentialStoragePort
  ): Promise<FileWebSearchConfigStore> {
    const initialSettings = storage.read(NAMESPACE).has('settings')
      ? DEFAULT_WEB_SEARCH_SETTINGS
      : readPreviousPreferences(filePath);
    const store = new FileWebSearchConfigStore(storage, initialSettings);
    store.readSettings();
    return store;
  }

  read(): WebSearchConfig {
    return projectActiveWebSearchConfig(this.readSettings());
  }

  readSettings(): WebSearchSettings {
    const stored = this.storage.read(NAMESPACE).get('settings');
    if (stored === undefined) return this.initialSettings;
    const parsed = SettingsSchema.safeParse(stored);
    if (!parsed.success) throw new CredentialStorageError('invalid_format');
    return normalizeWebSearchSettings(parsed.data);
  }

  preview(input: unknown): WebSearchConfig {
    return projectActiveWebSearchConfig(resolveWebSearchConfigUpdate(input, this.readSettings()));
  }

  save(input: unknown): Promise<WebSearchSettings> {
    const operation = this.saveQueue.then(async () => {
      const settings = resolveWebSearchConfigUpdate(input, this.readSettings());
      // 选择与对应 Key 一次提交；失败时不会留下配置已变而凭据未变的半次保存。
      await this.storage.update(
        NAMESPACE,
        new Map([['settings', JsonValueSchema.parse(settings)]])
      );
      return settings;
    });
    this.saveQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}

/** 只保留旧文件的非敏感偏好；旧 Key 不读取、不解密、不迁移。 */
function readPreviousPreferences(filePath: string): WebSearchSettings {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return DEFAULT_WEB_SEARCH_SETTINGS;
    throw new CredentialStorageError('unreadable');
  }
  try {
    const document = z
      .object({
        version: z.literal(3),
        settings: z.object({
          engine: z.unknown(),
          slots: z.record(z.string(), z.unknown()),
        }),
      })
      .parse(JSON.parse(raw));
    const slots = Object.fromEntries(
      Object.entries(document.settings.slots).map(([id, raw]) => {
        const slot = z
          .object({ keySource: z.unknown().optional(), searxngBaseUrl: z.unknown().optional() })
          .parse(raw);
        return [id, slot];
      })
    );
    return normalizeWebSearchSettings({ engine: document.settings.engine, slots });
  } catch {
    throw new CredentialStorageError('invalid_format');
  }
}
