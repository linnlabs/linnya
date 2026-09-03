import { describe, expect, it } from 'vitest';
import { normalizeToolArgs } from './argNormalizer';
import type { ToolParameterSchema } from './toolContracts';

describe('normalizeToolArgs discriminated unions', () => {
  it('按 enum 判别分支规范化嵌套参数', () => {
    const schema: ToolParameterSchema = {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Questions',
          items: {
            type: 'object',
            description: 'Question',
            oneOf: [
              {
                type: 'object',
                description: 'Single question',
                properties: {
                  type: { type: 'string', description: 'Type', enum: ['single'] },
                  required: { type: 'boolean', description: 'Required' },
                },
              },
              {
                type: 'object',
                description: 'Multi question',
                properties: {
                  type: { type: 'string', description: 'Type', enum: ['multi'] },
                  maxSelect: { type: 'integer', description: 'Selection limit' },
                },
              },
            ],
          },
        },
      },
    };

    expect(normalizeToolArgs(schema, {
      questions: JSON.stringify([
        { type: 'single', required: 'true' },
        { type: 'multi', maxSelect: '2' },
      ]),
    })).toEqual({
      questions: [
        { type: 'single', required: true },
        { type: 'multi', maxSelect: 2 },
      ],
    });
  });
});
