import { describe, expect, it } from 'vitest';
import { resolveConversationVirtualizerGeometry } from './conversationVirtualizerGeometry';

describe('resolveConversationVirtualizerGeometry', () => {
  it('按真实滚动原点声明画布起点，并只把画布外 footer 纳入 latest 区域', () => {
    expect(resolveConversationVirtualizerGeometry({
      scrollTop: 420,
      scrollClientTop: 1,
      scrollRectTop: 100,
      listRectTop: -309,
      footerHeight: 96,
      contentPaddingBottom: 24,
    })).toEqual({
      scrollMargin: 10,
      scrollEndThreshold: 121,
    });
  });

  it('无 footer 的宿主仍保留 16px latest 死区', () => {
    expect(resolveConversationVirtualizerGeometry({
      scrollTop: 0,
      scrollClientTop: 0,
      scrollRectTop: 0,
      listRectTop: 4,
      footerHeight: 0,
      contentPaddingBottom: 0,
    })).toEqual({
      scrollMargin: 4,
      scrollEndThreshold: 16,
    });
  });
});
