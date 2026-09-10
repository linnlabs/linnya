import express, { type NextFunction, type Request, type Response, Router } from 'express';
import {
  CONVERSATION_CONTROL_PROTOCOL_VERSION,
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  ConversationControlCommandRequestSchema,
  ConversationControlCommandResponseSchema,
  ConversationControlErrorResponseSchema,
  ConversationControlHandshakeRequestSchema,
  ConversationControlHandshakeResponseSchema,
  type ConversationControlCommandRequest,
  type ConversationControlErrorCode,
  type ConversationControlErrorResponse,
} from '@app/schemas';
import {
  ConversationControlError,
  type ConversationControlUseCase,
} from 'src/app-hosts/linnya/application/conversation-control';
import {
  CONVERSATION_CONTROL_MAX_MESSAGE_CHARS,
  CONVERSATION_CONTROL_MAX_PAGE_SIZE,
  CONVERSATION_CONTROL_MAX_REQUEST_BYTES,
  CONVERSATION_CONTROL_MAX_WATCH_TIMEOUT_MS,
  CONVERSATION_CONTROL_MIN_WATCH_INTERVAL_MS,
  LINNYA_CONVERSATION_CONTROL_CAPABILITIES,
  type ConversationControlBridgeDiagnosticPort,
} from './definitions/conversationControlBridge';

interface CreateConversationControlBridgeRouterOptions {
  readonly useCase: ConversationControlUseCase;
  readonly appInstanceId: string;
  readonly appVersion: string;
  readonly auditAvailable?: boolean;
  readonly diagnostics: ConversationControlBridgeDiagnosticPort;
}

function errorStatus(code: ConversationControlErrorCode): number {
  switch (code) {
    case 'invalid_request': return 400;
    case 'unauthorized': return 401;
    case 'run_not_found': return 404;
    case 'app_not_running':
    case 'stale_connection':
    case 'protocol_incompatible':
    case 'capability_unavailable':
    case 'conversation_busy':
    case 'no_active_run':
    case 'run_mismatch':
    case 'interaction_mismatch':
    case 'result_unavailable':
    case 'unsupported_runtime_state':
      return 409;
    case 'transport_failure': return 502;
    case 'internal_error': return 500;
  }
}

function projectError(
  error: ConversationControlError,
  command?: ConversationControlCommandRequest['command'],
): ConversationControlErrorResponse {
  return ConversationControlErrorResponseSchema.parse({
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    ok: false,
    command,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  });
}

function sendInvalidRequest(res: Response, message: string): void {
  const response = projectError(new ConversationControlError('invalid_request', message));
  res.status(400).json(response);
}

export function createConversationControlBridgeRouter(
  options: CreateConversationControlBridgeRouterOptions,
): Router {
  const router = Router();
  router.use(express.json({ limit: CONVERSATION_CONTROL_MAX_REQUEST_BYTES, strict: true }));

  router.post('/handshake', (req: Request, res: Response) => {
    const parsed = ConversationControlHandshakeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalidRequest(res, 'Invalid conversation-control handshake');
      return;
    }
    const response = ConversationControlHandshakeResponseSchema.parse({
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
      app_instance_id: options.appInstanceId,
      app_version: options.appVersion,
      capabilities: LINNYA_CONVERSATION_CONTROL_CAPABILITIES.filter(
        capability => capability !== 'audit' || options.auditAvailable !== false,
      ),
      limits: {
        max_request_bytes: CONVERSATION_CONTROL_MAX_REQUEST_BYTES,
        max_message_chars: CONVERSATION_CONTROL_MAX_MESSAGE_CHARS,
        max_page_size: CONVERSATION_CONTROL_MAX_PAGE_SIZE,
        min_watch_interval_ms: CONVERSATION_CONTROL_MIN_WATCH_INTERVAL_MS,
        max_watch_timeout_ms: CONVERSATION_CONTROL_MAX_WATCH_TIMEOUT_MS,
      },
    });
    res.json(response);
  });

  router.post('/commands', async (req: Request, res: Response) => {
    const parsed = ConversationControlCommandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalidRequest(res, 'Invalid conversation-control command');
      return;
    }

    try {
      const response = ConversationControlCommandResponseSchema.parse(
        await options.useCase.execute(parsed.data),
      );
      res.json(response);
    } catch (error: unknown) {
      if (error instanceof ConversationControlError) {
        res.status(errorStatus(error.code)).json(projectError(error, parsed.data.command));
        return;
      }
      options.diagnostics.error('Conversation-control command failed unexpectedly', {
        command: parsed.data.command,
        error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown_error',
      });
      const response = projectError(
        new ConversationControlError('internal_error', 'Conversation-control command failed'),
        parsed.data.command,
      );
      res.status(500).json(response);
    }
  });

  // body parser 的语法错误与尺寸错误也必须保持稳定 JSON，不能落到 Express HTML 错误页。
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    options.diagnostics.error('Conversation-control request body was rejected', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown_error',
    });
    sendInvalidRequest(res, 'Invalid conversation-control request body');
  });

  return router;
}
