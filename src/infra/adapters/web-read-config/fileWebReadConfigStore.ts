import fs from 'node:fs';
import { z } from 'zod';
import { JsonValueSchema } from '@app/schemas';
import {
  CredentialStorageError,
  type CredentialStoragePort,
} from '../../../shared/credential-storage';
import {
  DEFAULT_WEB_READ_SETTINGS,
  WEB_READ_MANAGED_READER_IDS,
  type WebReadConfig,
  type WebReadSettings,
} from '../../../tools/web/webread/definitions/webReadConfig';
import { normalizeWebReadSettings } from '../../../tools/web/webread/functions/normalizeWebReadConfig';
import { projectActiveWebReadConfig } from '../../../tools/web/webread/functions/projectActiveWebReadConfig';
import { resolveWebReadConfigUpdate } from '../../../tools/web/webread/functions/resolveWebReadConfigUpdate';
import type { WebReadConfigReader } from '../../../tools/web/webread/ports/webReadConfigReader';

const NAMESPACE = 'web-read';
const SettingsSchema = z
  .object({
    renderEnabled: z.boolean(),
    managedReader: z.enum(WEB_READ_MANAGED_READER_IDS),
    slots: z.partialRecord(
      z.enum(['metaso_reader', 'jina_reader']),
      z
        .object({
          byokKey: z.string().min(1).optional(),
        })
        .strict()
    ),
  })
  .strict();

export class FileWebReadConfigStore implements WebReadConfigReader {
  private saveQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly storage: CredentialStoragePort,
    private readonly initialSettings: WebReadSettings
  ) {}

  static async open(
    filePath: string,
    storage: CredentialStoragePort
  ): Promise<FileWebReadConfigStore> {
    const initialSettings = storage.read(NAMESPACE).has('settings')
      ? DEFAULT_WEB_READ_SETTINGS
      : readPreviousPreferences(filePath);
    const store = new FileWebReadConfigStore(storage, initialSettings);
    store.readSettings();
    return store;
  }

  read(): WebReadConfig {
    return projectActiveWebReadConfig(this.readSettings());
  }

  readSettings(): WebReadSettings {
    const stored = this.storage.read(NAMESPACE).get('settings');
    if (stored === undefined) return this.initialSettings;
    const parsed = SettingsSchema.safeParse(stored);
    if (!parsed.success) throw new CredentialStorageError('invalid_format');
    return normalizeWebReadSettings(parsed.data);
  }

  preview(input: unknown): WebReadConfig {
    return projectActiveWebReadConfig(resolveWebReadConfigUpdate(input, this.readSettings()));
  }

  save(input: unknown): Promise<WebReadSettings> {
    const operation = this.saveQueue.then(async () => {
      const settings = resolveWebReadConfigUpdate(input, this.readSettings());
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
function readPreviousPreferences(filePath: string): WebReadSettings {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return DEFAULT_WEB_READ_SETTINGS;
    throw new CredentialStorageError('unreadable');
  }
  try {
    const document = z
      .object({
        version: z.literal(1),
        settings: z.object({
          renderEnabled: z.unknown(),
          managedReader: z.unknown(),
          slots: z.record(z.string(), z.unknown()),
        }),
      })
      .parse(JSON.parse(raw));
    return normalizeWebReadSettings({
      renderEnabled: document.settings.renderEnabled,
      managedReader: document.settings.managedReader,
      slots: {},
    });
  } catch {
    throw new CredentialStorageError('invalid_format');
  }
}
