// main.ts — penyalin/validator entry.png untuk make.fun news-image-20261125.
// Node STDLIB-ONLY (node:fs, node:path, node:url). Tanpa network, tanpa jam,
// tanpa acak, dan TIDAK PERNAH membaca/menulis process.cwd().
//
// Cara pakai:
//   MAKEFUN_OUTPUT_DIR=/output node main.ts
// Menyalin entry.png dari DIREKTORI REPO (dirname dari import.meta.url) ke
// $MAKEFUN_OUTPUT_DIR/entry.png (default "/output"), setelah memvalidasi PNG:
// magic 8 byte, ukuran <= 1 MiB, chunk IEND ada, dan CRC-32 tiap chunk cocok.
// Menolak menulis bila output jatuh di dalam repo (exit 1).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(REPO_DIR, 'entry.png');
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DEST = join(OUT_DIR, 'entry.png');
const MAX_BYTES = 1024 * 1024;

// Tabel CRC-32 (IEEE 802.3), dibangun sekali saat start.
const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fail(message: string): never {
  console.error('error: ' + message);
  process.exit(1);
}

// Guard: output harus path absolut (path relatif akan bergantung pada cwd,
// dan skrip ini tidak pernah memakai cwd).
if (!isAbsolute(OUT_DIR)) {
  fail('MAKEFUN_OUTPUT_DIR must be an absolute path, got: ' + OUT_DIR);
}

// Guard: tolak bila output jatuh di dalam repo.
const repoRoot = REPO_DIR.endsWith(sep) ? REPO_DIR : REPO_DIR + sep;
if (DEST === SRC || DEST.startsWith(repoRoot)) {
  fail('refusing to write output inside the repo: ' + DEST);
}

if (!existsSync(SRC)) fail('entry.png not found in repo: ' + SRC);
const data = readFileSync(SRC);
if (data.length > MAX_BYTES) {
  fail('entry.png is ' + data.length + ' bytes, over the 1 MiB limit');
}
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (data.length < 8 || !data.subarray(0, 8).equals(PNG_MAGIC)) {
  fail('entry.png does not start with the PNG magic bytes');
}

// Parse semua chunk: verifikasi CRC-32 tiap chunk, wajib ada IHDR + IEND.
let offset = 8;
let sawIHDR = false;
let sawIEND = false;
while (offset + 8 <= data.length) {
  const length = data.readUInt32BE(offset);
  const type = data.toString('ascii', offset + 4, offset + 8);
  if (offset + 12 + length > data.length) fail('truncated chunk: ' + type);
  const stored = data.readUInt32BE(offset + 8 + length);
  const computed = crc32(data.subarray(offset + 4, offset + 8 + length));
  if (stored !== computed) fail('bad CRC-32 in chunk: ' + type);
  if (type === 'IHDR') {
    sawIHDR = true;
    const width = data.readUInt32BE(offset + 8);
    const height = data.readUInt32BE(offset + 12);
    if (width !== 1024 || height !== 1024) {
      fail('entry.png must be 1024x1024, got ' + width + 'x' + height);
    }
  }
  if (type === 'IEND') {
    sawIEND = true;
    // IEND harus jadi chunk terakhir: tidak boleh ada byte sampah sesudahnya.
    if (offset + 12 + length !== data.length) {
      fail('trailing bytes after IEND chunk');
    }
    break;
  }
  offset += 12 + length;
}
if (!sawIHDR) fail('entry.png is missing its IHDR chunk');
if (!sawIEND) fail('entry.png is missing its IEND chunk');

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(SRC, DEST);

// Verifikasi salinan byte-identik dengan sumber.
const copied = readFileSync(DEST);
if (!copied.equals(data)) fail('output differs from source after copy');
console.log('ok: entry.png copied to ' + DEST + ' (' + data.length + ' bytes)');
