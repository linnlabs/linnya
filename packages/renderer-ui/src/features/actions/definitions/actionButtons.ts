import type { ButtonHTMLAttributes } from 'vue';

export type ActionButtonsPrimaryVariant = 'default' | 'danger' | 'accent';
export type ActionButtonsSecondaryVariant = 'filled' | 'ghost' | 'plain';
export type ActionButtonsShape = 'default' | 'pill';

export type ActionButtonAttributes = Omit<ButtonHTMLAttributes, 'disabled' | 'type'>;

export interface ActionButtonsProps {
  readonly primaryActionText?: string;
  readonly secondaryActionText?: string;
  readonly isPrimaryActionDisabled?: boolean;
  readonly isSecondaryActionDisabled?: boolean;
  readonly showPrimaryAction?: boolean;
  readonly showSecondaryAction?: boolean;
  readonly primaryVariant?: ActionButtonsPrimaryVariant;
  readonly secondaryVariant?: ActionButtonsSecondaryVariant;
  readonly shape?: ActionButtonsShape;
  readonly primaryButtonAttributes?: ActionButtonAttributes;
  readonly secondaryButtonAttributes?: ActionButtonAttributes;
}

export interface ActionButtonsSlots {
  readonly 'primary-content'?: () => unknown;
  readonly 'secondary-content'?: () => unknown;
}
