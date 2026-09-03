import type { DeckSpec } from '../../src/shared';

export interface TextClippingAuditCase {
  readonly id: 'designed-tension' | 'coordinate-tag';
  readonly text: string;
  readonly prefixWithoutFinalGlyph: string;
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  readonly fontSizePt: number;
  readonly letterSpacingPt: number;
  readonly bold: boolean;
  readonly align: 'left' | 'right';
}

/**
 * 来自 2026-08-20 长对话 revision 35 的原始文本与 box。故意不带尾随 NBSP，
 * 用于区分布局宽度、Konva 像素裁切与 PowerPoint 导出结果。
 */
export const TEXT_CLIPPING_AUDIT_CASES: readonly TextClippingAuditCase[] = [
  {
    id: 'designed-tension',
    text: 'DESIGNED TENSION',
    prefixWithoutFinalGlyph: 'DESIGNED TENSIO',
    box: { x: 0.7, y: 1.23, w: 2.15, h: 0.22 },
    fontSizePt: 6.8,
    letterSpacingPt: 1.55,
    bold: true,
    align: 'left',
  },
  {
    id: 'coordinate-tag',
    text: 'D-04  /  1:25',
    prefixWithoutFinalGlyph: 'D-04  /  1:2',
    box: { x: 5.9, y: 3.34, w: 1.47, h: 0.14 },
    fontSizePt: 6.5,
    letterSpacingPt: 1.15,
    bold: true,
    align: 'left',
  },
];

export function createTextClippingAuditDeckSpec(
  fontFamily = 'Avenir Next',
): DeckSpec {
  return {
    title: 'Text clipping audit corpus',
    layout: '16x9',
    theme: {
      fonts: { major: fontFamily, minor: fontFamily },
    },
    slides: TEXT_CLIPPING_AUDIT_CASES.map((testCase, index) => ({
      slideNumber: index + 1,
      spec: {
        type: 'freeform',
        background: { color: '#FFFFFF' },
        elements: [{
          type: 'text',
          position: testCase.box,
          content: testCase.text,
          style: {
            fontFamily,
            fontSize: testCase.fontSizePt,
            bold: testCase.bold,
            color: '#111111',
            letterSpacing: testCase.letterSpacingPt,
            align: testCase.align,
          },
        }],
      },
    })),
  };
}

export function createTextClippingAuditDeckSource(fontFamily: string): string {
  const slides = TEXT_CLIPPING_AUDIT_CASES.map((testCase, index) => {
    const prefixY = testCase.box.y + 0.5;
    return `
const slide${index + 1} = createSlide({ background: { color: '#FFFFFF' } });
const full${index + 1} = createText(${JSON.stringify(testCase.text)});
full${index + 1}.position = 'absolute';
full${index + 1}.left = ${testCase.box.x}; full${index + 1}.top = ${testCase.box.y};
full${index + 1}.width = ${testCase.box.w}; full${index + 1}.height = ${testCase.box.h};
full${index + 1}.fontSize = ${testCase.fontSizePt}; full${index + 1}.fontWeight = 'bold';
full${index + 1}.letterSpacing = ${testCase.letterSpacingPt}; full${index + 1}.color = '#111111';
const prefix${index + 1} = createText(${JSON.stringify(testCase.prefixWithoutFinalGlyph)});
prefix${index + 1}.position = 'absolute';
prefix${index + 1}.left = ${testCase.box.x}; prefix${index + 1}.top = ${prefixY};
prefix${index + 1}.width = ${testCase.box.w}; prefix${index + 1}.height = ${testCase.box.h};
prefix${index + 1}.fontSize = ${testCase.fontSizePt}; prefix${index + 1}.fontWeight = 'bold';
prefix${index + 1}.letterSpacing = ${testCase.letterSpacingPt}; prefix${index + 1}.color = '#111111';
slide${index + 1}.add(full${index + 1}, prefix${index + 1});`;
  }).join('\n');

  return `${slides}
compose({
  title: 'Text clipping audit corpus',
  layout: '16x9',
  theme: { fonts: { major: ${JSON.stringify(fontFamily)}, minor: ${JSON.stringify(fontFamily)} } },
  slides: [${TEXT_CLIPPING_AUDIT_CASES.map((_, index) => `slide${index + 1}`).join(', ')}],
});
`;
}
