import { describe, expect, it } from 'vitest';
import {
  type WebAccessChallengeSignal,
  createWebAccessChallengeHeaderLookup,
  detectWebAccessChallenge,
  detectWebAccessChallengeHeader,
  isWebChallengeResponse,
  pickWebAccessChallengeHeaders,
} from './webAccessChallenge';

function headers(values: Record<string, string>): { get(name: string): string | undefined } {
  const lookup = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return { get: name => lookup.get(name.toLowerCase()) };
}

describe('访问挑战判定', () => {
  it.each<{ values: Record<string, string>; signal: WebAccessChallengeSignal }>([
    { values: { 'x-amzn-waf-action': 'challenge' }, signal: 'aws_waf_challenge' },
    { values: { 'X-Amzn-Waf-Action': ' CAPTCHA ' }, signal: 'aws_waf_captcha' },
    { values: { 'cf-mitigated': 'challenge' }, signal: 'cloudflare_challenge' },
  ])('厂商公开响应头 $values 直接识别为 $signal', ({ values, signal }) => {
    expect(detectWebAccessChallengeHeader(headers(values))).toBe(signal);
  });

  it('其他头值、普通 202 和无关头都不是挑战', () => {
    expect(detectWebAccessChallengeHeader(headers({ 'cf-mitigated': 'block' }))).toBeUndefined();
    expect(detectWebAccessChallengeHeader(headers({ 'x-amzn-waf-action': 'block' }))).toBeUndefined();
    expect(detectWebAccessChallenge({ status: 202, headers: headers({}), bodyPreview: 'challenge accepted' }))
      .toBeUndefined();
    expect(detectWebAccessChallenge({ status: 200, headers: headers({ 'x-challenge': 'challenge' }) }))
      .toBeUndefined();
  });

  it('响应头优先；正文标记只补充 403/419/429，正常正文提到 challenge 不算挑战', () => {
    expect(detectWebAccessChallenge({
      status: 503,
      headers: headers({ 'cf-mitigated': 'challenge' }),
      bodyPreview: 'service unavailable',
    })).toBe('cloudflare_challenge');
    expect(detectWebAccessChallenge({ status: 403, bodyPreview: '<title>Human verification</title>' }))
      .toBe('page_marker');
    expect(detectWebAccessChallenge({ status: 200, bodyPreview: 'Access challenge for policy makers' }))
      .toBeUndefined();
    expect(isWebChallengeResponse(419, '<title>Human verification</title>')).toBe(true);
    expect(isWebChallengeResponse(500, '<title>Human verification</title>')).toBe(false);
  });

  it('跨进程只挑出判定所需头并按上限裁剪，回读查询不区分大小写', () => {
    const picked = pickWebAccessChallengeHeaders(headers({
      'X-Amzn-Waf-Action': 'challenge',
      'Set-Cookie': 'session=secret',
      'cf-mitigated': 'block'.repeat(10),
    }), 9);
    expect(picked).toEqual({ 'x-amzn-waf-action': 'challenge', 'cf-mitigated': 'blockbloc' });
    expect(createWebAccessChallengeHeaderLookup(picked).get('X-AMZN-WAF-ACTION')).toBe('challenge');
    expect(createWebAccessChallengeHeaderLookup(picked).get('set-cookie')).toBeUndefined();
  });
});
