import { describe, expect, it } from 'vitest';
import { assertToolParameterSchema, ToolParameterSchemaError } from './assertToolParameterSchema';

describe('assertToolParameterSchema', () => {
  it('接受可无损重建的 object/array/oneOf 工具合同', () => {
    expect(() =>
      assertToolParameterSchema({
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: '问题列表',
            minItems: 1,
            items: {
              type: 'object',
              description: '问题',
              oneOf: [
                {
                  type: 'object',
                  description: '单选题',
                  properties: {
                    type: { type: 'string', description: '题型', enum: ['single'] },
                    prompt: { type: 'string', description: '问题正文', minLength: 1 },
                  },
                  required: ['type', 'prompt'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  description: '文本题',
                  properties: {
                    type: { type: 'string', description: '题型', enum: ['text'] },
                  },
                  required: ['type'],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
        required: ['questions'],
        additionalProperties: false,
      })
    ).not.toThrow();
  });

  it('拒绝 required 引用未声明字段', () => {
    expect(() =>
      assertToolParameterSchema({
        type: 'object',
        properties: {},
        required: ['missing'],
      })
    ).toThrowError(new ToolParameterSchemaError('$', 'required 引用了未声明字段: missing'));
  });

  it('拒绝没有 items 的宽 array，避免 Provider 边界自行猜测', () => {
    expect(() =>
      assertToolParameterSchema({
        type: 'object',
        properties: {
          values: {
            type: 'array',
            description: '值列表',
          },
        },
      })
    ).toThrow(/array 必须显式声明 items/);
  });

  it('拒绝与 type 不匹配的约束关键字', () => {
    expect(() =>
      assertToolParameterSchema({
        type: 'object',
        properties: {
          count: {
            type: 'integer',
            description: '数量',
            minLength: 1,
          },
        },
      })
    ).toThrow(/minLength\/maxLength 只能用于 string/);
  });
});
