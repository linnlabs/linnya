import type { MaybeRefOrGetter, Ref } from 'vue';

/** 一个模态浮层：Escape、遮罩点击和键盘焦点都按浮层栈的先后归属。 */
export interface ModalOverlayOptions {
  /** 浮层是否打开；打开时入栈，关闭或卸载时出栈。 */
  readonly active: MaybeRefOrGetter<boolean>;
  /** 浮层的可见容器，需要自带 `tabindex="-1"`，没有更合适的落点时由它接住焦点。 */
  readonly containerRef: Readonly<Ref<HTMLElement | null>>;
  /** 本层在最上面时按了 Escape。不关闭（例如处理中）也算接住，不会落到下面的层。 */
  readonly onEscape: (event: KeyboardEvent) => void;
  /**
   * 点了本层遮罩：按下和松开都在遮罩本身，且按下时本层在最上面。
   * 所以弹窗里开着下拉或日期面板时，第一次点遮罩只关那个面板；从弹窗里拖选文字到遮罩上松开也不算。
   */
  readonly onBackdropClick: () => void;
}

/** 绑到遮罩元素上：`v-on="backdropListeners"`。 */
export interface ModalBackdropListeners {
  readonly pointerdown: (event: Event) => void;
  readonly click: (event: Event) => void;
}

export interface ModalOverlayControls {
  /** 现在是不是最上面一层；上面还开着下拉、日期面板或另一个弹窗时为 false。 */
  readonly isTopmost: () => boolean;
  readonly backdropListeners: ModalBackdropListeners;
}

/** @deprecated 自 3.16.0 起改用 `useModalOverlay` 的 {@link ModalOverlayOptions}；下一个 major 删除。 */
export type ModalFocusOptions = Pick<ModalOverlayOptions, 'active' | 'containerRef'>;

/** @deprecated 自 3.16.0 起改用 `useModalOverlay` 的 {@link ModalOverlayControls}；下一个 major 删除。 */
export type ModalFocusControls = Pick<ModalOverlayControls, 'isTopmost'>;
