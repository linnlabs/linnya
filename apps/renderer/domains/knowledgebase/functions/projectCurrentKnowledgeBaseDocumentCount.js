/** 只投影当前库的记录总数，不用未加载的其它库文档推算数量。 */
export function projectCurrentKnowledgeBaseDocumentCount(knowledgeBases, documents, kbId) {
  if (!kbId || !Array.isArray(knowledgeBases) || !Array.isArray(documents)) return null
  const count = documents.filter(document => document && document.kbId === kbId).length
  const index = knowledgeBases.findIndex(kb => kb && kb.id === kbId)
  if (index === -1) return null
  return { index, value: { ...knowledgeBases[index], documentCount: Math.max(0, Math.trunc(count)) } }
}
