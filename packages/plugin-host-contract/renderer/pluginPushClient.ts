export declare function onRendererPluginPush(
  pluginId: string,
  channel: string,
  callback: (payload: unknown) => void,
): () => void;
