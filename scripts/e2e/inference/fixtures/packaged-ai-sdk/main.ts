import { app } from 'electron';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from 'linnkit/ports';
import type {
  InferenceCapabilityInvocation,
  ResolvedInferenceAttemptRoute,
} from '../../../../../src/app-hosts/linnya/adapters/inference/definitions/inferenceCapability';
import { createLinnyaAiSdkInferenceCapability } from '../../../../../src/app-hosts/linnya/adapters/inference/features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkInferenceCapability';
import { createLinnyaAiSdkLanguageModelRegistry } from '../../../../../src/app-hosts/linnya/adapters/inference/features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkLanguageModelRegistry';

const resultPath = process.env['LINNYA_AI_SDK_PACKAGED_RESULT_PATH'];
if (!resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('LINNYA_AI_SDK_PACKAGED_RESULT_PATH 必须是绝对路径。');
}

async function publishResult(value: object): Promise<void> {
  const pendingPath = `${resultPath}.${process.pid}.pending`;
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(pendingPath, JSON.stringify(value));
  await rename(pendingPath, resultPath);
}

function startProviderFixture() {
  let requestCount = 0;
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    requestCount += 1;
    authorization = request.headers.authorization;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end([
      `data: ${JSON.stringify({
        id: 'chatcmpl-packaged',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-packaged-fixture',
        choices: [{ index: 0, delta: { content: 'packaged answer' }, finish_reason: null }],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: 'chatcmpl-packaged',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'gpt-packaged-fixture',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      })}\n\n`,
      'data: [DONE]\n\n',
    ].join(''));
  });
  return new Promise<{
    baseUrl: string;
    requestCount: () => number;
    authorization: () => string | undefined;
    close: () => Promise<void>;
  }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('受控 Provider fixture 未取得 TCP 地址。'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requestCount: () => requestCount,
        authorization: () => authorization,
        close: () => new Promise<void>((resolveClose, rejectClose) => {
          server.close(error => error ? rejectClose(error) : resolveClose());
        }),
      });
    });
  });
}

async function collect(stream: AsyncIterable<CanonicalInferenceEvent>) {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function validatePackagedAiSdk(): Promise<object> {
  const fixture = await startProviderFixture();
  try {
    const route = {
      model_id: 'packaged-model',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'packaged-fixture',
      endpoint_model_id: 'gpt-packaged-fixture',
      api_surface: 'openai_chat_completions',
      base_url: fixture.baseUrl,
      auth_profile: 'bearer',
      context_window_tokens: 128000,
      max_output_tokens: 4096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    } satisfies ResolvedInferenceAttemptRoute;
    const request: CanonicalInferenceRequest = {
      model_id: route.model_id,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'packaged fixture' }] }],
      tools: [],
      tool_choice: 'none',
      sampling: { max_output_tokens: 32 },
      invocation: { trace_id: 'trace-packaged', attempt_id: 'attempt-packaged' },
    };
    const invocation: InferenceCapabilityInvocation = {
      request,
      route,
      credential: { profile: 'bearer', secret: 'packaged-secret' },
    };
    const capability = createLinnyaAiSdkInferenceCapability(
      route.capability_id,
      route.api_surface,
      { language_models: createLinnyaAiSdkLanguageModelRegistry() }
    );
    const events = await collect(capability.stream(invocation));
    return {
      success: true,
      packaged: app.isPackaged,
      electron: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
      requestCount: fixture.requestCount(),
      authorization: fixture.authorization(),
      events,
    };
  } finally {
    await fixture.close();
  }
}

app.on('window-all-closed', () => undefined);
void app.whenReady()
  .then(validatePackagedAiSdk)
  .then(publishResult)
  .then(() => app.quit())
  .catch(async (error: unknown) => {
    await publishResult({
      success: false,
      packaged: app.isPackaged,
      error: error instanceof Error ? error.stack : String(error),
    });
    app.exit(1);
  });
