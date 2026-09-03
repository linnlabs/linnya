import {
  CommandRiskRuleCatalogSchema,
  type CommandRiskEvaluation,
  type CommandRiskRuleCatalog,
  type CommandRiskRuleMatcher,
} from '../definitions/commandRiskRule';
import { scanCommandRiskLexemes } from './scanCommandRiskLexemes';
import { commandSegmentFacts } from './rules/commandRiskLexicalFacts';
import {
  MACOS_COMMAND_RISK_CATALOG,
  matchesMacosRiskRule,
} from './rules/macos';
import {
  WINDOWS_COMMAND_RISK_CATALOG,
  matchesWindowsRiskRule,
} from './rules/windows';

export function resolveFixedRiskRuleCatalog(
  platform: 'macos' | 'windows',
): CommandRiskRuleCatalog {
  return platform === 'macos'
    ? MACOS_COMMAND_RISK_CATALOG
    : WINDOWS_COMMAND_RISK_CATALOG;
}

function matchesRule(params: {
  readonly platform: 'macos' | 'windows';
  readonly matcher: CommandRiskRuleMatcher;
  readonly scan: ReturnType<typeof scanCommandRiskLexemes>;
  readonly shellSemanticsId: string;
}): boolean {
  return params.platform === 'macos'
    ? matchesMacosRiskRule(params.matcher, params.scan)
    : matchesWindowsRiskRule(
      params.matcher,
      params.scan,
      params.shellSemanticsId,
    );
}

function findEmbeddedScript(params: {
  readonly platform: 'macos' | 'windows';
  readonly tokens: readonly string[];
}): {
  readonly script: string;
  readonly shellSemantics: 'zsh' | 'powershell' | 'cmd';
} | undefined {
  const executable = params.tokens[0]?.split(/[\\/]/u).pop()?.toLocaleLowerCase('en-US');
  if (!executable) return undefined;

  if (params.platform === 'macos') {
    if (executable === 'eval') {
      return { script: params.tokens.slice(1).join(' '), shellSemantics: 'zsh' };
    }
    if (!['sh', 'bash', 'zsh'].includes(executable)) return undefined;
    const commandIndex = params.tokens.findIndex(token => /^-[^-]*c[^-]*$/u.test(token));
    const script = commandIndex >= 0 ? params.tokens[commandIndex + 1] : undefined;
    return script ? { script, shellSemantics: 'zsh' } : undefined;
  }

  if (executable === 'iex' || executable === 'invoke-expression') {
    return {
      script: params.tokens.slice(1).join(' '),
      shellSemantics: 'powershell',
    };
  }
  if (executable === 'cmd' || executable === 'cmd.exe') {
    const commandIndex = params.tokens.findIndex(token => /^\/(?:c|k)/iu.test(token));
    if (commandIndex < 0) return undefined;
    const switchToken = params.tokens[commandIndex];
    const attachedScript = switchToken.slice(2);
    const script = [attachedScript, ...params.tokens.slice(commandIndex + 1)]
      .filter(part => part.length > 0)
      .join(' ');
    return script ? { script, shellSemantics: 'cmd' } : undefined;
  }
  if (!['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(executable)) {
    return undefined;
  }
  const commandIndex = params.tokens.findIndex(token => (
    /^-(?:c|command|commandwithargs)$/iu.test(token)
  ));
  const script = commandIndex >= 0
    ? params.tokens.slice(commandIndex + 1).join(' ')
    : '';
  return script ? { script, shellSemantics: 'powershell' } : undefined;
}

type RiskScanExpansion =
  | {
      readonly status: 'complete';
      readonly scan: ReturnType<typeof scanCommandRiskLexemes>;
    }
  | {
      readonly status: 'analysis_incomplete';
    };

function expandLiteralShellWrappers(
  scan: ReturnType<typeof scanCommandRiskLexemes>,
  depth = 0,
): RiskScanExpansion {
  const segments: Array<(typeof scan.segments)[number]> = [];
  for (const segment of scan.segments) {
    const facts = commandSegmentFacts(segment, scan.platform);
    if (facts.analysisStatus !== 'complete') {
      return { status: 'analysis_incomplete' };
    }
    const embedded = findEmbeddedScript({
      platform: scan.platform,
      tokens: facts.executableTokens,
    }) ?? findEmbeddedScript({
      platform: scan.platform,
      tokens: facts.originalTokens,
    });
    segments.push(segment);
    if (!embedded) continue;
    // 最深一层仍含可静态展开的 Shell 脚本，说明风险分析没有完成；继续放行会让
    // 多层 bash/cmd/PowerShell 包装绕过固定规则，因此这里明确失败关闭。
    if (depth >= 4) return { status: 'analysis_incomplete' };

    const nested = expandLiteralShellWrappers(scanCommandRiskLexemes({
      command: embedded.script,
      platform: scan.platform,
      shellSemantics: embedded.shellSemantics,
    }), depth + 1);
    if (nested.status !== 'complete') return nested;
    segments.push(...nested.scan.segments.map((nestedSegment, index) => ({
      ...nestedSegment,
      separatorBefore: index === 0
        ? 'substitution' as const
        : nestedSegment.separatorBefore,
    })));
  }
  return { status: 'complete', scan: { ...scan, segments } };
}

/**
 * catalog 作为 unknown 进入，是为了让打包制品损坏和版本错配也走稳定业务失败，
 * 而不是因为 TypeScript 源码曾经合法就默认运行时一定完整。
 */
export function matchFixedRiskRule(params: {
  readonly command: string;
  readonly platform: 'macos' | 'windows';
  readonly shellSemanticsId: string;
  readonly catalog?: unknown;
}): CommandRiskEvaluation {
  return evaluateFixedRiskScan({
    scan: scanCommandRiskLexemes({
      command: params.command,
      platform: params.platform,
      shellSemantics: params.platform === 'macos' ? 'zsh' : 'powershell',
    }),
    platform: params.platform,
    shellSemanticsId: params.shellSemanticsId,
    catalog: params.catalog,
  });
}

function evaluateFixedRiskScan(params: {
  readonly scan: ReturnType<typeof scanCommandRiskLexemes>;
  readonly platform: 'macos' | 'windows';
  readonly shellSemanticsId: string;
  readonly catalog?: unknown;
}): CommandRiskEvaluation {
  const parsedCatalog = CommandRiskRuleCatalogSchema.safeParse(
    params.catalog ?? resolveFixedRiskRuleCatalog(params.platform),
  );
  if (!parsedCatalog.success) {
    return { status: 'unavailable', code: 'risk_catalog_invalid' };
  }
  const catalog = parsedCatalog.data;
  if (
    catalog.platform !== params.platform
    || !catalog.shell_semantics_ids.includes(params.shellSemanticsId)
  ) {
    return { status: 'unavailable', code: 'unsupported_risk_context' };
  }

  const expanded = expandLiteralShellWrappers(params.scan);
  if (expanded.status !== 'complete') {
    return { status: 'unavailable', code: 'risk_matcher_failed' };
  }
  const scan = expanded.scan;
  try {
    const findings = catalog.rules
      .filter(rule => matchesRule({
        platform: params.platform,
        matcher: rule.matcher,
        scan,
        shellSemanticsId: params.shellSemanticsId,
      }))
      .map(rule => ({
        ruleId: rule.id,
        category: rule.category,
        priority: rule.priority,
      }))
      .sort((left, right) => (
        right.priority - left.priority || left.ruleId.localeCompare(right.ruleId)
      ));
    return findings.length > 0
      ? { status: 'matched', findings }
      : { status: 'not_matched' };
  } catch {
    return { status: 'unavailable', code: 'risk_matcher_failed' };
  }
}
