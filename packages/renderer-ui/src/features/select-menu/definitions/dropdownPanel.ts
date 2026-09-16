export type DropdownMotionDirection = 'up' | 'down';

export interface DropdownPanelProps {
  readonly show: boolean;
  readonly direction?: DropdownMotionDirection;
}

/** 调用方只依赖公开动作，不依赖 Vue SFC 的推断实例或内部状态。 */
export interface DropdownActions {
  open(event?: Event): void;
  close(): void;
  closeAndFocus(): void;
}
