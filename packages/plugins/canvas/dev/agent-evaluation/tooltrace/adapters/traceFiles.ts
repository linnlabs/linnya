import { readFile, writeFile } from 'node:fs/promises';

export async function readTraceJson(file: string): Promise<unknown> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  return value;
}
export async function writeTraceJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
