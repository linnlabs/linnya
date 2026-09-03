import { Buffer } from 'node:buffer';

import type { CommandOutputTextEncoding } from '@app/schemas/commands';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';

import { createPipeCommandTextProjectionSession } from '../orchestration/createPipeCommandTextProjectionSession';

function createSession(
  encoding: CommandOutputTextEncoding = 'utf-8',
  maxCharactersPerCurrentLine = 100,
  maxCharactersPerStream = 200,
) {
  return createPipeCommandTextProjectionSession({
    encoding,
    currentLogicalLineLimits: { maxCharactersPerCurrentLine },
    agentTextProjectionLimits: {
      maxCharactersPerStream,
      maxLinesPerStream: 20,
    },
  });
}

function utf8(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}

describe('pipe command text projection session', () => {
  it('按 decoder -> parser -> logical-line -> bounded preview 组合双流稳定文本', () => {
    const session = createSession();

    expect(session.write('stdout', utf8('start\n10%\r'))).toEqual({
      stableText: 'start\n',
      committedLinesWithOmissions: 0,
      committedOmittedCharacters: 0,
    });
    expect(session.write('stdout', utf8('20%\r100%\n')).stableText).toBe('100%\n');
    expect(session.write('stderr', utf8('warn\u001b[31m!\u001b[0m\n')).stableText)
      .toBe('warn!\n');

    expect(session.snapshot()).toEqual({
      stablePreview: {
        mode: 'pipe',
        stdout: {
          status: 'complete',
          text: 'start\n100%\n',
          total_chars: 11,
          total_lines: 3,
        },
        stderr: {
          status: 'complete',
          text: 'warn!\n',
          total_chars: 6,
          total_lines: 2,
        },
      },
      currentLogicalLines: {
        stdout: { text: '', omittedCharacters: 0 },
        stderr: { text: '', omittedCharacters: 0 },
      },
    });
  });

  it('snapshot 不终结 session，并把可替换当前帧与稳定正文分开', () => {
    const session = createSession();
    session.write('stdout', utf8('stable\nprogress-10%\r'));

    expect(session.snapshot().stablePreview.stdout).toEqual({
      status: 'complete',
      text: 'stable\n',
      total_chars: 7,
      total_lines: 2,
    });
    expect(session.snapshot().currentLogicalLines.stdout).toEqual({
      text: 'progress-10%',
      omittedCharacters: 0,
    });

    session.write('stdout', utf8('done'));
    expect(session.snapshot().currentLogicalLines.stdout.text).toBe('done');
    expect(session.finalize().trailingStableText.stdout).toBe('done');
  });

  it('decoder EOF 残片经过 parser 和 logical-line 后才进入最终稳定文本', () => {
    const session = createSession();
    session.write('stdout', Uint8Array.of(0xe4));

    expect(session.finalize()).toEqual({
      trailingStableText: { stdout: '�', stderr: '' },
      agentPreview: {
        mode: 'pipe',
        stdout: {
          status: 'complete',
          text: '�',
          total_chars: 1,
          total_lines: 1,
        },
        stderr: {
          status: 'complete',
          text: '',
          total_chars: 0,
          total_lines: 0,
        },
      },
      streams: {
        stdout: {
          incompleteControlSequenceOmitted: false,
          logicalLinesWithOmissions: 0,
          logicalLineOmittedCharacters: 0,
        },
        stderr: {
          incompleteControlSequenceOmitted: false,
          logicalLinesWithOmissions: 0,
          logicalLineOmittedCharacters: 0,
        },
      },
    });
  });

  it('未闭合控制序列只形成所属流的独立事实，不回放 payload', () => {
    const session = createSession();
    session.write('stdout', utf8('before\n\u001b]0;hidden'));
    session.write('stderr', utf8('plain'));

    const finalization = session.finalize();
    expect(finalization.trailingStableText).toEqual({ stdout: '', stderr: 'plain' });
    expect(finalization.streams.stdout.incompleteControlSequenceOmitted).toBe(true);
    expect(finalization.streams.stderr.incompleteControlSequenceOmitted).toBe(false);
    expect(finalization.agentPreview.stdout).toEqual({
      status: 'complete',
      text: 'before\n',
      total_chars: 7,
      total_lines: 2,
    });
  });

  it('只累计真正提交的超长帧；被 CR 覆盖的旧帧不污染事实', () => {
    const session = createSession('utf-8', 4);
    session.write('stdout', utf8('123456789\r'));
    expect(session.write('stdout', utf8('done\nabcdef')).stableText).toBe('done\n');

    const finalization = session.finalize();
    expect(finalization.trailingStableText.stdout).toBe('ab[... output omitted ...]ef');
    expect(finalization.streams.stdout).toEqual({
      incompleteControlSequenceOmitted: false,
      logicalLinesWithOmissions: 1,
      logicalLineOmittedCharacters: 2,
    });
  });

  it('Agent preview 截断与逻辑行正文省略是两类独立事实', () => {
    const session = createSession('utf-8', 100, 10);
    session.write('stdout', utf8('head\nline-2\nline-3\ntail'));
    const finalization = session.finalize();

    expect(finalization.agentPreview.stdout.status).toBe('truncated');
    expect(finalization.streams.stdout).toEqual({
      incompleteControlSequenceOmitted: false,
      logicalLinesWithOmissions: 0,
      logicalLineOmittedCharacters: 0,
    });
  });

  it('Windows CP936 多字节字符跨任意 byte chunk 后仍遵守同一组合合同', () => {
    const session = createSession('windows-936');
    const bytes = iconv.encode('中文\r完成\n', 'cp936');
    for (const byte of bytes) session.write('stdout', Uint8Array.of(byte));

    expect(session.finalize().agentPreview.stdout).toEqual({
      status: 'complete',
      text: '完成\n',
      total_chars: 3,
      total_lines: 2,
    });
  });

  it('UTF-8、控制序列与 CR 任意 byte 单切点都得到相同最终结果', () => {
    const bytes = utf8('start🙂\u001b[31mred\u001b[0m\roverwrite\r\nlast');

    function project(chunks: readonly Uint8Array[]) {
      const session = createSession();
      for (const chunk of chunks) session.write('stdout', chunk);
      return session.finalize();
    }

    const expected = project([bytes]);
    for (let split = 0; split <= bytes.byteLength; split += 1) {
      expect(project([bytes.subarray(0, split), bytes.subarray(split)])).toEqual(expected);
    }
    expect(expected.agentPreview.stdout).toEqual({
      status: 'complete',
      text: 'overwrite\nlast',
      total_chars: 14,
      total_lines: 2,
    });
  });

  it('stdout/stderr 的半字符和半控制序列不会共享状态', () => {
    const session = createSession();
    const emoji = utf8('🙂');
    session.write('stdout', emoji.subarray(0, 2));
    session.write('stderr', utf8('err\u001b['));
    session.write('stdout', emoji.subarray(2));
    session.write('stderr', utf8('31m!\u001b[0m'));

    const result = session.finalize();
    expect(result.agentPreview.stdout).toMatchObject({ status: 'complete', text: '🙂' });
    expect(result.agentPreview.stderr).toMatchObject({ status: 'complete', text: 'err!' });
    expect(result.streams.stdout.incompleteControlSequenceOmitted).toBe(false);
    expect(result.streams.stderr.incompleteControlSequenceOmitted).toBe(false);
  });

  it('区分尾随 LF、无 LF、lone CR 与空流的 EOF 语义', () => {
    const session = createSession();
    session.write('stdout', utf8('line\nlast\r'));

    const result = session.finalize();
    expect(result.trailingStableText).toEqual({ stdout: 'last', stderr: '' });
    expect(result.agentPreview.stdout).toMatchObject({
      status: 'complete',
      text: 'line\nlast',
      total_lines: 2,
    });
    expect(result.agentPreview.stderr).toMatchObject({
      status: 'complete',
      text: '',
      total_lines: 0,
    });
  });

  it('大进度帧与大单行始终只暴露有界快照和有界预览', () => {
    const session = createSession('utf-8', 32, 64);
    for (let frame = 0; frame < 2_000; frame += 1) {
      session.write('stdout', utf8(`${'x'.repeat(1_000)}-${frame}\r`));
    }
    const snapshot = session.snapshot();
    expect(snapshot.currentLogicalLines.stdout.omittedCharacters).toBeGreaterThan(0);
    expect(snapshot.currentLogicalLines.stdout.text.length).toBeLessThan(64);

    session.write('stdout', utf8(`${'y'.repeat(20_000)}\n`));
    session.write('stdout', utf8(`${'z'.repeat(20_000)}\n`));
    session.write('stdout', utf8(`${'w'.repeat(20_000)}\n`));
    const result = session.finalize();
    expect(result.agentPreview.stdout.status).toBe('truncated');
    if (result.agentPreview.stdout.status === 'truncated') {
      expect(result.agentPreview.stdout.head.length + result.agentPreview.stdout.tail.length)
        .toBeLessThanOrEqual(64);
    }
    expect(result.streams.stdout.logicalLinesWithOmissions).toBe(3);
  });

  it('finalize 幂等且不会重复追加 EOF 当前行，之后拒绝继续 write', () => {
    const session = createSession();
    session.write('stdout', utf8('once'));
    const first = session.finalize();

    expect(session.finalize()).toBe(first);
    expect(first.agentPreview.stdout).toEqual({
      status: 'complete',
      text: 'once',
      total_chars: 4,
      total_lines: 1,
    });
    expect(() => session.write('stderr', utf8('late'))).toThrow(
      'cannot write command output after text projection finalization',
    );
  });
});
