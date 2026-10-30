import { ZodError } from 'zod';
import type { MessageWindowFailure } from '../definitions/messageWindow';
import { MessageWindowRequestError } from '../definitions/messageWindowApi';

export function describeMessageWindowFailure(error: unknown): {
  failure: MessageWindowFailure;
  diagnostics: {
    stage: string;
    errorName: string;
    httpStatus?: number;
    schemaIssues?: readonly { code: string; path: readonly (string | number)[] }[];
  };
} {
  if (error instanceof MessageWindowRequestError) {
    return {
      failure: {
        error_kind: error.stage === 'http'
          ? 'http'
          : error.stage === 'request'
            ? error.cause instanceof TypeError ? 'connection' : 'unknown'
            : 'projection',
        ...(error.stage === 'http' && error.httpStatus !== undefined ? { http_status: error.httpStatus } : {}),
      },
      diagnostics: {
        stage: error.stage,
        errorName: error.cause instanceof Error ? error.cause.name : error.name,
        httpStatus: error.httpStatus,
      },
    };
  }
  return {
    failure: { error_kind: 'projection' },
    diagnostics: {
      stage: 'projection',
      errorName: error instanceof Error ? error.name : typeof error,
      // Schema issue 只记录字段路径和类别，不记录 received 值、消息正文或工具响应。
      ...(error instanceof ZodError ? {
        schemaIssues: error.issues.map(issue => ({ code: issue.code, path: issue.path })),
      } : {}),
    },
  };
}
