import {
  hasSameCommandExecutionIdentity,
  type CommandApprovalReason,
  type ShellCommandProposalV1,
} from '@app/schemas/commands';

import type { ConversationCommandApproval } from '../../../definitions/commandApproval';
import type {
  CommandAuthorizationDecision,
  CommandAuthorizationPermissionRequirement,
} from '../definitions/commandAuthorizationDecision';
import { detectObviousShellWrite } from './detectObviousShellWrite';
import { deriveSimpleCommandCandidate } from './deriveSimpleCommandCandidate';
import { matchConversationCommandApproval } from './matchConversationCommandApproval';
import { matchFixedRiskRule } from './matchFixedRiskRule';
import { resolveApprovedCommandPermission } from './resolveApprovedCommandPermission';

function riskReasons(
  findings: Extract<
    ReturnType<typeof matchFixedRiskRule>,
    { status: 'matched' }
  >['findings'],
): readonly CommandApprovalReason[] {
  return findings.map(finding => ({
    type: 'fixed_risk_rule',
    rule_id: finding.ruleId,
    category: finding.category,
  }));
}

/**
 * 完整当前命令必须先过风险规则。固定规则只说明风险类别，并不知道参数对应的
 * 文件或远端范围，所以风险命令只有可见 token 与批准时 cwd 都完全相同时才能
 * 复用旧批准；普通未命中风险的命令仍按 D21-c 复用前缀。风险结果不复制到
 * SQLite，避免规则升级后持久事实与当前 catalog 漂移。
 */
export function evaluateCommandAuthorization(params: {
  readonly proposal: ShellCommandProposalV1;
  readonly permissionRequirement: CommandAuthorizationPermissionRequirement;
  readonly platform: 'macos' | 'windows';
  readonly shellSemanticsId: string;
  readonly conversationApprovals: readonly ConversationCommandApproval[];
  readonly riskCatalog?: unknown;
}): CommandAuthorizationDecision {
  const context = Object.freeze({
    platform: params.platform,
    shellSemanticsId: params.shellSemanticsId,
  });
  const basePermission = params.proposal.permission;
  if (!hasSameCommandExecutionIdentity(
    params.proposal.identity,
    params.permissionRequirement.identity,
  )) {
    return {
      status: 'unavailable',
      context,
      proposal: params.proposal,
      code: 'permission_requirement_identity_mismatch',
    };
  }
  if (basePermission.base_level === 'full_access') {
    return {
      status: 'authorized',
      context,
      proposal: params.proposal,
      permission: basePermission,
      evidence: { source: 'global_setting' },
    };
  }

  const risk = matchFixedRiskRule({
    command: params.proposal.command,
    platform: params.platform,
    shellSemanticsId: params.shellSemanticsId,
    catalog: params.riskCatalog,
  });
  if (risk.status === 'unavailable') {
    return {
      status: 'unavailable',
      context,
      proposal: params.proposal,
      code: risk.code === 'unsupported_risk_context'
        ? 'authorization_context_unsupported'
        : risk.code,
    };
  }

  const candidate = deriveSimpleCommandCandidate({
    command: params.proposal.command,
    platform: params.platform,
    shellSemanticsId: params.shellSemanticsId,
  });
  if (candidate.status === 'unavailable') {
    return {
      status: 'unavailable',
      context,
      proposal: params.proposal,
      code: 'authorization_context_unsupported',
    };
  }
  const remembered = candidate.status === 'derived'
    ? matchConversationCommandApproval({
      conversationId: params.proposal.identity.conversation_id,
      candidate: candidate.candidate,
      approvals: params.conversationApprovals,
    })
    : { status: 'not_matched' as const };
  if (remembered.status === 'unavailable') {
    return {
      status: 'unavailable',
      context,
      proposal: params.proposal,
      code: 'conversation_approval_invalid',
    };
  }

  // 风险规则只描述风险类别，不描述文件或远端目标。若允许在旧 token 后继续追加，
  // `rm file` 会错误覆盖 `rm file /`。因此风险命令只复用完全相同的可见 token；
  // 普通无风险命令仍可按 D21-c 的 token 前缀记忆。
  const rememberedCoversRisk = remembered.status === 'matched'
    && risk.status === 'matched'
    && candidate.status === 'derived'
    && remembered.approval.approvedCwd === params.proposal.cwd
    && candidate.candidate.token_prefix.length
      === remembered.approval.candidate.token_prefix.length
    && candidate.candidate.token_prefix.every(
      (token, index) => token === remembered.approval.candidate.token_prefix[index],
    );
  const uncoveredFindings = risk.status === 'matched' && !rememberedCoversRisk
    ? risk.findings
    : [];

  const obviousWrite = basePermission.base_level === 'read_only'
    && detectObviousShellWrite({
      command: params.proposal.command,
      platform: params.platform,
      shellSemanticsId: params.shellSemanticsId,
    });
  const needsStandardPermission = basePermission.base_level === 'read_only'
    && (
      params.permissionRequirement.level === 'standard'
      || risk.status === 'matched'
      || obviousWrite
    );
  const rememberedCoversRequest = remembered.status === 'matched'
    && uncoveredFindings.length === 0
    && (risk.status === 'matched' || needsStandardPermission);
  if (rememberedCoversRequest) {
    const permission = resolveApprovedCommandPermission({
      current: basePermission,
      source: 'conversation_approval',
    });
    if (permission.status === 'rejected') {
      return {
        status: 'unavailable',
        context,
        proposal: params.proposal,
        code: 'permission_resolution_failed',
      };
    }
    return {
      status: 'authorized',
      context,
      proposal: params.proposal,
      permission: permission.permission,
      evidence: {
        source: 'conversation_approval',
        approvalRequestId: remembered.approval.approvalRequestId,
      },
    };
  }

  if (uncoveredFindings.length > 0 || needsStandardPermission) {
    const reasons: CommandApprovalReason[] = [...riskReasons(uncoveredFindings)];
    if (needsStandardPermission) {
      reasons.unshift({
        type: 'permission_elevation',
        from_level: 'read_only',
        to_level: 'standard',
      });
    }
    return {
      status: 'approval_required',
      context,
      proposal: params.proposal,
      reasons,
      ...(candidate.status === 'derived'
        ? { conversationCandidate: candidate.candidate }
        : {}),
    };
  }

  return {
    status: 'authorized',
    context,
    proposal: params.proposal,
    permission: basePermission,
    evidence: { source: 'global_setting' },
  };
}
