import fs from 'node:fs';
import { createFileCredentialStorage } from '../createFileCredentialStorage';

const [filePath, writer, mode] = process.argv.slice(2);
if (!filePath || !writer) throw new Error('credential fixture arguments missing');
const storage = createFileCredentialStorage(filePath);
if (mode === 'crash') {
  // 模拟完成私有临时文件写入、尚未替换正式文件时进程退出。
  fs.renameSync = () => process.exit(78);
}
for (let index = 0; index < 20; index += 1) {
  await storage.update('fixture', new Map([[`${writer}-${index}`, `synthetic-${index}`]]));
}
