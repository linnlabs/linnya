export interface ConversationRowTailLayoutInput {
  readonly isTurnEnd: boolean;
  readonly isLastRow: boolean;
  readonly hasAnswerActions: boolean;
  readonly trailingStatusActive: boolean;
}

export interface ConversationRowTailLayout {
  readonly ownsTailRegion: boolean;
  readonly ownsTrailingStatus: boolean;
}

/**
 * 回答操作与生成等待共享同一块尾部几何；等待状态只能由主画布最后一行拥有。
 * 纯函数让虚拟画布和普通 Subrun 画布保持同一条边界规则。
 */
export function resolveConversationRowTailLayout(
  input: ConversationRowTailLayoutInput,
): ConversationRowTailLayout {
  const ownsTrailingStatus = input.isTurnEnd
    && input.isLastRow
    && input.trailingStatusActive;
  return {
    ownsTailRegion: input.isTurnEnd && (input.hasAnswerActions || ownsTrailingStatus),
    ownsTrailingStatus,
  };
}
