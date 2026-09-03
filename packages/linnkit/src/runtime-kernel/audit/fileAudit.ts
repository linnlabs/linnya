import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEnvelope } from '../../contracts';
import type { AuditPort } from '../../ports';

export interface FileAuditOptions {
  filePath: string;
}

/**
 * JSONL 文件审计 sink。
 *
 * 中文备注：
 * - 每个 envelope 一行，便于 tail / grep / 后续导入 SIEM；
 * - 不做轮转与脱敏，轮转/脱敏属于 host 策略，后续由 G-4 RedactionPort 处理。
 */
export class FileAuditPort implements AuditPort {
  private readonly filePath: string;

  constructor(options: FileAuditOptions) {
    this.filePath = options.filePath;
  }

  async emit(envelope: AuditEnvelope): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(envelope)}\n`, 'utf8');
  }
}

export function createFileAudit(options: FileAuditOptions): AuditPort {
  return new FileAuditPort(options);
}
