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
import type { PresentationComposeCompilationResult } from '../definitions/presentationBuildExecution';

/**
 * 可信 compose/layout CPU 工作。该函数只消费和返回 JSON DTO，不接触
 * Workspace、数据库、文件系统或 Electron；因此 in-process 测试 adapter 与
 * production Worker 可以共享完全相同的业务语义。
 */
export async function compilePresentationComposePayload(
  payload: SandboxJsonObject,
): Promise<PresentationComposeCompilationResult> {
  if (isFlexComposeInput(payload)) {
    try {
      await initYoga();
    } catch {
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
      return {
        ok: false,
        kind: 'compose_contract',
        message: safeComposeFailureSummary(error),
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

function safeComposeFailureSummary(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'The deck.js compose contract is invalid.';
}
