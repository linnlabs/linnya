export interface PluginModelConfigurationPort {
  /** Host 已发布的默认角色；用户的显式用途选择仍由调用方冻结后传入。 */
  readDefaultModelIdByCapability(capability: 'pdf_ocr_default'): string | undefined;
  getModelDisplayName(modelId: string): string | undefined;
}

/** 只有用途和名称投影；模型目录、端点和凭据始终留在 Host。 */
export declare function getPluginModelConfigurationPort(): PluginModelConfigurationPort;
