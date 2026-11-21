import type { MaybeRefOrGetter } from 'vue';

/** 一个参与 Escape 归属的浮层。 */
export interface EscapeLayerOptions {
  /**
   * 浮层是否处于打开状态。只有打开的层参与归属，先后顺序按打开时刻排列；
   * 关闭后自动退出，组件卸载时同样退出。
   */
  readonly active: MaybeRefOrGetter<boolean>;
  /**
   * 本层位于最上层时收到 Escape。是否关闭由本层自己决定：不关闭也算“已接住”，
   * Escape 不会继续交给下面的层。
   */
  readonly onEscape: (event: KeyboardEvent) => void;
}
