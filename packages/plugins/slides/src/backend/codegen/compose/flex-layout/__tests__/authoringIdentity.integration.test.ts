import { beforeAll, describe, expect, it } from 'vitest';
import { RenderModelMapper } from '../../../../engine/parser/RenderModelMapper';
import {
  buildDeckSpecFromDirectInput,
  readCompiledDirectComposeInput,
} from '../../presentationComposeInput';
import type { FlexComposeInput, LayoutShapeNode, LayoutSlideNode } from '../LayoutTypes';
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
      authoringRef: { slideKey: 'overview', editKey: 'hero_art' },
    });
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
