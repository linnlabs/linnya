/**
 * 所有进入受管 asset 链路的图片共享同一像素上限。
 *
 * 该限制同时约束用户图片、工具生成图和工具派生图，避免同一张图片先由生成工具接受，
 * 随后又在 managed-image-ingress 阶段因另一套像素政策失败。
 */
export const ASSET_IMAGE_MAX_PIXELS = 40_000_000;
