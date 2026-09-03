import fs from 'node:fs/promises';
import path from 'node:path';

import { pathManager } from 'src/shared/utils/pathManager';

import type {
  ProviderConfigurationRepository,
  ProviderConfigurationSnapshot,
} from '../../../definitions/providerConfiguration';
import {
  PROVIDER_CONFIGURATION_FILE_VERSION,
  migrateProviderConfigurationFileV1,
  migrateProviderConfigurationFileV2,
  readProviderConfigurationFile,
  type ProviderConfigurationFile,
} from '../definitions/providerConfigurationFile';

function emptySnapshot(): ProviderConfigurationSnapshot {
  return {
    legacy_formal_provider_migration: 'pending',
    configured_providers: [],
    pending_model_registrations: [],
    pending_model_removals: [],
  };
}

export class FileProviderConfigurationRepository implements ProviderConfigurationRepository {
  private filePath: string | null = null;

  async load(): Promise<ProviderConfigurationSnapshot> {
    const filePath = await this.requirePath();
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      const migrated =
        migrateProviderConfigurationFileV1(parsed) ?? migrateProviderConfigurationFileV2(parsed);
      if (migrated) {
        await this.save(migrated);
        return migrated;
      }
      return readProviderConfigurationFile(parsed);
    } catch (error: unknown) {
      const code = error instanceof Error ? Reflect.get(error, 'code') : undefined;
      if (code !== 'ENOENT') throw error;
      const snapshot = emptySnapshot();
      await this.save(snapshot);
      return snapshot;
    }
  }

  async save(snapshot: ProviderConfigurationSnapshot): Promise<void> {
    const filePath = await this.requirePath();
    const file: ProviderConfigurationFile = {
      version: PROVIDER_CONFIGURATION_FILE_VERSION,
      last_updated: new Date().toISOString(),
      ...snapshot,
    };
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  }

  private async requirePath(): Promise<string> {
    if (!this.filePath) {
      this.filePath = pathManager.getProviderConfigurationsConfigPath();
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }
    return this.filePath;
  }
}

export const fileProviderConfigurationRepository = new FileProviderConfigurationRepository();
