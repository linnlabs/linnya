import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginRuntimeState } from '../../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { dispatchPluginInvoke, type PluginInvokeDispatchDependencies } from './pluginInvokeDispatcher';

const infoSpy = vi.hoisted(() => vi.fn());
const warnSpy = vi.hoisted(() => vi.fn());
const errorSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../../shared/logger', () => ({
  Logger: vi.fn().mockImplementation(function MockLogger() {
    return {
      info: infoSpy,
      warn: warnSpy,
      error: errorSpy,
    };
  }),
}));

function createDependencies(options: {
  readonly runtimeState?: PluginRuntimeState;
  readonly allowedChannels?: readonly string[];
  readonly invokeHandler?: PluginInvokeDispatchDependencies['invokeHandler'];
} = {}): PluginInvokeDispatchDependencies {
  return {
    getRuntimeState: () => options.runtimeState ?? 'enabled',
    listAllowedChannels: () => options.allowedChannels ?? ['slides:preview'],
    invokeHandler: options.invokeHandler ?? (() => ({ success: true, data: 'ok' })),
  };
}

describe('dispatchPluginInvoke', () => {
  beforeEach(() => {
    infoSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  it('插件未安装时返回 missing 诊断，不继续触发 handler', async () => {
    const invokeHandler = vi.fn();

    const result = await dispatchPluginInvoke({}, {
      pluginId: 'slides',
      channel: 'slides:preview',
    }, createDependencies({
      runtimeState: 'missing',
      invokeHandler,
    }));

    expect(result).toEqual({
      success: false,
      error: '[plugin-registry] 插件未安装: slides',
      diagnostic: {
        code: 'missing',
        pluginId: 'slides',
        channel: 'slides:preview',
        message: '[plugin-registry] 插件未安装: slides',
      },
    });
    expect(invokeHandler).not.toHaveBeenCalled();
  });

  it('插件禁用时返回 disabled 诊断', async () => {
    const result = await dispatchPluginInvoke({}, {
      pluginId: 'slides',
      channel: 'slides:preview',
    }, createDependencies({
      runtimeState: 'disabled',
    }));

    expect(result).toMatchObject({
      success: false,
      diagnostic: {
        code: 'disabled',
        pluginId: 'slides',
        channel: 'slides:preview',
      },
    });
  });

  it('channel 未声明时返回 permission_denied 诊断', async () => {
    const result = await dispatchPluginInvoke({}, {
      pluginId: 'slides',
      channel: 'slides:export',
    }, createDependencies({
      allowedChannels: ['slides:preview'],
    }));

    expect(result).toEqual({
      success: false,
      error: '[plugin:invoke] 插件未声明 IPC channel: slides/slides:export',
      diagnostic: {
        code: 'permission_denied',
        pluginId: 'slides',
        channel: 'slides:export',
        message: '[plugin:invoke] 插件未声明 IPC channel: slides/slides:export',
      },
    });
  });

  it('handler 未注册时返回 missing_handler 诊断', async () => {
    const result = await dispatchPluginInvoke({}, {
      pluginId: 'slides',
      channel: 'slides:preview',
    }, createDependencies({
      invokeHandler: () => {
        throw new Error('[pluginIpcRuntime] 未注册插件 IPC handler: slides/slides:preview');
      },
    }));

    expect(result).toMatchObject({
      success: false,
      diagnostic: {
        code: 'missing_handler',
        pluginId: 'slides',
        channel: 'slides:preview',
      },
    });
  });

  it('handler 崩溃时返回 crash 诊断并保留插件/channel', async () => {
    const result = await dispatchPluginInvoke({}, {
      pluginId: 'slides',
      channel: 'slides:preview',
    }, createDependencies({
      invokeHandler: () => {
        throw new Error('render model exploded');
      },
    }));

    expect(result).toEqual({
      success: false,
      error: 'render model exploded',
      diagnostic: {
        code: 'crash',
        pluginId: 'slides',
        channel: 'slides:preview',
        message: 'render model exploded',
      },
    });
  });

  it('请求不是对象或缺少 pluginId/channel 时返回 validation 诊断', async () => {
    await expect(dispatchPluginInvoke({}, null, createDependencies())).resolves.toMatchObject({
      success: false,
      diagnostic: { code: 'validation' },
    });

    await expect(dispatchPluginInvoke({}, { pluginId: 'slides' }, createDependencies())).resolves.toMatchObject({
      success: false,
      diagnostic: { code: 'validation' },
    });
  });

  it('合法请求会调用插件 handler 并透传 payload', async () => {
    const invokeHandler = vi.fn(() => ({ success: true, data: 'preview' }));

    const result = await dispatchPluginInvoke({ sender: 'renderer' }, {
      pluginId: 'slides',
      channel: 'slides:preview',
      payload: { documentId: 'deck-1' },
    }, createDependencies({ invokeHandler }));

    expect(result).toEqual({ success: true, data: 'preview' });
    expect(invokeHandler).toHaveBeenCalledWith(
      'slides',
      'slides:preview',
      { sender: 'renderer' },
      { documentId: 'deck-1' },
    );
  });

  it('带通用 trace id 的请求会记录插件无关的 invoke trace', async () => {
    const invokeHandler = vi.fn(() => ({
      success: true,
      data: {
        kind: 'preview',
        documentId: 'doc-1',
      },
    }));

    const result = await dispatchPluginInvoke({}, {
      pluginId: 'fixture-plugin',
      channel: 'fixture:preview',
      payload: {
        __plugin_trace_id: 'trace-1',
        documentId: 'doc-1',
        company: 'ACME',
      },
    }, createDependencies({
      allowedChannels: ['fixture:preview'],
      invokeHandler,
    }));

    expect(result).toEqual({
      success: true,
      data: {
        kind: 'preview',
        documentId: 'doc-1',
      },
    });
    expect(infoSpy).toHaveBeenCalledWith('[plugin:invoke] dispatch start', expect.objectContaining({
      traceId: 'trace-1',
      pluginId: 'fixture-plugin',
      channel: 'fixture:preview',
      payload: expect.objectContaining({
        payloadKeys: ['company', 'documentId'],
        documentId: 'doc-1',
        company: 'ACME',
      }),
    }));
    expect(infoSpy).toHaveBeenCalledWith('[plugin:invoke] dispatch completed', expect.objectContaining({
      traceId: 'trace-1',
      pluginId: 'fixture-plugin',
      channel: 'fixture:preview',
      result: expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          dataKeys: ['documentId', 'kind'],
          kind: 'preview',
          documentId: 'doc-1',
        }),
      }),
    }));
  });
});
