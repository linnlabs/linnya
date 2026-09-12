import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';

import {
  compileFlexInput,
  initYoga,
  isFlexComposeInput,
} from '../../../codegen/compose/flex-layout';
import {
  readCompiledDirectComposeInput,
  readDirectComposeInput,
} from '../../../codegen/compose/presentationComposeInput';
import { isRecord } from '../../../codegen/compose/inputParsers/typeGuards';
import { projectSandboxJsonObject } from '../../../sandbox/sandboxJson';
import type {
  PresentationComposeCompilationResult,
  PresentationComposeDiagnosticsPort,
} from '../definitions/presentationBuildExecution';

/**
 * 可信 compose/layout CPU 工作。业务输入/输出只使用 JSON DTO，诊断窄端口仅报告内部 cause。
 * 不接触 Workspace、数据库、文件系统或 Electron；因此 in-process 测试 adapter 与
 * production Worker 可以共享完全相同的业务语义。
 */
export async function compilePresentationComposePayload(
  payload: SandboxJsonObject,
  diagnostics?: PresentationComposeDiagnosticsPort,
): Promise<PresentationComposeCompilationResult> {
  if (isFlexComposeInput(payload)) {
    try {
      await initYoga();
    } catch (error) {
      diagnostics?.recordRuntimeFailure({ phase: 'layout_initialize', slideCount: payload.slides.length, error });
      return {
        ok: false,
        kind: 'layout_unavailable',
        message: 'The Slides layout runtime is unavailable.',
      };
    }

    try {
      const compiled = compileFlexInput(payload);
      if (compiled.error || !compiled.input) {
        return {
          ok: false,
          kind: 'compose_contract',
          message: compiled.error ?? 'Flex compose input compile failed without an error summary.',
        };
      }
      // 正式 compose 提交的是整稿；底层诊断用部分结果不能成为可提交的成功文稿。
      if (compiled.rejectedSlides?.length) {
        return {
          ok: false,
          kind: 'compose_contract',
          message: compiled.rejectedSlides.map(slide => slide.reason).join('；'),
        };
      }
      const input = readTransportInput(compiled.input);
      const validated = readCompiledDirectComposeInput(input);
      if (validated.error || !validated.input) {
        return {
          ok: false,
          kind: 'compose_contract',
          message: validated.error ?? 'Flex compose output validation failed without an error summary.',
        };
      }
      return { ok: true, input };
    } catch (error) {
      diagnostics?.recordRuntimeFailure({ phase: 'compose_layout', slideCount: payload.slides.length, error });
      return {
        ok: false,
        kind: 'layout_unavailable',
        message: 'The Slides layout runtime failed. Retry the same source after restoring the runtime.',
      };
    }
  }

  if (isRecord(payload)) {
    const direct = readDirectComposeInput(payload);
    if (!direct.error && direct.input) {
      // Direct compose 的解析后对象是内部编译模型，并不承诺能再次作为公开输入解析
      // （例如 SVG source 会在首次解析时被规范化）。这里校验原始公开 DTO，返回时
      // 仍保留公开契约形态，让 App Server 的最终解析与迁移前完全一致。
      return { ok: true, input: readTransportInput(payload) };
    }
    return {
      ok: false,
      kind: 'compose_contract',
      message: direct.error ?? 'Compose input parse failed without an error summary.',
    };
  }

  return {
    ok: false,
    kind: 'compose_contract',
    message: 'Compose input parse failed: compose payload must be an object.',
  };
}

function readTransportInput(value: unknown): SandboxJsonObject {
  return projectSandboxJsonObject(value);
}
