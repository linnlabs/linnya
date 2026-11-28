/**
 * 标签基准的安全边界：只自动放行白名单里的 Shell 命令、结束时还原审计级别、默认只连隔离探针实例。
 * 纯逻辑放在这里，`run.mjs` 负责接线；判断规则有单元测试。
 */

/** 基准实际需要的程序：linnya CLI 与只读查看。不收 find（-exec/-delete）、sort（-o）、rg（--pre）等能写文件或执行命令的。 */
export const ALLOWED_PROGRAMS = Object.freeze(['linnya', 'cat', 'ls', 'grep', 'head', 'tail', 'wc', 'pwd', 'echo', 'cd']);

const ALLOWED = new Set(ALLOWED_PROGRAMS);
/** 只丢弃 stderr 的重定向不写文件，按原样放行。 */
const HARMLESS_REDIRECTS = /(^|\s)2>(?:\/dev\/null|&1)(?=\s|$)/gu;

const deny = reason => ({ allowed: false, reason });

/**
 * 按最小 shell 词法切分：单引号内全是文字；双引号内只有 `$(` 与反引号仍会执行。
 * 引号外的 `|`、`||`、`&&`、`;` 分段，每段首个词必须在白名单里；重定向、命令替换、后台执行与多行一律不放行。
 */
export function judgeShellCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return deny('空命令');
  if (/[\r\n]/u.test(command)) return deny('多行命令');
  const text = command.replace(HARMLESS_REDIRECTS, '$1');
  const segments = [[]];
  let word = '';
  let quote = null;
  const endWord = () => {
    if (word) segments.at(-1).push(word);
    word = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (char === '`' || (char === '$' && next === '(')) return deny('含命令替换');
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && next !== undefined) { word += next; index += 1; }
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '\\' && next !== undefined) { word += next; index += 1; continue; }
    if (char === '>' || char === '<') return deny('含重定向');
    if (char === '|' || char === ';' || (char === '&' && next === '&')) {
      endWord();
      if ((char === '|' && next === '|') || char === '&') index += 1;
      segments.push([]);
      continue;
    }
    if (char === '&') return deny('含后台执行');
    if (/\s/u.test(char)) { endWord(); continue; }
    word += char;
  }
  if (quote) return deny('引号未闭合');
  endWord();
  for (const segment of segments) {
    const program = segment[0];
    if (!program) return deny('空的命令段');
    if (!ALLOWED.has(program)) return deny(`程序 ${program} 不在白名单（${ALLOWED_PROGRAMS.join(', ')}）`);
  }
  return { allowed: true };
}

/** 白名单内只按“允许一次”放行，避免一次授权让同一对话后续命令绕过白名单；其余停止并报告。 */
export function decideCommandApproval(approval) {
  const verdict = judgeShellCommand(approval.command);
  if (!verdict.allowed) return { action: 'stop', reason: verdict.reason };
  if (!approval.available_choices?.includes('allow_once')) return { action: 'stop', reason: '审批没有“允许一次”选项' };
  return { action: 'reply', choice: 'allow_once' };
}

/**
 * 目标实例只允许用户本人批准命令时，驱动的自动放行做不了。认出这种拒绝并返回给评测人的处理办法；
 * 其他失败返回 undefined，照常抛出。按错误码识别，不依赖说明文字。
 */
export function externalApprovalRefusal(errorText) {
  if (!/"code"\s*:\s*"approval_requires_user"/u.test(String(errorText))) return undefined;
  return '目标实例只允许用户本人批准命令。在该实例的“设置 › 命令权限”里打开“允许命令行代为批准命令”后重跑；只在隔离的探针实例里打开，不要在日常实例里开';
}

/**
 * 审计级别是实例的运行默认值：apply 记下原级别再改，restore 改回（只改回一次）；run 保证异常时也改回。
 * 中断信号由调用方在退出前调用 restore。
 */
export function createAuditLevelGuard({ read, write }) {
  let original;
  let changed = false;
  let restoring;
  return {
    get original() { return original; },
    async apply(level) {
      original = await read();
      if (original === level) return;
      changed = true;
      await write(level);
    },
    restore() {
      if (!changed) return Promise.resolve();
      restoring ??= write(original).then(() => { changed = false; });
      return restoring;
    },
    async run(level, body) {
      await this.apply(level);
      try {
        return await body();
      } finally {
        await this.restore();
      }
    },
  };
}

export const DEFAULT_PROBE_NAME = 'tags-bench';

/**
 * 基准的目标实例。默认启动或复用当前 checkout 的隔离探针实例（独立 profile 与 Workspace）；
 * 要用其他实例（包括日常开发实例）必须同时显式给出 --connection-file 与 --db。
 * 不读取 LINNYA_CLI_CONNECTION_FILE，免得环境变量把基准悄悄指向日常实例。
 */
export async function resolveBenchmarkTarget(options, { startProbe }) {
  const connectionFile = options['connection-file'];
  const db = options.db;
  if (connectionFile || db) {
    if (!connectionFile) throw new Error('指定实例时 --db 必须与 --connection-file 一起给出');
    if (!db) throw new Error('指定实例时 --connection-file 必须与 --db 一起给出');
    if (options['probe-name']) throw new Error('--probe-name 与 --connection-file/--db 不能同时使用');
    return { kind: 'explicit', connectionFile, workspaceDb: db };
  }
  const name = options['probe-name'] ?? DEFAULT_PROBE_NAME;
  const probe = await startProbe(name);
  return { kind: 'probe', name, connectionFile: probe.connectionFile, workspaceDb: probe.workspaceDb };
}
