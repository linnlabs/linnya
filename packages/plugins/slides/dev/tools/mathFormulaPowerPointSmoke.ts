import { writeFile } from 'node:fs/promises';
import type { DeckSpec, FreeformInlineRun } from '../../src/shared';
import { normalizeMathFormulaSource } from '../../src/shared';
import { FreeformCompiler } from '../../src/backend/engine/FreeformCompiler';

const outputPath = process.argv[2] ?? '/tmp/linnya-native-formula-smoke.pptx';

function formula(latex: string, altText: string, fontSize = 24) {
  const result = normalizeMathFormulaSource({ latex, altText, fontSize, color: '#173B57' }, 'inline');
  if ('error' in result) throw new Error(result.error);
  return result.value;
}

const mixedRuns: FreeformInlineRun[] = [
  { text: '中文与公式同段：', style: { fontSize: 24, color: '#1F2A44' } },
  { formula: formula(String.raw`E=mc^2`, '质能方程') },
  { text: '；分式 ', style: { fontSize: 24, color: '#1F2A44' } },
  { formula: formula(String.raw`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, '求根公式') },
  { text: '；以及积分 ', style: { fontSize: 24, color: '#1F2A44' } },
  { formula: formula(String.raw`\int_0^1 x^2 dx`, '定积分') },
  { text: '。', style: { fontSize: 24, color: '#1F2A44' } },
];

const block = normalizeMathFormulaSource({
  latex: String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}\begin{pmatrix}x\\y\end{pmatrix}=\begin{pmatrix}u\\v\end{pmatrix}`,
  altText: '矩阵方程',
  fontSize: 30,
  color: '#6F2C91',
});
if ('error' in block) throw new Error(block.error);

const deck: DeckSpec = {
  title: 'Native Math Formula PowerPoint Gate',
  layout: '16x9',
  slides: [{
    slideNumber: 1,
    spec: {
      type: 'freeform',
      elements: [
        {
          type: 'text',
          position: { x: 0.8, y: 0.65, w: 8.4, h: 1.55 },
          content: mixedRuns,
          style: { fontSize: 24, fontFamily: 'Arial', color: '#1F2A44' },
        },
        {
          type: 'formula',
          position: { x: 1.1, y: 2.7, w: 7.8, h: 2.1 },
          source: block.value,
        },
      ],
    },
  }],
};

const buffer = await new FreeformCompiler().compileDeck(deck);
await writeFile(outputPath, buffer);
console.log(outputPath);
