import type { z } from 'zod';
import type { VisualFontFactsSchema } from './definitions';

type FontDeclaration = Pick<CSSStyleDeclaration, 'font' | 'fontFamily' | 'fontSize' | 'fontStyle' | 'fontWeight' | 'fontStretch' | 'fontVariantNumeric'>;

/** font shorthand无法表示marker的tabular-nums；查询始终从本元素真实长属性组成，不借父字体回退。 */
export function readVisualFontFacts(computed: FontDeclaration): Omit<z.infer<typeof VisualFontFactsSchema>, 'fontAvailable'> {
  return { fontShorthand: computed.font, fontFamily: computed.fontFamily, fontSize: computed.fontSize, fontStyle: computed.fontStyle,
    fontWeight: computed.fontWeight, fontStretch: computed.fontStretch, fontVariantNumeric: computed.fontVariantNumeric,
    fontQuery: `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}` };
}
