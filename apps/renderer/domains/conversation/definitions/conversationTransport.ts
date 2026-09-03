import type { SSETransportEndEvent, SSETransportErrorEvent } from '@linnlabs/linnkit/contracts';

export interface ClientConversationTransportError {
  readonly source: 'client';
  readonly kind: 'http' | 'network' | 'protocol' | 'projection';
  readonly error: Error;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ServerConversationTransportError {
  readonly source: 'server';
  readonly event: SSETransportErrorEvent;
}

export type ConversationTransportError =
  | ClientConversationTransportError
  | ServerConversationTransportError;

/** reader 已释放后交给业务编排的 transport 结果；它不表示 run 业务终态。 */
export type ConversationTransportOutcome =
  | {
      readonly kind: 'ended';
      readonly event: SSETransportEndEvent;
    }
  | {
      readonly kind: 'failed';
      readonly failure: ConversationTransportError;
      readonly event?: SSETransportEndEvent;
    }
  | {
      readonly kind: 'interrupted';
      readonly event?: SSETransportEndEvent;
    };
