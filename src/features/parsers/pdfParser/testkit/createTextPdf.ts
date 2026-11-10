/**
 * 测试用最小 PDF：每页给若干行 ASCII 文字（Helvetica），或给 null 表示只有图形、没有文字层。
 * columns 页把两组行分别放在左右两栏。
 */
export type TextPdfPage =
  | readonly string[]
  | null
  | { readonly columns: readonly [readonly string[], readonly string[]] };

const escapePdfText = (text: string) => text.replace(/[\\()]/gu, match => `\\${match}`);

/** 以两个空格开头的行缩进 18pt，模拟段落首行缩进。 */
function textLines(lines: readonly string[], x: number): string[] {
  return lines.map((line, index) => {
    const indented = line.startsWith('  ');
    return `BT /F1 12 Tf ${indented ? x + 18 : x} ${760 - index * 18} Td (${escapePdfText(line.trimStart())}) Tj ET`;
  });
}

export function createTextPdf(pages: readonly TextPdfPage[]): Uint8Array {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((page, index) => {
    const content = page === null
      ? ['0.2 0.4 0.8 rg 72 600 300 120 re f']
      : !('columns' in page)
        ? textLines(page, 72)
        : [
          // 真实多栏页有页眉页脚和缩进等其他横坐标；现有峰值检测靠它们区分栏位。
          'BT /F1 9 Tf 40 810 Td (Running header) Tj ET',
          ...textLines(page.columns[0], 72),
          ...textLines(page.columns[1], 330),
          'BT /F1 9 Tf 540 30 Td (7) Tj ET',
        ];
    const stream = content.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  });

  let body = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}
