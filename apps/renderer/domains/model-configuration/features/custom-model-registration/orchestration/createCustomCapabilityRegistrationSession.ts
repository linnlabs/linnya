import {
  CUSTOM_CAPABILITY_API_FORMATS,
  CustomCapabilityModelCommandSchema,
  type CustomCapabilityModelKind,
} from '@app/schemas/custom-api-onboarding';
import type {
  CustomCapabilityDraft,
  CustomCapabilityRegistrationGateway,
} from '../definitions/customCapabilityRegistration';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';
import { createCustomCapabilityRegistrationStore } from '../store/customCapabilityRegistrationStore';
import { buildCustomCapabilityRequest } from '../functions/buildCustomCapabilityRequest';
import { httpCustomCapabilityGateway } from '../infrastructure/httpCustomCapabilityGateway';

export function createCustomCapabilityRegistrationSession(
  kind: CustomCapabilityModelKind,
  refresh: () => Promise<void>,
  gateway: CustomCapabilityRegistrationGateway = httpCustomCapabilityGateway
) {
  const format = CUSTOM_CAPABILITY_API_FORMATS.find(item => item.kind === kind);
  if (!format) throw new Error('Unsupported custom model kind');
  const store = createCustomCapabilityRegistrationStore(format.id);
  let active: AbortController | undefined;
  let disposed = false;
  async function run(action: 'test' | 'save') {
    if (disposed || store.state.busy || store.state.saved) return;
    const parsed = CustomCapabilityModelCommandSchema.safeParse(
      buildCustomCapabilityRequest(store.state.form)
    );
    if (!parsed.success) {
      store.setError(parsed.error.issues[0]?.message ?? '请检查模型配置');
      return;
    }
    const controller = new AbortController();
    active = controller;
    store.setBusy(action);
    try {
      if (action === 'test') {
        const result = await gateway.test(parsed.data, controller.signal);
        if (!disposed && !controller.signal.aborted) store.setFeedback(result.message);
      } else {
        await gateway.register(parsed.data, controller.signal);
        if (disposed) return;
        store.saved();
        try {
          await refresh();
          store.setFeedback('模型已添加，可在模型配置中选择用途。');
        } catch {
          store.setFeedback('模型已保存，但列表同步失败，请重新打开设置。');
        }
      }
    } catch (failure: unknown) {
      if (!disposed)
        store.setError(
          controller.signal.aborted
            ? '测试已取消'
            : failure instanceof CustomApiModelRegistrationError
              ? failure.message
              : '调用未完成，请检查连接后重试'
        );
    } finally {
      store.setBusy(null);
      active = undefined;
    }
  }
  return {
    state: store.state,
    setField<K extends keyof CustomCapabilityDraft>(key: K, value: CustomCapabilityDraft[K]) {
      if (!disposed && !store.state.busy) store.setField(key, value);
    },
    test: () => run('test'),
    cancelTest() {
      if (store.state.busy !== 'test') return;
      active?.abort();
      store.setFeedback('测试已取消，表单内容已保留。');
    },
    submit: () => run('save'),
    dispose() {
      disposed = true;
      active?.abort();
      store.clearSecret();
    },
  };
}
