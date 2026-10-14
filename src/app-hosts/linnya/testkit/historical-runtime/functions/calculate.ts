import { z } from 'zod';
import { BaseTool, type ToolParameterSchema } from 'src/tools/types';

const argumentsSchema = z
  .object({
    operation: z.enum([
      'add',
      'subtract',
      'multiply',
      'divide',
      'mean',
      'growth_percent',
      'quantile',
    ]),
    values: z.array(z.number().finite()).min(1).max(1000),
    probability: z.number().min(0).max(1).optional(),
  })
  .strict();

export function calculate(input: unknown): number {
  const { operation, values, probability } = argumentsSchema.parse(input);
  let result: number;
  switch (operation) {
    case 'add':
      result = values.reduce((a, b) => a + b, 0);
      break;
    case 'subtract':
      result = values.slice(1).reduce((a, b) => a - b, values[0]);
      break;
    case 'multiply':
      result = values.reduce((a, b) => a * b, 1);
      break;
    case 'divide':
      if (values.length !== 2 || values[1] === 0)
        throw new Error('divide requires [numerator, nonzero denominator]');
      result = values[0] / values[1];
      break;
    case 'growth_percent':
      if (values.length !== 2 || values[1] === 0)
        throw new Error('growth_percent requires [current, nonzero previous]');
      result = (values[0] / values[1] - 1) * 100;
      break;
    case 'mean':
      result = values.reduce((a, b) => a + b, 0) / values.length;
      break;
    case 'quantile': {
      if (probability === undefined) throw new Error('quantile requires probability');
      const sorted = [...values].sort((a, b) => a - b);
      const h = (sorted.length - 1) * probability;
      const lower = Math.floor(h);
      result =
        sorted[lower] +
        (h - lower) * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]);
      break;
    }
  }
  if (!Number.isFinite(result)) throw new Error('Calculation produced a nonfinite result');
  return result;
}

/** 实验专用数值运算，无源码解释器、宿主读写或网络能力。 */
export class HistoricalCalculateTool extends BaseTool {
  readonly name = 'calculate';
  readonly description =
    'Execute arithmetic on supplied numbers. No code, files or network. growth_percent uses [current, previous]; quantile uses type 7 linear interpolation.';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      operation: {
        type: 'string',
        description: 'Operation to execute.',
        enum: ['add', 'subtract', 'multiply', 'divide', 'mean', 'growth_percent', 'quantile'],
      },
      values: {
        type: 'array',
        description: 'Finite numeric inputs in order.',
        items: { type: 'number', description: 'A finite number.' },
        minItems: 1,
        maxItems: 1000,
      },
      probability: {
        type: 'number',
        description: 'Quantile probability from 0 to 1.',
        minimum: 0,
        maximum: 1,
      },
    },
    required: ['operation', 'values'],
  };
  override validateArguments(input: Record<string, unknown>) {
    const parsed = argumentsSchema.safeParse(input);
    return parsed.success ? { success: true } : { success: false, error: parsed.error.message };
  }
  async run(input: Record<string, unknown>): Promise<string> {
    const result = calculate(input);
    return JSON.stringify({
      data: { ...argumentsSchema.parse(input), result },
      observation: `Executed calculation: ${JSON.stringify(input)} = ${result}`,
    });
  }
}
