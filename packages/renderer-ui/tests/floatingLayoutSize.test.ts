// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { measureFloatingLayoutSize } from '../src/features/floating-panels/functions/floatingLayoutSize';

describe('measureFloatingLayoutSize', () => {
  it('reads layout size so an entrance scale does not shrink the measurement', () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'offsetWidth', { value: 240 });
    Object.defineProperty(element, 'offsetHeight', { value: 155 });
    element.getBoundingClientRect = () => new DOMRect(0, 0, 230.4, 148.8);

    expect(measureFloatingLayoutSize(element)).toEqual({ width: 240, height: 155 });
  });
});
