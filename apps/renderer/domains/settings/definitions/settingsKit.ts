// apps/renderer/domains/settings/definitions/settingsKit.ts
// Settings Kit 的公共类型。组件只负责版式，文案与状态一律由业务层传入。

/** SettingsRow 的控件列排布方式。 */
export type SettingsRowControl =
  /** 控件占满右列（下拉、输入框、滑杆）。标签列固定 200px。 */
  | 'fill'
  /** 控件贴右且宽度自适应（开关、单个按钮）。标签与说明占满左侧。 */
  | 'end';

/** SettingsRow 中标签与控件的垂直对齐方式。 */
export type SettingsRowAlign = 'top' | 'center';

/** SettingsChoiceGroup 的单个选项。 */
export interface SettingsChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  /** 危险选项使用错误色提示，例如不可逆或高权限能力。 */
  readonly tone?: 'default' | 'danger';
  /** 选项名后的小标签，例如「实验性」。 */
  readonly badge?: string;
  readonly disabled?: boolean;
}

/** SettingsFeedback 的语气。 */
export type SettingsFeedbackKind = 'success' | 'error' | 'info';

/** SettingsState 的占位状态。 */
export type SettingsStateKind = 'loading' | 'empty' | 'error' | 'unavailable';
