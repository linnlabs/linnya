import type { CustomCapabilityRegistrationGateway } from '../definitions/customCapabilityRegistration';
import { describe, expect, it, vi } from 'vitest';
import { createCustomCapabilityRegistrationSession } from './createCustomCapabilityRegistrationSession';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';

function setup() {
  const gateway = {
    test: vi.fn<CustomCapabilityRegistrationGateway['test']>(async () => ({
      message: 'fixture success',
    })),
    register: vi.fn<CustomCapabilityRegistrationGateway['register']>(async () => ({
      model_id: 'new-model',
    })),
    updateProvider: vi.fn(),
  };
  const refresh = vi.fn(async () => {});
  const session = createCustomCapabilityRegistrationSession('embedding', refresh, gateway);
  session.setField('providerName', 'Fixture');
  session.setField('baseUrl', 'http://127.0.0.1:1234/v1');
  session.setField('credentialSecret', 'fixture-key');
  session.setField('modelId', 'embed-model');
  return { session, gateway, refresh };
}

describe('自定义能力模型表单会话', () => {
  it('测试与保存分开：测试不保存、不清草稿；保存成功后才清Key并同步目录', async () => {
    const { session, gateway, refresh } = setup();
    await session.test();
    expect(gateway.register).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(session.state.form.credentialSecret).toBe('fixture-key');
    expect(session.state.saved).toBe(false);
    await session.submit();
    expect(gateway.register).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(session.state.form.credentialSecret).toBe('');
    expect(session.state.saved).toBe(true);
  });
  it('失败保留草稿；已保存后的同步失败不误报为未保存，也不能重复提交', async () => {
    const { session, gateway, refresh } = setup();
    gateway.register.mockRejectedValueOnce(
      new CustomApiModelRegistrationError(
        'custom_api_onboarding.registration_failed',
        'fixture failure'
      )
    );
    await session.submit();
    expect(session.state.form.credentialSecret).toBe('fixture-key');
    expect(session.state.error).toBe('fixture failure');
    refresh.mockRejectedValueOnce(new Error('offline'));
    await session.submit();
    await session.submit();
    expect(gateway.register).toHaveBeenCalledTimes(2);
    expect(session.state.saved).toBe(true);
    expect(session.state.feedback).toContain('已保存');
    expect(session.state.form.credentialSecret).toBe('');
  });
  it('主动取消测试保留完整草稿，服务迟到成功不能显示成功或保存模型', async () => {
    const { session, gateway } = setup();
    let finish = (_value: { message: string }) => {};
    gateway.test.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const running = session.test();
    session.cancelTest();
    expect(gateway.test.mock.calls[0]?.[1].aborted).toBe(true);
    finish({ message: 'late success' });
    await running;
    expect(session.state.feedback).toContain('已取消');
    expect(session.state.form.credentialSecret).toBe('fixture-key');
    expect(session.state.form.modelId).toBe('embed-model');
    expect(gateway.register).not.toHaveBeenCalled();
  });
  it('卸载取消进行中的测试，清除Key，迟到结果不更新已离开的表单', async () => {
    const { session, gateway } = setup();
    let finish = (_value: { message: string }) => {};
    gateway.test.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const running = session.test();
    const signal = gateway.test.mock.calls[0]?.[1];
    session.dispose();
    finish({ message: 'late success' });
    await running;
    expect(signal?.aborted).toBe(true);
    expect(session.state.feedback).toBe('');
    expect(session.state.form.credentialSecret).toBe('');
  });
});
