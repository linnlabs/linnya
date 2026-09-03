/**
 * parseContext —— Doc 26 P0 plumbing：parser 警告上下文与 ParseWarning 通道
 *
 * ## 角色定位
 *
 * `inputParsers` 解析层历史上对"未知字段 / 已知字段类型错"的处理是
 * 静默 drop（详见 docs/26 §1）。本模块为后续 P1/P2 铺设结构化 warning
 * 通道，使解析过程可以**不阻塞**地把"AI 写错了什么"沿调用栈冒泡到
 * tool observation，让 AI 在下一轮自动修正。
 *
 * ## P0 范围（本提交）
 *
 * - 定义 `ParseWarning` / `ParseContext` 类型与 helper
 * - 提供 `pushParseWarning` 兼容 ctx 缺失场景（向后兼容）
 * - 提供 `formatParseWarnings` / `dedupeParseWarnings` 给编排层做最终格式化
 * - **不**强制现有 parser 在内部产生 warning；那是 P1 的工作
 *
 * ## 路径约定（path）
 *
 * 用 dotted + bracket 表达层级，与 JSON 习惯一致：
 * - 根：`''`
 * - field：`.foo`（root 时不加前导 `.`）
 * - index：`[3]`
 *
 * 例：`edits[2].operations[1].slide.elements[0]`
 *
 * 调用方应该用 `ctx.field(name)` / `ctx.index(i)` 派生子 ctx，
 * **不要**手动拼字符串，避免根/非根边界处理不一致。
 *
 * ## 与 editPresentation 现有 `parseWarnings: string[]` 的关系
 *
 * editPresentation pipeline 已有 string[] 通道（Doc 15 §10）。本模块的
 * 输出经 `formatParseWarnings` 压平成 string[] 后即可直接接到旧通道，
 * 因此结构化升级是**附加**，而非破坏性替换。
 */

export type ParseWarningSeverity = 'warn' | 'info';

/**
 * 解析层结构化警告。
 *
 * `path` 与 `code` 是机器可读字段，前者用于定位、后者用于按类型聚合 /
 * 限流 / 去重；`message` / `hint` 给 AI 与人类看。
 */
export interface ParseWarning {
  /** dotted + bracket 路径，定位错误位置；根级允许为空字符串 */
  path: string;
  /** 机器可读 code，建议小写 + snake_case，如 `unknown_field` / `invalid_type` */
  code: string;
  severity: ParseWarningSeverity;
  /** 人类可读描述（中英不限，先以英文为主，i18n 留待后续） */
  message: string;
  /** 修复建议（可选） */
  hint?: string;
}

/**
 * 仅用于 `ctx.push` / `pushParseWarning` 的传入形态：调用方不需要关心 path，
 * 由 ctx 自动注入当前路径。
 */
export type ParseWarningInput = Omit<ParseWarning, 'path'>;

/**
 * 解析上下文。`field` / `index` 派生子 ctx，子 ctx push 的 warning 共享同一
 * 个底层 collector，根 ctx 调用 `collected()` 即可拿到完整列表。
 */
export interface ParseContext {
  readonly path: string;
  /** 在当前 path 下追加一条 warning */
  push(warning: ParseWarningInput): void;
  /** 派生子 ctx：path 追加 `.name`（根 ctx 时不加前导 `.`） */
  field(name: string): ParseContext;
  /** 派生子 ctx：path 追加 `[i]` */
  index(i: number): ParseContext;
  /** 当前已收集的所有 warning（按 push 顺序，未去重未 cap） */
  collected(): ParseWarning[];
}

/** 创建一个根级 parse 上下文。`rootPath` 可选，默认 `''`。 */
export function createParseContext(rootPath = ''): ParseContext {
  const warnings: ParseWarning[] = [];
  return makeContext(rootPath, warnings);
}

function makeContext(path: string, sink: ParseWarning[]): ParseContext {
  return {
    path,
    push(warning) {
      sink.push({ path, ...warning });
    },
    field(name) {
      const next = path === '' ? name : `${path}.${name}`;
      return makeContext(next, sink);
    },
    index(i) {
      return makeContext(`${path}[${i}]`, sink);
    },
    collected() {
      // 返回浅拷贝，避免外部修改污染内部 sink。
      return sink.slice();
    },
  };
}

/**
 * 安全 push：ctx 为 undefined 时静默跳过。
 *
 * 设计目的：让 parser 内部的 warning 触发点不必每次 `if (ctx) ctx.push(...)`，
 * 现有"P0 不传 ctx"的旧调用路径也不会因为缺 ctx 而崩。
 */
export function pushParseWarning(
  ctx: ParseContext | undefined,
  warning: ParseWarningInput,
): void {
  if (!ctx) return;
  ctx.push(warning);
}

/**
 * 把结构化 warning 压平成 observation 友好的 string[]，与现有
 * editPresentation parseWarnings: string[] 通道兼容。
 *
 * 输出形态：`⚠ <code> <path>: <message>（<hint>）`
 */
export function formatParseWarnings(warnings: readonly ParseWarning[]): string[] {
  return warnings.map(formatOneParseWarning);
}

function formatOneParseWarning(w: ParseWarning): string {
  const icon = w.severity === 'warn' ? '⚠' : 'ℹ';
  const path = w.path ? ` ${w.path}` : '';
  const hint = w.hint ? `（${w.hint}）` : '';
  return `${icon} ${w.code}${path}: ${w.message}${hint}`;
}

export interface DedupeOptions {
  /** 同 (path,code) 对最多保留几条；默认 1 */
  maxPerPathCode?: number;
  /** 全局总条数 cap；默认 20 */
  maxTotal?: number;
}

/**
 * (path,code) 去重 + 全局 cap。observation 噪音控制走这里。
 *
 * 截断时**不**追加 "...省略 N 条"——保持纯净 list；调用方如需提示由其
 * 自行 append（observation 层语义不在本模块范围）。
 */
export function dedupeParseWarnings(
  warnings: readonly ParseWarning[],
  options: DedupeOptions = {},
): ParseWarning[] {
  const maxPerPathCode = options.maxPerPathCode ?? 1;
  const maxTotal = options.maxTotal ?? 20;
  const seen = new Map<string, number>();
  const out: ParseWarning[] = [];
  for (const w of warnings) {
    if (out.length >= maxTotal) break;
    const key = `${w.path}::${w.code}`;
    const count = seen.get(key) ?? 0;
    if (count >= maxPerPathCode) continue;
    seen.set(key, count + 1);
    out.push(w);
  }
  return out;
}
