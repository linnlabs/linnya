<template>
  <SettingsPage>
    <SettingsSection :title="settingsMessage('settings.appearance.theme.title')">
      <SettingsRow
        :label="settingsMessage('settings.appearance.theme.label')"
        :hint="settingsMessage('settings.appearance.theme.description')"
      >
        <div
          class="appearance-theme-selector"
          role="radiogroup"
          :aria-label="settingsMessage('settings.appearance.theme.label')"
        >
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            role="radio"
            class="appearance-theme-option"
            :class="{ 'is-active': uiStore.theme === option.value }"
            :aria-checked="uiStore.theme === option.value"
            @click="setTheme(option.value)"
          >
            <span class="appearance-theme-preview" aria-hidden="true">
              <span
                v-for="previewTheme in option.previewThemes"
                :key="previewTheme"
                class="appearance-theme-canvas"
                :data-linnya-ui-theme="previewTheme"
              >
                <span class="appearance-theme-canvas-sidebar">
                  <span class="appearance-theme-canvas-line is-active" />
                  <span class="appearance-theme-canvas-line" />
                  <span class="appearance-theme-canvas-line is-short" />
                </span>
                <span class="appearance-theme-canvas-main">
                  <span class="appearance-theme-canvas-line is-strong" />
                  <span class="appearance-theme-canvas-line" />
                  <span class="appearance-theme-canvas-input">
                    <span class="appearance-theme-canvas-send" />
                  </span>
                </span>
              </span>
            </span>
            <span class="appearance-theme-label">{{ settingsMessage(option.labelKey) }}</span>
          </button>
        </div>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="settingsMessage('settings.appearance.language.title')">
      <SettingsRow
        :label="settingsMessage('settings.appearance.language.label')"
        :hint="settingsMessage('settings.appearance.language.description')"
      >
        <CustomSelect
          v-model="languageValue"
          :options="languageOptions"
          :title="settingsMessage('settings.appearance.language.selectTitle')"
          font-size="14px"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="settingsMessage('settings.appearance.font.title')">
      <SettingsRow
        :label="settingsMessage('settings.appearance.font.label')"
        :hint="settingsMessage('settings.appearance.font.description')"
      >
        <CustomSelect
          v-model="fontValue"
          :options="fontOptions"
          :title="settingsMessage('settings.appearance.font.selectTitle')"
          :disabled="true"
          font-size="14px"
        />
      </SettingsRow>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import type { RendererUiTheme } from '@linnya/renderer-ui/theme';
import { useUIStore, type ThemePreference } from '@/shared/stores/ui';
import { computed, ref } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { useLocalization, type LinnyaLocale } from '@app/localization';
import type { SettingsMessageKey } from '../../definitions/settingsMessages';
import { SettingsPage, SettingsRow, SettingsSection } from '../kit';
import { useSettingsLocalization } from '../useSettingsLocalization';

interface ThemeOption {
  readonly value: ThemePreference;
  readonly labelKey: SettingsMessageKey;
  /** 预览画布使用的真实主题；跟随系统左右各半展示浅色与深色。 */
  readonly previewThemes: readonly RendererUiTheme[];
}

const themeOptions: readonly ThemeOption[] = [
  { value: 'system', labelKey: 'settings.appearance.theme.system', previewThemes: ['light', 'dark'] },
  { value: 'light', labelKey: 'settings.appearance.theme.light', previewThemes: ['light'] },
  { value: 'moon-blue', labelKey: 'settings.appearance.theme.moonBlue', previewThemes: ['moon-blue'] },
  { value: 'dark', labelKey: 'settings.appearance.theme.dark', previewThemes: ['dark'] },
];

const uiStore = useUIStore();
const { currentLocale, changeLocale } = useLocalization();
const { settingsMessage } = useSettingsLocalization();
const languageValue = computed<LinnyaLocale>({
  get: () => currentLocale.value,
  set: (locale) => changeLocale(locale),
});
const fontValue = ref('default');

const languageOptions = computed(() => [
  { value: 'zh-CN', text: settingsMessage('settings.appearance.language.zhCN') },
  { value: 'en-US', text: settingsMessage('settings.appearance.language.enUS') },
]);

const fontOptions = computed(() => [
  { value: 'default', text: settingsMessage('settings.appearance.font.systemDefault') },
  { value: 'pingfang', text: settingsMessage('settings.appearance.font.pingfang') },
  { value: 'source-han', text: settingsMessage('settings.appearance.font.sourceHan') },
]);

const setTheme = (theme: ThemePreference) => {
  uiStore.setTheme(theme);
};
</script>
