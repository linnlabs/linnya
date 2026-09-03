import { describe, expect, it } from 'vitest';

import { normalizeCodegenSourceCompatibility } from '../normalizeCodegenSourceCompatibility.js';

describe('normalizeCodegenSourceCompatibility', () => {
  it('把径向渐变的数字字面量半径展开为公开合同要求的二维半径', () => {
    const source = 'createShape({ fill: { type: "radial", stops, radius: 0.5 } });';

    expect(normalizeCodegenSourceCompatibility(source)).toBe(
      'createShape({ fill: { type: "radial", stops, radius: { x: 0.5, y: 0.5 } } });'
    );
  });

  it('不改写线性渐变、动态表达式或无关对象', () => {
    const source = [
      'createShape({ fill: { type: "linear", angle: 0, stops, radius: 0.5 } });',
      'createShape({ fill: { type: "radial", stops, radius: gradientRadius } });',
      'const metadata = { type: "note", radius: 0.5 };',
    ].join('\n');

    expect(normalizeCodegenSourceCompatibility(source)).toBe(source);
  });

  it('只把 compose options 中的 16:9 layout 字面量规范为 16x9', () => {
    const source = [
      "compose({ title: 'Deck', layout: '16:9', slides });",
      'const metadata = { layout: "16:9" };',
      'render({ layout: "16:9" });',
      'compose({ layout: selectedLayout, slides });',
      'compose({ layout: "4:3", slides });',
    ].join('\n');

    expect(normalizeCodegenSourceCompatibility(source)).toBe([
      "compose({ title: 'Deck', layout: \"16x9\", slides });",
      'const metadata = { layout: "16:9" };',
      'render({ layout: "16:9" });',
      'compose({ layout: selectedLayout, slides });',
      'compose({ layout: "4:3", slides });',
    ].join('\n'));
  });

  it('只移除 typed path viewBox 中无歧义的零原点', () => {
    const source = [
      'createShape({ geometry: { type: "path", viewBox: { x: 0, y: 0, width: 100, height: size }, commands } });',
      'createShape({ geometry: { type: "path", viewBox: { x: 1, y: 0, width: 100, height: 100 }, commands } });',
      'const metadata = { viewBox: { x: 0, y: 0, width: 100, height: 100 } };',
      'createShape({ geometry: { type: "path", viewBox: dynamicViewBox, commands } });',
    ].join('\n');

    expect(normalizeCodegenSourceCompatibility(source)).toBe([
      'createShape({ geometry: { type: "path", viewBox: { width: 100, height: size }, commands } });',
      'createShape({ geometry: { type: "path", viewBox: { x: 1, y: 0, width: 100, height: 100 }, commands } });',
      'const metadata = { viewBox: { x: 0, y: 0, width: 100, height: 100 } };',
      'createShape({ geometry: { type: "path", viewBox: dynamicViewBox, commands } });',
    ].join('\n'));
  });
});
