import { describe, expect, it } from 'vitest';
import { toggleMultiAnswerSelection } from './toggleMultiAnswerSelection';

describe('toggleMultiAnswerSelection', () => {
  it('连续选择多个选项时保留全部选择', () => {
    const first = toggleMultiAnswerSelection([], 'a', 2);
    const second = toggleMultiAnswerSelection(first.selection, 'b', 2);

    expect(second).toEqual({
      selection: ['a', 'b'],
      rejectedByLimit: false,
    });
  });

  it('达到上限后拒绝新选项且不替换已有选择', () => {
    expect(toggleMultiAnswerSelection(['a', 'b'], 'c', 2)).toEqual({
      selection: ['a', 'b'],
      rejectedByLimit: true,
    });
  });

  it('达到上限后仍可取消已选项', () => {
    expect(toggleMultiAnswerSelection(['a', 'b'], 'a', 2)).toEqual({
      selection: ['b'],
      rejectedByLimit: false,
    });
  });
});
