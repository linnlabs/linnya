import { describe, expect, it } from 'vitest';
import { projectWriteToTablePresentation } from './projectWriteToTablePresentation';

describe('projectWriteToTablePresentation', () => {
  it('以共享 write_to_table 输出合同为完成态事实源', () => {
    const projection = projectWriteToTablePresentation({
      sourceToolName: 'write_to_table',
      uiKey: 'write_to_table',
      toolCallId: 'call-1',
      args: { content: '正式写入内容', mode: 'replace', row: 4, col: 2 },
      result: {
        data: {
          action: 'write_to_table',
          content: '正式写入内容',
          mode: 'replace',
          row: 4,
          col: 2,
          timestamp: 1,
        },
        observation: '表格内容已写入。',
      },
      status: 'success',
      phase: 'complete',
    });

    expect(projection.data).toEqual({
      content: '正式写入内容',
      mode: 'replace',
      previewText: '正式写入内容',
    });
    expect(projection.title?.text.key).toBe('tableFill.tool.write');
  });

  it('执行中严格读取参数，并对预览做有界截断', () => {
    const content = 'a'.repeat(121);
    expect(projectWriteToTablePresentation({
      sourceToolName: 'write_to_table',
      uiKey: 'write_to_table',
      toolCallId: 'call-2',
      args: { content },
      result: undefined,
      status: 'loading',
      phase: 'start',
    }).data).toEqual({
      content,
      mode: 'append',
      previewText: `${'a'.repeat(120)}…`,
    });
  });

  it('结果与请求不一致时拒绝 presentation', () => {
    expect(() => projectWriteToTablePresentation({
      sourceToolName: 'write_to_table',
      uiKey: 'write_to_table',
      toolCallId: 'call-3',
      args: { content: 'A', mode: 'append' },
      result: {
        data: {
          action: 'write_to_table',
          content: 'B',
          mode: 'append',
          timestamp: 1,
        },
        observation: 'done',
      },
      status: 'success',
      phase: 'complete',
    })).toThrow('does not match');
  });
});
