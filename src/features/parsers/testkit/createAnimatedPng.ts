import { crc32, deflateSync } from 'node:zlib';

/** W3C PNG Third Edition：两帧 RGBA APNG，完整 IHDR/acTL/fcTL/IDAT/fdAT/IEND 与 CRC。 */
export function createAnimatedPng(): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const tag = Buffer.from(type, 'ascii');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
    return Buffer.concat([header, tag, data, crc]);
  }
  function control(sequence: number): Buffer {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(1, 4); data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22);
    return data;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2, 0);
  const secondSequence = Buffer.alloc(4);
  secondSequence.writeUInt32BE(2);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('acTL', animation), chunk('fcTL', control(0)),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('fcTL', control(1)),
    chunk('fdAT', Buffer.concat([secondSequence, deflateSync(Buffer.from([0, 0, 255, 0, 255]))])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
