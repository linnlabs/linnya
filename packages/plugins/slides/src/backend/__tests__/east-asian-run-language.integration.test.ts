import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';
import { resolveEastAsianLanguage } from '../engine/text/eastAsianRunLanguagePptx';
import { createPptxDocument } from '../engine/pptx/createPptxDocument.cjs';
import { PatchCompiler } from '../engine/patch/PatchCompiler';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import { FreeformCompiler } from '../engine/FreeformCompiler';
import { PptxReader } from '../engine/parser/PptxReader';
import type { DeckSpec, PatchSpec } from '@plugin/slides/shared';

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

const AUTHORED_TEXTS = ['一二三四五六七八九十。后面还有字。', '日本語の資料', '日本語'];

/**
 * 模拟 PowerPoint 作者写出的导入稿：PptxGenJS 原始输出，不经过本插件的包清理，
 * 中日文 run 保持作者的 `lang="en-US"`（PowerPoint 会为中文输入写 en-US + altLang）。
 */
async function buildAuthoredDeck(slideCount: number): Promise<Buffer> {
  const pptx = createPptxDocument();
  for (let index = 0; index < slideCount; index += 1) {
    const slide = pptx.addSlide();
    AUTHORED_TEXTS.forEach((text, row) => {
      slide.addText(text, { x: 0.5, y: 0.5 + row * 1.2, w: 8, h: 1, objectName: `authored-${row}` });
    });
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as ArrayBuffer);
}

/** 按 presentation.xml 的页序读取各页 XML；automizer 重组后的 slideN.xml 文件名不代表页码。 */
async function readSlidesInOrder(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const presentation = await zip.file('ppt/presentation.xml')?.async('text');
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text');
  if (!presentation || !rels) throw new Error('Expected presentation.xml and its rels');
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => [
      /\bId="([^"]+)"/.exec(match[0])?.[1],
      /\bTarget="([^"]+)"/.exec(match[0])?.[1],
    ] as const),
  );
  const slideXml: string[] = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const target = targets.get(/\br:id="([^"]+)"/.exec(match[0])?.[1]);
    const xml = target ? await zip.file(`ppt/${target}`)?.async('text') : undefined;
    if (!xml) throw new Error(`Expected slide part for ${match[0]}`);
    slideXml.push(xml);
  }
  return slideXml;
}

function runLanguageOf(xml: string, text: string): string | undefined {
  const run = runLanguages(xml).find((entry) => entry.text === text);
  if (!run) throw new Error(`Expected a run with text ${text}`);
  return run.lang;
}

describe('导入稿导出不改写作者的 run 语言', () => {
  const patchCompiler = new PatchCompiler(new StructuredCompiler());

  it('前提：导入稿里中日文 run 是作者写的 en-US', async () => {
    const [source] = await readSlidesInOrder(await buildAuthoredDeck(1));
    for (const text of AUTHORED_TEXTS) expect(runLanguageOf(source, text)).toBe('en-US');
  });

  it('只改一页样式时，其余页的 XML 与全部 run 语言保持原样', async () => {
    const source = await buildAuthoredDeck(2);
    const name = (await new PptxReader().parse(source)).slides[1].elements[0].name;
    const patch: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'modify_style', target: { slideNumber: 2, elementName: name }, style: { fill: '#FF0000' } }],
    };

    const result = await patchCompiler.compile(source, patch);

    const before = await readSlidesInOrder(source);
    const after = await readSlidesInOrder(result);
    expect(after[0]).toBe(before[0]);
    for (const text of AUTHORED_TEXTS) expect(runLanguageOf(after[1], text)).toBe('en-US');
  });

  it('删页等需要重组包的导出同样保留作者语言', async () => {
    const source = await buildAuthoredDeck(3);
    const patch: PatchSpec = { type: 'patch', operations: [{ op: 'delete_slide', slideNumber: 3 }] };

    const result = await patchCompiler.compile(source, patch);

    const slides = await readSlidesInOrder(result);
    expect(slides).toHaveLength(2);
    for (const xml of slides) {
      for (const text of AUTHORED_TEXTS) expect(runLanguageOf(xml, text)).toBe('en-US');
    }
  });

  it('补丁新插入的生成页仍按文字标注语言，作者页不受影响', async () => {
    const source = await buildAuthoredDeck(1);
    const patch: PatchSpec = {
      type: 'patch',
      operations: [{
        op: 'insert_slide',
        slideNumber: 2,
        spec: {
          type: 'structured',
          elements: [{ type: 'text', content: '新增的中文页。', position: { x: 1, y: 1, w: 8, h: 1 } }],
        },
      }],
    };

    const result = await patchCompiler.compile(source, patch);

    const slides = await readSlidesInOrder(result);
    expect(slides).toHaveLength(2);
    for (const text of AUTHORED_TEXTS) expect(runLanguageOf(slides[0], text)).toBe('en-US');
    expect(runLanguageOf(slides[1], '新增的中文页。')).toBe('zh-CN');
  });
});

describe('进程内生成稿编译入口仍标注中日韩 run 语言', () => {
  it('StructuredCompiler 与 FreeformCompiler 的中文 run 是 zh-CN', async () => {
    const structured: DeckSpec = {
      title: 'Structured',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{ type: 'text', content: '生成的中文页。', position: { x: 1, y: 1, w: 8, h: 1 } }],
        },
      }],
    };
    const freeform: DeckSpec = {
      title: 'Freeform',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{ type: 'text', content: '自由页中文。', position: { x: 1, y: 1, w: 8, h: 1 } }],
        },
      }],
    };

    const [structuredXml] = await readSlidesInOrder(await new StructuredCompiler().compileDeck(structured));
    const [freeformXml] = await readSlidesInOrder(await new FreeformCompiler().compileDeck(freeform));

    expect(runLanguageOf(structuredXml, '生成的中文页。')).toBe('zh-CN');
    expect(runLanguageOf(freeformXml, '自由页中文。')).toBe('zh-CN');
  });
});
