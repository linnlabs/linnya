/**
 * 类型声明：pdf-parse-debugging-disabled
 * 
 * 这个包与pdf-parse接口兼容，只是修复了调试模式的bug
 */
declare module 'pdf-parse-debugging-disabled' {
  interface ParsedPdf {
    text: string;
    numpages: number;
    info: any;
    metadata: any;
  }

  function pdfParse(data: Buffer | Uint8Array): Promise<ParsedPdf>;
  export = pdfParse;
} 