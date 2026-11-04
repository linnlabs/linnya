import { expect, it } from 'vitest';
import { createVisibleUpdateFixture, changeVisibleUpdateFixture } from '../visibleUpdateFixture';

it('reproduces the actual r4 first500 prestate and changes all500 current revisions to new six-character text', () => {
  const before = createVisibleUpdateFixture('text'), after = changeVisibleUpdateFixture(before, 'text', 21);
  expect(before[0].revision).toBe(21); expect(before[50].revision).toBe(1);
  expect(before[0].data.content.content[0].content?.[0].text).toBe('20:001');
  expect(before[50].data.content.content[0].content?.[0].text).toBe('卡 051');
  expect(after).toHaveLength(500);
  after.forEach((card, i) => {
    expect(card.revision).toBe(before[i].revision + 1);
    expect(card.data.content.content[0].content?.[0].text).toBe(`21:${String(i + 1).padStart(3, '0')}`);
    expect([card.x, card.y, card.width, card.height, card.color, card.data.heightMode]).toEqual([before[i].x, before[i].y, 88, 72, 'white', 'fixed']);
    expect(card.data.content).not.toEqual(before[i].data.content);
  });
  expect(before[0].data.content.content[0].content?.[0].text).toBe('20:001');
});

it('retains historical color-only mode as a separate unchanged-body comparison', () => {
  const before = createVisibleUpdateFixture('color'), after = changeVisibleUpdateFixture(before, 'color', 21);
  expect(after.every((card, i) => card.data === before[i].data && card.color === 'green')).toBe(true);
  expect(before.every(card => card.color === 'white')).toBe(true);
});
