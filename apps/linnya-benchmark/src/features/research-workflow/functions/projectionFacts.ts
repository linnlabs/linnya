import {
  WorkspaceDocumentCitationSourceSchema,
  type WorkspaceReadFileCitation,
  type WorkspaceDocumentCitationSource,
} from '@app/schemas';
import type { Projection } from '../definitions/researchWorkflow';
import { hashText, hanCharacters } from './workflowFacts';

export function citationSnapshots(
  sources: readonly WorkspaceReadFileCitation[]
): WorkspaceDocumentCitationSource[] {
  return sources.map(source => {
    const { index: _index, ...snapshot } = source;
    return WorkspaceDocumentCitationSourceSchema.parse(snapshot);
  });
}

export function buildProjection(
  locator: string,
  text: string,
  representation: Projection['representation'],
  sources: readonly WorkspaceDocumentCitationSource[]
): Projection {
  // snippet 是当前窗口预算后的摘录，不是完整来源。保留已见变体，不拼接或猜补全文。
  const variants = [...new Set(sources.map(source => JSON.stringify(source)))].sort();
  const snapshots = variants.map(value =>
    WorkspaceDocumentCitationSourceSchema.parse(JSON.parse(value))
  );
  return {
    locator,
    text,
    representation,
    sha256: hashText(text),
    hanCharacters: hanCharacters(text),
    citationSnapshots: snapshots,
    versionHash: hashText(JSON.stringify({ representation, text, citationSnapshots: snapshots })),
  };
}
