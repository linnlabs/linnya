import { z } from 'zod';
import { WebRenderFailureKindSchema } from '@app/schemas';
import {
  WEB_ACCESS_CHALLENGE_HEADER_NAMES,
  type WebAccessChallengeHeaderName,
} from '../../../../../../tools/web/shared/webAccessChallenge';
import {
  WEB_PAGE_MAIN_RESPONSE_HEADER_MAX_CHARS,
  WEB_PAGE_NET_ERROR_NAME_PATTERN,
  type WebPageMainResponse,
} from '../../../../../../tools/web/webread/definitions/webPageRenderer';

const MainResponseHeaderValueSchema = z.string().max(WEB_PAGE_MAIN_RESPONSE_HEADER_MAX_CHARS).optional();

// 头名与 Web 判定规则同源；新增判定头时编译期强制同步本 DTO。
const mainResponseHeaderShape = {
  'x-amzn-waf-action': MainResponseHeaderValueSchema,
  'cf-mitigated': MainResponseHeaderValueSchema,
} satisfies Record<WebAccessChallengeHeaderName, typeof MainResponseHeaderValueSchema>;

const WebPageMainResponseRpcSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.object(mainResponseHeaderShape).strict(),
}).strict();

const WebPageSubresourceFailuresRpcSchema = z.object({
  count: z.number().int().min(1).max(100_000),
  sample_error: z.string().regex(WEB_PAGE_NET_ERROR_NAME_PATTERN).optional(),
}).strict();

export const WebPageRenderRpcRequestSchema = z.object({
  url: z.string().url(),
  timeout_ms: z.number().int().positive().optional(),
}).strict();

export const WebPageRenderRpcResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    value: z.object({
      html: z.string(),
      final_url: z.string().url(),
      main_response: WebPageMainResponseRpcSchema,
    }).strict(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: z.object({
      kind: WebRenderFailureKindSchema,
      message: z.string().min(1).max(2_048),
      main_response: WebPageMainResponseRpcSchema.optional(),
      net_error_code: z.number().int().min(-9_999).max(-1).optional(),
      subresource_failures: WebPageSubresourceFailuresRpcSchema.optional(),
      data_request_failures: WebPageSubresourceFailuresRpcSchema.optional(),
    }).strict(),
  }).strict(),
]);

/** 双向只复制白名单头；未出现的头不写入，避免把 undefined 当作声明过的值。 */
export function copyWebPageMainResponse(response: {
  readonly status: number;
  readonly headers: Readonly<Partial<Record<WebAccessChallengeHeaderName, string | undefined>>>;
}): WebPageMainResponse {
  const headers: Partial<Record<WebAccessChallengeHeaderName, string>> = {};
  for (const name of WEB_ACCESS_CHALLENGE_HEADER_NAMES) {
    const value = response.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  return { status: response.status, headers };
}
