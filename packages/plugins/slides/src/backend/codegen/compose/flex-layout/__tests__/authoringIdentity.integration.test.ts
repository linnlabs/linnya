import { beforeAll, describe, expect, it } from 'vitest';
import { RenderModelMapper } from '../../../../engine/parser/RenderModelMapper';
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
      authoringEdit: { capabilities: ['translate'] },
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
          capabilities: ['translate', 'set_text_content'],
          text: { kind: 'plain_text', content: '增长 2026\n下一行' },
        },
      }),
      expect.objectContaining({
        authoringRef: expect.objectContaining({ editKey: 'rich_copy' }),
        authoringEdit: {
          capabilities: ['translate'],
          text: { kind: 'rich_text' },
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
        authoringEdit: { capabilities: ['translate'] },
      }),
      expect.objectContaining({
        id: 'authoring-overview-hero_art',
        authoringAncestorRefs: [expect.objectContaining({
          slideKey: 'overview', editKey: 'hero_group', targetKind: 'frame',
        })],
      }),
    ]));
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

  it('拒绝用纯文本人工记录覆盖富文本作者对象', () => {
    const result = compileFlexInput({
      ...deck([slide('overview', [{
        _type: 'Text',
        editKey: 'rich_copy',
        content: [{ text: 'Rich', style: { bold: true } }],
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
    expect(result.error).toContain('不是可直接改字的纯文本作者对象');
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
