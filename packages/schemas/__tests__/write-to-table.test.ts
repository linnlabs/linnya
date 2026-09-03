import { describe, expect, it } from 'vitest';
import {
  readWriteToTableOutput,
  readWriteToTableReplayResult,
} from '../src/tools/write-to-table';

describe('write_to_table shared output contract', () => {
  it('reads the declared tool output from its SSE JSON string', () => {
    expect(readWriteToTableOutput(JSON.stringify({
      data: {
        action: 'write_to_table',
        content: '已完成',
        mode: 'replace',
        row: 3,
        col: 2,
        timestamp: 123,
      },
      observation: '表格内容已写入。',
      control: {
        terminateRun: true,
        finalAnswer: '已完成',
      },
    }))).toEqual({
      action: 'write_to_table',
      content: '已完成',
      mode: 'replace',
      row: 3,
      col: 2,
      timestamp: 123,
      control: {
        terminateRun: true,
        finalAnswer: '已完成',
      },
    });
  });

  it('rejects malformed or empty write intents', () => {
    expect(readWriteToTableOutput('not json')).toBeNull();
    expect(readWriteToTableOutput({
      data: {
        action: 'write_to_table',
        content: '',
        mode: 'append',
        timestamp: 123,
      },
      observation: '表格内容已写入。',
      control: { terminateRun: true, finalAnswer: '' },
    })).toBeNull();
  });

  it('requires the terminal child final answer to match the written content', () => {
    expect(readWriteToTableOutput({
      data: {
        action: 'write_to_table',
        content: '真实写入内容',
        mode: 'replace',
        timestamp: 123,
      },
      observation: '表格内容已写入。',
      control: {
        terminateRun: true,
        finalAnswer: '真实写入内容',
      },
    })?.control).toEqual({
      terminateRun: true,
      finalAnswer: '真实写入内容',
    });

    expect(readWriteToTableOutput({
      data: {
        action: 'write_to_table',
        content: '真实写入内容',
        mode: 'replace',
        timestamp: 123,
      },
      observation: '表格内容已写入。',
      control: {
        terminateRun: true,
        finalAnswer: '另一段内容',
      },
    })).toBeNull();
  });

  it('reads the durable replay result without execution control', () => {
    const replayResult = {
      data: {
        action: 'write_to_table',
        content: '已完成',
        mode: 'replace',
        timestamp: 123,
      },
      observation: '表格内容已写入。',
    };

    expect(readWriteToTableReplayResult(replayResult)).toEqual(replayResult);
    expect(readWriteToTableReplayResult({
      ...replayResult,
      control: { terminateRun: true, finalAnswer: '已完成' },
    })).toBeNull();
  });
});
