// Gera os icones PNG do PWA CRM IDEAL sem dependencias externas (zlib nativo).
// Desenha um fundo verde (estetica WhatsApp) com um balao de conversa branco.
// Rode: node scripts/gen-app-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "app", "icons");
mkdirSync(OUT, { recursive: true });

const BG = [18, 140, 126]; // #128C7E verde WhatsApp
const FG = [255, 255, 255]; // balao branco

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.30; // raio do balao
  // Cauda do balao (triangulo) no canto inferior esquerdo do circulo.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inCircle = dx * dx + dy * dy <= r * r;
      // Cauda: pequeno triangulo apontando pra baixo-esquerda.
      const tail =
        x > cx - r * 0.7 &&
        x < cx - r * 0.1 &&
        y > cy + r * 0.45 &&
        y < cy + r * 1.05 &&
        y - (cy + r * 0.45) < (x - (cx - r * 0.7)) * 1.4;
      const isFg = inCircle || tail;
      const [rr, gg, bb] = isFg ? FG : BG;
      const o = rowStart + 1 + x * 4;
      raw[o] = rr;
      raw[o + 1] = gg;
      raw[o + 2] = bb;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const png = makePng(size);
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`icon-${size}.png (${png.length} bytes)`);
}
console.log("Icones gerados em", OUT);
