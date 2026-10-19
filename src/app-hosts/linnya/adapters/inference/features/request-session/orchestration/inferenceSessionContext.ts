import { AsyncLocalStorage } from 'node:async_hooks';

const inferenceSession = new AsyncLocalStorage<string | undefined>();

/** 推理会话身份属于请求合同，不依赖可关闭的审计或每轮变化的 run/attempt 身份。 */
export function getCurrentInferenceSessionId(): string | undefined {
  return inferenceSession.getStore();
}

/**
 * 调用方必须在作用域内消费完整异步流程（包括 stream），只创建 generator 不会开始执行。
 * undefined 显式建立独立调用边界，避免缺少 Conversation 的 child 借用外层会话身份。
 */
export function runWithInferenceSession<T>(
  sessionId: string | undefined,
  execute: () => Promise<T>
): Promise<T> {
  return inferenceSession.run(sessionId, execute);
}
