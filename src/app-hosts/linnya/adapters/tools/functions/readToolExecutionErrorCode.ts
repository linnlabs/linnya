/**
 * 从 concrete tool 抛出的错误读取稳定业务码。
 *
 * Error 子类可声明只读 `code`；普通异常没有业务码，不制造分类。
 */
export function readToolExecutionErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' && code.trim().length > 0 ? code.trim() : undefined;
}
