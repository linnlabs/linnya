/**
 * 图谱开关属于单个知识库，图谱抽取模型属于全局“模型配置·辅助模型”，且没有默认值。
 * 开关打开而模型为空时，后端上传与回填只会跳过抽取、写一条日志，所以必须由界面告诉用户。
 */
export function needsGraphExtractionModel(graphEnabled: boolean, graphExtractionModelId: string | null): boolean {
  return graphEnabled && graphExtractionModelId === null;
}
