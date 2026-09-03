import { describe, expect, it } from 'vitest';
import { readWriteToTableOutput } from '@app/schemas';
import { createToolContextFixture } from 'linnkit/testkit';
import { WriteToTableTool } from '../WriteToTableTool';

describe('WriteToTableTool', () => {
  it('把写入内容作为 child final answer，并在一次成功写入后结束当前 run', async () => {
    const output = await new WriteToTableTool().run(
      { content: '企业知识库，让智慧触手可及。', mode: 'replace' },
      createToolContextFixture(),
    );

    expect(readWriteToTableOutput(output)).toMatchObject({
      action: 'write_to_table',
      content: '企业知识库，让智慧触手可及。',
      mode: 'replace',
      control: {
        terminateRun: true,
        finalAnswer: '企业知识库，让智慧触手可及。',
        reason: 'write_to_table completed',
      },
    });
  });
});
