/** Modal 内容区的滚动职责。 */
export type ModalScrollMode = 'content' | 'internal';

/** Modal 在 Renderer 浮层体系中的语义层级。 */
export type ModalLayer = 'base' | 'alert';

/** Modal 的命名 slot；footer 位于内容滚动区之外。 */
export interface ModalSlots {
  readonly default?: () => unknown;
  readonly footer?: () => unknown;
}

/** 通用模态窗口的稳定公共属性。 */
export interface ModalProps {
  readonly isVisible?: boolean;
  readonly title?: string;
  readonly width?: string;
  readonly maxWidth?: string;
  readonly height?: string;
  readonly maxHeight?: string;
  readonly minHeight?: string;
  readonly closeOnOverlayClick?: boolean;
  readonly closeOnEsc?: boolean;
  readonly layer?: ModalLayer;
  readonly scrollMode?: ModalScrollMode;
}
