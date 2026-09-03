import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readWorkspaceIpcSource(): string {
  return fs.readFileSync(path.join(__dirname, 'workspace-ipc.ts'), 'utf8');
}

function readCreateWorkspaceDocumentSource(): string {
  return fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../features/workspace/document-lifecycle/orchestration/createWorkspaceDocument.ts',
    ),
    'utf8',
  );
}

describe('workspace:create-document plugin boundary', () => {
  it('does not hard-code Slides creation in the workspace lifecycle entry', () => {
    const ipcSource = readWorkspaceIpcSource();
    const orchestrationSource = readCreateWorkspaceDocumentSource();

    expect(ipcSource).not.toContain('createPptCoordinator');
    expect(ipcSource).not.toContain("type === 'presentation'");
    expect(ipcSource).not.toContain('未命名演示文稿');
    expect(orchestrationSource).toContain('resolveWorkspaceDocumentLifecycleProvider');
    expect(orchestrationSource).not.toContain('getDocumentTypeBackendHook');
  });
});
