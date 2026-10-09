import type { ToolLocalizedTextDescriptor } from '../../../ui/tools/types';

export interface ResearchRunProgressItem {
  readonly subrunId: string;
  readonly label: ToolLocalizedTextDescriptor;
  /** 只有 Host 正式保存的 artifact 才有链接；不由 trace 文本推测。 */
  readonly artifactPath?: string;
}

export type ResearchRunPresentationData = {
  readonly kind: 'lifecycle';
  readonly items: readonly ResearchRunProgressItem[];
} | {
  readonly kind: 'result';
  readonly outcome: 'delivered' | 'inputs_changed';
  readonly items: readonly ResearchRunProgressItem[];
  readonly modelId: string;
  readonly changedPaths: readonly string[];
};
