import { ProcessOutputCursorSchema } from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import type { ProcessOutputObservationWindow } from '../../../../../../domains/commands';
import { projectProcessObservationText } from '../functions/projectShellToolRuntimeResult';

describe('PTY process observation Agent projection', () => {
  it('使用 terminal 标签且保留省略事实，不把合流屏幕冒充 stdout', () => {
    const cursor = ProcessOutputCursorSchema.parse(3);
    const observation: ProcessOutputObservationWindow = {
      mode: 'pty',
      coverage: 'complete',
      requestedCursor: ProcessOutputCursorSchema.parse(2),
      availableAfterCursor: ProcessOutputCursorSchema.parse(0),
      nextCursor: cursor,
      terminal: {
        status: 'truncated',
        head: 'screen-head',
        tail: 'screen-tail',
        omitted_chars: 12,
        total_chars: 34,
        total_lines: 4,
      },
      outputPhase: 'open',
      textProjection: 'available',
    };

    const projected = projectProcessObservationText(observation);

    expect(projected).toContain('terminal:\nscreen-head');
    expect(projected).toContain('[12 characters omitted]');
    expect(projected).not.toContain('stdout:');
  });

  it('pipe 输出带首尾换行时只规范化 Agent 文本，不改变内部换行', () => {
    const cursor = ProcessOutputCursorSchema.parse(4);
    const projected = projectProcessObservationText({
      mode: 'pipe',
      coverage: 'complete',
      requestedCursor: ProcessOutputCursorSchema.parse(0),
      availableAfterCursor: ProcessOutputCursorSchema.parse(0),
      nextCursor: cursor,
      outputPhase: 'closed',
      textProjection: 'available',
      stdout: '\nfirst line\nsecond line\n',
      stderr: '\nElectron diagnostic\n',
      currentLogicalLines: {
        stdout: { text: '', omittedCharacters: 0 },
        stderr: { text: '', omittedCharacters: 0 },
      },
    });

    expect(projected).toBe(
      'stdout:\n\nfirst line\nsecond line\n\nstderr:\n\nElectron diagnostic',
    );
    expect(projected).toBe(projected.trim());
  });
});
