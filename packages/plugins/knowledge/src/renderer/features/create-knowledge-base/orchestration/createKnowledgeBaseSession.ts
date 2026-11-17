interface KnowledgeCreationInput {
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly projectIds: readonly string[];
}
interface KnowledgeCreationDependencies {
  create(input: { name: string; description?: string }): Promise<{ knowledge_base: { id: string } }>;
  update(id: string, input: { name: string; description: string | null; tags: string[] }): Promise<void>;
  replaceProjects(id: string, projectIds: readonly string[]): Promise<void>;
  refresh(): Promise<void>;
}

/** 创建成功即保留身份；后续关联失败只重试同一个库，关闭表单不回滚用户已创建的实体。 */
export function createKnowledgeBaseSession(dependencies: KnowledgeCreationDependencies) {
  let createdId: string | null = null;
  return {
    reset() { createdId = null; },
    async save(input: KnowledgeCreationInput): Promise<string> {
      if (!createdId) {
        const created = await dependencies.create({ name: input.name, description: input.description || undefined });
        createdId = created.knowledge_base.id;
      }
      const id = createdId;
      // 重试期间用户仍可修订名称/描述，不静默沿用首次创建的输入。
      await dependencies.update(id, { name: input.name, description: input.description || null, tags: [...input.tags] });
      await dependencies.replaceProjects(id, input.projectIds);
      await dependencies.refresh();
      return id;
    },
  };
}
