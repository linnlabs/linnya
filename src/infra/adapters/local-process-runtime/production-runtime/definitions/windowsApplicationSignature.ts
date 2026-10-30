import { z } from 'zod';

// 只接纳确切的未签名状态；损坏、撤销、检查失败都不能降级为未签名发行。
export const WindowsApplicationSignatureSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('Valid'), publisher: z.string().min(1) }).strict(),
  z.object({ status: z.literal('NotSigned'), publisher: z.null() }).strict(),
]);

export type WindowsApplicationSignature = z.infer<typeof WindowsApplicationSignatureSchema>;

export interface WindowsApplicationSignatureProbePort {
  readAuthenticodeSignature(input: {
    readonly executablePath: string;
    readonly environment: Readonly<Record<string, string>>;
  }): WindowsApplicationSignature | undefined;
}
