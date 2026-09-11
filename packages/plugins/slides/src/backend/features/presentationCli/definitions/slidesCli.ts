import type {
  PresentationInspectionRequest,
  ToolBuildStatus,
} from '@plugin/slides/shared';
import type {
  ConversationFileLocator,
  FileLocator,
} from '@app/schemas/file-locator';
import type {
  DiagnosticCategory,
  DiagnosticFinding,
  DiagnosticPriority,
  DiagnosticScope,
} from '../../../engine/quality/definitions';
import type { PresentationInspectionResult } from '../../presentationInspection';
import type {
  PluginFontFamilyCheckResult,
  PluginFontFamilyListRequest,
  PluginFontFamilyListResult,
} from '@plugin/backend/fontResolution';
import type {
  PresentationScreenshotRequest,
  PresentationScreenshotResult,
  SlidesScreenshotErrorCode,
} from '../../presentationScreenshot';

export const SLIDES_CLI_REPORT_KIND = 'linnya.slides.inspection-report' as const;
export const SLIDES_CLI_REPORT_VERSION = 8 as const;
export const SLIDES_CLI_FONT_CHECK_KIND = 'linnya.slides.font-check' as const;
export const SLIDES_CLI_FONT_LIST_KIND = 'linnya.slides.font-list' as const;
export const SLIDES_CLI_FONT_REPORT_VERSION = 1 as const;
export const SLIDES_CLI_RENDER_REPORT_KIND = 'linnya.slides.render-report' as const;
export const SLIDES_CLI_RENDER_REPORT_VERSION = 1 as const;
export const SLIDES_CLI_VERSION = '1.8.0' as const;

export const SlidesCliExitCode = {
  SUCCESS: 0,
  INVALID_ARGUMENTS: 2,
  PRESENTATION_UNAVAILABLE: 3,
  RENDER_FAILED: 4,
  OUTPUT_FAILED: 5,
  ENVIRONMENT_UNAVAILABLE: 6,
  INTERNAL_ERROR: 10,
} as const;

export type SlidesCliExitCode = (typeof SlidesCliExitCode)[keyof typeof SlidesCliExitCode];

interface SlidesCliPresentationCommandBase {
  readonly format?: 'json' | 'pretty';
  readonly databasePath?: string;
  readonly presentationId: string;
}

export interface SlidesCliRenderCommand extends SlidesCliPresentationCommandBase {
  readonly kind: 'render';
  /** 受管调用的输出目录；独立 CLI 未传入时由执行层生产 file: locator。 */
  readonly outputDirectoryReference?: ConversationFileLocator;
  readonly request: Omit<PresentationScreenshotRequest, 'presentationId'>;
}

export interface SlidesCliInspectCommand extends SlidesCliPresentationCommandBase {
  readonly kind: 'inspect';
  readonly request: Omit<PresentationInspectionRequest, 'presentationId'>;
}

export type SlidesCliPresentationCommand = SlidesCliRenderCommand | SlidesCliInspectCommand;

export interface SlidesCliFontCheckCommand {
  readonly format?: 'json' | 'pretty';
  readonly kind: 'fonts-check';
  readonly family: string;
}

export interface SlidesCliFontListCommand {
  readonly format?: 'json' | 'pretty';
  readonly kind: 'fonts-list';
  readonly request: PluginFontFamilyListRequest;
}

export type SlidesCliFontCommand = SlidesCliFontCheckCommand | SlidesCliFontListCommand;
export type SlidesCliCommand = SlidesCliPresentationCommand | SlidesCliFontCommand;

export type SlidesCliInvocation =
  | { readonly kind: 'help'; readonly text: string }
  | { readonly kind: 'command'; readonly command: SlidesCliCommand };

export interface SlidesCliExecutionPort {
  readonly renderScreenshots: (
    request: PresentationScreenshotRequest,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<PresentationScreenshotResult>;
  readonly inspectPresentation: (
    request: PresentationInspectionRequest
  ) => Promise<PresentationInspectionResult>;
}

export interface SlidesCliFontExecutionPort {
  readonly checkFontFamily: (family: string) => Promise<PluginFontFamilyCheckResult>;
  readonly listFontFamilies: (
    request: PluginFontFamilyListRequest
  ) => Promise<PluginFontFamilyListResult>;
}

export interface SlidesCliExecutionResult {
  readonly exitCode: SlidesCliExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

export type SlidesCliErrorCode =
  | 'slides.cli.invalid_arguments'
  | 'slides.cli.database_unavailable'
  | 'slides.cli.presentation_unavailable'
  | 'slides.cli.unresolved_draft'
  | 'slides.cli.font_catalog_unavailable'
  | SlidesScreenshotErrorCode
  | 'slides.cli.environment_unavailable'
  | 'slides.cli.internal_error';

export class SlidesCliError extends Error {
  readonly name = 'SlidesCliError';

  constructor(
    readonly code: SlidesCliErrorCode,
    readonly exitCode: SlidesCliExitCode,
    message: string
  ) {
    super(message);
  }
}

/** CLI 审计投影补充 registry 派生维度；finding 事实本身不重复存储它们。 */
export type SlidesCliDiagnosticFinding = DiagnosticFinding & {
  readonly action: string;
  readonly scope: DiagnosticScope;
  readonly category: DiagnosticCategory;
  readonly priority: DiagnosticPriority;
};

export interface SlidesCliDiagnosticRootGroup {
  readonly basis: 'declared_root' | 'shared_source';
  readonly key: string;
  readonly priority: DiagnosticPriority;
  readonly rootFindingId?: string;
  readonly findingIds: readonly string[];
}

export interface SlidesCliDiagnosticSummary {
  readonly rawFindingCount: number;
  readonly uniqueFindingCount: number;
  readonly rootGroupCount: number;
  readonly p0Count: number;
  readonly p1Count: number;
  readonly p2Count: number;
}

export interface SlidesCliInspectionReport {
  readonly kind: typeof SLIDES_CLI_REPORT_KIND;
  readonly schemaVersion: typeof SLIDES_CLI_REPORT_VERSION;
  readonly cliVersion: typeof SLIDES_CLI_VERSION;
  readonly presentation: {
    readonly id: string;
    readonly title: string;
    readonly versionId: string;
    readonly versionNumber: number;
    readonly sourceKind: PresentationInspectionResult['renderModel']['sourceKind'];
  };
  readonly slideSize: PresentationInspectionResult['renderModel']['slideSize'];
  readonly totalSlideCount: number;
  readonly requestedSlideNumbers: readonly number[];
  readonly shownSlideNumbers: readonly number[];
  readonly truncated: boolean;
  readonly buildStatus: ToolBuildStatus;
  readonly findingSummary: SlidesCliDiagnosticSummary;
  readonly rootGroups: readonly SlidesCliDiagnosticRootGroup[];
  readonly focus?: NonNullable<PresentationInspectionResult['feedback']['focus']>;
  /** 与 ppt_inspect 共享同一 finding 契约，不在 CLI 层二次降维。 */
  readonly findings: readonly SlidesCliDiagnosticFinding[];
}

export interface SlidesCliRenderReport {
  readonly kind: typeof SLIDES_CLI_RENDER_REPORT_KIND;
  readonly schemaVersion: typeof SLIDES_CLI_RENDER_REPORT_VERSION;
  readonly cliVersion: typeof SLIDES_CLI_VERSION;
  readonly presentation: {
    readonly id: string;
    readonly versionId: string;
    readonly versionNumber: number;
  };
  readonly slides: readonly {
    readonly slideNumber: number;
    readonly locator: FileLocator;
  }[];
}

export interface SlidesCliFontCheckReport extends PluginFontFamilyCheckResult {
  readonly kind: typeof SLIDES_CLI_FONT_CHECK_KIND;
  readonly schemaVersion: typeof SLIDES_CLI_FONT_REPORT_VERSION;
  readonly cliVersion: typeof SLIDES_CLI_VERSION;
}

export interface SlidesCliFontListReport extends PluginFontFamilyListResult {
  readonly kind: typeof SLIDES_CLI_FONT_LIST_KIND;
  readonly schemaVersion: typeof SLIDES_CLI_FONT_REPORT_VERSION;
  readonly cliVersion: typeof SLIDES_CLI_VERSION;
}
