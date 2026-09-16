import type { TextEditingTarget } from '../definitions/textEditingTypes';

const INCHES_TO_CSS_PX = 96;
const POINTS_TO_CSS_PX = INCHES_TO_CSS_PX / 72;

export interface InlineTextEditorViewport {
  readonly slideLeft: number;
  readonly slideTop: number;
  readonly renderScale: number;
}

export type InlineTextEditorStyle = Readonly<Record<string, string | number>>;

export function createInlineTextEditorStyle(
  target: TextEditingTarget,
  viewport: InlineTextEditorViewport,
): InlineTextEditorStyle {
  const scale = viewport.renderScale;
  return {
    left: `${viewport.slideLeft + target.origin.x * INCHES_TO_CSS_PX * scale}px`,
    top: `${viewport.slideTop + target.origin.y * INCHES_TO_CSS_PX * scale}px`,
    width: `${target.width * INCHES_TO_CSS_PX * scale}px`,
    height: `${target.height * INCHES_TO_CSS_PX * scale}px`,
    paddingTop: `${(target.padding.top + target.verticalOffset) * INCHES_TO_CSS_PX * scale}px`,
    paddingRight: `${target.padding.right * INCHES_TO_CSS_PX * scale}px`,
    paddingBottom: `${target.padding.bottom * INCHES_TO_CSS_PX * scale}px`,
    paddingLeft: `${target.padding.left * INCHES_TO_CSS_PX * scale}px`,
    transform: `rotate(${target.rotation}deg)`,
    fontFamily: target.fontFamily,
    fontSize: `${target.fontSizePt * target.appliedFontScale * POINTS_TO_CSS_PX * scale}px`,
    fontWeight: target.fontWeight,
    fontStyle: target.fontStyle,
    textDecoration: target.textDecoration ?? 'none',
    color: target.color,
    textAlign: target.textAlign,
    lineHeight: String(target.lineHeight),
    letterSpacing: target.letterSpacingPt === undefined
      ? 'normal'
      : `${target.letterSpacingPt * POINTS_TO_CSS_PX * scale}px`,
    opacity: target.opacity,
  };
}
