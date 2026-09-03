import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = path.resolve(
  process.cwd(),
  'src/electron-main/ipc/handlers/index.ts',
);

function readSource(): string {
  return readFileSync(sourcePath, 'utf8');
}

describe('registerAllHandlers boundary', () => {
  it('Main 系统 IPC 不得再装载 Backend handler 或 BackendRuntimeOwner', () => {
    const source = readSource();

    expect(source).not.toMatch(/from\s+['"][^'"]*tsHandlers['"]/);
    expect(source).not.toMatch(/import\(\s*['"][^'"]*tsHandlers['"]\s*\)/);
    expect(source).not.toContain('BackendRuntimeOwner');
    expect(source).toContain('registerApiPortHandlers(apiPortProvider)');
  });
});
