import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { createProfileCredentialStorage } from '../../adapters/credential-storage/createProfileCredentialStorage';
import { FileProviderAccountRegistry } from '../../../../domains/provider-account';
import type { ModelConfig } from '../../../../domains/model-catalog';

it('独立知识库 Worker 从同一 profile 恢复端点 Key 与 OAuth，任务消息不携带凭据', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-worker-credentials-'));
  const roots = {
    developmentRoot: process.cwd(),
    appDataRoot: path.join(root, 'app'),
    profileRoot: path.join(root, 'profile'),
    workspaceRoot: path.join(root, 'workspace'),
    workspaceRootIsCustom: true,
  };
  let worker: Worker | undefined;
  try {
    const storage = createProfileCredentialStorage(roots);
    await storage.update('model-endpoints', new Map([['worker-key-id', 'worker-key']]));
    const accounts = new FileProviderAccountRegistry();
    accounts.installCredentialStorage(storage);
    await accounts.putOAuthCredential(
      {
        id: 'chatgpt-subscription',
        provider_connection_definition_id: 'openai-chatgpt-subscription',
        auth_method: 'oauth_pkce',
      },
      {
        access_token: 'worker-token',
        refresh_token: 'worker-refresh',
        expires_at: Date.now() + 86_400_000,
        account_id: 'worker-account',
      }
    );
    const model: ModelConfig = {
      id: 'worker-model',
      model_name: 'fixture-model',
      display_name: 'Worker',
      description: '',
      catalog_source: 'user',
      billing_mode: 'byok',
      capabilities: ['chat'],
      ui_visibility: [],
      custom_provider_name: 'Worker',
      inference_endpoint_id: 'worker-endpoint',
      inference_route: {
        api_surface: 'openai_chat_completions',
        capability_id: 'ai-sdk:openai-chat',
        endpoint_id: 'fixture',
        endpoint_model_id: 'fixture-model',
        base_url: 'https://fixture.invalid/v1',
        auth_profile: 'bearer',
        context_window_tokens: 32768,
        max_output_tokens: 4096,
        input_support: { user_image: false, tool_result_image: false },
        usage: { response_usage: 'provider_reported_optional' },
        continuation: { tool_replay: 'required' },
      },
    };
    const modelsRoot = path.join(roots.workspaceRoot, 'Models');
    await fs.mkdir(modelsRoot, { recursive: true });
    await fs.writeFile(
      path.join(modelsRoot, 'user_models.json'),
      JSON.stringify({
        version: '5.0.0',
        last_updated: '2026-10-31T00:00:00.000Z',
        models: [
          model,
          { ...model, id: 'worker-env-model', inference_endpoint_id: 'worker-env-endpoint' },
        ],
        inference_endpoints: [
          {
            id: 'worker-endpoint',
            route_profile_id: 'openai_chat',
            endpoint_id: 'fixture',
            base_url: 'https://fixture.invalid/v1',
            auth_profile: 'bearer',
            credential_reference: { kind: 'stored_secret', credential_id: 'worker-key-id' },
          },
          {
            id: 'worker-env-endpoint',
            route_profile_id: 'openai_chat',
            endpoint_id: 'fixture',
            base_url: 'https://fixture.invalid/v1',
            auth_profile: 'bearer',
            credential_reference: {
              kind: 'environment_variable',
              environment_variable: 'WORKER_FIXTURE_API_KEY',
            },
          },
        ],
        custom_api_groups: [
          { name: 'Worker', inference_endpoint_ids: ['worker-endpoint', 'worker-env-endpoint'] },
        ],
      })
    );
    worker = new Worker(new URL('./fixtures/modelCredentials.worker.cjs', import.meta.url), {
      workerData: roots,
      env: {
        ...process.env,
        WORKER_FIXTURE_API_KEY: 'worker-env-secret',
        MODEL_REGISTRY_DEFAULTS_PATH: path.resolve(
          'src/domains/model-catalog/features/default-catalog/assets/default_models.json'
        ),
      },
    });
    const running = worker;
    const result = await new Promise<unknown>((resolve, reject) => {
      running.once('message', resolve);
      running.once('error', reject);
      running.once('exit', code => {
        if (code !== 0) reject(new Error(`Worker exited: ${code}`));
      });
    });
    expect(result).toEqual({ keyMatches: true, oauthMatches: true, environmentMatches: true });
    expect(await fs.readdir(roots.workspaceRoot)).toEqual(['Models']);
    expect(
      await fs.readFile(
        path.join(roots.profileRoot, 'AIService', 'config', 'credentials.json'),
        'utf8'
      )
    ).not.toContain('worker-env-secret');
  } finally {
    await worker?.terminate();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
