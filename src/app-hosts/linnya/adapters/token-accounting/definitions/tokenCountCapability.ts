import type { TokenRoute } from 'linnkit/contracts';
import type { LlmRequestMessage } from 'linnkit/ports';
import type { ModelRequestCredential } from '../../model-request-auth';

export type TokenCountSurface =
  | 'anthropic_messages_count_tokens'
  | 'gemini_generate_content_count_tokens'
  | 'zai_tokenizer';

export interface TokenCountCapabilityInput {
  readonly route: TokenRoute;
  readonly credential?: ModelRequestCredential;
  readonly baseURL: string;
  readonly endpointModelId: string;
  readonly messages: readonly LlmRequestMessage[];
  readonly tools?: unknown;
}

export interface TokenCountHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface TokenCountCapability {
  readonly surface: TokenCountSurface;
  buildRequest(input: TokenCountCapabilityInput): TokenCountHttpRequest;
  readInputTokens(raw: unknown): number;
}
