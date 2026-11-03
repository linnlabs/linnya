import { randomUUID } from 'node:crypto';
import { DocumentReferenceMarkdownBindingSchema, JsonValueSchema, type DocumentReferenceMarkdownBinding, type JsonValue } from '@app/schemas';
import type { ReferenceMarkdownBaseline, ReferenceMarkdownPort } from '../definitions/referenceMarkdown';
import { collectDocumentReferenceInputs } from '../functions/referenceContent';
import { projectReferenceMarkdown, assertReferenceMarkdownBindings } from '../functions/projectReferenceMarkdown';
import { admitReferenceMarkdown } from '../functions/admitReferenceMarkdown';

interface ReferenceReadInput { readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string; readonly content: JsonValue }
/** 生命周期由数据库/插件实例拥有；不把 Agent 读取基线变成永久关系或模块全局状态。 */
export function createDocumentReferenceMarkdownRuntime(port: ReferenceMarkdownPort) {
  const reads = new Map<string, { readonly readerId: string; readonly baseline: ReferenceMarkdownBaseline }>();
  const key = (input: { readerId: string; sourceDocumentId: string; sourceKey: string }) => JSON.stringify([input.readerId, input.sourceDocumentId, input.sourceKey]);
  function registerRead(input: ReferenceReadInput) {
    const projected = projectReferenceMarkdown({ ...input, content: JsonValueSchema.parse(input.content) }, port);
    const previous = reads.get(key(input)); const presentIds = new Set(collectDocumentReferenceInputs(input.content).map(reference => reference.referenceId));
    const paths = new Map([...(previous?.baseline.bindings ?? []), ...projected.baseline.bindings].filter(binding => presentIds.has(binding.referenceId)).map(binding => [JSON.stringify([binding.referenceId, binding.targetDocumentId, binding.path, binding.label]), binding]));
    const baseline = { ...projected.baseline, bindings: [...paths.values()] };
    if (presentIds.size) { reads.delete(key(input)); reads.set(key(input), { readerId: input.readerId, baseline }); }
    while (reads.size > 1024) { const oldest = reads.keys().next().value; if (oldest === undefined) break; reads.delete(oldest); }
    return { content: projected.content, ...baseline };
  }
  function admit(input: ReferenceReadInput & { readonly existingContent?: JsonValue }) {
    return admitReferenceMarkdown({ ...input, content: JsonValueSchema.parse(input.content), baseline: reads.get(key(input))?.baseline }, port, randomUUID);
  }
  function assertBindings(input: { readonly sourceDocumentId: string; readonly bindings: readonly DocumentReferenceMarkdownBinding[] }) {
    assertReferenceMarkdownBindings(input.sourceDocumentId, input.bindings.map(binding => DocumentReferenceMarkdownBindingSchema.parse(binding)), port);
  }
  function clearReader(readerId: string) { for (const [readKey, value] of reads) if (value.readerId === readerId) reads.delete(readKey); }
  return { registerRead, admit, assertBindings, clearReader };
}
