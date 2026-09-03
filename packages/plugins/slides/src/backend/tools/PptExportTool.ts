import { BaseTool, type ToolContext, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import type { StructuredToolResult } from '@plugin/backend/toolRuntime';
import {
  readRequiredStringArg,
  requirePresentationCoordinator,
} from '@plugin/slides/backend-tools';

interface PptExportData {
  presentationId: string;
  fileName: string;
  sizeBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export class PptExportTool extends BaseTool {
  readonly name = 'ppt_export';

  get description() {
    return [
      '将演示文稿导出为 PPTX 文件。',
      '返回文件名和大小。导出后用户可以下载该文件。',
    ].join(' ');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      presentationId: {
        type: 'string',
        description: '要导出的演示文稿 ID',
      },
    },
    required: ['presentationId'],
  };

  getExecutionSummary(output: string): string {
    try {
      const result: unknown = JSON.parse(output);
      const data = isRecord(result) ? result.data : undefined;
      if (!isRecord(data)) return '导出 PPTX';
      if (typeof data.error === 'string') return `导出失败: ${data.error}`;
      if (typeof data.fileName === 'string') return `已导出 ${data.fileName}`;
      return '导出 PPTX';
    } catch {
      return '导出 PPTX';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error ?? 'ppt_export: invalid arguments.');
    }

    const coordinator = requirePresentationCoordinator(context);

    const presentationId = readRequiredStringArg(args, 'presentationId');
    if (!presentationId) {
      throw new Error('presentationId must be a non-empty string.');
    }

    const exported = await coordinator.export(presentationId);

    const data: PptExportData = {
      presentationId,
      fileName: exported.fileName,
      sizeBytes: exported.buffer.length,
    };

    const sizeKB = Math.round(exported.buffer.length / 1024);
    const result: StructuredToolResult<PptExportData> = {
      data,
      observation: `已导出 ${exported.fileName}（${sizeKB} KB），用户可以下载。`,
    };

    return JSON.stringify(result);
  }
}
