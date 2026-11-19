import { isRecord } from '@linnya/foundation';
import { APICallError } from 'ai';

/** 诊断里 Provider 拒绝原因的最大字符数；超出截断并加省略号。 */
export const PROVIDER_ERROR_EXCERPT_MAX_CHARS = 300;

const REDACTED = '[redacted]';

/**
 * 依次删除凭据与大块编码内容。顺序有意义：先整体替换 data URL，再处理认证头与参数，
 * 最后把剩余的长令牌（API Key、JWT、base64、签名）整体替换。
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[\w.+-]+)*;base64,[A-Za-z0-9+/=_-]*/gu, '[data-url]'],
  [/\b(Bearer|Basic)\s+[^\s"',;]+/giu, `$1 ${REDACTED}`],
  [/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|signature|authorization|x-api-key|key)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/giu, `$1${REDACTED}`],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/gu, REDACTED],
  [/[A-Za-z0-9_\-+/=.]{32,}/gu, REDACTED],
];

/** 只认常见错误 envelope 里的说明文字；没有说明时不带出整个 JSON，避免回显请求内容。 */
function readEnvelopeMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const error = value.error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') return error;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.detail === 'string') return value.detail;
  return undefined;
}

function readRejectionText(responseBody: string): string | undefined {
  try {
    return readEnvelopeMessage(JSON.parse(responseBody));
  } catch {
    // 非 JSON（纯文本或网关页面）按原文处理。
    return responseBody;
  }
}

/** 删除凭据与编码内容、折叠空白并限长；结果为空时返回 undefined。 */
export function redactProviderErrorText(text: string): string | undefined {
  let redacted = text;
  for (const [pattern, replacement] of REDACTIONS) redacted = redacted.replace(pattern, replacement);
  const compact = redacted.replace(/\s+/gu, ' ').trim();
  if (!compact) return undefined;
  const characters = Array.from(compact);
  return characters.length <= PROVIDER_ERROR_EXCERPT_MAX_CHARS
    ? compact
    : `${characters.slice(0, PROVIDER_ERROR_EXCERPT_MAX_CHARS).join('')}…`;
}

/**
 * Provider 拒绝请求（HTTP 非 2xx）时响应正文里的说明，脱敏、限长后只供诊断日志判断原因。
 * 不进入 canonical failure、UI 或 Audit；其他错误类型、成功状态或没有正文时返回 undefined。
 */
export function projectProviderErrorExcerpt(error: unknown): string | undefined {
  if (!APICallError.isInstance(error)) return undefined;
  if (error.statusCode === undefined || error.statusCode < 400) return undefined;
  if (typeof error.responseBody !== 'string' || !error.responseBody.trim()) return undefined;
  const text = readRejectionText(error.responseBody);
  return text === undefined ? undefined : redactProviderErrorText(text);
}
