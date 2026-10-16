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
            <span class="appearance-theme-tile" aria-hidden="true">
              <ThemePreviewArt
                v-for="(scene, index) in option.scenes"
                :key="scene"
                :scene="scene"
                :class="{ 'is-split-night': option.scenes.length > 1 && index === 1 }"
              />
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
  </SettingsPage>
</template>

<script setup lang="ts">
import { useUIStore, type ThemePreference } from '@/shared/stores/ui';
import { computed } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { useLocalization, type LinnyaLocale } from '@app/localization';
import type { SettingsMessageKey } from '../../definitions/settingsMessages';
import { SettingsPage, SettingsRow, SettingsSection } from '../kit';
import type { ThemePreviewScene } from '../../definitions/themePreview';
import ThemePreviewArt from './appearance/ThemePreviewArt.vue';
import { useSettingsLocalization } from '../useSettingsLocalization';

interface ThemeOption {
  readonly value: ThemePreference;
  readonly labelKey: SettingsMessageKey;
  /** 预览插画场景；“跟随系统”把白天与夜晚沿对角线各占一半。 */
  readonly scenes: readonly ThemePreviewScene[];
}

const themeOptions: readonly ThemeOption[] = [
  { value: 'system', labelKey: 'settings.appearance.theme.system', scenes: ['day', 'night'] },
  { value: 'light', labelKey: 'settings.appearance.theme.light', scenes: ['day'] },
  { value: 'moon-blue', labelKey: 'settings.appearance.theme.moonBlue', scenes: ['moon'] },
  { value: 'dark', labelKey: 'settings.appearance.theme.dark', scenes: ['night'] },
];

const uiStore = useUIStore();
const { currentLocale, changeLocale } = useLocalization();
const { settingsMessage } = useSettingsLocalization();
const languageValue = computed<LinnyaLocale>({
  get: () => currentLocale.value,
  set: (locale) => changeLocale(locale),
});

const languageOptions = computed(() => [
  { value: 'zh-CN', text: settingsMessage('settings.appearance.language.zhCN') },
  { value: 'en-US', text: settingsMessage('settings.appearance.language.enUS') },
]);

const setTheme = (theme: ThemePreference) => {
  uiStore.setTheme(theme);
};
</script>
