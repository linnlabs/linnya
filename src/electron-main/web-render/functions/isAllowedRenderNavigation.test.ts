import { describe, expect, it } from 'vitest';
import {
  isAllowedPreCommitRedirectTarget,
  isAllowedRenderNavigation,
} from './isAllowedRenderNavigation';

describe('Web 渲染站点导航', () => {
  it.each([
    ['https://www.bundesrechnungshof.de/report', 'https://bundesrechnungshof.de/report'],
    ['http://example.co.uk/report', 'https://data.example.co.uk:443/report'],
    ['https://www.example.com/report', 'https://example.com/next'],
    ['https://tenant.github.io/report', 'https://www.tenant.github.io/next'],
  ])('允许同注册域跳转 %s → %s', (target, candidate) => {
    expect(isAllowedRenderNavigation(target, candidate)).toBe(true);
  });

  it.each([
    'https://bundesrechnungshof.de.attacker.com/report',
    'https://evilbundesrechnungshof.de/report',
    'https://user:password@bundesrechnungshof.de/report',
    'https://localhost/report',
    'https://127.0.0.1/report',
    'https://8.8.8.8/report',
    'https://[::1]/report',
    'file:///report',
    'javascript:alert(1)',
  ])('拒绝跨站、凭据、IP 和危险协议 %s', candidate => {
    expect(isAllowedRenderNavigation('https://www.bundesrechnungshof.de/report', candidate)).toBe(false);
  });

  it('公共后缀及私有托管后缀不把不同站点合并', () => {
    expect(isAllowedRenderNavigation('https://first.co.uk', 'https://second.co.uk')).toBe(false);
    expect(isAllowedRenderNavigation('https://first.github.io', 'https://second.github.io')).toBe(false);
    expect(isAllowedRenderNavigation('https://first.blogspot.com', 'https://second.blogspot.com')).toBe(false);
    expect(isAllowedRenderNavigation('https://8.8.8.8', 'https://8.8.8.8/path')).toBe(false);
    expect(isAllowedRenderNavigation('https://localhost', 'https://localhost/path')).toBe(false);
  });

  it('isAllowedPreCommitRedirectTarget 只放行具备公共注册域的 HTTP(S) 目标', () => {
    expect(isAllowedPreCommitRedirectTarget('https://target.example.org/doc')).toBe(true);
    expect(isAllowedPreCommitRedirectTarget('https://sub.gov.co.uk/notice')).toBe(true);
    expect(isAllowedPreCommitRedirectTarget('about:blank')).toBe(false);
    expect(isAllowedPreCommitRedirectTarget('http://localhost/path')).toBe(false);
    expect(isAllowedPreCommitRedirectTarget('http://127.0.0.1/path')).toBe(false);
    expect(isAllowedPreCommitRedirectTarget('https://8.8.8.8/path')).toBe(false);
    expect(isAllowedPreCommitRedirectTarget('https://user:pass@target.example.org/doc')).toBe(false);
    expect(isAllowedPreCommitRedirectTarget('file:///etc/passwd')).toBe(false);
    expect(isAllowedPreCommitRedirectTarget('javascript:alert(1)')).toBe(false);
  });
});
