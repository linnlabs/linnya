export interface BenchmarkInputDefinition {
  readonly key: string;
  readonly label: string;
  readonly kind: 'absolute_file';
  readonly required: true;
}

export interface BenchmarkHumanReviewCriterion {
  readonly id: string;
  readonly label: string;
  readonly guidance: string;
}

export interface BenchmarkCaseDefinition {
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly agentId: string;
  readonly reasoningEffort: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  readonly timeoutMs: number;
  readonly promptTemplate: string;
  readonly inputs: readonly BenchmarkInputDefinition[];
  readonly interaction: {
    readonly awaitingUser: 'approve' | 'manual';
    readonly maxResponses: number;
  };
  readonly artifactExpectation: string;
  readonly humanReview: readonly BenchmarkHumanReviewCriterion[];
}

export interface ResolvedBenchmarkCase {
  readonly definition: BenchmarkCaseDefinition;
  readonly prompt: string;
  readonly inputs: Readonly<Record<string, string>>;
}
