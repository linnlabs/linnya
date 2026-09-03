import { z } from 'zod';

export const UserFacingMessageParamValueSchema = z.union([z.string(), z.number()]);
export const UserFacingMessageParamsSchema = z.record(UserFacingMessageParamValueSchema);

export const UserFacingMessageSchema = z.object({
  key: z.string().min(1),
  params: UserFacingMessageParamsSchema.optional(),
  fallback: z.string().optional(),
  diagnostic: z.string().optional(),
});

export type UserFacingMessageParamValue = z.infer<typeof UserFacingMessageParamValueSchema>;
export type UserFacingMessageParams = z.infer<typeof UserFacingMessageParamsSchema>;
export type UserFacingMessage = z.infer<typeof UserFacingMessageSchema>;

export type OperationFailure = {
  readonly success: false;
  readonly error: string;
  readonly userMessage?: UserFacingMessage;
};

export type OperationSuccess<T = unknown> = {
  readonly success: true;
  readonly data: T;
};

export type OperationResult<T = unknown> = OperationSuccess<T> | OperationFailure;

export function createUserFacingMessage(
  key: string,
  options: {
    readonly params?: UserFacingMessageParams;
    readonly fallback?: string;
    readonly diagnostic?: string;
  } = {},
): UserFacingMessage {
  return {
    key,
    ...(options.params === undefined ? {} : { params: options.params }),
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
    ...(options.diagnostic === undefined ? {} : { diagnostic: options.diagnostic }),
  };
}

export function createOperationFailure(
  error: string,
  userMessage?: UserFacingMessage,
): OperationFailure {
  return userMessage === undefined
    ? { success: false, error }
    : { success: false, error, userMessage };
}

export function parseUserFacingMessage(value: unknown): UserFacingMessage | null {
  const result = UserFacingMessageSchema.safeParse(value);
  return result.success ? result.data : null;
}
