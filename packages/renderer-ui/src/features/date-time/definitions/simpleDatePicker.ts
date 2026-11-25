export interface SimpleDatePickerClassNames {
  /** 业务 owner 只能通过自己的 class 扩展触发器，不得依赖日期组件内部 selector。 */
  readonly trigger?: string;
}

export interface SimpleDatePickerProps {
  readonly modelValue: Date | null;
  readonly placeholder?: string;
  readonly classNames?: SimpleDatePickerClassNames;
}
