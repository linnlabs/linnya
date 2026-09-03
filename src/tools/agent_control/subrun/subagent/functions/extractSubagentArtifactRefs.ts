import {
  ToolOutputBlobIdSchema,
  type SubagentArtifactRef,
} from '@app/schemas';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

import { isWorkspaceVfsInode } from '../../../../../shared/artifacts/artifactReference';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function appendUnique(
  artifact: SubagentArtifactRef,
  seen: Set<string>,
  artifacts: SubagentArtifactRef[],
): void {
  if (seen.has(artifact)) return;
  seen.add(artifact);
  artifacts.push(artifact);
}

/**
 * 只从正式生产者结果提取可交接产物，不扫描 observation，也不接纳任意 uri 字段。
 *
 * Workspace inode 由 write_file/edit_file 产生；ToolOutput blob 由执行层的
 * observation governance 以 tool_output.metadata.observationTruncation.blobId 发布。
 * 运行时产物身份不能注入具体工具的 owner data，否则会破坏其 strict schema。
 */
export function extractSubagentArtifactRefs(
  events: readonly RuntimeEvent[],
): SubagentArtifactRef[] {
  const seen = new Set<string>();
  const artifacts: SubagentArtifactRef[] = [];

  for (const event of events) {
    if (event.type !== 'tool_output' || event.status !== 'success') {
      continue;
    }

    if (
      isRecord(event.data)
      && (event.tool_name === 'write_file' || event.tool_name === 'edit_file')
    ) {
      const inode = typeof event.data['inode'] === 'string' ? event.data['inode'].trim() : '';
      if (isWorkspaceVfsInode(inode)) {
        appendUnique(inode, seen, artifacts);
      }
    }

    const truncation = isRecord(event.metadata?.['observationTruncation'])
      ? event.metadata['observationTruncation']
      : undefined;
    const parsedBlobId = ToolOutputBlobIdSchema.safeParse(truncation?.['blobId']);
    if (!parsedBlobId.success) continue;
    appendUnique(`tool_output://blobs/${parsedBlobId.data}`, seen, artifacts);
  }

  return artifacts;
}
