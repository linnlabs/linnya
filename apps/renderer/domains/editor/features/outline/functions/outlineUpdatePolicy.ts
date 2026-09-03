export interface OutlineUpdatePolicyInput {
  hasAnyHeadings: boolean;
  outlineVisible: boolean;
  currentListLength: number;
}

export interface OutlineUpdatePlan {
  publishHasHeadings: boolean;
  shouldPopulateList: boolean;
  shouldClearList: boolean;
}

export function planOutlineListUpdate(input: OutlineUpdatePolicyInput): OutlineUpdatePlan {
  // 中文说明：目录关闭时只能发布“有无标题”这个轻量 presence。
  // 完整标题列表会驱动目录派生计算和列表渲染，必须等用户打开目录时再构建。
  if (!input.hasAnyHeadings) {
    return {
      publishHasHeadings: false,
      shouldPopulateList: false,
      shouldClearList: input.currentListLength > 0,
    };
  }

  if (!input.outlineVisible) {
    return {
      publishHasHeadings: true,
      shouldPopulateList: false,
      shouldClearList: input.currentListLength > 0,
    };
  }

  return {
    publishHasHeadings: true,
    shouldPopulateList: true,
    shouldClearList: false,
  };
}
