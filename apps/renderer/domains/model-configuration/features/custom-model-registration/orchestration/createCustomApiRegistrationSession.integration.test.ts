import { describe, expect, it, vi } from 'vitest';
import type { ModelDiscoveryResponse } from '@app/schemas';
import type { CustomApiModelRegistrationGateway } from '../definitions/customApiModelRegistrationGateway';
import { createCustomApiRegistrationSession } from './createCustomApiRegistrationSession';

const discovered: ModelDiscoveryResponse = {
  models: ['a', 'b'].map(id => ({
    id,
    name: id,
    context_window_tokens: 64000,
    max_output_tokens: 8192,
    supports_image_input: false,
    confidence: 'reported',
  })),
};

function setup(refresh = vi.fn(async () => undefined)) {
  const gateway: CustomApiModelRegistrationGateway = {
    register: vi.fn(async () => ({ model_ids: ['local-a', 'local-b'] })),
    discoverModels: vi.fn(async () => discovered),
  };
  const session = createCustomApiRegistrationSession(
    refresh,
    {
      invalidUrl: 'API 地址无效',
      discoveryEmpty: '没有模型',
      discoveryFailed: '发现失败',
      invalidConfiguration: '模型配置无效',
      registrationFailed: '注册失败',
      synchronizationFailed: '模型已保存，列表同步失败',
    },
    gateway
  );
  session.setField('baseUrl', 'https://relay.example/v1');
  session.setField('credentialSecret', 'test-secret');
  return { session, gateway, refresh };
}

describe('自定义模型表单会话', () => {
  it.each(['baseUrl', 'credentialSecret', 'customApiFormat'] as const)(
    '更改 %s 立即清空旧列表，迟到响应不能重新启用提交',
    async field => {
      const { session, gateway } = setup();
      let complete!: (value: ModelDiscoveryResponse) => void;
      vi.mocked(gateway.discoverModels).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            complete = resolve;
          })
      );
      const pending = session.discover();
      if (field === 'customApiFormat') session.setField(field, 'anthropic_compatible');
      else
        session.setField(
          field,
          field === 'baseUrl' ? 'https://other.example/v1' : 'changed-secret'
        );
      complete(discovered);
      await pending;
      expect(session.state.models).toEqual([]);
      await session.submit();
      expect(gateway.register).not.toHaveBeenCalled();
      await session.discover();
      expect(session.state.models).toHaveLength(2);
    }
  );

  it('每个表单独立保存选择，批量提交保留关闭项且阻止重复提交', async () => {
    const { session, gateway } = setup();
    const other = setup();
    await session.discover();
    session.setModelEnabled('b', false);
    let finish!: () => void;
    vi.mocked(gateway.register).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = () => resolve({ model_ids: ['local-a', 'local-b'] });
        })
    );
    const saving = session.submit();
    session.setField('baseUrl', 'https://changed.example');
    await session.submit();
    expect(gateway.register).toHaveBeenCalledOnce();
    expect(gateway.register).toHaveBeenCalledWith(
      expect.objectContaining({
        base_url: 'https://relay.example/v1',
        models: [
          expect.objectContaining({ picker_enabled: true }),
          expect.objectContaining({ picker_enabled: false }),
        ],
      })
    );
    expect(other.session.state.models).toEqual([]);
    finish();
    await saving;
    expect(session.state.form.credentialSecret).toBe('');
    expect(session.state.status.success).toBe(true);
  });

  it('提交成功但重读失败时明确说明已经保存，不能再次提交同一批', async () => {
    const { session, gateway } = setup(
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await session.discover();
    await session.submit();
    expect(session.state.status).toMatchObject({
      success: true,
      error: expect.stringContaining('已保存'),
    });
    await session.submit();
    expect(gateway.register).toHaveBeenCalledOnce();
  });

  it('卸载后清除密钥并取消发现，迟到响应不写回已销毁会话', async () => {
    const { session, gateway } = setup();
    let complete!: (value: ModelDiscoveryResponse) => void;
    vi.mocked(gateway.discoverModels).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    const pending = session.discover();
    session.dispose();
    complete(discovered);
    await pending;
    expect(vi.mocked(gateway.discoverModels).mock.calls[0][1]?.aborted).toBe(true);
    expect(session.state.models).toEqual([]);
    expect(session.state.form.credentialSecret).toBe('');
  });
});
