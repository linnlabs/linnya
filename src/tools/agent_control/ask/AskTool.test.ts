import { describe, expect, it, vi } from 'vitest';
import { AskResultSchema } from '@app/schemas';
import { AskTool } from './AskTool';

function findQuestionBranch(tool: AskTool, type: 'single' | 'multi' | 'text') {
  return tool.parameters.properties.questions.items?.oneOf?.find(
    branch => branch.properties?.type?.enum?.includes(type) === true
  );
}

describe('ask live contract', () => {
  it('模型 schema 使用封闭的题型判别联合', () => {
    const tool = new AskTool();
    const single = findQuestionBranch(tool, 'single');
    const multi = findQuestionBranch(tool, 'multi');
    const text = findQuestionBranch(tool, 'text');

    expect(tool.parameters).toMatchObject({
      additionalProperties: false,
      properties: {
        questions: { minItems: 1, maxItems: 10 },
      },
    });
    expect(tool.parameters.properties.questions.items?.oneOf).toHaveLength(3);
    expect(single).toMatchObject({
      required: ['id', 'type', 'question', 'options'],
      additionalProperties: false,
    });
    expect(single?.properties).not.toHaveProperty('maxSelect');
    expect(multi?.properties?.maxSelect).toMatchObject({
      type: 'integer',
      minimum: 2,
      maximum: 7,
    });
    expect(text).toMatchObject({
      required: ['id', 'type', 'question'],
      additionalProperties: false,
    });
    expect(text?.properties).not.toHaveProperty('options');
    expect(text?.properties).not.toHaveProperty('allowOther');
    expect(text?.properties).not.toHaveProperty('maxSelect');
  });

  it('审计中的 single + maxSelect 错误返回精确问题路径', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      new AskTool().run(
        {
          questions: [
            {
              id: 'audience',
              type: 'multi',
              question: '主要受众是谁？',
              options: [
                { id: 'management', label: '企业管理层' },
                { id: 'employees', label: '内部员工' },
              ],
              maxSelect: 2,
            },
            {
              id: 'page_count',
              type: 'single',
              question: '希望控制在多少页？',
              options: [{ id: '12', label: '约12页' }],
              maxSelect: 2,
            },
            {
              id: 'style',
              type: 'single',
              question: '偏好的设计风格是？',
              options: [{ id: 'business', label: '现代商务' }],
              maxSelect: 2,
            },
          ],
        },
        {}
      )
    ).rejects.toThrow(
      'questions[1].maxSelect: field is not allowed for this question type; '
      + 'questions[2].maxSelect: field is not allowed for this question type'
    );
  });

  it('运行边界拒绝 maxSelect=1 的伪多选问题并返回字段路径', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      new AskTool().run(
        {
          questions: [
            {
              id: 'q_multi',
              type: 'multi',
              question: '请选择交付格式',
              options: [
                { id: 'document', label: '文档' },
                { id: 'slides', label: '演示稿' },
              ],
              maxSelect: 1,
            },
          ],
        },
        {}
      )
    ).rejects.toThrow(/questions\[0\]\.maxSelect: Number must be greater than or equal to 2/);
  });

  it('单选、多选和文本题通过同一 live 合同创建问卷', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const output = await new AskTool().run(
      {
        title: '交付偏好',
        questions: [
          {
            id: 'format',
            type: 'single',
            question: '选择交付格式',
            options: [{ id: 'slides', label: '演示稿' }],
          },
          {
            id: 'audience',
            type: 'multi',
            question: '选择受众',
            options: [
              { id: 'management', label: '管理层' },
              { id: 'employees', label: '员工' },
            ],
            maxSelect: 2,
          },
          {
            id: 'notes',
            type: 'text',
            question: '补充说明',
          },
        ],
      },
      {}
    );
    const result = AskResultSchema.parse(JSON.parse(output));

    expect(result.data.questions.map(question => question.type)).toEqual([
      'single',
      'multi',
      'text',
    ]);
    expect(result.control).toMatchObject({
      requireUser: true,
      resumeStrategy: 'continue',
    });
  });
});
