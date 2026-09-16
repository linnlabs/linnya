/** 此 fixture 在提交/刷新端口注入确定性文稿，不连接用户 Workspace。意外越界必须报错。 */
export function invokeRendererPluginIpc(): never {
  throw new Error('Preview smoke unexpectedly invoked Host IPC');
}
export function onRendererPluginPush(): never {
  throw new Error('Preview smoke unexpectedly subscribed to Host events');
}
export function notifyWorkspaceDocumentOpened(): never {
  throw new Error('Preview smoke unexpectedly opened a Workspace document');
}
