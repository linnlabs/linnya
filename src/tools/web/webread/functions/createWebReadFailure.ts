import { WebHttpError } from '../../../../infra/adapters/web-http/webHttpFetch';
import {
  WebFailureError,
  getWebFailureDiagnostics,
  getWebFailureKind,
  type WebFailureStage,
  type WebFailureDetails,
} from '../../shared/webFailure';
import type { WebReadEscalationReason } from '../definitions/readLadder';

/** 阶段由实际调用位置登记；未知异常只报告 kind，不把任意供应商文字带入可信错误。 */
export function createWebReadFailure(
  error: unknown,
  failureStage: WebFailureStage,
  ladderFacts: WebFailureDetails<WebReadEscalationReason> = {}
): WebFailureError<WebReadEscalationReason> {
  const kind = getWebFailureKind(error);
  const diagnostics = getWebFailureDiagnostics(error);
  return new WebFailureError(
    kind,
    error instanceof WebFailureError || error instanceof WebHttpError
      ? error.message
      : `网页读取失败（${kind}）。`,
    {
      status: diagnostics.status,
      details: { ...diagnostics, ...ladderFacts, failureStage },
    }
  );
}
