import {
  CONVERSATION_CONTROL_BRIDGE_PATH,
  CONVERSATION_CONTROL_PROTOCOL_VERSION,
  CONVERSATION_CONTROL_TOKEN_HEADER,
  ConversationControlCommandResponseSchema,
  ConversationControlErrorResponseSchema,
  ConversationControlHandshakeResponseSchema,
  type ConversationControlCommandRequest,
  type ConversationControlConnectionDescriptor,
  type ConversationControlErrorResponse,
  type ConversationControlHandshakeResponse,
} from '@app/schemas';
import {
  LINNYA_CLI_VERSION,
  LINNYA_CLI_BUILD_ID,
  LinnyaCliError,
  requireCapability,
  type ConversationControlClient,
  type ConversationControlSuccessResponse,
} from '../definitions/cli';

interface HttpConversationControlClientOptions {
  readonly descriptor: ConversationControlConnectionDescriptor;
  readonly fetchImplementation?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw new LinnyaCliError(
      'transport_failure',
      'Linnya App returned a non-JSON conversation-control response',
      true,
    );
  }
}

function throwWireError(response: ConversationControlErrorResponse): never {
  throw new LinnyaCliError(
    response.error.code,
    response.error.message,
    response.error.retryable,
    response.command,
  );
}

async function postJson(
  options: HttpConversationControlClientOptions,
  path: '/handshake' | '/commands',
  body: unknown,
  timeoutMs = options.requestTimeoutMs ?? 5000,
  command?: ConversationControlCommandRequest['command'],
): Promise<{ readonly response: Response; readonly body: unknown }> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort('conversation-control request timeout'),
    timeoutMs,
  );
  try {
    const response = await fetchImplementation(
      `http://${options.descriptor.host}:${options.descriptor.port}${CONVERSATION_CONTROL_BRIDGE_PATH}${path}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CONVERSATION_CONTROL_TOKEN_HEADER]: options.descriptor.session_token,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    return { response, body: await readResponseBody(response) };
  } catch (error: unknown) {
    if (error instanceof LinnyaCliError && !controller.signal.aborted) throw error;
    throw new LinnyaCliError(
      controller.signal.aborted ? 'transport_failure' : 'stale_connection',
      controller.signal.aborted
        ? `Linnya ${command ?? 'handshake'} response timed out after ${timeoutMs}ms; the App may still be processing it. Check the exact run before retrying a mutation.`
        : 'Cannot reach the Linnya App conversation-control bridge. Check that the App is running; use linnya doctor to verify the connection.',
      true,
      command,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function handshake(
  options: HttpConversationControlClientOptions,
): Promise<ConversationControlHandshakeResponse> {
  const result = await postJson(options, '/handshake', {
    protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
    client_name: 'linnya-cli',
    client_version: `${LINNYA_CLI_VERSION}+${LINNYA_CLI_BUILD_ID}`,
  });
  const wireError = ConversationControlErrorResponseSchema.safeParse(result.body);
  if (wireError.success) throwWireError(wireError.data);
  const parsed = ConversationControlHandshakeResponseSchema.safeParse(result.body);
  if (!result.response.ok || !parsed.success) {
    throw new LinnyaCliError(
      'protocol_incompatible',
      `Linnya App handshake does not match CLI ${LINNYA_CLI_VERSION} (${LINNYA_CLI_BUILD_ID}), protocol ${CONVERSATION_CONTROL_PROTOCOL_VERSION}. Rebuild with pnpm build:linnya-cli and verify the running App version.`,
    );
  }
  if (parsed.data.app_instance_id !== options.descriptor.app_instance_id) {
    throw new LinnyaCliError(
      'stale_connection',
      'Linnya App instance changed while the CLI was connecting',
      true,
    );
  }
  return parsed.data;
}

export async function createHttpConversationControlClient(
  options: HttpConversationControlClientOptions,
): Promise<ConversationControlClient> {
  const connectedHandshake = await handshake(options);
  return {
    descriptor: options.descriptor,
    handshake: connectedHandshake,
    async execute(request, requestOptions): Promise<ConversationControlSuccessResponse> {
      requireCapability(connectedHandshake.capabilities, request.command);
      const encoded = JSON.stringify(request);
      if (Buffer.byteLength(encoded, 'utf8') > connectedHandshake.limits.max_request_bytes) {
        throw new LinnyaCliError(
          'invalid_request',
          'Command exceeds the running App request size limit',
          false,
          request.command,
        );
      }
      const isMutation = request.command === 'send' || request.command === 'respond'
        || request.command === 'stop'
        || (request.command === 'workspace_tools' && request.action === 'call');
      const result = await postJson(options, '/commands', request,
        requestOptions?.timeoutMs ?? options.requestTimeoutMs ?? (isMutation ? 60_000 : 5000),
        request.command);
      const parsed = ConversationControlCommandResponseSchema.safeParse(result.body);
      if (!parsed.success) {
        throw new LinnyaCliError(
          'protocol_incompatible',
          'Linnya App command response does not match this CLI protocol',
          false,
          request.command,
        );
      }
      if (!parsed.data.ok) throwWireError(parsed.data);
      if (parsed.data.command !== request.command) {
        throw new LinnyaCliError('protocol_incompatible',
          `Expected ${request.command} response, received ${parsed.data.command}`, false, request.command);
      }
      if (!result.response.ok) {
        throw new LinnyaCliError(
          'transport_failure',
          `Linnya App returned HTTP ${result.response.status} for a successful payload`,
          true,
          request.command,
        );
      }
      return parsed.data;
    },
  };
}
