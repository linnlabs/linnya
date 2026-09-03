import { describe, expect, it } from 'vitest';

import {
  createBackendRendererRequestRegistry,
  decodeBackendRendererRequestValue,
  encodeBackendRendererRequestValue,
} from '..';

describe('Backend Renderer request registry', () => {
  it('只调用显式注册的 channel，并稳定列出 allowlist', async () => {
    const registry = createBackendRendererRequestRegistry();
    registry.handle('workspace:list-projects', async () => ({ success: true }));
    registry.handle('todo:add', (payload) => payload);

    expect(registry.listChannels()).toEqual(['todo:add', 'workspace:list-projects']);
    await expect(registry.invoke('todo:add', [{ title: 'A' }])).resolves.toEqual({ title: 'A' });
    await expect(registry.invoke('todo:delete', ['1'])).rejects.toThrow('未注册');
  });

  it('拒绝重复或不合规 channel', () => {
    const registry = createBackendRendererRequestRegistry();
    registry.handle('plugins:list', () => null);
    expect(() => registry.handle('plugins:list', () => null)).toThrow('重复注册');
    expect(() => registry.handle('list', () => null)).toThrow('不合法');
  });

  it('仅兼容 Renderer 已发布的旧知识库扁平 channel', () => {
    const registry = createBackendRendererRequestRegistry();
    registry.handle('get-all-kbs', () => []);

    expect(registry.listChannels()).toEqual(['get-all-kbs']);
    expect(() => registry.handle('unpublished-flat-channel', () => null)).toThrow('不合法');
  });
});

describe('Backend Renderer request value codec', () => {
  it('往返现有 IPC 所需的可序列化值与二进制', () => {
    const input = {
      text: '中文',
      optional: undefined,
      count: 42n,
      bytes: Uint8Array.from([0, 1, 2, 255]),
      nested: [true, null, { value: 3.5 }],
    };
    const decoded = decodeBackendRendererRequestValue(
      encodeBackendRendererRequestValue(input),
    );

    expect(decoded).toEqual(input);
    expect(decoded).toBeTypeOf('object');
    if (typeof decoded !== 'object' || decoded === null) throw new Error('decoded object missing');
    expect(Reflect.get(decoded, 'bytes')).toBeInstanceOf(Uint8Array);
  });

  it('拒绝循环引用和类实例', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => encodeBackendRendererRequestValue(cyclic)).toThrow('循环引用');
    expect(() => encodeBackendRendererRequestValue(new Date())).toThrow('普通对象');
  });

  it('严格拒绝伪造 wire node', () => {
    expect(() => decodeBackendRendererRequestValue({
      kind: 'bytes',
      value: 'not base64',
    })).toThrow('bytes');
    expect(() => decodeBackendRendererRequestValue({
      kind: 'null',
      extra: true,
    })).toThrow('字段不合法');
  });
});
