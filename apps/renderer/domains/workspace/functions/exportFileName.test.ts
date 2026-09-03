import { describe, expect, it } from 'vitest';
import { buildWorkspaceExportFileName } from './exportFileName';

describe('buildWorkspaceExportFileName', () => {
  it('replaces the current extension with the export extension', () => {
    expect(buildWorkspaceExportFileName({
      currentFileName: 'Research.md',
      extension: 'pdf',
      untitledBaseName: 'Untitled document',
    })).toBe('Research.pdf');
  });

  it('uses the localized untitled base name when current file name is empty', () => {
    expect(buildWorkspaceExportFileName({
      currentFileName: '',
      extension: 'md',
      untitledBaseName: '未命名文档',
    })).toBe('未命名文档.md');
  });
});
