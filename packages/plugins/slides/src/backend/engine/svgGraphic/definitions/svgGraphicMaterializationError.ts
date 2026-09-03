export type SvgGraphicMaterializationErrorCode =
  | 'slides.svg.render_failed'
  | 'slides.svg.pptx_embedding_failed';

/** SVG 已通过 admission 后，fallback 或双媒体封装失败的稳定 engine 错误。 */
export class SvgGraphicMaterializationError extends Error {
  readonly name = 'SvgGraphicMaterializationError';

  constructor(
    readonly code: SvgGraphicMaterializationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
