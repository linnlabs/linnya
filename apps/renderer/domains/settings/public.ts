export type { SettingsMessageKey, SettingsMessageResolver } from './definitions/settingsMessages';
export type { SettingsChoiceOption } from './definitions/settingsKit';
export { registerSettingsContribution } from './registry/settingsRegistry';
// 对话里切到更宽的命令权限档位时，沿用设置页同一份确认内容。
export { confirmPermissionLevelExpansion } from './features/command-permission-settings/orchestration/confirmPermissionLevelExpansion';
export { useSettingsLocalization } from './ui/useSettingsLocalization';
export {
  SettingsActions,
  SettingsChoiceGroup,
  SettingsFeedback,
  SettingsList,
  SettingsListRow,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsState,
  SettingsSwitchRow,
} from './ui/kit';
