export interface AiSdkReleasePackage {
  readonly name: string;
  readonly version: string;
  readonly license: 'Apache-2.0';
  readonly upstream: 'vercel-ai' | 'openrouter';
}

export interface AiSdkThirdPartyNoticeProblem {
  readonly path: string;
  readonly message: string;
}
