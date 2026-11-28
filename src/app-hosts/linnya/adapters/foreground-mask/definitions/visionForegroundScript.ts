/**
 * 交给 `osascript -l JavaScript` 执行的 JXA 脚本：用 Vision 的 VNGenerateForegroundInstanceMaskRequest（macOS 14+）
 * 生成前景遮罩，把不裁剪的整图（透明度即遮罩）写成 PNG。
 *
 * 为什么用系统脚本桥而不随包带 Swift 小程序：调用的是同一个系统接口，结果一样；不用在打包时编译通用二进制、
 * 进签名公证与签名校验清单，开发机和 CI 也不需要 Swift 工具链。代价是每次多约 0.1 秒的 osascript 启动。
 *
 * 输入输出路径只经 argv 传入，不拼进脚本文本。stdout 一行 JSON：`{"instances":N}`；N 为 0 时不写输出文件。
 * 失败时抛错，osascript 以非 0 退出，错误写在 stderr。
 */
export const VISION_FOREGROUND_SCRIPT = `
ObjC.import('Foundation');
ObjC.import('Vision');
ObjC.import('CoreImage');
ObjC.import('CoreGraphics');
function run(argv) {
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $({}));
  const request = $.VNGenerateForegroundInstanceMaskRequest.alloc.init;
  const error = $();
  if (!handler.performRequestsError($([request]), error)) throw new Error(ObjC.unwrap(error.localizedDescription));
  if (request.results.count === 0) return JSON.stringify({ instances: 0 });
  const observation = request.results.objectAtIndex(0);
  const buffer = observation.generateMaskedImageOfInstancesFromRequestHandlerCroppedToInstancesExtentError(observation.allInstances, handler, false, error);
  const image = $.CIImage.imageWithCVPixelBuffer(buffer);
  const space = $.CGColorSpaceCreateWithName($.kCGColorSpaceSRGB);
  const written = $.CIContext.context.writePNGRepresentationOfImageToURLFormatColorSpaceOptionsError(image, $.NSURL.fileURLWithPath(argv[1]), $.kCIFormatRGBA8, space, $({}), error);
  if (!written) throw new Error(ObjC.unwrap(error.localizedDescription));
  return JSON.stringify({ instances: Number(observation.allInstances.count) });
}
`;
