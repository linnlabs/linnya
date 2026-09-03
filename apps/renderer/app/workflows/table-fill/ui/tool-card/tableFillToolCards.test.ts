import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { tableFillToolCards } from './tableFillToolCards';

describe('tableFillToolCards', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('由 table-fill contribution 注册 write_to_table，标题只来自 owner presentation', () => {
    const config = tableFillToolCards['write_to_table'];
    const projector = config?.presentation;
    if (!projector) {
      throw new Error('write_to_table must register a presentation projector');
    }
    const projection = projector({
      sourceToolName: 'write_to_table',
      uiKey: 'write_to_table',
      toolCallId: 'write-call-1',
      args: { content: '结果', mode: 'append' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    });

    expect(projection.title).toEqual({
      text: { key: 'tableFill.tool.write', fallback: '写入表格' },
      tag: {
        text: { key: 'tableFill.tool.mode.fill', fallback: '填充' },
        variant: 'info',
      },
    });
    expect(config?.layout).toEqual({ fullWidth: true });
  });
});
