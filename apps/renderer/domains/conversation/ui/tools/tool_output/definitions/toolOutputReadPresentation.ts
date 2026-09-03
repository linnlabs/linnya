import type { ToolOutputReadData } from '@app/schemas';

export type ToolOutputReadPresentationData =
  | {
      readonly kind: 'lifecycle';
    }
  | {
      readonly kind: 'snapshot';
      readonly result: ToolOutputReadData;
      readonly lineRange: string;
    };
