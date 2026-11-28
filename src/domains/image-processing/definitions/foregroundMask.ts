/**
 * 系统前景遮罩（macOS 14+ 的 Vision）的合同。由宿主适配器实现，本 domain 只依赖这个接口，
 * 不知道它怎么调起系统能力。
 */
export interface ForegroundMaskPort {
  /** 本机能不能用；不能用时 `auto` 直接走边缘抠图。 */
  readonly available: boolean;
  /** 输入已摆正、缩好的 JPEG；成功时给回同尺寸的 RGBA PNG，透明度就是前景遮罩。 */
  mask(input: { readonly jpeg: Uint8Array; readonly signal: AbortSignal }): Promise<ForegroundMaskResult>;
}

export type ForegroundMaskResult =
  | { readonly status: 'ok'; readonly png: Uint8Array }
  | { readonly status: 'no_foreground' }
  /** message 不含本机路径，可以原样给模型看。 */
  | { readonly status: 'failed'; readonly message: string };
