import { z } from 'zod';

import type {
  ExternalAuthorizationBrowserOpenRpcRequest,
} from '../definitions/externalAuthorizationBrowserRpc';

const HttpsAuthorizationUrlSchema = z.string().url().refine(
  value => new URL(value).protocol === 'https:',
  '外部授权浏览器只接受 HTTPS URL',
);

const OpenRequestSchema = z.object({ url: HttpsAuthorizationUrlSchema }).strict();
const OpenResponseSchema = z.null();

export function parseExternalAuthorizationBrowserOpenRpcRequest(
  value: unknown,
): ExternalAuthorizationBrowserOpenRpcRequest {
  return OpenRequestSchema.parse(value);
}

export function parseExternalAuthorizationBrowserOpenRpcResponse(value: unknown): null {
  return OpenResponseSchema.parse(value);
}
