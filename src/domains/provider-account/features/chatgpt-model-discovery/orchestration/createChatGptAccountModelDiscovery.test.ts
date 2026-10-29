import { describe, expect, it, vi } from 'vitest';

import { CHATGPT_MODEL_CATALOG_CONFIG } from '../definitions/chatGptModelCatalog';
import { createChatGptAccountModelDiscovery } from './createChatGptAccountModelDiscovery';

describe('ChatGPT account model discovery', () => {
  it.each(['0.0.38', '1.2.3'])(
    '应用版本 %s 不参与 Codex 模型可见性筛选',
    async applicationVersion => {
      const fetchImplementation = vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(
            JSON.stringify({
              // 复现上游按客户端版本筛选模型：误传产品版本会得到成功的空响应。
              models:
                new URL(String(input)).searchParams.get('client_version') === applicationVersion
                  ? []
                  : [
                      {
                        slug: 'gpt-hidden',
                        display_name: 'GPT Hidden',
                        visibility: 'hide',
                      },
                      {
                        slug: 'gpt-5.6-sol',
                        display_name: 'GPT-5.6 Sol',
                        visibility: 'list',
                        priority: 1,
                        context_window: 272_000,
                        max_context_window: 1_000_000,
                        effective_context_window_percent: 95,
                        input_modalities: ['text', 'image'],
                        supported_reasoning_levels: [{ effort: 'low' }],
                      },
                    ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      );
      const discovery = createChatGptAccountModelDiscovery({
        credentials: {
          resolve: vi.fn(async () => ({
            access_token: 'oauth-access-token',
            request_headers: {
              'chatgpt-account-id': 'upstream-account',
              originator: 'linnya',
            },
          })),
        },
        fetchImplementation,
        applicationVersion,
      });

      await expect(discovery.listModels('chatgpt-subscription')).resolves.toEqual([
        {
          id: 'gpt-5.6-sol',
          display_name: 'GPT-5.6 Sol',
          context_window_tokens: 272_000,
          max_input_tokens: 258_400,
          max_output_tokens: 13_600,
          capabilities: { image_input: true, tool_call: true, reasoning: true },
        },
      ]);
      expect(fetchImplementation).toHaveBeenCalledWith(
        new URL(
          `https://chatgpt.com/backend-api/codex/models?client_version=${CHATGPT_MODEL_CATALOG_CONFIG.compatibility_version}`
        ),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            authorization: 'Bearer oauth-access-token',
            'user-agent': `linnya/${applicationVersion}`,
            'chatgpt-account-id': 'upstream-account',
            originator: 'linnya',
          }),
        })
      );
    }
  );

  it('拒绝没有可见模型的账号目录，不把空响应当成成功同步', async () => {
    const discovery = createChatGptAccountModelDiscovery({
      credentials: {
        resolve: vi.fn(async () => ({ access_token: 'token', request_headers: {} })),
      },
      fetchImplementation: vi.fn(
        async () => new Response(JSON.stringify({ models: [] }), { status: 200 })
      ),
      applicationVersion: '0.0.38',
    });

    await expect(discovery.listModels('chatgpt-subscription')).rejects.toThrow(
      '没有当前账号可用的模型'
    );
  });
});
