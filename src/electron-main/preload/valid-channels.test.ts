import { describe, expect, it } from 'vitest';
import { VALID_CHANNELS } from './valid-channels';

describe('preload valid channels', () => {
  it('exposes generic plugin doors but not raw plugin channels', () => {
    expect(VALID_CHANNELS).toContain('plugin:invoke');
    expect(VALID_CHANNELS).toContain('plugin:push');
    expect(VALID_CHANNELS.filter((channel) => channel.startsWith('slides:'))).toEqual([]);
    expect(VALID_CHANNELS).not.toContain('sheet-ops-appended');
  });

  it('只开放 Web Search 配置所需的三个窄通道', () => {
    expect(VALID_CHANNELS.filter((channel) => channel.startsWith('web-search-config:'))).toEqual([
      'web-search-config:get',
      'web-search-config:set',
      'web-search-config:test-connection',
    ]);
  });

  it('只开放网络读取配置所需的三个窄通道', () => {
    expect(VALID_CHANNELS.filter((channel) => channel.startsWith('web-read-config:'))).toEqual([
      'web-read-config:get',
      'web-read-config:set',
      'web-read-config:test-connection',
    ]);
  });
});
