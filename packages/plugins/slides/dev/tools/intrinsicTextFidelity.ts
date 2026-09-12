import { createSystemTextMeasurementRuntime } from '@plugin/backend/textMeasurement';
import type { PresentationRenderModel } from '../../src/shared/renderModel';

/** 用真实系统字形验收自动宽度，不能以启发式自洽替代 HarfBuzz 验证。 */
export async function assertIntrinsicTextFidelity(
  fontFamily: string,
  compile: (source: string, id: string) => Promise<PresentationRenderModel>,
): Promise<void> {
  const measurement = createSystemTextMeasurementRuntime({ useHarfBuzz: true });
  await measurement.initialize();
  try {
    const model = await compile(`
const slide = createSlide({ background: { color: '#FFFFFF' } });
const number = createText('02');
number.x = 1; number.y = 0.5; number.fontSize = 150; number.bold = true;
const brand = createText('DEEP CANOPY');
brand.right = 0.5; brand.y = 4; brand.fontSize = 8; brand.letterSpacing = 3;
const footer = createText('Review copy · record count 24');
footer.right = 0.3; footer.bottom = 0.15; footer.fontSize = 8;
slide.add(number, brand, footer);
compose({ title: 'Intrinsic fidelity', layout: '16x9',
  theme: { fonts: { major: ${JSON.stringify(fontFamily)}, minor: ${JSON.stringify(fontFamily)} } },
  slides: [slide] });
`, 'intrinsic-text-fidelity');
    if (model.slides[0].layoutKey !== 'freeform') {
      throw new Error('Intrinsic text fidelity must exercise the freeform transform boundary');
    }
    for (const node of model.slides[0].elements) {
      if (node.kind !== 'text' || node.layout?.advanceSource !== 'harfbuzz') {
        throw new Error('Intrinsic text fidelity requires final HarfBuzz layout');
      }
      if (node.layout.overflow.horizontal || node.layout.overflow.vertical) {
        throw new Error(`Intrinsic text overflow: ${node.id}`);
      }
    }
    console.log(`Intrinsic text fidelity passed: freeform bold 150pt, letterSpacing 3pt and 8pt anchored footer, font=${fontFamily}`);
  } finally {
    measurement.dispose();
  }
}
