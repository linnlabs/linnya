import { describe, expect, it } from 'vitest';

import { instrumentDeckSourceForLayoutTrace } from './instrumentDeckSource';

describe('instrumentDeckSourceForLayoutTrace', () => {
  it('为节点工厂与 compose 调用注入原始源码行号追踪', () => {
    const source = [
      'const slide = createSlide();',
      'const frame = createFrame();',
      'const title = createText("Title");',
      'frame.add(title);',
      'slide.add(frame);',
      'compose({ title: "Deck", slides: [slide] });',
    ].join('\n');

    const instrumented = instrumentDeckSourceForLayoutTrace(source);

    expect(instrumented).toContain(
      '__withLoc(createSlide(), { startLine: 1, endLine: 1 })',
    );
    expect(instrumented).toContain(
      '__withLoc(createFrame(), { startLine: 2, endLine: 2 })',
    );
    expect(instrumented).toContain(
      '__withLoc(createText("Title"), { startLine: 3, endLine: 3 })',
    );
    expect(instrumented).toContain(
      '__withComposeTrace(compose,({ title: "Deck", slides: [slide] }))',
    );
  });

  it('多行工厂调用保留起止行，并覆盖 spacer', () => {
    const source = [
      'const spacer = createSpacer({',
      '  flex: 1,',
      '});',
    ].join('\n');

    expect(instrumentDeckSourceForLayoutTrace(source)).toBe([
      'const spacer = __withLoc(createSpacer({',
      '  flex: 1,',
      '}), { startLine: 1, endLine: 3 });',
    ].join('\n'));
  });

  it('语法错误时保持现有语法错误通道，不追加不完整插桩', () => {
    const source = 'const slide = createSlide(;';
    expect(instrumentDeckSourceForLayoutTrace(source)).toBe(source);
  });
});
