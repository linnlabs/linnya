import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  ConversationControlErrorResponseSchema,
  type ConversationControlErrorCode,
  type ConversationControlErrorResponse,
} from '@app/schemas';
import {
  LINNYA_CLI_EXIT,
  LinnyaCliError,
} from '../definitions/cli';

export function projectCliError(error: unknown): ConversationControlErrorResponse {
  const failure = error instanceof LinnyaCliError
    ? error
    : new LinnyaCliError(
        'internal_error',
        error instanceof Error ? error.message : 'Unexpected Linnya CLI failure',
      );
  return ConversationControlErrorResponseSchema.parse({
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    ok: false,
    command: failure.command,
    error: {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    },
  });
}

export function exitCodeForError(code: ConversationControlErrorCode): number {
  switch (code) {
    case 'invalid_request': return LINNYA_CLI_EXIT.usage;
    case 'app_not_running':
    case 'stale_connection':
    case 'transport_failure':
      return LINNYA_CLI_EXIT.connection;
    case 'protocol_incompatible': return LINNYA_CLI_EXIT.protocol;
    case 'unauthorized': return LINNYA_CLI_EXIT.unauthorized;
    case 'conversation_busy':
    case 'no_active_run':
    case 'run_not_found':
    case 'run_mismatch':
    case 'interaction_mismatch':
    case 'result_unavailable':
    case 'unsupported_runtime_state':
      return LINNYA_CLI_EXIT.conflict;
    case 'capability_unavailable': return LINNYA_CLI_EXIT.unavailable;
    case 'internal_error': return LINNYA_CLI_EXIT.internal;
  }
}
