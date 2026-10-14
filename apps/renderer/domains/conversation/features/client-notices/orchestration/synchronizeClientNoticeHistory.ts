/** 接纳与窗口确认是两件事。确认失败保留 local receipt，不再次产生“读取失败”notice。 */
export async function synchronizeClientNoticeHistory(deps: {
  readonly synchronize: () => Promise<boolean>;
  readonly isCurrent: () => boolean;
  readonly refresh: () => Promise<unknown>;
}): Promise<void> {
  if (!await deps.synchronize() || !deps.isCurrent()) return;
  try { await deps.refresh(); } catch { /* 下次窗口恢复继续确认，不能自我报告形成无限错误链。 */ }
}
