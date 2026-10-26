import { WEB_READ_QUALITY_SIGNAL_VALUES } from '@app/schemas';
import { getWebAccessBlockKind, getWebFailureDiagnostics, getWebFailureKind } from '../../shared/webFailure';
import { getWebFileFormat } from '../file-acquisition/functions/validateWebFile';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

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
  const subresourceFailures = facts.subresourceFailureCount !== undefined
    ? `页面所需的 ${facts.subresourceFailureCount} 个脚本或样式表下载失败${facts.subresourceError ? `（如 ${facts.subresourceError}）` : ''}`
    : '';
  const dataRequestFailures = facts.dataRequestFailureCount !== undefined
    ? `页面有 ${facts.dataRequestFailureCount} 个数据请求（XHR/fetch）传输失败${facts.dataRequestError ? `（如 ${facts.dataRequestError}）` : ''}`
    : '';
  const pageRequestFailures = [subresourceFailures, dataRequestFailures].filter(Boolean).join('，');
  const renderNetworkFailure = facts.renderFailureKind === 'load_failed'
    && facts.netErrorCode !== undefined && facts.netErrorCode <= -100;
  const renderTimedOutWithFailures = facts.renderFailureKind === 'load_timeout' && pageRequestFailures !== '';
  if (facts.renderFailureKind === 'app_shell_not_rendered') {
    guidance.push(pageRequestFailures
      ? `本机渲染时${pageRequestFailures}，可能影响正文加载，但无法仅凭这些失败确定正文缺失的原因；不代表页面没有正文。可稍后重试，或查找该页实际提供的原件、导出文件或公开接口链接。`
      : '本机渲染已执行页面脚本，但前端应用在时限内仍未渲染出正文；重复读取同一地址通常不会改变结果。查找该页实际提供的原件、导出文件或公开接口链接。');
  } else if (facts.initialFailureKind === 'js_required' || facts.escalationReason === 'js_required' || reason === 'js_required') {
    guidance.push('静态 HTML 未提供可读正文，可能依赖 JavaScript。数据页常另有 CSV、XLSX 或公开接口；只跟随实际发现的链接，不猜接口地址。');
  }
  if (facts.renderFailureKind === 'unavailable' || facts.renderFailureKind === 'render_process_gone') {
    guidance.push('本机渲染能力本次不可用，这不表示网站永久不可读；恢复该能力后可再试。');
  }
  if (renderNetworkFailure) {
    guidance.push(`本机渲染加载网页时网络或 TLS 连接失败（net_error=${facts.netErrorCode}）；这通常是站点或本机网络路径的问题，不是页面没有正文。可稍后重试，或寻找其他主机上的副本。`);
  } else if (renderTimedOutWithFailures) {
    guidance.push(`本机渲染时${pageRequestFailures}，页面结构在时限内未就绪；这更像网络或站点暂时问题，可稍后重试，或寻找其他主机上的副本。`);
  }
  const fileDownload = facts.contentType !== undefined && getWebFileFormat(facts.contentType) !== undefined;
  if (reason === 'timeout' && fileDownload && facts.bodyBytes !== undefined) {
    const declared = facts.declaredBodyBytes !== undefined ? `，响应声明 ${formatBytes(facts.declaredBodyBytes)}` : '';
    guidance.push(`文件下载在本次时限内未完成：已收 ${formatBytes(facts.bodyBytes)}${declared}，未保存文件。可稍后重试，或查找较小的版本、分卷或网页文本版；Shell 另行下载的副本没有来源身份，不能代替正式取得。`);
  } else if (!renderNetworkFailure && !renderTimedOutWithFailures
    && (reason === 'timeout' || reason === 'network_error' || reason === 'http_5xx' || reason === 'rate_limited')) {
    guidance.push('本次为超时、网络或上游暂时失败；可在等待或连接恢复后再试，当前未取得正文。');
  }
  if (facts.retryAfterMs !== undefined) guidance.push(`服务器要求至少等待 ${Math.ceil(facts.retryAfterMs / 1000)} 秒；本工具没有为等待而扩大本次预算。`);
  if (facts.retryStopReason === 'retry_limit') guidance.push('本次有界重试次数已用尽。');
  if (facts.retryStopReason === 'retry_after_limit') guidance.push('服务器要求的等待超过本次自动重试等待上限，未提前补发请求。');
  if (facts.retryStopReason === 'budget_exhausted') guidance.push('本次剩余时间不足以继续退避重试。');
  // 质量信号只在页面已取得、但正文不合格时出现；其它失败不能被说成“质量不足”。
  const qualitySignal = kind === 'managed_disabled' && facts.previousFailureKind === undefined
    ? WEB_READ_QUALITY_SIGNAL_VALUES.find(signal => signal === facts.escalationReason) : undefined;
  const rendered = facts.renderAttempted ? '（已尝试本机渲染）' : '';
  const chars = facts.extractedChars !== undefined ? `${facts.extractedChars} 字` : '很少';
  if (qualitySignal === 'content_too_short') {
    guidance.push(`已取得的正文只有 ${chars}${rendered}，可能不完整；短通知也可能就是全文，但附带的摘录不能作为引用来源。可检查页面发现的原件或数据链接，或寻找可取得完整正文的来源。当前未配置第三方增强读取。`);
  } else if (qualitySignal) {
    guidance.push(`页面以模板、表格或列表为主，抽取到的正文只有 ${chars}${rendered}，可能遗漏主要内容；可检查页面发现的原件或数据链接，或寻找可取得完整正文的来源。当前未配置第三方增强读取。`);
  } else if (reason === 'empty_content' && guidance.length === 0) {
    guidance.push(`页面已取得，但没有可读正文${facts.renderAttempted ? '，本机渲染后仍为空' : ''}；可能是入口或导航页、只含图片，或需要交互。优先检查实际发现的原件或数据链接，再寻找替代来源。`);
  }
  if (guidance.length === 0 && kind === 'managed_disabled') {
    guidance.push('本机读取未取得合格正文，且未配置第三方增强读取；优先检查实际发现的原件/数据链接，再寻找可取得的替代来源，并说明缺失。');
  }
  return guidance.join('\n');
}
