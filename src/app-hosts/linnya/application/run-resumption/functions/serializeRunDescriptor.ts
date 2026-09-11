import { RunDescriptorSchema, type RunDescriptor } from '../definitions/runDescriptor';

/** JSON 会静默忽略函数；恢复输入必须明确拒绝能力对象，不能保存一个残缺的“成功快照”。 */
export function serializeRunDescriptor(descriptor: RunDescriptor): string {
  const encoded = JSON.stringify(RunDescriptorSchema.parse(descriptor), (_key, value: unknown) => {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new Error('Run descriptor contains a non-serializable runtime capability');
    }
    return value;
  });
  return encoded;
}
