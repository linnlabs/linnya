/**
 * 源码开发不应依赖 Linnya Cloud，也不应生成 Cloud 设备身份或产生隐式外部请求。
 * 发布态是否真正开放由服务端账号鉴权边界独立决定，客户端条件不能充当安全控制。
 */
export function isLinnyaCloudClientEnabled(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  return environment.LINNYA_DEV_MODE !== 'true';
}
