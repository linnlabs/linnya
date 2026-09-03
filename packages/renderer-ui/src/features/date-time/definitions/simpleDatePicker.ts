export type DatePickerViewMode = 'date' | 'monthYear';

export type DatePickerPanelPlacement = 'top' | 'bottom';

export interface SimpleDatePickerClassNames {
  /** 业务 owner 只能通过自己的 class 扩展触发器，不得依赖日期组件内部 selector。 */
  readonly trigger?: string;
}

export interface SimpleDatePickerProps {
  readonly modelValue: Date | null;
  readonly placeholder?: string;
  readonly classNames?: SimpleDatePickerClassNames;
}

export interface DatePickerCalendarCell {
  readonly date: Date;
  readonly isToday: boolean;
  readonly isSelected: boolean;
  readonly isCurrentMonth: boolean;
}

export interface DatePickerCalendarInput {
  readonly displayDate: Date;
  readonly selectedDate: Date | null;
  readonly today: Date;
}

export interface DatePickerPanelPlacementInput {
  readonly boundaryBottom: number;
  readonly boundaryTop: number;
  readonly panelGap: number;
  readonly panelHeight: number;
  readonly triggerBottom: number;
  readonly triggerTop: number;
}
