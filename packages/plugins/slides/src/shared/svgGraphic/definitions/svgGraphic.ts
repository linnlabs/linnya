/** SVG Graphic 在 authoring、ownership 与渲染链之间共享的稳定合同。 */

export interface SvgGraphicViewBox {
  readonly width: number;
  readonly height: number;
}

/** Agent 首期只可写 inline SVG，或引用当前会话/本地工作区中的 SVG 文件。 */
export type SvgGraphicAuthoringSource =
  | { readonly kind: 'inline_svg'; readonly svg: string }
  | { readonly kind: 'local_path'; readonly path: string }
  | { readonly kind: 'conversation_file'; readonly locator: string };

/** ownership 完成后的 canonical 引用；DeckSpec 不长期保存任意源路径或 SVG XML。 */
export interface SvgGraphicOwnedAssetRef {
  readonly kind: 'owned_svg';
  readonly assetId: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly viewBox: SvgGraphicViewBox;
}

/** 单次编译/渲染读取到的授权内容；不会写回 canonical DeckSpec。 */
export interface SvgGraphicResolvedAsset extends SvgGraphicOwnedAssetRef {
  readonly canonicalSvg: string;
}

export type SvgGraphicFit = 'contain' | 'stretch';

export type SvgGraphicAccessibility =
  | { readonly altText: string; readonly decorative?: false }
  | { readonly decorative: true; readonly altText?: never };

/** admission 与 ownership 完成后进入 DeckSpec 的原子 SVG Graphic 事实。 */
export type SvgGraphicElementSpec = SvgGraphicAccessibility & {
  readonly asset: SvgGraphicOwnedAssetRef;
  readonly fit: SvgGraphicFit;
  /** 0 表示透明，1 表示不透明。 */
  readonly opacity?: number;
  readonly rotate?: number;
};
