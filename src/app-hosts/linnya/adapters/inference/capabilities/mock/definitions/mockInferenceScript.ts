export type MockInferencePreset = 'content' | 'tool_call';

export interface MockInferenceScript {
  readonly preset: MockInferencePreset;
  readonly delay_ms: number;
  readonly chunk_size: number;
  readonly thought: string;
  readonly content: string;
  readonly tool?: string;
}

export interface MockInferenceScriptCatalog {
  readonly scripts: Readonly<Record<string, MockInferenceScript>>;
}

export interface ResolvedMockInferenceConfig {
  readonly preset: MockInferencePreset;
  readonly delayMs: number;
  readonly chunkSize: number;
  readonly thought: string;
  readonly content: string;
  readonly toolName?: string;
}
