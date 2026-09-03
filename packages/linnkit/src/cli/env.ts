import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function parseEnvLine(line: string): readonly [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex <= 0) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  const rawValue = trimmed.slice(eqIndex + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  const value =
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue;
  return [key, value] as const;
}

/**
 * 读取当前项目的 .env。
 *
 * 中文备注：quickstart 模板需要开箱即用，但 linnkit 不引入 dotenv 依赖；
 * 这里只支持 KEY=VALUE 的最小格式，生产项目应使用自己的配置系统。
 */
export async function loadDotEnv(cwd: string): Promise<void> {
  try {
    const content = await readFile(resolve(cwd, '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}
