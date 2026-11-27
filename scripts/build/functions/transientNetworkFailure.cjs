'use strict';

/**
 * 可识别的临时传输错误：连接被拒或被对端重置、超时、DNS 暂时解析失败、断网。
 * 只有这类失败值得原样再试；HTTP 状态错误、证书错误、下载物校验不符、审计查出的漏洞，
 * 重试也不会变，只会拖慢失败，所以都不在这里。
 */
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
]);

/**
 * 重试用尽后写在日志里的标记行。本地 CI 的失败摘要认这一行，把这次失败标成网络原因；
 * 改动它就是改动两边的约定。
 */
const NETWORK_FAILURE_MARKER = '[network-failure]';

/**
 * Node 内置 fetch（undici）的传输失败是 TypeError('fetch failed')，错误码在 cause 链上；
 * 读响应体时断线是 TypeError('terminated')，同样带 cause。返回可读的原因，不是临时错误时返回 undefined。
 */
function describeTransientFetchError(error) {
  let current = error;
  // cause 链很短；限定层数，防止异常对象自引用时死循环。
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    if (typeof current.code === 'string' && TRANSIENT_NETWORK_ERROR_CODES.has(current.code)) {
      return current.message ? `${current.code}：${current.message}` : current.code;
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * npm 与 pnpm 访问 registry 的传输失败都会打印“request to <url> failed, reason: <原因>”。
 * HTTP 状态错误、漏洞报告不是这个格式；原因还要是断线或超时，证书类错误不算。
 */
const REGISTRY_REQUEST_FAILURE = /request to (\S+) failed, reason: ([^\n]+)/u;
const TRANSIENT_REASON = new RegExp(
  `\\b(?:${[...TRANSIENT_NETWORK_ERROR_CODES].join('|')})\\b|socket hang up|network socket disconnected|network timeout`,
  'iu'
);

function describeTransientRegistryFailure(output) {
  const match = REGISTRY_REQUEST_FAILURE.exec(output);
  if (!match || !TRANSIENT_REASON.test(match[2])) return undefined;
  return `${match[1]}：${match[2].trim()}`;
}

module.exports = {
  NETWORK_FAILURE_MARKER,
  describeTransientFetchError,
  describeTransientRegistryFailure,
};
