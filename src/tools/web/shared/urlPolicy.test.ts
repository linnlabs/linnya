import { describe, expect, it } from 'vitest';
import { assertAllowedWebUrl, resolveAndAssertPublicHost } from './urlPolicy';

describe('Web URL 安全策略', () => {
  it.each([
    ['file:///etc/passwd', 'http 或 https'],
    [`https://${['user', 'secret'].join(':')}@example.com/`, '用户名或密码'],
    ['http://127.0.0.1/', '回环地址'],
    ['http://10.1.2.3/', '私网地址'],
    ['http://172.16.0.1/', '私网地址'],
    ['http://192.168.1.1/', '私网地址'],
    ['http://169.254.169.254/latest/meta-data', '链路本地地址'],
    ['http://100.64.0.1/', '运营商级 NAT'],
    ['http://198.18.1.16/', '基准测试保留地址'],
    ['http://[::1]/', '回环地址'],
    ['http://[fc00::1]/', '唯一本地地址'],
    ['http://[fe80::1]/', '链路本地地址'],
    ['http://[::ffff:127.0.0.1]/', '回环地址'],
  ])('拒绝 %s', (url, reason) => {
    expect(() => assertAllowedWebUrl(url)).toThrow(reason);
  });

  it('放行普通公网 HTTP/HTTPS 地址并返回规范 URL', () => {
    expect(assertAllowedWebUrl('https://example.com/path?q=1').toString()).toBe(
      'https://example.com/path?q=1'
    );
    expect(assertAllowedWebUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8');
  });

  it('DNS 解析到本机地址时拒绝', async () => {
    await expect(resolveAndAssertPublicHost(new URL('http://localhost/'))).rejects.toThrow(
      '回环地址'
    );
  });

  it('仅允许域名解析所得的 198.18/15 代理 fake-IP', async () => {
    const resolved = await resolveAndAssertPublicHost(new URL('https://example.com/article'), {
      lookupHost: async () => [{ address: '198.18.1.16', family: 4 }],
    });
    expect(resolved).toEqual({
      hostname: 'example.com',
      addresses: [{ address: '198.18.1.16', family: 4 }],
    });
  });

  it('fake-IP 与私网地址混合返回时仍拒绝整次解析', async () => {
    await expect(
      resolveAndAssertPublicHost(new URL('https://example.com/article'), {
        lookupHost: async () => [
          { address: '198.18.1.16', family: 4 },
          { address: '192.168.1.10', family: 4 },
        ],
      })
    ).rejects.toThrow('私网地址');
  });
});
