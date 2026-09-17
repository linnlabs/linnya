import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { RenderModelMapper } from '../../../../engine/parser/RenderModelMapper';
import { materializePresentationPptx } from '../../../../features/presentationBuildExecution';
import {
  buildDeckSpecFromDirectInput,
  readCompiledDirectComposeInput,
} from '../../presentationComposeInput';
import type {
  FlexComposeInput,
  LayoutShapeNode,
  LayoutSlideNode,
  LayoutTextNode,
  LayoutViewNode,
} from '../LayoutTypes';
import { compileFlexInput } from '../FlexLayoutCompiler';
import { initYoga } from '../YogaAdapter';

function shape(editKey: string): LayoutShapeNode {
  return {
    _type: 'Shape',
    editKey,
    width: 2,
    height: 1,
    fill: '#224466',
  };
}

function text(editKey: string, content: string): LayoutTextNode {
  return {
    _type: 'Text',
    editKey,
    content,
    position: { x: 5, y: 1, w: 3, h: 1 },
  };
}

function frame(editKey: string, children: LayoutViewNode['children']): LayoutViewNode {
  return {
    _type: 'View',
    editKey,
    children,
    position: { x: 1, y: 1, w: 3, h: 2 },
    backgroundColor: '#EEEEEE',
  };
}

function slide(slideKey: string | undefined, children: LayoutSlideNode['children']): LayoutSlideNode {
  return { _type: 'Slide', slideKey, children };
}

function deck(slides: LayoutSlideNode[]): FlexComposeInput {
  return { title: 'Editable deck', slides };
}

describe('authoring identity projection', () => {
  beforeAll(async () => {
    await initYoga();
  });

  it('从作者树贯穿 DeckSpec 与 RenderModel，并产生稳定渲染 ID', () => {
    const compiled = compileFlexInput(deck([
      slide('overview', [shape('hero_art')]),
    ]));
    expect(compiled.error).toBeUndefined();
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected compiled Flex input.');
    expect(compiled.input.slides[0].elements[0]._authoringRef).toEqual({
      slideKey: 'overview',
      editKey: 'hero_art',
      targetKind: 'shape',
    });

    const admitted = readCompiledDirectComposeInput(structuredClone(compiled.input));
    if (!admitted.input) throw new Error(admitted.error ?? 'Expected admitted compiled input.');
    const deckSpec = buildDeckSpecFromDirectInput(admitted.input);
    const model = new RenderModelMapper().fromGeneratedDeck(
      'presentation-1',
      1,
      deckSpec.title,
      deckSpec,
      { width: 13.333, height: 7.5 },
    );

    expect(model.slides[0].elements[0]).toMatchObject({
      id: 'authoring-overview-hero_art',
      authoringRef: { slideKey: 'overview', editKey: 'hero_art', targetKind: 'shape' },
      authoringEdit: {
        capabilities: ['translate', 'delete', 'set_fill_color', 'set_visual_size'],
        fill: { kind: 'solid', color: '#224466' },
      },
    });
  });

  it('形状改字保留作者身份和尺寸/填充，并进入 RenderModel 与 PPTX', async () => {
    const original = { ...shape('badge'), content: 'Before' };
    const input = deck([slide('overview', [original])]);
    input.manualEdits = {
      version: 2,
      slides: [{ slideKey: 'overview', targets: [{
        kind: 'shape', editKey: 'badge', content: 'After', fillColor: '#445566',
        visualSize: { width: 3, height: 2 }, translation: { dx: 0.5, dy: 0.25 },
      }] }],
    };
    const compiled = compileFlexInput(input);
    if (!compiled.input) throw new Error(compiled.error);
    const admitted = readCompiledDirectComposeInput(structuredClone(compiled.input));
    if (!admitted.input) throw new Error(admitted.error);
    const spec = buildDeckSpecFromDirectInput(admitted.input);
    const model = new RenderModelMapper().fromGeneratedDeck('p', 2, spec.title, spec, { width: 13.333, height: 7.5 });
    expect(original.content).toBe('Before');
    expect(model.slides[0].elements[0]).toMatchObject({
      kind: 'shape', box: { w: 3, h: 2 },
      fill: { type: 'solid', color: '#445566' },
      authoringRef: { slideKey: 'overview', editKey: 'badge', targetKind: 'shape' },
      authoringEdit: {
        capabilities: ['translate', 'delete', 'set_fill_color', 'set_visual_size', 'set_text_content'],
        text: { kind: 'plain_text', content: 'After' },
      },
      innerText: { paragraphs: [{ runs: [expect.objectContaining({ text: 'After' })] }] },
    });
    const zip = await JSZip.loadAsync(await materializePresentationPptx({ deckSpec: spec, svgAssets: [], svgFallbacks: [] }));
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(xml).toContain('After');
    expect(xml).not.toContain('Before');
    const rich: LayoutShapeNode = { ...original, content: [{ text: 'Rich' }] };
    expect(compileFlexInput({ ...input, slides: [slide('overview', [rich])] }).error).toContain('不是带有纯文本的形状');
    expect(compileFlexInput({ ...input, slides: [slide('overview', [shape('badge')])] }).error).toContain('不是带有纯文本的形状');
  });

  it.each([false, true])('形状清空文字后仍可再次编辑，structured=%s', (structured) => {
    const compiled = compileFlexInput({
      ...deck([slide('overview', [{ ...shape('badge'), content: 'Before' }])]),
      manualEdits: { version: 2, slides: [{ slideKey: 'overview', targets: [{ kind: 'shape', editKey: 'badge', content: '' }] }] },
    });
    if (!compiled.input) throw new Error(compiled.error);
    if (structured) compiled.input.slides[0].elements.push({
      type: 'table', position: { x: 4, y: 1, w: 2, h: 1 }, headers: ['Header'], rows: [[{ text: 'Value' }]],
    });
    const spec = buildDeckSpecFromDirectInput(compiled.input);
    const model = new RenderModelMapper().fromGeneratedDeck('p', 2, spec.title, spec, { width: 13.333, height: 7.5 });
    expect(model.slides[0].elements[0]).toMatchObject({
      authoringEdit: { text: { kind: 'plain_text', content: '' } }, innerText: { kind: 'text' },
    });
  });

  it('按作者内容声明改字能力，不从渲染后的段落和 run 数量反推', () => {
    const richText: LayoutTextNode = {
      _type: 'Text',
      editKey: 'rich_copy',
      content: [
        { text: 'Rich ', style: { bold: true } },
        { text: 'copy' },
      ],
      position: { x: 1, y: 3, w: 4, h: 1 },
    };
    const compiled = compileFlexInput(deck([
      slide('overview', [text('headline', '增长 2026\n下一行'), richText]),
    ]));
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected compiled Flex input.');
    const admitted = readCompiledDirectComposeInput(structuredClone(compiled.input));
    if (!admitted.input) throw new Error(admitted.error ?? 'Expected admitted compiled input.');
    const deckSpec = buildDeckSpecFromDirectInput(admitted.input);
    const model = new RenderModelMapper().fromGeneratedDeck(
      'presentation-1',
      1,
      deckSpec.title,
      deckSpec,
      { width: 13.333, height: 7.5 },
    );

    expect(model.slides[0].elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        authoringRef: expect.objectContaining({ editKey: 'headline' }),
        authoringEdit: {
          capabilities: ['translate', 'delete', 'set_text_content', 'set_text_style'],
          text: { kind: 'plain_text', content: '增长 2026\n下一行' },
        },
      }),
      expect.objectContaining({
        authoringRef: expect.objectContaining({ editKey: 'rich_copy' }),
        authoringEdit: {
          capabilities: ['translate', 'delete', 'set_text_content'],
          text: { kind: 'rich_text', content: [{ text: 'Rich ', style: { bold: true } }, { text: 'copy' }], baseStyle: expect.objectContaining({ fontFamily: 'Calibri' }) },
        },
      }),
    ]));
  });

  it('拒绝没有 slideKey 的孤立 editKey', () => {
    const result = compileFlexInput(deck([slide(undefined, [shape('headline')])]));
    expect(result.error).toContain('需要所属 Slide 声明 slideKey');
  });

  it('可信 Direct admission 拒绝畸形 authoring ref', () => {
    const admitted = readCompiledDirectComposeInput({
      title: 'Invalid ref',
      slides: [{
        elements: [{
          type: 'shape',
          position: { x: 0, y: 0, w: 1, h: 1 },
          _authoringRef: { slideKey: 'overview', editKey: 'bad key' },
        }],
      }],
    });
    expect(admitted.error).toContain('_authoringRef 不是有效的内部编译结果');
  });

  it('在 Yoga 前应用文本，在 Yoga 后累加 Frame 与子对象位移', () => {
    const originalText = text('headline', 'Original');
    const input = deck([
      slide('overview', [
        frame('hero_group', [shape('hero_art')]),
        originalText,
      ]),
    ]);
    input.manualEdits = {
      version: 1,
      slides: [{
        slideKey: 'overview',
        targets: [
          { kind: 'frame', editKey: 'hero_group', translation: { dx: 0.5, dy: 0.2 } },
          { kind: 'shape', editKey: 'hero_art', translation: { dx: 0.1, dy: 0.3 } },
          { kind: 'text', editKey: 'headline', content: 'Updated' },
        ],
      }],
    };

    const compiled = compileFlexInput(input);
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected compiled manual edits.');
    expect(originalText.content).toBe('Original');
    expect(compiled.input.slides[0].elements).toMatchObject([
      { position: { x: 1.5, y: 1.2 }, _authoringRef: { editKey: 'hero_group', targetKind: 'frame' } },
      {
        position: { x: 1.6, y: 1.5 },
        _authoringRef: { editKey: 'hero_art', targetKind: 'shape' },
        _authoringAncestorRefs: [{ editKey: 'hero_group', targetKind: 'frame' }],
      },
      { content: 'Updated', position: { x: 5, y: 1 }, _authoringRef: { editKey: 'headline', targetKind: 'text' } },
    ]);

    const admitted = readCompiledDirectComposeInput(structuredClone(compiled.input));
    if (!admitted.input) throw new Error(admitted.error ?? 'Expected admitted compiled input.');
    const deckSpec = buildDeckSpecFromDirectInput(admitted.input);
    const model = new RenderModelMapper().fromGeneratedDeck(
      'presentation-1',
      1,
      deckSpec.title,
      deckSpec,
      { width: 13.333, height: 7.5 },
    );
    expect(model.slides[0].elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'authoring-overview-hero_group',
        authoringEdit: {
          capabilities: ['translate', 'delete', 'set_fill_color'],
          fill: { kind: 'solid', color: '#EEEEEE' },
        },
      }),
      expect.objectContaining({
        id: 'authoring-overview-hero_art',
        authoringAncestorRefs: [expect.objectContaining({
          slideKey: 'overview', editKey: 'hero_group', targetKind: 'frame',
        })],
      }),
    ]));
  });

  it('在正式编译阶段应用文本样式、纯色填充与原子元素视觉尺寸', () => {
    const input = deck([
      slide('overview', [
        frame('hero_group', [shape('hero_art')]),
        text('headline', 'Original'),
      ]),
    ]);
    input.manualEdits = {
      version: 2,
      slides: [{
        slideKey: 'overview',
        targets: [
          { kind: 'frame', editKey: 'hero_group', backgroundColor: '#112233' },
          {
            kind: 'shape',
            editKey: 'hero_art',
            fillColor: '#445566',
            visualSize: { width: 2.5, height: 1.25 },
          },
          { kind: 'text', editKey: 'headline', fontSizePt: 30, color: '#778899' },
        ],
      }],
    };

    const compiled = compileFlexInput(input);
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected compiled manual styles.');
    expect(compiled.input.slides[0].elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _authoringRef: expect.objectContaining({ editKey: 'hero_group' }),
        style: expect.objectContaining({
          paint: { type: 'solid', color: '#112233' },
        }),
      }),
      expect.objectContaining({
        _authoringRef: expect.objectContaining({ editKey: 'hero_art' }),
        position: expect.objectContaining({ w: 2.5, h: 1.25 }),
        style: expect.objectContaining({
          paint: { type: 'solid', color: '#445566' },
        }),
      }),
      expect.objectContaining({
        _authoringRef: expect.objectContaining({ editKey: 'headline' }),
        style: expect.objectContaining({ fontSize: 30, color: '#778899' }),
      }),
    ]));
  });

  it('删除 Frame 时在 Yoga 前剪除完整作者子树', () => {
    const input = deck([
      slide('overview', [
        frame('hero_group', [shape('hero_art')]),
        text('headline', 'Keep me'),
      ]),
    ]);
    input.manualEdits = {
      version: 2,
      slides: [{
        slideKey: 'overview',
        targets: [{ kind: 'frame', editKey: 'hero_group', deleted: true }],
      }],
    };

    const compiled = compileFlexInput(input);
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected Frame deletion.');
    expect(compiled.input.slides[0].elements.map(element => element._authoringRef?.editKey))
      .toEqual(['headline']);
  });

  it('删除原子作者元素时只剪除该元素', () => {
    const input = deck([
      slide('overview', [
        frame('hero_group', [shape('hero_art'), text('hero_copy', 'Keep child')]),
        text('headline', 'Remove me'),
      ]),
    ]);
    input.manualEdits = {
      version: 2,
      slides: [{
        slideKey: 'overview',
        targets: [
          { kind: 'shape', editKey: 'hero_art', deleted: true },
          { kind: 'text', editKey: 'headline', deleted: true },
        ],
      }],
    };

    const compiled = compileFlexInput(input);
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected atomic deletion.');
    expect(compiled.input.slides[0].elements.map(element => element._authoringRef?.editKey))
      .toEqual(['hero_group', 'hero_copy']);
  });

  it('把 v2 样式、视觉尺寸与 Frame 删除带入正式 PPTX', async () => {
    const input = deck([
      slide('overview', [
        frame('removed_group', [text('removed_copy', 'Delete me')]),
        shape('hero_art'),
        text('headline', 'Keep me'),
      ]),
    ]);
    input.manualEdits = {
      version: 2,
      slides: [{
        slideKey: 'overview',
        targets: [
          { kind: 'frame', editKey: 'removed_group', deleted: true },
          {
            kind: 'shape',
            editKey: 'hero_art',
            fillColor: '#445566',
            visualSize: { width: 2.5, height: 1.25 },
          },
          { kind: 'text', editKey: 'headline', fontSizePt: 30, color: '#778899' },
        ],
      }],
    };

    const compiled = compileFlexInput(input);
    if (!compiled.input) throw new Error(compiled.error ?? 'Expected compiled manual edits.');
    const admitted = readCompiledDirectComposeInput(structuredClone(compiled.input));
    if (!admitted.input) throw new Error(admitted.error ?? 'Expected admitted compiled input.');
    const deckSpec = buildDeckSpecFromDirectInput(admitted.input);
    const pptx = await materializePresentationPptx({ deckSpec, svgAssets: [], svgFallbacks: [] });
    const zip = await JSZip.loadAsync(pptx);
    const slideFile = zip.file('ppt/slides/slide1.xml');
    if (!slideFile) throw new Error('Expected slide XML.');
    const slideXml = await slideFile.async('text');

    expect(slideXml).toContain('445566');
    expect(slideXml).toContain('778899');
    expect(slideXml).toContain('cx="2286000"');
    expect(slideXml).toContain('cy="1143000"');
    expect(slideXml).toContain('sz="3000"');
    expect(slideXml).toContain('Keep me');
    expect(slideXml).not.toContain('Delete me');
  });

  it('拒绝 dangling 与类型不符的人工记录', () => {
    const baseSlide = slide('overview', [shape('hero_art')]);
    const dangling = compileFlexInput({
      ...deck([baseSlide]),
      manualEdits: {
        version: 1,
        slides: [{
          slideKey: 'overview',
          targets: [{ kind: 'shape', editKey: 'missing', translation: { dx: 1, dy: 0 } }],
        }],
      },
    });
    expect(dangling.error).toContain('overview/missing');

    const mismatch = compileFlexInput({
      ...deck([baseSlide]),
      manualEdits: {
        version: 1,
        slides: [{
          slideKey: 'overview',
          targets: [{ kind: 'chart', editKey: 'hero_art', translation: { dx: 1, dy: 0 } }],
        }],
      },
    });
    expect(mismatch.error).toContain('类型为 chart，实际作者对象为 shape');
  });

  it('拒绝用文本人工记录覆盖含公式的作者对象', () => {
    const result = compileFlexInput({
      ...deck([slide('overview', [{
        _type: 'Text',
        editKey: 'rich_copy',
        content: [{ formula: 'x^2' }],
        position: { x: 1, y: 1, w: 3, h: 1 },
      }])]),
      manualEdits: {
        version: 1,
        slides: [{
          slideKey: 'overview',
          targets: [{ kind: 'text', editKey: 'rich_copy', content: 'Flattened' }],
        }],
      },
    });
    expect(result.error).toContain('包含不能手动覆盖的公式或未知正文');
  });

  it('拒绝页面内重复 editKey 与文稿内重复 slideKey', () => {
    const duplicateElements = compileFlexInput(deck([
      slide('overview', [shape('metric'), shape('metric')]),
    ]));
    expect(duplicateElements.error).toContain('editKey "metric" 在作者树内重复');

    const duplicateSlides = compileFlexInput(deck([
      slide('overview', [shape('first')]),
      slide('overview', [shape('second')]),
    ]));
    expect(duplicateSlides.error).toContain('slideKey "overview" 在文稿内重复');
  });
});
