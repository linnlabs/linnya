import { getWebAccessBlockKind, getWebFailureDiagnostics, getWebFailureKind } from '../../shared/webFailure';

/** 恢复建议只依据正式失败事实，不能从任意上游文案推断登录、验证码或链接来源。 */
export function buildWebReadFailureFeedback(error: unknown, params: {
  hostname: string;
  urlWasObserved?: boolean;
}): string {
  const kind = getWebFailureKind(error);
  if (kind === 'aborted' || kind === 'policy_denied') return '';
  const facts = getWebFailureDiagnostics(error);
  const reason = getWebAccessBlockKind(error)
    ?? (kind === 'managed_disabled'
      ? facts.previousFailureKind ?? facts.initialFailureKind ?? facts.escalationReason : kind);
  if (reason === 'login_required') return '页面明确要求登录。当前读取没有该登录会话；需要具备登录能力的读取路径或可公开取得的原件。';
  if (facts.challengeSignal) return '站点返回了访问验证页面；本工具不会执行或绕过验证，重复请求也不会改变访问条件。寻找实际可取得的副本，或在具备新的访问条件后再读。';
  if (reason === 'captcha' || reason === 'http_403') return '当前访问被拦截；重复请求不会改变访问条件。寻找实际可取得的副本，或在具备新的访问条件后再读。';
  if (reason === 'http_404' || facts.status === 410) {
    return `${params.urlWasObserved === false ? '此 URL 未在本会话正式来源/资源记录中出现，可能是推测地址或已失效链接；普通正文链接不一定被收录，未命中不等于编造。' : '目标地址不存在或已移除。'}先用 site:${params.hostname} 搜索定位真实页面，不继续按命名规律拼地址。`;
  }
  if (facts.status === 401) return '服务器拒绝了认证。当前没有取得正文；状态码本身不足以确认网页登录方式，需要有效访问凭据或公开来源。';
  if (reason === 'body_too_large') return '响应超过本次下载/渲染上限，未保存完整文件。max_chars 只控制返回文字量，不能扩大下载额度；可查找较小的正式文件或分页资源。';
  if (reason === 'unsupported_mime') return '该响应类型未被当前读取方式支持，未保存文件；查看已知类型，查找网页文本版或受支持的原件。';
  const guidance: string[] = [];
  if (facts.renderFailureKind === 'app_shell_not_rendered') {
    guidance.push('本机渲染已执行页面脚本，但前端应用在时限内仍未渲染出正文；重复读取同一地址通常不会改变结果。查找该页实际提供的原件、导出文件或公开接口链接。');
  } else if (facts.initialFailureKind === 'js_required' || facts.escalationReason === 'js_required' || reason === 'js_required') {
    guidance.push('静态 HTML 未提供可读正文，可能依赖 JavaScript。数据页常另有 CSV、XLSX 或公开接口；只跟随实际发现的链接，不猜接口地址。');
  }
  if (facts.renderFailureKind === 'unavailable' || facts.renderFailureKind === 'render_process_gone') {
    guidance.push('本机渲染能力本次不可用，这不表示网站永久不可读；恢复该能力后可再试。');
  }
  if (reason === 'timeout' || reason === 'network_error' || reason === 'http_5xx' || reason === 'rate_limited') {
    guidance.push('本次为超时、网络或上游暂时失败；可在等待或连接恢复后再试，当前未取得正文。');
  }
  if (facts.retryAfterMs !== undefined) guidance.push(`服务器要求至少等待 ${Math.ceil(facts.retryAfterMs / 1000)} 秒；本工具没有为等待而扩大本次预算。`);
  if (facts.retryStopReason === 'retry_limit') guidance.push('本次有界重试次数已用尽。');
  if (facts.retryStopReason === 'retry_after_limit') guidance.push('服务器要求的等待超过本次自动重试等待上限，未提前补发请求。');
  if (facts.retryStopReason === 'budget_exhausted') guidance.push('本次剩余时间不足以继续退避重试。');
  if (guidance.length === 0 && kind === 'managed_disabled') {
    guidance.push('本机抽取质量不足，且未配置第三方增强读取；优先检查实际发现的原件/数据链接，再寻找可取得的替代来源，并说明缺失。');
  }
  return guidance.join('\n');
}
