import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CHART_PRESET_NAMES,
  CHART_PRESETS,
  typecheckCodegenSource,
} from '@plugin/slides/backend-sandbox';
import { parseSlidesCliArgs } from '@plugin/slides/backend-cli-contract';
import { formatConversationFileLocator } from '@app/schemas/file-locator';

export const SLIDES_SKILL_ROOT_RELATIVE =
  'packages/plugins/slides/resources/skills/slides-design';

const REQUIRED_RESOURCES = [
  'SKILL.md',
  'references/chart-presets.md',
  'references/cli.md',
  'references/design.md',
  'references/layoutPrimitives.d.ts',
  'references/syntax.md',
  'references/examples/card-grid.js',
  'references/examples/brush-artwork.js',
  'references/examples/chart-analysis.js',
  'references/examples/complete-deck.js',
  'references/examples/cover-variants.js',
  'references/examples/media-and-paint.js',
  'references/examples/native-formula.js',
  'references/examples/table.js',
  'references/examples/timeline.js',
] as const;

const BANNED_LIVE_CONTRACTS = [
  { label: '已删除的 ppt_diagnose 工具', pattern: /\bppt_diagnose\b/u },
  { label: '模型不可观测的数字 errorCode', pattern: /\berrorCode\s*=?\s*\d/u },
  { label: '已退役的 family edit 工具', pattern: /\bppt_edit_(?:text|data|image|style|geometry|arrangement)\b/u },
  { label: '已退役的 ppt_manage_slides 工具', pattern: /\bppt_manage_slides\b/u },
  { label: '未向 Agent 暴露的 ppt_export 工具', pattern: /\bppt_export\b/u },
  { label: '不存在的 Slides CLI export 子命令', pattern: /\blinnya-slides\s+export\b/u },
  { label: '已删除的 Quality Gate 口径', pattern: /Quality Gate/u },
  { label: '已删除的 passed/blockers 验收口径', pattern: /passed[\s\S]{0,80}blockers/u },
  { label: '已删除的 blockers 质量字段', pattern: /\bblockers\b/u },
  { label: '会误导 Agent 在 conversation 外落盘的任意本地目录', pattern: /下载到任意本地(?:位置|目录)/u },
] as const;

export type SlidesSkillProblemKind =
  | 'missing-resource'
  | 'resource-budget'
  | 'instruction-budget'
  | 'broken-link'
  | 'banned-contract'
  | 'unvalidated-code-block'
  | 'invalid-example'
  | 'invalid-cli-example'
  | 'generated-reference-drift'
  | 'invalid-authoring-contract'
  | 'missing-workflow-contract'
  | 'missing-syntax-section';

export interface SlidesSkillProblem {
  readonly kind: SlidesSkillProblemKind;
  readonly path: string;
  readonly message: string;
}

export interface SlidesSkillCheckResult {
  readonly ok: boolean;
  readonly problems: readonly SlidesSkillProblem[];
  readonly resourceCount: number;
  readonly estimatedInstructionTokens: number;
  readonly validatedExamples: readonly string[];
  readonly validatedCliExamples: readonly string[];
}

export function renderChartPresetsReference(): string {
  const rows = CHART_PRESET_NAMES.map((name) => {
    const preset = CHART_PRESETS[name];
    return `| \`${name}\` | \`${preset.chartType}\` | ${preset.label} |`;
  });

  return [
    '<!-- Generated from packages/plugins/slides/src/backend/sandbox/chartPresets.ts. Do not edit by hand. -->',
    '',
    '# Chart presets',
    '',
    '| preset | chart type | label |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

export function estimateSkillInstructionTokens(content: string): number {
  const tokens = content.match(/[\u0080-\u{10FFFF}]|[A-Za-z0-9_]+|[^\sA-Za-z0-9_\u0080-\u{10FFFF}]/gu) ?? [];
  return tokens.reduce((total, token) => {
    if (/^[A-Za-z0-9_]+$/u.test(token)) {
      return total + Math.max(1, Math.ceil(token.length / 4));
    }
    return total + 1;
  }, 0);
}

export function runSlidesSkillCheck(options: {
  readonly repoRoot?: string;
  readonly skillRoot?: string;
  readonly skipTypecheck?: boolean;
} = {}): SlidesSkillCheckResult {
  const repoRoot = options.repoRoot ?? process.cwd();
  const skillRoot = options.skillRoot ?? path.join(repoRoot, SLIDES_SKILL_ROOT_RELATIVE);
  const problems: SlidesSkillProblem[] = [];

  for (const relativePath of REQUIRED_RESOURCES) {
    const absolutePath = path.join(skillRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      problems.push({
        kind: 'missing-resource',
        path: relativePath,
        message: `缺少正式 Skill 资源：${relativePath}`,
      });
    }
  }

  const resourceFiles = listFilesRecursively(skillRoot);
  if (resourceFiles.length > 20) {
    problems.push({
      kind: 'resource-budget',
      path: relativePath(skillRoot, skillRoot),
      message: `Skill 资源共 ${resourceFiles.length} 个，超过 20 个的上下文预算。`,
    });
  }

  const skillPath = path.join(skillRoot, 'SKILL.md');
  const skill = readIfPresent(skillPath);
  const estimatedInstructionTokens = estimateSkillInstructionTokens(skill);
  if (estimatedInstructionTokens > 5_000) {
    problems.push({
      kind: 'instruction-budget',
      path: 'SKILL.md',
      message: `SKILL.md 估算为 ${estimatedInstructionTokens} tokens，超过 5000。`,
    });
  }

  checkWorkflowContract(skill, problems);
  checkSyntaxCoverage(readIfPresent(path.join(skillRoot, 'references/syntax.md')), problems);
  checkGeneratedAuthoringContract(
    readIfPresent(path.join(skillRoot, 'references/layoutPrimitives.d.ts')),
    problems,
  );
  checkMarkdownLinks(skillRoot, resourceFiles, problems);
  checkLiveContracts(skillRoot, resourceFiles, problems);

  const generatedPath = path.join(skillRoot, 'references/chart-presets.md');
  if (readIfPresent(generatedPath) !== renderChartPresetsReference()) {
    problems.push({
      kind: 'generated-reference-drift',
      path: relativePath(skillRoot, generatedPath),
      message: 'chart-presets.md 与运行时 Chart preset 注册表不一致。',
    });
  }

  const validatedExamples: string[] = [];
  const examplesDir = path.join(skillRoot, 'references/examples');
  for (const examplePath of listFilesRecursively(examplesDir).filter((file) => file.endsWith('.js'))) {
    const source = fs.readFileSync(examplePath, 'utf-8');
    if (/\b(?:import|require)\b/u.test(source)) {
      problems.push({
        kind: 'invalid-example',
        path: relativePath(skillRoot, examplePath),
        message: '示例必须是 sandbox 可执行的 plain JavaScript，不能导入模块。',
      });
      continue;
    }
    // 每个示例都必须在 compose() 里声明 theme。theme 是 DECK_DESIGN 的唯一来源：
    // 不写 theme 的示例会让模型学到"新建文稿不需要视觉系统"，后续每次编辑都拿不到
    // 跨页锚点，只能回落到示例里硬编码的颜色常量——那等于把示例的配色变成产品默认风格。
    if (!/compose\(\{[\s\S]*\btheme\s*:/u.test(source)) {
      problems.push({
        kind: 'invalid-example',
        path: relativePath(skillRoot, examplePath),
        message: '示例必须在 compose() 中声明 theme，否则 DECK_DESIGN 永远为空骨架。',
      });
      continue;
    }
    if (!options.skipTypecheck) {
      const result = typecheckCodegenSource(source);
      if (!result.ok) {
        problems.push({
          kind: 'invalid-example',
          path: relativePath(skillRoot, examplePath),
          message: result.message,
        });
        continue;
      }
    }
    validatedExamples.push(path.basename(examplePath));
  }

  const validatedCliExamples = checkCliExamples(
    readIfPresent(path.join(skillRoot, 'references/cli.md')),
    problems,
  );

  return {
    ok: problems.length === 0,
    problems,
    resourceCount: resourceFiles.length,
    estimatedInstructionTokens,
    validatedExamples: validatedExamples.sort(),
    validatedCliExamples,
  };
}

function checkWorkflowContract(skill: string, problems: SlidesSkillProblem[]): void {
  const requiredPatterns = [
    { label: '有 ppt_plan 时提交计划', pattern: /有\s*`ppt_plan`/u },
    // 匹配"若无 / 没有 / 缺少 ppt_plan"等写法：这里要钉住的是"无工具时也要输出计划"
    // 这条合同，而不是某一次措辞。用精确短语会让无关的文案润色误伤 CI。
    { label: '没有 ppt_plan 时在对话输出计划', pattern: /(?:若无|没有|无)\s*`ppt_plan`/u },
    {
      label: '计划包含最小视觉方向合同',
      pattern: /visualDirection:\s*\{\s*concept,\s*composition,\s*signature\s*\}/u,
    },
    {
      label: '无工具计划与 ppt_plan 同构',
      pattern: /若无\s*`ppt_plan`[\s\S]{0,220}相同结构/u,
    },
    { label: '计划后等待用户批准', pattern: /等待用户明确批准/u },
    { label: '新建 Workspace Slides 使用 write_file locator', pattern: /write_file[\s\S]{0,120}locator="workspace:\//u },
    { label: 'presentation ID 来源', pattern: /presentation_id[\s\S]{0,160}details\.presentationId/u },
    { label: 'CLI inspect 主路径', pattern: /linnya-slides inspect --presentation/u },
    { label: '按需 render', pattern: /需要确认像素效果时才 render/u },
    { label: 'Agent 导出边界', pattern: /Agent 当前没有可调用的 PPTX export 工具/u },
    { label: '同因失败停止原样重试', pattern: /同一输入、同一错误 code 或同一 Shell exit code/u },
    { label: '最终 revision 像素验收', pattern: /最终 revision 上检查全部页面/u },
    { label: '同版截图只读取一次', pattern: /presentation\.versionId \+ slideNumber[\s\S]{0,80}最多读取一次/u },
    { label: '最终语言与单位核对', pattern: /语言一致性与单位表达/u },
    {
      label: '新资产默认写入 conversation 工作目录',
      pattern: /新下载或转换生成的资产[\s\S]{0,120}默认[\s\S]{0,80}conversation 工作目录/u,
    },
    {
      label: '新资产使用默认 cwd 与相对路径',
      pattern: /省略 `cwd`[\s\S]{0,100}相对 OS 路径[\s\S]{0,100}`requires_write_access: true`/u,
    },
    {
      label: '允许使用用户指定且获准的其他落点',
      pattern: /用户指定其他落点[\s\S]{0,100}已有其他目录的写入权限/u,
    },
    // 新建/改版必须写 theme：examples 全部不写 theme 时，DECK_DESIGN 永远是空骨架，
    // 跨页一致性锚点失效，模型只能回落到示例里的硬编码颜色。
    { label: '新建或整体改版必须声明 theme', pattern: /compose\(\{\s*theme\s*\}\)/u },
  ] as const;

  for (const requirement of requiredPatterns) {
    if (!requirement.pattern.test(skill)) {
      problems.push({
        kind: 'missing-workflow-contract',
        path: 'SKILL.md',
        message: `缺少流程合同：${requirement.label}`,
      });
    }
  }
}

function checkSyntaxCoverage(syntax: string, problems: SlidesSkillProblem[]): void {
  const requiredSections = [
    'Source 与 deck 顶层',
    '两种写法与它们的硬性区别',
    '页面、容器与父子关系',
    '坐标、尺寸与布局',
    '内容节点地图',
    '公开能力边界',
    'Text',
    'Shape、Paint 与层级',
    'Image',
    'Chart',
    'Table',
    '主题、设计系统与局部覆盖',
    '编辑与诊断',
  ] as const;

  for (const section of requiredSections) {
    if (!syntax.includes(section)) {
      problems.push({
        kind: 'missing-syntax-section',
        path: 'references/syntax.md',
        message: `语法地图缺少：${section}`,
      });
    }
  }

  const requiredBoundaryTerms = [
    '正式',
    '兼容',
    '内部/不支持',
    'chartOptions',
    'tableOptions',
    'styleDecision',
    'theme.logo',
    'Shape fill 的 `transparency` 是 0–100',
    'Image 的同名字段是 0–1',
  ] as const;
  for (const term of requiredBoundaryTerms) {
    if (!syntax.includes(term)) {
      problems.push({
        kind: 'missing-syntax-section',
        path: 'references/syntax.md',
        message: `语法说明缺少能力边界：${term}`,
      });
    }
  }
}

function checkGeneratedAuthoringContract(
  dts: string,
  problems: SlidesSkillProblem[],
): void {
  const forbiddenFields = ['chartOptions', 'tableOptions', 'styleDecision'] as const;
  for (const field of forbiddenFields) {
    if (new RegExp(`\\b${field}\\??:`, 'u').test(dts)) {
      problems.push({
        kind: 'invalid-authoring-contract',
        path: 'references/layoutPrimitives.d.ts',
        message: `生成类型不得把内部字段 ${field} 暴露为 deck.js authoring 属性。`,
      });
    }
  }

  if (/type\s+\w+\s*=\s*unknown;/u.test(dts)) {
    problems.push({
      kind: 'invalid-authoring-contract',
      path: 'references/layoutPrimitives.d.ts',
      message: '生成类型仍包含 unknown capability stub，Agent 无法发现精确高级语法。',
    });
  }

  const requiredDeclarations = [
    'type LayoutTextRun',
    'interface LayoutChartSeriesInput',
    'interface LayoutTableCellInput',
    'interface LayoutImageVisualShadowInput',
    'interface LayoutThemeInput',
    'function createChart(config: LayoutChartConfig)',
    'function createSlide(config?: LayoutSlideConfig)',
  ] as const;
  for (const declaration of requiredDeclarations) {
    if (!dts.includes(declaration)) {
      problems.push({
        kind: 'invalid-authoring-contract',
        path: 'references/layoutPrimitives.d.ts',
        message: `生成类型缺少精确 authoring 声明：${declaration}`,
      });
    }
  }
}

function checkMarkdownLinks(
  skillRoot: string,
  files: readonly string[],
  problems: SlidesSkillProblem[],
): void {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
  for (const filePath of files.filter((file) => file.endsWith('.md'))) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const match of content.matchAll(linkPattern)) {
      const rawTarget = match[1]?.trim() ?? '';
      if (!rawTarget || rawTarget.startsWith('#') || /^[a-z]+:/iu.test(rawTarget)) continue;
      const targetWithoutFragment = rawTarget.split('#', 1)[0];
      const targetPath = path.resolve(path.dirname(filePath), decodeURIComponent(targetWithoutFragment));
      if (!fs.existsSync(targetPath)) {
        problems.push({
          kind: 'broken-link',
          path: relativePath(skillRoot, filePath),
          message: `本地链接不存在：${rawTarget}`,
        });
      }
    }
  }
}

function checkLiveContracts(
  skillRoot: string,
  files: readonly string[],
  problems: SlidesSkillProblem[],
): void {
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const banned of BANNED_LIVE_CONTRACTS) {
      if (banned.pattern.test(content)) {
        problems.push({
          kind: 'banned-contract',
          path: relativePath(skillRoot, filePath),
          message: banned.label,
        });
      }
    }

    if (filePath.endsWith('.md') && /```(?:javascript|js)\b/iu.test(content)) {
      problems.push({
        kind: 'unvalidated-code-block',
        path: relativePath(skillRoot, filePath),
        message: 'Markdown 不得包含绕过示例 typecheck 的 JavaScript fenced block。',
      });
    }

  }
}

function checkCliExamples(
  cliReference: string,
  problems: SlidesSkillProblem[],
): string[] {
  const examples = [...cliReference.matchAll(/^- `linnya-slides ([^`]+)`$/gmu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  for (const example of examples) {
    try {
      parseSlidesCliArgs(example.split(/\s+/u), {
        resolveManagedRenderOutput: () => ({
          root: '/managed/slides-render',
          directoryReference: formatConversationFileLocator('slides-renders/example'),
        }),
      });
    } catch (error) {
      problems.push({
        kind: 'invalid-cli-example',
        path: 'references/cli.md',
        message: `${example}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (examples.length === 0) {
    problems.push({
      kind: 'invalid-cli-example',
      path: 'references/cli.md',
      message: '没有找到可送入真实 parser 的 Agent CLI 样例。',
    });
  }
  return examples;
}

function listFilesRecursively(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(root, entry.name);
      return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
    })
    .sort();
}

function readIfPresent(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
}

function relativePath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  return relative || '.';
}
