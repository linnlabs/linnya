/**
 * @file rendererPermissionPolicy.ts
 * @description Electron renderer permission policy.
 */

/**
 * 中文备注：
 * - 当前 Electron 的 async clipboard 写入权限名是 `clipboard-sanitized-write`；
 * - 复制按钮只需要写剪贴板，不需要读剪贴板，因此不要放行 `clipboard-read`。
 */
const ALLOWED_RENDERER_PERMISSIONS = new Set<string>([
  'media',
  'audioCapture',
  'clipboard-sanitized-write',
]);

export function shouldAllowRendererPermission(permission: string): boolean {
  return ALLOWED_RENDERER_PERMISSIONS.has(permission);
}
