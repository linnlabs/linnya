export interface TimePickerProps {
  readonly modelValue: Date | null;
  readonly placeholder?: string;
  /** 旁边没有可见标签时给输入框的可访问名称；默认用占位文案。 */
  readonly ariaLabel?: string;
}

export interface TimeOfDay {
  readonly hour: number;
  readonly minute: number;
}
