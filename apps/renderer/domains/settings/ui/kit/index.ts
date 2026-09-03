// apps/renderer/domains/settings/ui/kit/index.ts
// Settings Kit 统一出口。新建设置页时从这里引入，不要 deep import 单个 .vue。
// 用法与取舍见 apps/renderer/domains/settings/docs/settings-kit.md。

export { default as SettingsActions } from './SettingsActions.vue';
export { default as SettingsChoiceGroup } from './SettingsChoiceGroup.vue';
export { default as SettingsFeedback } from './SettingsFeedback.vue';
export { default as SettingsList } from './SettingsList.vue';
export { default as SettingsListRow } from './SettingsListRow.vue';
export { default as SettingsPage } from './SettingsPage.vue';
export { default as SettingsRow } from './SettingsRow.vue';
export { default as SettingsSection } from './SettingsSection.vue';
export { default as SettingsState } from './SettingsState.vue';
export { default as SettingsSwitchRow } from './SettingsSwitchRow.vue';

export type {
  SettingsChoiceOption,
  SettingsFeedbackKind,
  SettingsRowAlign,
  SettingsRowControl,
  SettingsStateKind,
} from '../../definitions/settingsKit';
