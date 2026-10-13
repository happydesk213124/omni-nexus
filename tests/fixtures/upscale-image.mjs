import { crc32, deflateSync } from 'node:zlib';
import { PNG_NAI_1X1 } from '../../tools/parity/host.mjs';
export function png(width, height) {
  const chunk=(name,data)=>{const c=Buffer.alloc(data.length+12);c.writeUInt32BE(data.length);c.write(name,4);data.copy(c,8);c.writeUInt32BE(crc32(c.subarray(4,-4)),c.length-4);return c;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from(PNG_NAI_1X1.subarray(0,8)),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
