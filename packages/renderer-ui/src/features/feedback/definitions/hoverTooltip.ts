export type HoverTooltipPlacement = 'top' | 'bottom';

export interface HoverTooltipProps {
  readonly text: string;
  readonly placement?: HoverTooltipPlacement;
  readonly offset?: number;
  readonly disabled?: boolean;
}

export interface HoverTooltipRectangle {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface HoverTooltipPosition {
  readonly top: number;
  readonly left: number;
}

export type HoverTooltipInputModality = 'keyboard' | 'pointer' | null;

export interface HoverTooltipInteractionState {
  readonly inputModality: HoverTooltipInputModality;
  readonly isWindowActive: boolean;
}

export type HoverTooltipInteractionEvent =
  | { readonly type: 'initialize'; readonly focused: boolean }
  | { readonly type: 'window-blurred' }
  | { readonly type: 'window-focused' }
  | { readonly type: 'keyboard-input' }
  | { readonly type: 'pointer-input' };
