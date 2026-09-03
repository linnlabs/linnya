import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createDialogDirectorySession } from '../createDialogDirectorySession';

describe('system dialog directory session', () => {
  it('keeps each feature session independent and resolves save names inside its latest directory', () => {
    const exportSession = createDialogDirectorySession(path.resolve('/documents'));
    const mediaSession = createDialogDirectorySession(path.resolve('/pictures'));

    exportSession.rememberDirectory(path.resolve('/exports/quarterly'));
    mediaSession.rememberFile(path.resolve('/assets/photos/cover.png'));

    expect(exportSession.resolveFileDefaultPath('report.pdf'))
      .toBe(path.resolve('/exports/quarterly/report.pdf'));
    expect(mediaSession.currentDirectory()).toBe(path.resolve('/assets/photos'));
    expect(exportSession.currentDirectory()).not.toBe(mediaSession.currentDirectory());
  });

  it('rejects relative owner state instead of letting the OS choose an implicit directory', () => {
    expect(() => createDialogDirectorySession('downloads')).toThrow('absolute path');
  });
});
