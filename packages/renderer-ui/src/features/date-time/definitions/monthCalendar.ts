export type MonthCalendarViewMode = 'days' | 'months';

export interface MonthCalendarProps {
  readonly modelValue: Date | null;
  /** 要展示的月份；变化时切过去，之后仍可翻月。不传就跟随选中的日期或今天。 */
  readonly month?: Date | null;
  /** 为 false 时只用来看：可以翻月，不能选日。 */
  readonly selectable?: boolean;
  /** 早于这一天的日期淡显且不可选；只比较年月日。 */
  readonly minDate?: Date | null;
  /** 需要标出的日期，例如一条规则会命中的日子。 */
  readonly isMarked?: (date: Date) => boolean;
}

export interface MonthCalendarCell {
  readonly date: Date;
  /** 本地日期 YYYY-MM-DD，也是单元格的 data-date。 */
  readonly key: string;
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly isSelected: boolean;
  readonly isMarked: boolean;
  readonly isBeforeMin: boolean;
}

export interface MonthCalendarInput {
  readonly displayDate: Date;
  readonly selectedDate: Date | null;
  readonly today: Date;
  readonly minDate?: Date | null;
  readonly isMarked?: (date: Date) => boolean;
}
