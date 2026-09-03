export type NumberInputValue = number | string;
export type NumberInputConstraint = number | string;
export type CustomNumberInputVariant = 'default' | 'panel' | 'inline-menu';
export type CustomNumberInputAlignment = 'left' | 'center' | 'right';

export interface CustomNumberInputProps {
  readonly modelValue: NumberInputValue;
  readonly label?: string;
  readonly inputWidth?: NumberInputConstraint;
  readonly min?: NumberInputConstraint;
  readonly max?: NumberInputConstraint;
  readonly step?: NumberInputConstraint;
  readonly variant?: CustomNumberInputVariant;
  readonly fullWidth?: boolean;
  readonly showSpinButtons?: boolean;
  readonly isStepUpDisabled?: boolean;
  readonly isStepDownDisabled?: boolean;
  readonly spinButtonTabIndex?: number;
  readonly align?: CustomNumberInputAlignment;
  /** 业务 owner 只能通过自己的 class 扩展原生 input，不得命中 package 内部 selector。 */
  readonly inputClass?: string;
}
