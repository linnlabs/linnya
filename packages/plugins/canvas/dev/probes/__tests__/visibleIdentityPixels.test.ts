import { expect, it } from 'vitest';
import { createVisibleUpdateFixture } from '../visibleUpdateFixture';
import { readVisibleIdentityPixels } from '../visibleIdentityPixels';

it('reads actual transformed lower-paragraph pixels separately from the first-line control', () => {
  const width = 128, height = 100, before = new Uint8Array(width * height * 4).fill(255), after = before.slice();
  after[(65 * width + 45) * 4] = 20;
  after[(33 * width + 45) * 4] = 80;
  // 卡外或首行变化不能代替下段正文的像素证据。
  after[(20 * width + 5) * 4] = 0;
  const facts = readVisibleIdentityPixels({ bytes: before, width, height }, { bytes: after, width, height },
    createVisibleUpdateFixture('identity-control').slice(0, 1), { x: 11, y: 7, zoom: 0.5 }, 2);
  expect(facts[0].first.changed).toBe(1); expect(facts[0].second.changed).toBe(1);
  expect(facts[0].second.maximumDelta).toBe(235);
});
