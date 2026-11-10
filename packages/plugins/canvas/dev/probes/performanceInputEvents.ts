/** 两端各自有界保留原始输入事实，overflow非零不能宣称完整事件分账。 */
export function createCanvasInputEvents() {
  const events: unknown[] = [];
  let overflow = 0;
  return {
    record(event: unknown) { if (events.length < 512) events.push(event); else overflow++; },
    read: () => ({ events, overflow, limit: 512 }),
  };
}
