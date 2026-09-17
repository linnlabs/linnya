import { beforeAll, describe, expect, it } from 'vitest';
import type { DeckSpec } from '@plugin/slides/shared';
import {
  buildDeckSpecFromDirectInput,
  compileFlexInput,
  initYoga,
} from '../../../codegen/index.js';
import {
  projectManualTranslationToDeckSpec,
  SlidesManualEditDeckProjectionError,
} from './projectManualTranslationToDeckSpec.js';

const TARGET = { slideKey: 'overview', editKey: 'headline' } as const;

function makeDeck(): DeckSpec {
  return {
    title: 'Demo',
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements: [{
          type: 'text',
          content: 'Original',
          position: { x: 1, y: 2, w: 3, h: 1 },
          _authoringRef: { ...TARGET, targetKind: 'text' },
          _layoutConstraintEvidence: {
            layoutNodeId: 'slide:1/root.0',
            positionMode: 'absolute',
            declared: {},
            finalBox: { x: 1, y: 2, w: 3, h: 1, unit: 'in' },
            computedRatios: {},
            parent: {
              nodeId: 'slide:1/root',
              kind: 'slide',
              label: 'Slide 1',
              finalBox: { x: 0, y: 0, w: 13.333, h: 7.5, unit: 'in' },
              zIndex: -1,
            },
            clipSemantics: 'visible',
          },
        }],
      },
    }],
  };
}

describe('projectManualTranslationToDeckSpec', () => {
  beforeAll(async () => {
    await initYoga();
  });

  it('与完整 Flex 编译的 post-layout 位移结果一致', () => {
    const sourceInput = {
      title: 'Equivalent translation',
      slides: [{
        _type: 'Slide' as const,
        slideKey: 'overview',
        children: [{
          _type: 'Shape' as const,
          editKey: 'metric',
          position: { x: 1, y: 2, w: 3, h: 1 },
          fill: '#224466',
        }],
      }],
    };
    const base = compileFlexInput(sourceInput);
    const fullyCompiled = compileFlexInput({
      ...sourceInput,
      manualEdits: {
        version: 2,
        slides: [{
          slideKey: 'overview',
          targets: [{
            kind: 'shape',
            editKey: 'metric',
            translation: { dx: 0.5, dy: -0.25 },
          }],
        }],
      },
    });
    if (!base.input || !fullyCompiled.input) {
      throw new Error(base.error ?? fullyCompiled.error ?? 'Expected compiled decks.');
    }
    const projected = projectManualTranslationToDeckSpec(
      buildDeckSpecFromDirectInput(base.input),
      {
        op: 'translate_by',
        target: { slideKey: 'overview', editKey: 'metric' },
        targetKind: 'shape',
        delta: { dx: 0.5, dy: -0.25 },
      },
    );

    expect(projected.kind).toBe('projected');
    if (projected.kind !== 'projected') throw new Error('Expected projected deck.');
    expect(projected.deckSpec).toEqual(buildDeckSpecFromDirectInput(fullyCompiled.input));
  });

  it('只复制目标路径，并同步平移元素盒与布局证据', () => {
    const deck = makeDeck();
    const result = projectManualTranslationToDeckSpec(deck, {
      op: 'translate_by',
      target: TARGET,
      targetKind: 'text',
      delta: { dx: 0.25, dy: -0.5 },
    });

    expect(result.kind).toBe('projected');
    if (result.kind !== 'projected') throw new Error('Expected projected deck.');
    expect(result.deckSpec).not.toBe(deck);
    expect(result.deckSpec.slides[0]?.spec.elements[0]).toMatchObject({
      position: { x: 1.25, y: 1.5, w: 3, h: 1 },
      _layoutConstraintEvidence: {
        finalBox: { x: 1.25, y: 1.5, w: 3, h: 1, unit: 'in' },
      },
    });
    expect(deck.slides[0]?.spec.elements[0]?.position).toEqual({ x: 1, y: 2, w: 3, h: 1 });
  });

  it('把内容修改、Frame 和嵌套目标交给完整编译器', () => {
    expect(projectManualTranslationToDeckSpec(makeDeck(), {
      op: 'set_text_content', targetKind: 'text',
      target: TARGET,
      content: 'Updated',
    })).toEqual({ kind: 'requires_full_compile' });

    const frameDeck: DeckSpec = {
      title: 'Frame',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'group',
            position: { x: 1, y: 1, w: 5, h: 3 },
            _authoringRef: { slideKey: 'overview', editKey: 'frame', targetKind: 'frame' },
            children: [{
              type: 'shape',
              position: { x: 0, y: 0, w: 1, h: 1 },
              _authoringRef: { slideKey: 'overview', editKey: 'nested', targetKind: 'shape' },
            }],
          }],
        },
      }],
    };
    expect(projectManualTranslationToDeckSpec(frameDeck, {
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'frame' },
      targetKind: 'frame',
      delta: { dx: 1, dy: 1 },
    })).toEqual({ kind: 'requires_full_compile' });
    expect(projectManualTranslationToDeckSpec(frameDeck, {
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'nested' },
      targetKind: 'shape',
      delta: { dx: 1, dy: 1 },
    })).toEqual({ kind: 'requires_full_compile' });
  });

  it('拒绝缺失、重复或类型不一致的作者目标', () => {
    expect(() => projectManualTranslationToDeckSpec(makeDeck(), {
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'missing' },
      targetKind: 'text',
      delta: { dx: 1, dy: 1 },
    })).toThrowError(SlidesManualEditDeckProjectionError);

    expect(() => projectManualTranslationToDeckSpec(makeDeck(), {
      op: 'translate_by',
      target: TARGET,
      targetKind: 'shape',
      delta: { dx: 1, dy: 1 },
    })).toThrow('当前编译快照为 text');

    const duplicate = makeDeck();
    const slide = duplicate.slides[0];
    if (slide?.spec.type === 'structured') {
      slide.spec.elements.push({ ...slide.spec.elements[0] });
    }
    expect(() => projectManualTranslationToDeckSpec(duplicate, {
      op: 'translate_by',
      target: TARGET,
      targetKind: 'text',
      delta: { dx: 1, dy: 1 },
    })).toThrow('不唯一');
  });
});
