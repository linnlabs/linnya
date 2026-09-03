import { z } from 'zod';

import type {
  DesktopCredentialDecryptRpcRequest,
  DesktopCredentialDecryptRpcResponse,
  DesktopCredentialEncryptRpcRequest,
  DesktopCredentialEncryptRpcResponse,
} from '../definitions/credentialProtectionRpc';

const EncryptRequestSchema = z.object({ plaintext: z.string() }).strict();
const EncryptResponseSchema = z.object({ ciphertext: z.string() }).strict();
const DecryptRequestSchema = z.object({ ciphertext: z.string() }).strict();
const DecryptResponseSchema = z.object({ plaintext: z.string() }).strict();

export function parseDesktopCredentialEncryptRpcRequest(
  value: unknown,
): DesktopCredentialEncryptRpcRequest {
  return EncryptRequestSchema.parse(value);
}

export function parseDesktopCredentialEncryptRpcResponse(
  value: unknown,
): DesktopCredentialEncryptRpcResponse {
  return EncryptResponseSchema.parse(value);
}

export function parseDesktopCredentialDecryptRpcRequest(
  value: unknown,
): DesktopCredentialDecryptRpcRequest {
  return DecryptRequestSchema.parse(value);
}

export function parseDesktopCredentialDecryptRpcResponse(
  value: unknown,
): DesktopCredentialDecryptRpcResponse {
  return DecryptResponseSchema.parse(value);
}
