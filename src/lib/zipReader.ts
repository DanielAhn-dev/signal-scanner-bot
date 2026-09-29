/**
 * 아주 작은 ZIP 읽기 — DART document.xml·corpCode.xml이 ZIP으로 온다.
 * 중앙 디렉터리 기준으로 읽는다(로컬 헤더의 크기가 0으로 비어 있는 ZIP도 있어서). 저장(0)·deflate(8)만 지원.
 */
import { inflateRawSync } from "node:zlib";

export function readZipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`zip: unsupported method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
