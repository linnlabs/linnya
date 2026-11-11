/** 等待若干毫秒。需要可取消的等待时由调用方自己接 AbortSignal，这里不提供。 */
export function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, milliseconds); });
}
