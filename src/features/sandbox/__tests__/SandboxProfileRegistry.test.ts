import { describe, expect, it } from 'vitest';
import { SandboxProfileRegistry } from '../SandboxProfileRegistry.js';
import type { SandboxProfile } from '../types.js';

function makeProfile(id: string): SandboxProfile {
  return {
    id,
    policyVersion: 'test',
    allowedCapabilities: new Set(),
    buildPolicy() {
      throw new Error('test profile should not execute buildPolicy');
    },
    prepareExecution() {
      throw new Error('test profile should not execute prepareExecution');
    },
    finalizeExecution() {
      throw new Error('test profile should not execute finalizeExecution');
    },
  };
}

describe('SandboxProfileRegistry', () => {
  it('拒绝空 profile id', () => {
    const registry = new SandboxProfileRegistry();

    expect(() => registry.register(makeProfile('   '))).toThrow('SandboxProfile.id 不能为空');
    expect(registry.listIds()).toEqual([]);
  });

  it('默认拒绝同 id 静默覆盖，必须显式 replace', () => {
    const registry = new SandboxProfileRegistry();
    const first = makeProfile('demo');
    const second = makeProfile(' demo ');

    registry.register(first);

    expect(() => registry.register(second)).toThrow('SandboxProfile.id 已注册: demo');
    expect(registry.get('demo')).toBe(first);

    registry.register(second, { replace: true });

    expect(registry.get('demo')).toBe(second);
  });

  it('支持查询、列出和注销 profile', () => {
    const registry = new SandboxProfileRegistry();
    const profile = makeProfile('demo');

    registry.register(profile);

    expect(registry.has(' demo ')).toBe(true);
    expect(registry.list()).toEqual([profile]);
    expect(registry.listIds()).toEqual(['demo']);
    expect(registry.unregister(' demo ')).toBe(true);
    expect(registry.has('demo')).toBe(false);
    expect(registry.get('demo')).toBeNull();
    expect(registry.unregister('demo')).toBe(false);
  });
});
