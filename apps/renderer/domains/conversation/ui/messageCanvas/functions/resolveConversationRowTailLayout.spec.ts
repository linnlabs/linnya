import { describe, expect, it } from 'vitest';
import { resolveConversationRowTailLayout } from './resolveConversationRowTailLayout';

describe('resolveConversationRowTailLayout', () => {
  it('让最后一行用同一个 tail region 承载回答操作与等待状态', () => {
    expect(resolveConversationRowTailLayout({
      isTurnEnd: true,
      isLastRow: true,
      hasAnswerActions: true,
      trailingStatusActive: true,
    })).toEqual({
      ownsTailRegion: true,
      ownsTrailingStatus: true,
    });
  });

  it('等待状态不为更早轮次创建第二块尾部占位', () => {
    expect(resolveConversationRowTailLayout({
      isTurnEnd: true,
      isLastRow: false,
      hasAnswerActions: false,
      trailingStatusActive: true,
    })).toEqual({
      ownsTailRegion: false,
      ownsTrailingStatus: false,
    });
  });

  it('终态失败且没有有效回答时释放临时 tail region', () => {
    expect(resolveConversationRowTailLayout({
      isTurnEnd: true,
      isLastRow: true,
      hasAnswerActions: false,
      trailingStatusActive: false,
    })).toEqual({
      ownsTailRegion: false,
      ownsTrailingStatus: false,
    });
  });

  it('没有回答但本轮改过文档时，仍由 turn-end row 承载改动清单', () => {
    expect(resolveConversationRowTailLayout({
      isTurnEnd: true,
      isLastRow: false,
      hasAnswerActions: false,
      trailingStatusActive: false,
      hasRunDocumentChanges: true,
    })).toEqual({
      ownsTailRegion: true,
      ownsTrailingStatus: false,
    });
    expect(resolveConversationRowTailLayout({
      isTurnEnd: false,
      isLastRow: false,
      hasAnswerActions: false,
      trailingStatusActive: false,
      hasRunDocumentChanges: true,
    }).ownsTailRegion).toBe(false);
  });
});
