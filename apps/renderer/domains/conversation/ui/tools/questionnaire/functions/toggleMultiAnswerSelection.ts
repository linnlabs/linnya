export interface MultiAnswerSelectionChange {
  readonly selection: string[];
  readonly rejectedByLimit: boolean;
}

/**
 * 多选达到上限时保留用户已经确认的选择，避免后一次点击静默改写先前答案。
 */
export function toggleMultiAnswerSelection(
  currentSelection: readonly string[],
  optionId: string,
  maxSelect?: number
): MultiAnswerSelectionChange {
  if (currentSelection.includes(optionId)) {
    return {
      selection: currentSelection.filter(selectedId => selectedId !== optionId),
      rejectedByLimit: false,
    };
  }

  if (maxSelect !== undefined && currentSelection.length >= maxSelect) {
    return {
      selection: [...currentSelection],
      rejectedByLimit: true,
    };
  }

  return {
    selection: [...currentSelection, optionId],
    rejectedByLimit: false,
  };
}
