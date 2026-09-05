export interface AiSdkReleasePackage {
  readonly name: string;
  readonly version: string;
  readonly license: 'Apache-2.0' | 'MIT';
  readonly upstream: 'vercel-ai' | 'openrouter' | 'ollama-provider';
}

export interface AiSdkThirdPartyNoticeProblem {
  readonly path: string;
  readonly message: string;
}
