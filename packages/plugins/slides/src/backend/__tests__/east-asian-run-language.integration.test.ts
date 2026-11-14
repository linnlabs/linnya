import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';
import { resolveEastAsianLanguage } from '../engine/text/eastAsianRunLanguagePptx';

async function slideXml(children: SandboxJsonObject[]): Promise<string> {
  const compiled = await compilePresentationComposePayload({ title: 'Language', slides: [{ _type: 'Slide', children }] });
  if (!compiled.ok) throw new Error(compiled.message);
  const parsed = readCompiledDirectComposeInput(compiled.input);
  if (!parsed.input) throw new Error(parsed.error);
  const deck = buildDeckSpecFromDirectInput(parsed.input);
  const pptx = await materializePresentationPptx(await preparePresentationMaterialization(deck, undefined, {}));
  const xml = await (await JSZip.loadAsync(pptx)).file('ppt/slides/slide1.xml')?.async('text');
  if (!xml) throw new Error('Expected slide XML');
  return xml;
}

function runLanguages(xml: string): Array<{ lang: string | undefined; alt: string | undefined; text: string }> {
  return [...xml.matchAll(/<a:r><a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)<\/a:t><\/a:r>/g)].map((match) => ({
    lang: /\blang="([^"]+)"/.exec(match[1])?.[1],
    alt: /\baltLang="([^"]+)"/.exec(match[1])?.[1],
    text: match[2],
  }));
}

describe('PPTX 里中日韩文字的 run 语言', () => {
  it('中文正文、表格格子标成 zh-CN（PowerPoint 才会避头尾），纯西文仍是 en-US', async () => {
    const xml = await slideXml([
      { _type: 'Text', content: '一二三四五六七八九十。后面还有字。', width: 3, height: 1 },
      { _type: 'Text', content: 'Quarterly revenue', width: 3, height: 0.5 },
      { _type: 'Table', headers: ['指标', 'Q1'], rows: [['营收', '12']], width: 4 },
    ]);
    const runs = runLanguages(xml);
    expect(runs.find((run) => run.text.startsWith('一二三'))).toMatchObject({ lang: 'zh-CN', alt: 'en-US' });
    expect(runs.find((run) => run.text === '营收')).toMatchObject({ lang: 'zh-CN', alt: 'en-US' });
    expect(runs.find((run) => run.text === 'Quarterly revenue')).toMatchObject({ lang: 'en-US', alt: undefined });
    expect(runs.find((run) => run.text === '12')).toMatchObject({ lang: 'en-US' });
  });

  it('按文字判断语言：假名是日文，谚文是韩文，只有全角标点也按中文处理', () => {
    expect(resolveEastAsianLanguage('日本語のテキスト')).toBe('ja-JP');
    expect(resolveEastAsianLanguage('한국어 텍스트')).toBe('ko-KR');
    expect(resolveEastAsianLanguage('，')).toBe('zh-CN');
    expect(resolveEastAsianLanguage('TypeScript 和 PowerPoint')).toBe('zh-CN');
    expect(resolveEastAsianLanguage('Revenue 128.5%')).toBeUndefined();
  });
});
