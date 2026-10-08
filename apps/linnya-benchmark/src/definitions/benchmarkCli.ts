import type { StageId } from '../features/research-workflow/definitions/researchWorkflow';
export type BenchmarkCliInvocation =
  | { readonly kind: 'help' }
  | { readonly kind: 'list'; readonly pretty: boolean }
  | {
      readonly kind: 'research-workflow';
      readonly manifestFile: string;
      readonly output: string;
      readonly resumeStage?: StageId;
      readonly stopAfterStage?: StageId;
    }
  | {
      readonly kind: 'run';
      readonly caseId: string;
      readonly projectId: string;
      readonly inputs: Readonly<Record<string, string>>;
      readonly outputRoot?: string;
      readonly modelId?: string;
      readonly reasoningEffort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      readonly pretty: boolean;
    };

export interface BenchmarkCliIo {
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
}

export class BenchmarkUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkUsageError';
  }
}
