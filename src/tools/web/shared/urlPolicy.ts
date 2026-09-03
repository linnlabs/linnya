/**
 * Web 目标 URL 安全策略。
 *
 * Phase 0 只在服务端代读入口执行同步字面地址校验。Phase 1 本地抓取必须在每次
 * 发起请求及每次跟随重定向前调用 resolveAndAssertPublicHost，防止 DNS rebinding
 * 或重定向把请求导向用户本机和内网。
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class WebUrlPolicyError extends Error {
  readonly kind = 'policy_denied';

  constructor(message: string) {
    super(message);
    this.name = 'WebUrlPolicyError';
  }
}

function policyError(message: string): never {
  throw new WebUrlPolicyError(message);
}

function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function isIpv4InCidr(address: number, base: number, prefixLength: number): boolean {
  const hostBits = 32 - prefixLength;
  const divisor = 2 ** hostBits;
  return Math.floor(address / divisor) === Math.floor(base / divisor);
}

function isProxySyntheticIpv4(address: string): boolean {
  const value = parseIpv4(address);
  return value !== null && isIpv4InCidr(value, 0xc6120000, 15);
}

function assertPublicIpv4(address: string): void {
  const value = parseIpv4(address);
  if (value === null) policyError(`IP 地址格式无效：${address}`);

  const blockedRanges: Array<{ base: number; prefix: number; reason: string }> = [
    { base: 0x00000000, prefix: 8, reason: '保留地址' },
    { base: 0x0a000000, prefix: 8, reason: '私网地址' },
    { base: 0x64400000, prefix: 10, reason: '运营商级 NAT 地址' },
    { base: 0x7f000000, prefix: 8, reason: '回环地址' },
    { base: 0xa9fe0000, prefix: 16, reason: '链路本地地址' },
    { base: 0xac100000, prefix: 12, reason: '私网地址' },
    { base: 0xc0000000, prefix: 24, reason: 'IETF 保留地址' },
    { base: 0xc0a80000, prefix: 16, reason: '私网地址' },
    { base: 0xc6120000, prefix: 15, reason: '基准测试保留地址' },
    { base: 0xc0000200, prefix: 24, reason: '文档保留地址' },
    { base: 0xc6336400, prefix: 24, reason: '文档保留地址' },
    { base: 0xcb007100, prefix: 24, reason: '文档保留地址' },
    { base: 0xe0000000, prefix: 4, reason: '组播地址' },
    { base: 0xf0000000, prefix: 4, reason: '保留地址' },
  ];

  const blocked = blockedRanges.find((range) => isIpv4InCidr(value, range.base, range.prefix));
  if (blocked) {
    policyError(`不允许访问${blocked.reason} ${address}。`);
  }
}

function parseIpv6(address: string): bigint | null {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  const doubleColonParts = normalized.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSide = (side: string): string[] => (side ? side.split(':') : []);
  const left = parseSide(doubleColonParts[0] ?? '');
  const right = parseSide(doubleColonParts[1] ?? '');

  const expandEmbeddedIpv4 = (groups: string[]): string[] | null => {
    if (groups.length === 0 || !groups[groups.length - 1].includes('.')) return groups;
    const ipv4 = parseIpv4(groups[groups.length - 1]);
    if (ipv4 === null) return null;
    return [...groups.slice(0, -1), ((ipv4 >>> 16) & 0xffff).toString(16), (ipv4 & 0xffff).toString(16)];
  };

  const expandedLeft = expandEmbeddedIpv4(left);
  const expandedRight = expandEmbeddedIpv4(right);
  if (!expandedLeft || !expandedRight) return null;

  const missing = 8 - expandedLeft.length - expandedRight.length;
  if (doubleColonParts.length === 1 && missing !== 0) return null;
  if (doubleColonParts.length === 2 && missing < 1) return null;
  const groups = [...expandedLeft, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...expandedRight];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function hasIpv6Prefix(address: bigint, base: bigint, prefixLength: number): boolean {
  const hostBits = BigInt(128 - prefixLength);
  return address >> hostBits === base >> hostBits;
}

function assertPublicIpv6(address: string): void {
  const value = parseIpv6(address);
  if (value === null) policyError(`IP 地址格式无效：${address}`);

  const ipv4MappedBase = 0xffffn << 32n;
  if (hasIpv6Prefix(value, ipv4MappedBase, 96)) {
    const ipv4 = Number(value & 0xffffffffn);
    const text = [24, 16, 8, 0].map((shift) => (ipv4 >>> shift) & 0xff).join('.');
    assertPublicIpv4(text);
    return;
  }

  const blockedRanges: Array<{ base: bigint; prefix: number; reason: string }> = [
    { base: 0n, prefix: 128, reason: '未指定地址' },
    { base: 1n, prefix: 128, reason: '回环地址' },
    { base: 0xfc00n << 112n, prefix: 7, reason: '唯一本地地址' },
    { base: 0xfe80n << 112n, prefix: 10, reason: '链路本地地址' },
    { base: 0xff00n << 112n, prefix: 8, reason: '组播地址' },
  ];
  const blocked = blockedRanges.find((range) => hasIpv6Prefix(value, range.base, range.prefix));
  if (blocked) policyError(`不允许访问${blocked.reason} ${address}。`);
}

function assertPublicIp(address: string): void {
  const version = isIP(address.replace(/^\[|\]$/g, ''));
  if (version === 4) {
    assertPublicIpv4(address);
    return;
  }
  if (version === 6) {
    assertPublicIpv6(address);
    return;
  }
  policyError(`IP 地址格式无效：${address}`);
}

export function assertAllowedWebUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    policyError('网页地址不是合法 URL。');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    policyError(`网页地址只允许使用 http 或 https 协议，当前为 ${url.protocol || '未知协议'}。`);
  }
  if (url.username || url.password) {
    policyError('网页地址不允许包含用户名或密码。');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) assertPublicIp(hostname);
  return url;
}

export interface ResolvedWebHostAddress {
  address: string;
  family: 4 | 6;
}

export interface ResolvedWebHost {
  hostname: string;
  addresses: ResolvedWebHostAddress[];
}

export interface ResolvePublicWebHostDependencies {
  readonly lookupHost?: (hostname: string) => Promise<Array<{
    readonly address: string;
    readonly family: number;
  }>>;
}

export async function resolveAndAssertPublicHost(
  url: URL,
  dependencies: ResolvePublicWebHostDependencies = {},
): Promise<ResolvedWebHost> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    assertPublicIp(hostname);
    return { hostname, addresses: [{ address: hostname, family: literalFamily }] };
  }

  const addresses = await (dependencies.lookupHost
    ? dependencies.lookupHost(hostname)
    : lookup(hostname, { all: true, verbatim: true }));
  if (addresses.length === 0) policyError(`网页域名 ${hostname} 没有可用的 DNS 解析结果。`);
  const validated: ResolvedWebHostAddress[] = [];
  for (const address of addresses) {
    // Clash 等 TUN 代理会把域名映射到 198.18/15 fake-IP，再在虚拟网卡内还原目标。
    // 只对“域名解析结果”开放此例外；字面 IP 仍由 assertAllowedWebUrl 拒绝。
    if (!isProxySyntheticIpv4(address.address)) assertPublicIp(address.address);
    if (address.family !== 4 && address.family !== 6) {
      policyError(`网页域名 ${hostname} 返回未知地址族。`);
    }
    validated.push({ address: address.address, family: address.family });
  }
  return { hostname, addresses: validated };
}
