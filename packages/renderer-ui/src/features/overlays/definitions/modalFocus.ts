import type { MaybeRefOrGetter, Ref } from 'vue';

/** 一个接管键盘焦点的模态浮层。 */
export interface ModalFocusOptions {
  /** 浮层是否处于打开状态。 */
  readonly active: MaybeRefOrGetter<boolean>;
  /** 浮层的可见容器，需要自带 `tabindex="-1"`，没有更合适的落点时由它接住焦点。 */
  readonly containerRef: Readonly<Ref<HTMLElement | null>>;
}

export interface ModalFocusControls {
  /** 现在是不是最上面的弹窗；弹窗叠弹窗时，下面的不响应按键。 */
  readonly isTopmost: () => boolean;
}
