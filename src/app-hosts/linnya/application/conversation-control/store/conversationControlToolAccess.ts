/** 临时开关归当前控制面实例所有；Host 重启重新关闭，不写入用户的 Web 设置。 */
export function createConversationControlToolAccess() {
  let webEnabled = false;
  return {
    isWebEnabled: () => webEnabled,
    setWebEnabled(enabled: boolean) {
      webEnabled = enabled;
    },
  };
}
