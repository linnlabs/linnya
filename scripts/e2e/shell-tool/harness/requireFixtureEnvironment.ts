import path from 'node:path';

/** fixture 的进程输入在启动时验证；异步回调只消费已接纳的值。 */
export function requireFixtureEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function requireFixtureAbsolutePath(name: string): string {
  const value = requireFixtureEnvironment(name);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}
