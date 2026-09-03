<template>
  <SettingsPage>
    <SettingsSection :title="settingsMessage('settings.appearance.theme.title')">
      <SettingsRow
        :label="settingsMessage('settings.appearance.theme.label')"
        control="end"
        align="center"
      >
        <div class="appearance-theme-selector">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            class="appearance-theme-option"
            :class="{ 'is-active': uiStore.theme === option.value }"
            :title="settingsMessage(option.labelKey)"
            :aria-label="settingsMessage(option.labelKey)"
            :aria-pressed="uiStore.theme === option.value"
            @click="setTheme(option.value)"
          >
            <span :class="['appearance-theme-circle', option.circleClass]" />
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
import { useUIStore } from '@/shared/stores/ui';
import { computed, ref } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { useLocalization, type LinnyaLocale } from '@app/localization';
import type { SettingsMessageKey } from '../../definitions/settingsMessages';
import { SettingsPage, SettingsRow, SettingsSection } from '../kit';
import { useSettingsLocalization } from '../useSettingsLocalization';

interface ThemeOption {
  readonly value: RendererUiTheme;
  readonly labelKey: SettingsMessageKey;
  readonly circleClass: string;
}

const themeOptions: readonly ThemeOption[] = [
  { value: 'light', labelKey: 'settings.appearance.theme.light', circleClass: 'is-light' },
  { value: 'moon-blue', labelKey: 'settings.appearance.theme.moonBlue', circleClass: 'is-moon-blue' },
  { value: 'dark', labelKey: 'settings.appearance.theme.dark', circleClass: 'is-dark' },
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

const setTheme = (theme: RendererUiTheme) => {
  uiStore.setTheme(theme);
};
</script>
