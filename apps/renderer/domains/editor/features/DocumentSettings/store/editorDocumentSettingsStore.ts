import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';

const LEGACY_UI_SETTINGS_KEY = 'ui-settings';
const EDITOR_DOCUMENT_SETTINGS_KEY = 'editor-document-settings';

interface PersistedEditorDocumentSettings {
  menuBarVisible: boolean;
  characterCountVisible: boolean;
  blockHoverEnabled: boolean;
  spellcheckEnabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 旧版本把文本文档编辑偏好存放在 ui-settings。
 * 迁移只在新 key 不存在时执行，避免覆盖用户已经在新结构中保存的选择。
 */
export function migrateLegacyEditorDocumentSettings(): void {
  const storage = getRendererPersistStorage();
  if (storage.getItem(EDITOR_DOCUMENT_SETTINGS_KEY) !== null) {
    return;
  }

  const legacyRaw = storage.getItem(LEGACY_UI_SETTINGS_KEY);
  if (!legacyRaw) {
    return;
  }

  try {
    const legacySettings: unknown = JSON.parse(legacyRaw);
    if (!isRecord(legacySettings)) {
      return;
    }

    const nextSettings: PersistedEditorDocumentSettings = {
      menuBarVisible: readBoolean(legacySettings, 'menuBarVisible', true),
      characterCountVisible: readBoolean(legacySettings, 'characterCountVisible', true),
      blockHoverEnabled: readBoolean(legacySettings, 'blockHoverEnabled', false),
      spellcheckEnabled: readBoolean(legacySettings, 'spellcheckEnabled', true),
    };
    storage.setItem(EDITOR_DOCUMENT_SETTINGS_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    console.warn('[EditorDocumentSettingsStore] 迁移旧文本文档设置失败:', error);
  }
}

export const useEditorDocumentSettingsStore = defineStore('editorDocumentSettings', {
  state: () => ({
    menuBarVisible: true,
    characterCountVisible: true,
    characterCount: 0,
    characterCountActualWidth: 0,
    blockHoverEnabled: false,
    spellcheckEnabled: true,
  }),

  actions: {
    setMenuBarVisible(visible: boolean) {
      this.menuBarVisible = visible;
    },

    setCharacterCountVisible(visible: boolean) {
      this.characterCountVisible = visible;
    },

    setCharacterCount(count: number) {
      if (!Number.isFinite(count)) {
        console.warn('[EditorDocumentSettingsStore] 字数统计收到非法数值:', count);
        return;
      }
      this.characterCount = count;
    },

    setCharacterCountActualWidth(width: number) {
      if (!Number.isFinite(width) || width < 0) {
        return;
      }
      this.characterCountActualWidth = width;
    },

    setBlockHoverEnabled(enabled: boolean) {
      this.blockHoverEnabled = enabled;
    },

    setSpellcheckEnabled(enabled: boolean) {
      this.spellcheckEnabled = enabled;
    },
  },

  persist: {
    key: EDITOR_DOCUMENT_SETTINGS_KEY,
    storage: getRendererPersistStorage(),
    pick: ['menuBarVisible', 'characterCountVisible', 'blockHoverEnabled', 'spellcheckEnabled'],
  },
});
