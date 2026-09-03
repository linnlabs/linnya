import { describe, expect, it } from 'vitest';
import { createToolContextFixture } from 'linnkit/testkit';
import { WriteReportTool } from '../writeReport';

describe('write_report 最终交付合同', () => {
  it('把完整报告作为唯一 final answer，并在工具执行后终止当前 run', async () => {
    const report = '结论 [@Abc234]';
    const output = await new WriteReportTool().run(
      { report },
      createToolContextFixture(),
    );
    const parsed: unknown = JSON.parse(output);

    expect(parsed).toEqual({
      data: { report },
      observation: `write_report 已接收报告正文（长度=${report.length} chars）。`,
      control: {
        finalAnswer: report,
        terminateRun: true,
        reason: 'write_report: terminate after tool output',
      },
    });
  });

  it('拒绝空报告，避免发布空 final answer', async () => {
    await expect(new WriteReportTool().run(
      { report: '   ' },
      createToolContextFixture(),
    )).rejects.toThrow('write_report: report is required');
  });
});
