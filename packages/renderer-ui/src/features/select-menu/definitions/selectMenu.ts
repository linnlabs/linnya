import type { Component, CSSProperties, Ref } from 'vue';

export type CustomSelectOptionValue = string | number | boolean;

export type CustomSelectValue = CustomSelectOptionValue | null;

export type CustomSelectSemanticRole = 'listbox' | 'menu';

export type CustomSelectVariant = 'default' | 'minimal';

export type CustomSelectOptionVariant = 'default' | 'danger';

export type TextPopoverPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right';

export type TextPopoverTriggerMode = 'click' | 'hover';

export type DropdownElementReference = HTMLElement | Ref<HTMLElement | null> | null;

export interface CustomSelectInlineNumberInput {
  enabled: true;
  value: string | number;
  min: string | number;
  max: string | number;
  prefix?: string;
  suffix?: string;
}

export interface CustomSelectPanelItem {
  label?: string;
  value?: string;
  clickable?: boolean;
  title?: string;
  onClick?: () => void;
}

export interface CustomSelectOption<
  Value extends CustomSelectOptionValue = CustomSelectOptionValue,
> {
  value?: Value | null;
  label?: string;
  text?: string;
  icon?: string;
  iconComponent?: Component;
  rightIconComponent?: Component;
  className?: string;
  labelClassName?: string;
  iconClassName?: string;
  shortcutClassName?: string;
  disabled?: boolean;
  disabledReason?: string;
  selected?: boolean;
  allowDirectSelect?: boolean;
  shortcut?: string;
  variant?: CustomSelectOptionVariant;
  isGroup?: boolean;
  isSeparator?: boolean;
  isPanel?: boolean;
  isColorPicker?: boolean;
  children?: readonly CustomSelectOption<Value>[];
  inlineNumberInput?: CustomSelectInlineNumberInput;
  clickable?: boolean;
  title?: string;
  onClick?: () => void;
}

export interface CustomSelectClassNames {
  trigger?: string;
  selectedValue?: string;
  arrowIcon?: string;
  options?: string;
  optionsHeader?: string;
  submenu?: string;
  nestedSubmenu?: string;
  option?: string;
  optionLabel?: string;
  optionIcon?: string;
  optionShortcut?: string;
  optionArrow?: string;
}

export interface CustomSelectInlineNumberConfirm<
  Value extends CustomSelectOptionValue = CustomSelectOptionValue,
> {
  value: number;
  optionValue: Value | null | undefined;
}

export interface CustomSelectKeyboardNavigationInput {
  event: KeyboardEvent;
}

export interface DropdownPanelPositionStyle extends CSSProperties {
  top?: string;
  left?: string;
  right?: string;
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  maxHeight?: string;
  overflow?: string;
  visibility?: CSSProperties['visibility'];
  zIndex?: CSSProperties['zIndex'];
}

/**
 * 独立浮层需要复用选择菜单的面板视觉时，只允许使用这组公开类名。
 * 业务代码不得借用 select-options 等组件内部选择器。
 */
export const DROPDOWN_SURFACE_CLASSES = {
  root: 'linnya-dropdown-surface',
  panel: 'linnya-dropdown-surface--panel',
  portal: 'linnya-dropdown-surface--portal',
  minimal: 'linnya-dropdown-surface--minimal',
} as const;
