import Database from 'better-sqlite3';
import type { RoutedRuntimeEvent, RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type {
  CanonicalInferencePort,
  CanonicalInferenceRequest,
  LlmInputMaterializationAttempt,
  ResolvedLlmInputMessage,
} from '@linnlabs/linnkit/ports';
import { llm } from '@linnlabs/linnkit/runtime-kernel';
import { expect } from 'vitest';
import { findLanguageInferenceRouteProfileForRoute } from '@app/schemas/model-inference';

import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { projectCanonicalMessages } from '@linnlabs/linnkit-provider-ai-sdk/conformance';
import type { AiSdkInferenceRoute } from '@linnlabs/linnkit-provider-ai-sdk';

export type ToolImageProviderSurface = 'openai_responses' | 'anthropic_messages';

export function createToolImageModelCatalog(modelId: string): llm.ModelCatalogLike {
  const model: llm.ModelCatalogEntry = {
    id: modelId,
    enabled: true,
    api_key: 'test-key',
    capabilities: ['chat', 'image_input'],
    ui_visibility: ['chat'],
    adapter_input_support: { user_image: false, tool_result_image: true },
    inference_route: {
      context_window_tokens: 32_000,
      max_output_tokens: 2_048,
    },
  };
  return {
    getModelById: id => id === model.id ? model : undefined,
    getModelsByCapability: capability => model.capabilities?.includes(capability) ? [model] : [],
    getModelsByUIVisibility: visibility => model.ui_visibility?.includes(visibility) ? [model] : [],
  };
}

export function createToolImageWorkspaceDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      media_type TEXT,
      size_bytes INTEGER,
      width_px INTEGER,
      height_px INTEGER,
      sha256 TEXT,
      storage_status TEXT NOT NULL,
      local_path TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE project_asset_links (
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'resource',
      origin TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, asset_id)
    );
  `);
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  return db;
}

type SuccessfulToolOutput = Extract<RoutedRuntimeEvent, { type: 'tool_output' }>;

export function findSuccessfulToolOutput(
  events: readonly (RoutedRuntimeEvent | RuntimeEvent)[],
): SuccessfulToolOutput {
  const event = events.find(
    (candidate): candidate is SuccessfulToolOutput => (
      candidate.type === 'tool_output' && candidate.status === 'success'
    ),
  );
  if (!event) throw new Error('expected successful image-producing tool output');
  return event;
}

export async function assertToolImageAiSdkInput(params: {
  readonly surface: ToolImageProviderSurface;
  readonly modelId: string;
  readonly inputMessages: LlmInputMaterializationAttempt['messages'];
  readonly messages: readonly ResolvedLlmInputMessage[];
  readonly admissionEvidence: LlmInputMaterializationAttempt['admissionEvidence'];
  readonly expectedBase64: string;
}): Promise<void> {
  let request: CanonicalInferenceRequest | undefined;
  const capturePort: CanonicalInferencePort = {
    async *stream(input) {
      request = input;
      yield { type: 'start', model_id: input.model_id, attempt_id: input.invocation.attempt_id };
      yield { type: 'answer_delta', text: 'captured' };
      yield { type: 'finish', reason: 'stop' };
    },
  };
  await new llm.LlmCaller({
    modelCatalog: createToolImageModelCatalog(params.modelId),
    inferencePort: capturePort,
    llmInputMaterializer: {
      materialize: async () => [...params.messages],
    },
  }).call(
    params.modelId,
    [...params.inputMessages],
    {},
    undefined,
    { imageInputAdmissionEvidence: params.admissionEvidence },
  );
  if (!request) {
    throw new Error('Expected LlmCaller to publish one canonical inference request.');
  }
  const capturedRequest: CanonicalInferenceRequest = request;
  const route: AiSdkInferenceRoute = {
    model_id: params.modelId,
    capability_id: params.surface === 'openai_responses'
      ? 'ai-sdk:openai-responses'
      : 'ai-sdk:anthropic-messages',
    endpoint_id: params.surface === 'openai_responses' ? 'openai' : 'anthropic',
    endpoint_model_id: 'provider-model',
    surface: params.surface,
    request_profile: findLanguageInferenceRouteProfileForRoute({
      api_surface: params.surface,
      capability_id:
        params.surface === 'openai_responses'
          ? 'ai-sdk:openai-responses'
          : 'ai-sdk:anthropic-messages',
    }).id,
    base_url: 'https://fixture.invalid/v1',
  };
  const projected = projectCanonicalMessages(capturedRequest.messages, route);
  const toolMessage = projected.find(message => message.role === 'tool');
  if (!toolMessage || toolMessage.role !== 'tool') {
    throw new Error('Expected projected messages to contain a tool result.');
  }
  const toolResult = toolMessage.content.find(part => part.type === 'tool-result');
  if (!toolResult || toolResult.output.type !== 'content') {
    throw new Error('Expected projected tool output to contain image content.');
  }
  const file = toolResult.output.value.find(part => part.type === 'file');
  if (!file || file.data.type !== 'data') {
    throw new Error('Expected projected tool output to contain inline image bytes.');
  }

  const actualBytes = typeof file.data.data === 'string'
    ? Buffer.from(file.data.data, 'base64')
    : file.data.data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(file.data.data))
      : Buffer.from(file.data.data);
  expect(file.mediaType).toBe('image/png');
  expect(actualBytes).toEqual(Buffer.from(params.expectedBase64, 'base64'));
}
