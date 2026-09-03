/**
 * Model inference 的跨端合同与 Provider SDK 边界守卫。
 *
 * 这里只锁架构不变量：配置生产端不能恢复 legacy route，wire contract 不能复制，
 * Provider SDK 只能存在于 Linnya Host capability，Linnkit 核心只能依赖 canonical
 * contract。旧 codec、integration registry 与宽 AIEngine 已物理删除，本门禁阻止
 * 它们以兼容层名义回流。
 */
import fs from 'node:fs';
import path from 'node:path';

interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

const REPO_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.json']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'dist_build', 'coverage', '.git']);
const INFERENCE_CONTRACT_OWNER = 'packages/schemas/src/model-inference/';
const DOCUMENT_OCR_CONTRACT_OWNER = 'packages/schemas/src/document-ocr/';
const AI_SDK_OWNERS = [
  'src/app-hosts/linnya/adapters/inference/capabilities/ai-sdk/',
  'src/app-hosts/linnya/adapters/image-generation/capabilities/ai-sdk/',
] as const;
const LINNKIT_CORE_ROOTS = [
  'packages/linnkit/src/contracts/',
  'packages/linnkit/src/context-manager/',
  'packages/linnkit/src/ports/',
  'packages/linnkit/src/runtime-kernel/',
  'packages/linnkit/src/shared/',
] as const;
const INPUT_MATERIALIZATION_OWNER = 'src/app-hosts/linnya/adapters/llm-input-materialization/';
const TOKEN_ACCOUNTING_OWNER = 'src/app-hosts/linnya/adapters/token-accounting/';
const PROVIDER_OUTBOUND_AUDIT_OWNER = 'src/domains/audit/features/provider-outbound-audit/';
const PROVIDER_OUTBOUND_AUDIT_CONTRACT_OWNER = 'packages/schemas/src/provider-outbound-audit/';
const MODEL_CATALOG_OWNER = 'src/domains/model-catalog/';
const FORBIDDEN_LEGACY_MODEL_REGISTRY_DIRECTORY = 'src/model-registry/';
const FORBIDDEN_LEGACY_LLM_DIRECTORY = 'src/infra/adapters/llm/';
const FORBIDDEN_LEGACY_INTEGRATIONS_DIRECTORY = 'src/integrations/';
const FORBIDDEN_WIDE_AI_ENGINE_FILES = [
  'src/core/aiEngine.ts',
  'src/core/types.ts',
  'src/core/streamProcessor.ts',
] as const;
const FORBIDDEN_LEGACY_IMAGE_GENERATION = [
  'src/core/imageGenerationEngine.ts',
  'src/infra/adapters/image_generation/',
] as const;
const FORBIDDEN_LEGACY_INPUT_EGRESS = 'src/infra/adapters/llm/input-egress/';
const FORBIDDEN_LEGACY_PROVIDER_DEBUG_FILES = [
  'src/electron-main/routes/llmDebugRouter.ts',
  'apps/renderer/shared/services/llmDebugService.ts',
  'apps/renderer/domains/editor/ui/LlmRequestDebugPanel.vue',
] as const;
const FORBIDDEN_LEGACY_TOKEN_ACCOUNTING = [
  'src/infra/adapters/llm/token-counter.ts',
  'src/app-hosts/linnya/adapters/runtime/runCostCollector.ts',
  'src/app-hosts/linnya/adapters/runtime/runCostTelemetryPort.ts',
  'src/app-hosts/linnya/adapters/runtime/tokenCalibrationCollector.ts',
] as const;
const RENDERER_CONFIGURATION_OWNER = 'apps/renderer/domains/model-configuration/';
const RENDERER_OLLAMA_DISCOVERY_ADAPTER = `${RENDERER_CONFIGURATION_OWNER}features/ollama-model-registration/infrastructure/ollamaModelDiscoveryPort.ts`;
const FORBIDDEN_SETTINGS_MODEL_FILES = [
  'apps/renderer/domains/settings/definitions/addModelForm.ts',
  'apps/renderer/domains/settings/functions/buildUserLanguageModelRoute.ts',
  'apps/renderer/domains/settings/functions/modelInputCapability.ts',
  'apps/renderer/domains/settings/functions/ollamaModelFetchErrorPresentation.ts',
  'apps/renderer/domains/settings/ui/tabs/AddModelTab.vue',
  'apps/renderer/domains/settings/definitions/auxiliaryModelPurposes.ts',
  'apps/renderer/domains/settings/definitions/modelSettings.ts',
  'apps/renderer/domains/settings/ui/tabs/ModelConfigTab.vue',
  'apps/renderer/domains/settings/ui/common/ModelDetailsModal.vue',
  'apps/renderer/domains/settings/ui/common/AuxiliaryModelPurposeSelectGroup.vue',
  'apps/renderer/shared/services/ai/modelService.js',
  'apps/renderer/shared/stores/models.js',
  'apps/renderer/shared/stores/models.d.ts',
] as const;
const CONFIGURATION_ROOTS = [
  'apps/renderer/domains/settings/',
  RENDERER_CONFIGURATION_OWNER,
  'cloud/admin/src/',
  'cloud/src/model-config.ts',
  'cloud/src/models.ts',
  'cloud/src/types.ts',
  'src/domains/model-catalog/',
  'src/electron-main/routes/modelRouter.ts',
  'src/app-hosts/linnya/adapters/llm-input-materialization/registry/',
] as const;

function normalize(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function listSourceFiles(relativeRoot: string): string[] {
  const absoluteRoot = path.join(REPO_ROOT, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  if (fs.statSync(absoluteRoot).isFile()) return [relativeRoot];

  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(normalize(path.relative(REPO_ROOT, absolutePath)));
      }
    }
  };
  visit(absoluteRoot);
  return files;
}

function isTestFile(file: string): boolean {
  return /(?:^|\/)(__tests__\/|[^/]+\.(?:test|spec)\.)/u.test(file);
}

function occurrences(file: string, pattern: RegExp, rule: string, detail: string): Violation[] {
  const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  return content.split(/\r?\n/u).flatMap((line, index) => {
    pattern.lastIndex = 0;
    return pattern.test(line) ? [{ rule, file, line: index + 1, detail }] : [];
  });
}

function sdkImportOccurrences(file: string): Violation[] {
  const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const pattern = /(?:^|\n)\s*import(?:\s+type)?[\s\S]{0,300}?\sfrom\s*['"](?:ai|@ai-sdk\/[^'"]+)['"]|\bimport\(\s*['"](?:ai|@ai-sdk\/[^'"]+)['"]\s*\)/gu;
  return [...content.matchAll(pattern)].map(match => ({
    rule: 'INFERENCE-04',
    file,
    line: content.slice(0, match.index).split(/\r?\n/u).length,
    detail: 'Vercel AI SDK 只能由 Linnya Host ai-sdk capability 导入。',
  }));
}

function main(): void {
  const violations: Violation[] = [];
  for (const [directory, rule, detail] of [
    [
      FORBIDDEN_LEGACY_LLM_DIRECTORY,
      'INFERENCE-21',
      '旧 LLM adapter/codec 目录已删除，Provider 实现只能进入 Host capability。',
    ],
    [
      FORBIDDEN_LEGACY_INTEGRATIONS_DIRECTORY,
      'INFERENCE-22',
      '旧 DeepSeek/mixed integration registry 已删除，不得以扩展点名义恢复。',
    ],
    [
      FORBIDDEN_LEGACY_MODEL_REGISTRY_DIRECTORY,
      'INFERENCE-24',
      '后端模型目录已迁入 model-catalog domain，不得恢复旧 model-registry 兼容目录。',
    ],
  ] as const) {
    if (fs.existsSync(path.join(REPO_ROOT, directory))) {
      violations.push({ rule, file: directory, line: 1, detail });
    }
  }
  for (const file of FORBIDDEN_WIDE_AI_ENGINE_FILES) {
    if (fs.existsSync(path.join(REPO_ROOT, file))) {
      violations.push({
        rule: 'INFERENCE-23',
        file,
        line: 1,
        detail: '宽 AIEngine/StreamProcessor 已被窄能力 port 取代，不得恢复。',
      });
    }
  }
  for (const target of FORBIDDEN_LEGACY_IMAGE_GENERATION) {
    if (fs.existsSync(path.join(REPO_ROOT, target))) {
      violations.push({
        rule: 'INFERENCE-27',
        file: target,
        line: 1,
        detail: '图片生成已迁移到窄 domain port 与 Host AI SDK capability，不得恢复旧引擎或专用 adapter。',
      });
    }
  }
  if (fs.existsSync(path.join(REPO_ROOT, FORBIDDEN_LEGACY_INPUT_EGRESS))) {
    violations.push({
      rule: 'INFERENCE-13',
      file: FORBIDDEN_LEGACY_INPUT_EGRESS,
      line: 1,
      detail: '图片 profile/materialization 只能由 Linnya Host 模块拥有，旧 input-egress 目录不得恢复。',
    });
  }
  for (const file of FORBIDDEN_LEGACY_TOKEN_ACCOUNTING) {
    if (fs.existsSync(path.join(REPO_ROOT, file))) {
      violations.push({
        rule: 'INFERENCE-15',
        file,
        line: 1,
        detail: 'Host token accounting 只能由高内聚模块拥有，旧 LLM/runtime 文件不得恢复。',
      });
    }
  }
  for (const file of FORBIDDEN_LEGACY_PROVIDER_DEBUG_FILES) {
    if (fs.existsSync(path.join(REPO_ROOT, file))) {
      violations.push({
        rule: 'INFERENCE-17',
        file,
        line: 1,
        detail: 'Provider outbound 调试面已迁入统一 audit feature，旧 LLM debug 文件不得恢复。',
      });
    }
  }
  for (const file of FORBIDDEN_SETTINGS_MODEL_FILES) {
    if (fs.existsSync(path.join(REPO_ROOT, file))) {
      violations.push({
        rule: 'INFERENCE-05',
        file,
        line: 1,
        detail: 'Renderer 模型配置只能由 model-configuration 拥有，旧 Settings/shared 实现不得恢复。',
      });
    }
  }
  const configurationFiles = [...new Set(CONFIGURATION_ROOTS.flatMap(listSourceFiles))]
    .filter(file => !isTestFile(file));
  for (const file of configurationFiles) {
    violations.push(...occurrences(
      file,
      /legacy:[a-z0-9_-]+/iu,
      'INFERENCE-01',
      '配置生产与 admission 边界不得恢复 legacy capability。'
    ));
    violations.push(...occurrences(
      file,
      /\bapi_protocol\b/u,
      'INFERENCE-02',
      'chat route 不得恢复 api_protocol 旁路。'
    ));
    violations.push(...occurrences(
      file,
      /\bvision_pipeline\b/u,
      'INFERENCE-10',
      'OCR 配置不得恢复 vision_pipeline；必须使用 document_ocr_route。'
    ));
    violations.push(...occurrences(
      file,
      /["']?adapter["']?\s*[:=]\s*["']paddleocr(?:-layout-parsing|-job)?["']/iu,
      'INFERENCE-11',
      'OCR 配置不得恢复 adapter 字符串选路。'
    ));
  }

  const linnkitCoreFiles = [...new Set(LINNKIT_CORE_ROOTS.flatMap(listSourceFiles))]
    .filter(file => !isTestFile(file));
  const contractFiles = [
    ...listSourceFiles('src'),
    ...listSourceFiles('apps'),
    ...listSourceFiles('cloud'),
    ...listSourceFiles('packages/schemas/src'),
    ...linnkitCoreFiles,
  ]
    .filter(file => !isTestFile(file));
  for (const file of contractFiles) {
    if (!file.startsWith(INFERENCE_CONTRACT_OWNER)) {
      violations.push(...occurrences(
        file,
        /^\s*(?:export\s+)?(?:interface\s+Model(?:Inference|Embedding|Reranking|ImageGeneration)Route\b|type\s+Model(?:Inference|Embedding|Reranking|ImageGeneration)Route\s*=)/u,
        'INFERENCE-03',
        'Language、Embedding、Reranking 与 Image Generation route 只能由 @app/schemas/model-inference 定义。'
      ));
      violations.push(...occurrences(
        file,
        /^\s*(?:export\s+)?type\s+InferenceApiSurface\s*=/u,
        'INFERENCE-03',
        'InferenceApiSurface 只能由 @app/schemas/model-inference 定义。'
      ));
    }
    if (!file.startsWith(DOCUMENT_OCR_CONTRACT_OWNER)) {
      violations.push(...occurrences(
        file,
        /^\s*(?:export\s+)?(?:interface\s+DocumentOcrRoute\b|type\s+DocumentOcrRoute\s*=)/u,
        'INFERENCE-12',
        'DocumentOcrRoute 只能由 @app/schemas/document-ocr 定义。'
      ));
    }
    if (!file.startsWith(PROVIDER_OUTBOUND_AUDIT_CONTRACT_OWNER)) {
      violations.push(...occurrences(
        file,
        /^\s*(?:export\s+)?(?:interface\s+ProviderOutboundAttemptSnapshot\b|type\s+ProviderOutboundAttemptSnapshot\s*=)/u,
        'INFERENCE-18',
        'Provider outbound snapshot wire contract 只能由 @app/schemas/provider-outbound-audit 定义。'
      ));
    }
    if (!AI_SDK_OWNERS.some(owner => file.startsWith(owner))) {
      violations.push(...sdkImportOccurrences(file));
    }
    if (!file.startsWith(MODEL_CATALOG_OWNER)) {
      violations.push(...occurrences(
        file,
        /(?:from\s+['"]|import\(\s*['"])src\/domains\/model-catalog\//u,
        'INFERENCE-25',
        'Model Catalog 的外部消费者只能从 domain index 导入。'
      ));
    }
    violations.push(...occurrences(
      file,
      /\b(?:AIEngineImpl|AgentAiEngine|AgentAiEngineStreamContent)\b/u,
      'INFERENCE-23',
      '生产源码不得恢复宽 AIEngine 合同或实现。'
    ));
    if (file.startsWith(INPUT_MATERIALIZATION_OWNER)) {
      violations.push(...occurrences(
        file,
        /(?:from\s+['"]|import\(\s*['"])src\/infra\/adapters\/llm\//u,
        'INFERENCE-14',
        'Host 图片物化模块不得反向依赖旧 LLM adapter。'
      ));
    }
    if (file.startsWith(TOKEN_ACCOUNTING_OWNER)) {
      violations.push(...occurrences(
        file,
        /(?:from\s+['"]|import\(\s*['"])src\/infra\/adapters\/llm\//u,
        'INFERENCE-16',
        'Host token accounting 模块不得反向依赖旧 LLM adapter。'
      ));
    }
    if (file.startsWith(PROVIDER_OUTBOUND_AUDIT_OWNER)) {
      violations.push(...occurrences(
        file,
        /(?:from\s+['"]|import\(\s*['"])src\/infra\/adapters\/llm\//u,
        'INFERENCE-19',
        'Provider outbound audit feature 不得反向依赖旧 LLM adapter。'
      ));
    }
    if (file.startsWith('src/electron-main/') || file.startsWith('apps/renderer/')) {
      violations.push(...occurrences(
        file,
        /\/api\/v1\/debug\/llm(?:\/last-request)?/u,
        'INFERENCE-20',
        '旧 LLM debug endpoint 不得恢复；统一读取 Provider outbound snapshot。'
      ));
    }
    if (!file.startsWith(RENDERER_CONFIGURATION_OWNER)) {
      violations.push(...occurrences(
        file,
        /from\s+['"]@\/domains\/model-configuration\//u,
        'INFERENCE-06',
        'model-configuration 的外部消费者只能从 domain index 导入。'
      ));
    }
    if (
      file.startsWith('apps/renderer/domains/')
      && !file.startsWith('apps/renderer/domains/settings/')
    ) {
      violations.push(...occurrences(
        file,
        /from\s+['"]@\/domains\/settings\/(?!public['"])/u,
        'INFERENCE-07',
        '外部 domain 只能依赖 Settings 的 public 集成合同。'
      ));
    }
    if (file.startsWith(RENDERER_CONFIGURATION_OWNER)) {
      violations.push(...occurrences(
        file,
        /@shared\/stores\/models(?:\.js)?/u,
        'INFERENCE-08',
        'model-configuration 不得依赖旧宽 models store。'
      ));
      if (file !== RENDERER_OLLAMA_DISCOVERY_ADAPTER) {
        violations.push(...occurrences(
          file,
          /@shared\/services\/aiService/u,
          'INFERENCE-09',
          '旧 AI service 只能出现在 Ollama discovery 迁移适配器中。'
        ));
      }
    }
  }

  for (const file of linnkitCoreFiles) {
    violations.push(...occurrences(
      file,
      /\b(?:extra_content|thought_signature|reasoning_content|prompt_tokens|completion_tokens|prompt_tokens_details|completion_tokens_details|provider_metadata|providerMetadata|summary_supported|budget_tokens_by_effort|beforeRequest|afterResponse)\b/u,
      'INFERENCE-28',
      'Linnkit 核心只能消费 canonical contract；厂商 wire 字段与原始请求/响应 hook 必须留在 Host Provider capability。'
    ));
    violations.push(...occurrences(
      file,
      /\b(?:deepseek|gemini|google|anthropic|claude|openai|openrouter|moonshot|minimax|alibaba|qwen|kimi|glm)\b/iu,
      'INFERENCE-29',
      'Linnkit 核心不得按厂商或模型家族名称分支；路由、codec 与模型特性属于 Host。'
    ));
  }

  if (violations.length > 0) {
    console.error('Model inference boundary guard 发现违规：');
    for (const violation of violations) {
      console.error(
        `- [${violation.rule}] ${violation.file}:${violation.line} ${violation.detail}`
      );
    }
    process.exit(1);
  }
  console.log('✓ model inference boundary guard: no violations');
}

main();
