import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import {
  MAX_PTY_FINAL_SCREEN_SERIALIZED_BYTES,
  MAX_PTY_LIVE_SCREEN_SERIALIZED_BYTES,
} from '../functions/projectTerminalScreen';
import { createPtyScreenProjection } from '../orchestration/createPtyScreenProjection';

const encoder = new TextEncoder();

function createProjection(input?: {
  readonly columns?: number;
  readonly rows?: number;
  readonly scrollbackLines?: number;
  readonly maxCharacters?: number;
  readonly maxLines?: number;
}) {
  return createPtyScreenProjection({
    columns: input?.columns ?? 12,
    rows: input?.rows ?? 4,
    scrollbackLines: input?.scrollbackLines ?? 4,
    agentTextProjectionLimits: {
      maxCharactersPerStream: input?.maxCharacters ?? 100,
      maxLinesPerStream: input?.maxLines ?? 20,
    },
  });
}

async function writeEveryByte(
  projection: ReturnType<typeof createProjection>,
  text: string,
): Promise<void> {
  for (const byte of encoder.encode(text)) {
    await projection.write(Uint8Array.of(byte));
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

describe('PTY headless 屏幕投影', () => {
  it('跨任意 chunk 解析控制序列且不把宿主副作用 payload 交给 Agent 或 renderer', async () => {
    const projection = createProjection({ columns: 20, rows: 3 });
    const transcript = [
      '\x1b]0;PRIVATE-TITLE\x07',
      '\x1b]52;c;U0VDUkVULUNMSVBCT0FSRA==\x07',
      '\x1b]8;;https://secret.example/path\x07link\x1b]8;;\x07',
      '\x1b]1337;File=name=secret.png:AAAA\x07',
      '\x1b]9;desktop-notification\x07',
      '\x1b[31mred\x1b[0m\r\nplain',
    ].join('');

    await writeEveryByte(projection, transcript);
    const snapshot = await projection.snapshot();
    const serialized = JSON.stringify(snapshot.screen);

    expect(snapshot.stableText).toBe('linkred\nplain');
    expect(snapshot.agentText.terminal).toEqual({
      status: 'complete',
      text: 'linkred\nplain',
      total_chars: 13,
      total_lines: 2,
    });
    expect(serialized).not.toContain('PRIVATE-TITLE');
    expect(serialized).not.toContain('SECRET-CLIPBOARD');
    expect(serialized).not.toContain('secret.example');
    expect(serialized).not.toContain('secret.png');
    expect(serialized).not.toContain('desktop-notification');
    expect(serialized).not.toContain('\\u001b');
    expect(snapshot.screen.lines[0]?.text).toBe('linkred');
    expect(snapshot.screen.lines[0]?.style_runs).toContainEqual({
      start_column: 4,
      end_column: 7,
      style: { foreground: { mode: 'palette', index: 1 } },
    });
    expect(serializedBytes(snapshot.screen)).toBeLessThanOrEqual(
      MAX_PTY_LIVE_SCREEN_SERIALIZED_BYTES,
    );

    await projection.finalize('complete');
  });

  it('用稀疏 metric 保留宽字符、组合字符和内部空白，不要求 renderer 猜列宽', async () => {
    const projection = createProjection({ columns: 12, rows: 3 });
    // 光标右移形成没有文本的内部两列，projection 必须显式交付列信息。
    await projection.write(encoder.encode('\x1b[1;38;2;1;2;3m中e\u0301\x1b[2CA'));

    const snapshot = await projection.snapshot();
    const line = snapshot.screen.lines[0];
    expect(line?.text).toBe('中e\u0301A');
    expect(line?.cell_metrics).toEqual([
      { column: 0, text_offset: 0, text_length: 1, display_width: 2 },
      { column: 2, text_offset: 1, text_length: 2, display_width: 1 },
      { column: 3, text_offset: 3, text_length: 0, display_width: 2 },
    ]);
    expect(line?.style_runs).toEqual([
      {
        start_column: 0,
        end_column: 3,
        style: {
          bold: true,
          foreground: { mode: 'rgb', value: 0x010203 },
        },
      },
      {
        start_column: 5,
        end_column: 6,
        style: {
          bold: true,
          foreground: { mode: 'rgb', value: 0x010203 },
        },
      },
    ]);
    expect(snapshot.stableText).toBe('中e\u0301A');

    await projection.finalize('complete');
  });

  it('保留 resize 与备用屏幕，并在退出备用屏幕后恢复普通屏幕', async () => {
    const projection = createProjection({ columns: 8, rows: 3 });
    await projection.write(encoder.encode('normal'));
    await projection.write(encoder.encode('\x1b[?1049h'));
    await projection.write(encoder.encode('alternate'));
    await projection.resize(10, 4);

    const alternate = await projection.snapshot();
    expect(alternate.screen.active_buffer).toBe('alternate');
    expect(alternate.screen.scope).toBe('viewport');
    expect(alternate.screen.columns).toBe(10);
    expect(alternate.screen.rows).toBe(4);
    expect(alternate.stableText).toContain('alternate');

    await projection.write(encoder.encode('\x1b[?1049l'));
    const normal = await projection.snapshot();
    expect(normal.screen.active_buffer).toBe('normal');
    expect(normal.stableText).toBe('normal');

    await projection.finalize('complete');
  });

  it('scrollback、Agent head/tail 和 terminal settlement 均保持有界且关闭后不再接纳旧 sink', async () => {
    const projection = createProjection({
      columns: 10,
      rows: 2,
      scrollbackLines: 2,
      maxCharacters: 8,
      maxLines: 3,
    });
    const source = encoder.encode('line-1\r\nline-2\r\nline-3\r\nline-4\r\nline-5');
    const write = projection.write(source);
    source.fill('X'.charCodeAt(0));
    await write;

    const finalization = await projection.finalize('interrupted');
    expect(finalization.sourceCompletion).toBe('interrupted');
    expect(finalization.screen.scope).toBe('terminal_window');
    expect(finalization.screen.lines).toHaveLength(4);
    expect(finalization.screen.scrollback_lines).toBe(2);
    expect(finalization.stableText).toContain('line-5');
    expect(serializedBytes(finalization.screen)).toBeLessThanOrEqual(
      MAX_PTY_FINAL_SCREEN_SERIALIZED_BYTES,
    );
    expect(finalization.agentText.terminal).toMatchObject({
      status: 'truncated',
      total_chars: finalization.stableText.length,
    });
    if (finalization.agentText.terminal.status !== 'truncated') {
      throw new Error('expected bounded PTY Agent text to be truncated');
    }
    expect(finalization.agentText.terminal.tail).toContain('5');
    expect(finalization.agentText.terminal.omitted_chars).toBeGreaterThan(0);

    await expect(projection.write(encoder.encode('late'))).rejects.toThrow('closed');
    await expect(projection.resize(80, 24)).rejects.toThrow('closed');
    await expect(projection.snapshot()).rejects.toThrow('closed');
    await expect(projection.finalize('complete')).resolves.toBe(finalization);
  });

  it.each([
    { columns: 80, rows: 24, scrollbackLines: 0 },
    { columns: 200, rows: 60, scrollbackLines: 0 },
    { columns: 80, rows: 24, scrollbackLines: 1_024 },
  ])('真实 parser 压力 $columns x $rows + $scrollbackLines 行滚屏保持字节硬门', async config => {
    const projection = createProjection(config);
    const lineCount = config.scrollbackLines > 0
      ? config.rows + config.scrollbackLines
      : config.rows;
    const transcript = Array.from(
      { length: lineCount },
      (_, index) => `row-${index.toString().padStart(4, '0')} \x1b[32mvalue\x1b[0m`,
    ).join('\r\n');

    const startedAt = performance.now();
    await projection.write(encoder.encode(transcript));
    const snapshot = await projection.snapshot();
    const finalization = await projection.finalize('complete');
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(snapshot.screen.lines).toHaveLength(config.rows);
    expect(snapshot.screen.scope).toBe('viewport');
    expect(serializedBytes(snapshot.screen)).toBeLessThanOrEqual(
      MAX_PTY_LIVE_SCREEN_SERIALIZED_BYTES,
    );
    expect(finalization.screen.scope).toBe('terminal_window');
    expect(serializedBytes(finalization.screen)).toBeLessThanOrEqual(
      MAX_PTY_FINAL_SCREEN_SERIALIZED_BYTES,
    );
    // 这是防止意外退化到逐 cell 巨型对象的宽门，不把开发机瞬时性能锁成产品合同。
    expect(elapsedMilliseconds).toBeLessThan(10_000);
  });

  it('高密度样式仍完整交付 live viewport，final 只舍弃超过字节门的旧滚屏', async () => {
    const rows = 24;
    const scrollbackLines = 512;
    const projection = createProjection({ columns: 80, rows, scrollbackLines });
    const styledLine = Array.from(
      { length: 40 },
      () => '\x1b[31mX\x1b[32mY',
    ).join('');
    const transcript = Array.from(
      { length: rows + scrollbackLines },
      () => `${styledLine}\x1b[0m`,
    ).join('\r\n');

    await projection.write(encoder.encode(transcript));
    const live = await projection.snapshot();
    const finalization = await projection.finalize('complete');

    expect(live.screen.lines).toHaveLength(rows);
    expect(live.screen.lines.every(line => line.style_runs.length === 80)).toBe(true);
    expect(serializedBytes(live.screen)).toBeLessThanOrEqual(
      MAX_PTY_LIVE_SCREEN_SERIALIZED_BYTES,
    );
    expect(finalization.screen.omitted_before_lines).toBeGreaterThan(0);
    expect(finalization.screen.lines[finalization.screen.lines.length - 1]?.text).toBe(
      'XY'.repeat(40),
    );
    expect(serializedBytes(finalization.screen)).toBeLessThanOrEqual(
      MAX_PTY_FINAL_SCREEN_SERIALIZED_BYTES,
    );
  });

  it('极端尺寸只约束 headless terminal 自身容量，不物化无界屏幕结构', async () => {
    expect(() => createProjection({
      columns: 32_767,
      rows: 32_767,
      scrollbackLines: 0,
    })).toThrow('bounded headless terminal budget');

    const projection = createProjection({ columns: 80, rows: 24, scrollbackLines: 100 });
    await expect(projection.resize(32_767, 32_767)).rejects.toThrow(
      'bounded headless terminal budget',
    );
    await projection.write(encoder.encode('projection remains available'));
    await expect(projection.snapshot()).resolves.toMatchObject({
      stableText: 'projection remains available',
      screen: { columns: 80, rows: 24 },
    });
    await expect(projection.finalize('interrupted')).resolves.toMatchObject({
      sourceCompletion: 'interrupted',
      stableText: 'projection remains available',
    });
  });
});
