import { NETWORK_FAILURE_MARKER } from '../../../../build/functions/transientNetworkFailure.cjs';
import {
  LOCAL_CI_FAILURE_DIGEST_LIMITS as LIMITS,
  type LocalCiFailedTest,
  type LocalCiFailureDigest,
} from '../definitions/localCiFailureDigest';
import type { LocalCiStepKind } from '../definitions/localCiSchedule';

const ANSI = /\u001b\[[0-9;]*m/gu;
/** vitest 默认报告在全部用例跑完后才输出失败段落；测试自己打印的错误与警告都在它之前。 */
const FAILURE_SECTION = /^⎯+ Failed (?:Tests|Suites) \d+ ⎯+$/u;
const OTHER_SECTION = /^⎯+ [^⎯]+ ⎯+$/u;
const ENTRY_SEPARATOR = /^⎯+(?:\[\d+\/\d+\]⎯*)?$/u;
/** 多项目配置时文件前有 `|项目名|`；多个用例报同一个错时，vitest 把几行 FAIL 连在一起、错误只打印一次。 */
const FAIL_LINE = /^ FAIL {2}(?:\|[^|]+\| )?(.+)$/u;
const LOCATION_LINE = /^ ❯ (?:.+ )?(\S+:\d+:\d+)$/u;
const FILE_LEVEL_FAILURE = /^(.+?) \[ .+ \]$/u;

function clip(line: string): string {
  return line.length > LIMITS.lineChars ? `${line.slice(0, LIMITS.lineChars - 1)}…` : line;
}

function splitFailName(name: string): { file: string; test: string } {
  const fileLevel = FILE_LEVEL_FAILURE.exec(name);
  if (fileLevel) return { file: fileLevel[1]!, test: '' };
  const at = name.indexOf(' > ');
  return at < 0 ? { file: name, test: '' } : { file: name.slice(0, at), test: name.slice(at + 3) };
}

/** 只读 vitest 失败段落：失败用例、断言消息与报错位置。不是 vitest 的步骤返回空列表。 */
export function parseVitestFailures(text: string): LocalCiFailedTest[] {
  const failures: LocalCiFailedTest[] = [];
  let inSection = false;
  let current: { names: string[]; message: string[]; location?: string } | null = null;
  const flush = () => {
    if (!current) return;
    for (const name of current.names) {
      failures.push({ ...splitFailName(name), message: current.message, ...(current.location ? { location: current.location } : {}) });
    }
    current = null;
  };
  for (const line of text.replace(ANSI, '').split('\n')) {
    if (FAILURE_SECTION.test(line)) {
      flush();
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (OTHER_SECTION.test(line)) {
      flush();
      inSection = false;
      continue;
    }
    if (ENTRY_SEPARATOR.test(line)) {
      flush();
      continue;
    }
    const fail = FAIL_LINE.exec(line);
    if (fail) {
      if (current && current.message.length === 0 && !current.location) current.names.push(fail[1]!);
      else {
        flush();
        current = { names: [fail[1]!], message: [] };
      }
      continue;
    }
    if (!current) continue;
    const location = LOCATION_LINE.exec(line);
    if (location && !current.location) {
      current.location = location[1]!;
      continue;
    }
    // 位置之后是代码片段，对判断原因没有帮助。
    if (current.location || !line.trim() || current.message.length >= LIMITS.messageLines) continue;
    current.message.push(clip(line.trimEnd()));
  }
  flush();
  return failures;
}

export function summarizeLocalCiFailure(logText: string, kind: LocalCiStepKind): LocalCiFailureDigest {
  const failures = parseVitestFailures(logText);
  const lines = logText.replace(ANSI, '').trimEnd().split('\n');
  return {
    kind,
    networkFailure: lines.some(line => line.startsWith(NETWORK_FAILURE_MARKER)),
    failedTestCount: failures.length,
    failedTests: failures.slice(0, LIMITS.tests),
    failedTestFiles: [...new Set(failures.map(failure => failure.file))].slice(0, LIMITS.files),
    tail: lines.slice(-LIMITS.tailLines).map(clip),
  };
}

/** 终端展示：有解析出的失败用例时只列用例，否则给日志末尾。 */
export function formatLocalCiFailureDigest(digest: LocalCiFailureDigest): string[] {
  const output: string[] = [];
  if (digest.networkFailure) output.push('网络失败：构建脚本重试后仍连不上（日志里有 [network-failure] 行），不是代码问题时重跑即可');
  if (digest.failedTestCount) {
    const shown = digest.failedTests.length;
    output.push(`失败用例 ${digest.failedTestCount} 个${digest.failedTestCount > shown ? `（列出前 ${shown} 个）` : ''}：`);
    for (const failure of digest.failedTests) {
      output.push(`  ✗ ${failure.file}${failure.test ? ` > ${failure.test}` : ''}`);
      output.push(...failure.message.map(line => `      ${line}`));
      if (failure.location) output.push(`      位置 ${failure.location}`);
    }
  } else {
    output.push(...digest.tail);
  }
  if (digest.isolatedRerun) {
    const rerun = digest.isolatedRerun;
    output.push(
      rerun.outcome === 'success'
        ? `隔离重跑 ${rerun.files.length} 个失败文件：通过。本轮仍判失败；多半是负载下的偶发，反复出现就把它改为独占执行`
        : `隔离重跑 ${rerun.files.length} 个失败文件：仍失败，是确定性失败`
    );
  }
  return output;
}
