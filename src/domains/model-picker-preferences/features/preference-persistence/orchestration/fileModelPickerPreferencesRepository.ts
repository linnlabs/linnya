import fs from 'node:fs/promises';
import path from 'node:path';

import { pathManager } from 'src/shared/utils/pathManager';

import type {
  ModelPickerPreferencesRepository,
  ModelPickerPreferencesSnapshot,
} from '../../../definitions/modelPickerPreferences';
import {
  MODEL_PICKER_PREFERENCES_FILE_VERSION,
  readModelPickerPreferencesFile,
  type ModelPickerPreferencesFile,
} from '../definitions/modelPickerPreferencesFile';

const EMPTY_SNAPSHOT: ModelPickerPreferencesSnapshot = {
  provider_preferences: [],
  model_preferences: [],
};

export class FileModelPickerPreferencesRepository implements ModelPickerPreferencesRepository {
  private filePath: string | null = null;

  async load(): Promise<ModelPickerPreferencesSnapshot> {
    const filePath = await this.requirePath();
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      return readModelPickerPreferencesFile(parsed);
    } catch (error: unknown) {
      const code = error instanceof Error ? Reflect.get(error, 'code') : undefined;
      if (code !== 'ENOENT') throw error;
      await this.save(EMPTY_SNAPSHOT);
      return EMPTY_SNAPSHOT;
    }
  }

  async save(snapshot: ModelPickerPreferencesSnapshot): Promise<void> {
    const filePath = await this.requirePath();
    const file: ModelPickerPreferencesFile = {
      version: MODEL_PICKER_PREFERENCES_FILE_VERSION,
      last_updated: new Date().toISOString(),
      provider_preferences: snapshot.provider_preferences,
      model_preferences: snapshot.model_preferences,
    };
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  }

  private async requirePath(): Promise<string> {
    if (!this.filePath) {
      this.filePath = pathManager.getModelPickerPreferencesConfigPath();
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }
    return this.filePath;
  }
}

export const fileModelPickerPreferencesRepository = new FileModelPickerPreferencesRepository();
