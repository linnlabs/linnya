import { describe, expect, it, vi } from 'vitest';
import type { ProviderModelDefinition } from '@linnya/provider-catalog';
import { createProviderModelDiscovery } from '../index';

const known: ProviderModelDefinition = {
  id: 'known',
  display_name: 'Known',
  release_status: 'active',
  context_window_tokens: 262_144,
  max_input_tokens: 262_144,
  max_output_tokens: 32_768,
  capabilities: { image_input: true, tool_call: true, reasoning: true },
};
const request = {
  baseUrl: 'https://provider.example.com/v1/',
  apiKey: 'fixture-secret',
  bundledModels: [known],
};

function metadata(sourceId: string) {
  return {
    [sourceId]: {
      id: sourceId,
      name: sourceId,
      npm: '@ai-sdk/openai',
      models: Object.fromEntries(
        ['new', 'without-tools'].map(id => [
          id,
          {
            id,
            name: id,
            tool_call: id !== 'without-tools',
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: 1_000_000, output: 64_000 },
          },
        ])
      ),
    },
    unrelated: { invalid: true },
  };
}

describe('共享供应商模型列表协议', () => {
  it.each([
    ['openai-api', 'openai'],
    ['moonshot-api-global', 'moonshotai'],
    ['moonshot-api-cn', 'moonshotai'],
  ])('%s 真实查询成员，精确补资料并隔离公共资料请求的凭据', async (connectionId, sourceId) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: 'known' }, { id: 'new' }, { id: 'without-tools' }, { id: 'unknown' }],
        })
      )
      .mockResolvedValueOnce(Response.json(metadata(sourceId)));
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId,
    });
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe('https://provider.example.com/v1/models');
    expect(new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer fixture-secret'
    );
    expect(new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers).has('authorization')).toBe(
      false
    );
    expect(result[0]).toEqual({ status: 'available', definition: known });
    expect(result[1]).toMatchObject({
      status: 'available',
      definition: {
        id: 'new',
        context_window_tokens: 1_000_000,
        max_output_tokens: 64_000,
      },
    });
    expect(result.slice(2)).toEqual([
      {
        status: 'unavailable',
        id: 'without-tools',
        display_name: 'without-tools',
        reason: '该模型尚未确认支持 Agent 所需的工具调用',
      },
      {
        status: 'unavailable',
        id: 'unknown',
        display_name: 'unknown',
        reason: '尚无经过准入的模型容量与能力资料',
      },
    ]);
  });

  it('Go 查询官方成员，新 ID 不借用默认协议，已审核 ID 复用现有资料', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ id: 'known' }, { id: 'new-mixed-protocol' }],
      })
    );
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId: 'opencode-go',
    });
    expect(result).toEqual([
      { status: 'available', definition: known },
      {
        status: 'unavailable',
        id: 'new-mixed-protocol',
        display_name: 'new-mixed-protocol',
        reason: '该模型的调用协议尚未审核，请等待目录更新后启用',
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('Claude 完整读取分页，使用独立认证头且不丢弃末页', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'known' }], has_more: true, last_id: 'known' })
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'new' }], has_more: false, last_id: 'new' })
      )
      .mockResolvedValueOnce(Response.json(metadata('anthropic')));
    const result = await createProviderModelDiscovery({ fetchImplementation }).discover({
      ...request,
      connectionId: 'anthropic',
    });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ status: 'available', definition: { id: 'new' } });
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      'https://provider.example.com/v1/models?limit=1000&after_id=known'
    );
    const headers = new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-api-key')).toBe('fixture-secret');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.has('authorization')).toBe(false);
    expect(new Headers(fetchImplementation.mock.calls[2]?.[1]?.headers).has('x-api-key')).toBe(
      false
    );
  });

  it.each([
    { data: [{ id: 'known' }, { id: 'known' }] },
    { error: { message: 'private server detail' } },
    { data: [{ name: 'missing ID' }] },
  ])('共享列表拒绝非法或不完整响应', async payload => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    await expect(
      createProviderModelDiscovery({ fetchImplementation }).discover({
        ...request,
        connectionId: 'openai-api',
      })
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it.each(['request-failed', 'duplicate-cursor', 'missing-cursor'])(
    'Claude 后续分页 %s 时整次失败',
    async outcome => {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ data: [{ id: 'known' }], has_more: true, last_id: 'known' })
        );
      if (outcome === 'request-failed') {
        fetchImplementation.mockResolvedValueOnce(new Response('private detail', { status: 401 }));
      } else {
        fetchImplementation.mockResolvedValueOnce(
          Response.json({
            data: [{ id: 'new' }],
            has_more: true,
            last_id: outcome === 'missing-cursor' ? null : 'known',
          })
        );
      }
      await expect(
        createProviderModelDiscovery({ fetchImplementation }).discover({
          ...request,
          connectionId: 'anthropic',
        })
      ).rejects.toMatchObject({ statusCode: outcome === 'request-failed' ? 401 : 502 });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    }
  );
});
