import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';

/** deck.js Text → compose 回读 → DeckSpec → 原生 PPTX，走真实链路。 */
async function build(text: SandboxJsonObject) {
  const compiled = await compilePresentationComposePayload({
    title: 'Run line spacing',
    slides: [{ _type: 'Slide', children: [{ _type: 'Text', width: 6, height: 2, ...text }] }],
  });
  if (!compiled.ok) throw new Error(compiled.message);
  const parsed = readCompiledDirectComposeInput(compiled.input);
  if (!parsed.input) throw new Error(parsed.error);
  const deck = buildDeckSpecFromDirectInput(parsed.input);
  const pptx = await materializePresentationPptx(await preparePresentationMaterialization(deck, undefined, {}));
  const xml = await (await JSZip.loadAsync(pptx)).file('ppt/slides/slide1.xml')?.async('text');
  if (!xml) throw new Error('Expected slide XML');
  return { parsed, deck, xml };
}

const WITHOUT_RUN_SPACING = [{ text: '上' }, { text: '下', style: { bold: true } }];

describe('富文本 run 上的 style.lineSpacing（旧稿）', () => {
  it('照常加载：忽略 run 行距，并给出 parse 阶段的 warning', async () => {
    const { parsed, deck } = await build({
      content: [
        { text: '上', style: { lineSpacing: { kind: 'exactPt', value: 40 } } },
        { text: '下', style: { bold: true, lineSpacing: { kind: 'multiple', value: 2 } } },
      ],
    });

    expect(parsed.error).toBeUndefined();
    const [element] = deck.slides[0].spec.elements;
    if (element.type !== 'text' || !Array.isArray(element.content)) throw new Error('Expected rich text');
    expect(element.content.map((run) => ('style' in run ? run.style : undefined))).toEqual([{}, { bold: true }]);
    expect(parsed.parseWarningsStructured).toEqual([
      expect.objectContaining({
        code: 'run_line_spacing_ignored',
        severity: 'warn',
        path: 'slides[0].elements[0].content[0].style.lineSpacing',
      }),
      expect.objectContaining({
        code: 'run_line_spacing_ignored',
        path: 'slides[0].elements[0].content[1].style.lineSpacing',
      }),
    ]);
    expect(parsed.parseWarnings?.[0]).toContain('lineHeight');
  });

  it('不改变渲染：PPTX 与没有 run 行距的同一份稿件逐字节一致', async () => {
    const legacy = await build({
      content: [
        { text: '上', style: { lineSpacing: { kind: 'exactPt', value: 40 } } },
        { text: '下', style: { bold: true, lineSpacing: { kind: 'multiple', value: 2 } } },
      ],
    });
    const clean = await build({ content: WITHOUT_RUN_SPACING });

    expect(legacy.xml).toBe(clean.xml);
    expect(clean.parsed.parseWarningsStructured).toBeUndefined();
  });

  it('写错的旧值同样忽略，不报错', async () => {
    const { parsed, xml } = await build({ content: [{ text: '上', style: { lineSpacing: 'wide' } }, { text: '下' }] });

    expect(parsed.parseWarningsStructured).toEqual([
      expect.objectContaining({ code: 'run_line_spacing_ignored' }),
    ]);
    expect(xml).toContain('上');
  });

  it('整框行距不变：Text 的 lineHeight 仍写成段落 spcPct，其他未知 run 字段仍然报错', async () => {
    const { parsed, xml } = await build({
      lineHeight: 1.5,
      content: [{ text: '上', style: { lineSpacing: { kind: 'exactPt', value: 40 } } }],
    });
    expect(xml).toContain('<a:spcPct val="150000"/>');
    expect(xml).not.toContain('spcPts');
    expect(parsed.parseWarningsStructured).toHaveLength(1);

    const invalid = await compilePresentationComposePayload({
      title: 'Unknown',
      slides: [{ _type: 'Slide', children: [{ _type: 'Text', content: [{ text: '上', style: { bogus: 1 } }] }] }],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).toContain('style');
  });
});
