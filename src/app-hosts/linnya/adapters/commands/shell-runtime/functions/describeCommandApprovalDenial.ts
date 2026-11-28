/**
 * 被拒命令交还给 Agent 的说明。拒绝方附了理由时原样带上（长度已由回复合同限定），
 * 让 Agent 知道该换什么做法；理由是对方写的文字，用引号标出，避免被读成系统指示。
 */
export function describeCommandApprovalDenial(denyReason: string | undefined): string {
  return denyReason === undefined
    ? 'The command was not approved.'
    : `The command was not approved. Reason given by whoever denied it: ${JSON.stringify(denyReason)}`;
}
