import { fromBuffer, type Entry } from 'yauzl';
import { load } from 'cheerio';
import { WebFailureError } from '../../../shared/webFailure';
import type { WebFilePayload } from '../definitions/webFileAcquisition';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIMES = new Set(['text/csv', 'application/csv']);
const XLSX_WORKBOOK_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

/** 响应头只决定下载预算；实际字节仍须通过下面的类型校验才能保存。 */
export function getWebFileFormat(contentType: string): WebFilePayload['format'] | undefined {
  const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === XLSX_MIME) return 'xlsx';
  if (mimeType && CSV_MIMES.has(mimeType)) return 'csv';
  return undefined;
}

function invalidFile(): WebFailureError {
  return new WebFailureError(
    'unsupported_mime',
    '文件内容与允许的 PDF、CSV、XLSX 类型不符，或包含宏/超出容器检查预算；未保存文件。'
  );
}

/** 只检查 ZIP 目录及小型内容类型声明，不解压工作表、更不执行 Office 内容。 */
async function validateXlsx(bytes: Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(invalidFile());
          return;
        }
        let entries = 0;
        let expandedBytes = 0;
        let workbook = false;
        let contentTypes = false;
        const names = new Set<string>();
        const fail = (): void => {
          zip.close();
          reject(invalidFile());
        };
        zip.on('error', fail);
        zip.on('end', () => {
          zip.close();
          if (workbook && contentTypes) resolve();
          else reject(invalidFile());
        });
        zip.on('entry', (entry: Entry) => {
          entries += 1;
          expandedBytes += entry.uncompressedSize;
          if (
            entries > 4096 ||
            expandedBytes > 50 * 1024 * 1024 ||
            names.has(entry.fileName) ||
            (entry.generalPurposeBitFlag & 1) !== 0 ||
            /vba|macrosheets/i.test(entry.fileName)
          ) {
            fail();
            return;
          }
          names.add(entry.fileName);
          if (entry.fileName === 'xl/workbook.xml') workbook = true;
          if (entry.fileName !== '[Content_Types].xml') {
            zip.readEntry();
            return;
          }
          if (entry.uncompressedSize > 64 * 1024) {
            fail();
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail();
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 64 * 1024) {
                stream.destroy();
                fail();
                return;
              }
              chunks.push(chunk);
            });
            stream.on('end', () => {
              const xml = Buffer.concat(chunks).toString('utf8');
              if (/macroEnabled|vbaProject|macrosheet|<!DOCTYPE|<!ENTITY/i.test(xml)) {
                fail();
                return;
              }
              const types = load(xml, { xmlMode: true });
              const workbookTypes = types('Types > Override')
                .toArray()
                .filter(element => types(element).attr('PartName') === '/xl/workbook.xml');
              if (
                workbookTypes.length !== 1 ||
                types(workbookTypes[0]).attr('ContentType') !== XLSX_WORKBOOK_TYPE
              ) {
                fail();
                return;
              }
              contentTypes = true;
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      }
    );
  });
}

export async function validateWebFile(input: {
  mimeType: string;
  bytes: Uint8Array;
  decodedText: string;
}): Promise<WebFilePayload | undefined> {
  const { bytes, mimeType } = input;
  const format = getWebFileFormat(mimeType);
  const prefix = Buffer.from(bytes.subarray(0, 32)).toString('latin1');
  if (format === 'pdf') {
    if (!/^%PDF-[12]\.\d(?:\s|$)/.test(prefix)) throw invalidFile();
    return { bytes, format: 'pdf' };
  }
  if (format === 'xlsx') {
    if (!prefix.startsWith('PK\x03\x04')) throw invalidFile();
    await validateXlsx(bytes);
    return { bytes, format: 'xlsx' };
  }
  if (format === 'csv') {
    // CSV 没有魔数。按声明的文本编码解码，拒绝二进制控制符及常见伪装正文；不执行公式。
    if (
      !input.decodedText.trim() ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(input.decodedText) ||
      /^(?:PK\x03\x04|%PDF-|\x7fELF)/.test(prefix) ||
      /^\s*(?:<!doctype\s+html|<html\b|<script\b)/i.test(input.decodedText)
    )
      throw invalidFile();
    return { bytes, format: 'csv' };
  }
  return undefined;
}
