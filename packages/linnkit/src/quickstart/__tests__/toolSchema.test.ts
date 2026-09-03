import { describe, expect, it } from 'vitest';
import type { ToolParameterSchema } from '../../runtime-kernel';
import { serializeToolParameters } from '../toolSchema';

describe('serializeToolParameters', () => {
  it('完整保留判别联合和数组边界', () => {
    const schema: ToolParameterSchema = {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Questions',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            description: 'Question',
            oneOf: [
              {
                type: 'object',
                description: 'Single question',
                properties: {
                  type: { type: 'string', description: 'Type', enum: ['single'] },
                },
                required: ['type'],
                additionalProperties: false,
              },
              {
                type: 'object',
                description: 'Multi question',
                properties: {
                  type: { type: 'string', description: 'Type', enum: ['multi'] },
                  maxSelect: {
                    type: 'integer',
                    description: 'Selection limit',
                    minimum: 2,
                    maximum: 7,
                  },
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
    };

    expect(serializeToolParameters(schema)).toEqual(schema);
  });
});
