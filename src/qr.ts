/**
 * A small dependency-free QR encoder: byte mode, error correction level L, versions 1-10 (up to 271 bytes),
 * plus a compact terminal renderer. Enough for a pairing URL.
 */

// ---- GF(256) and Reed-Solomon ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const gmul = (a: number, b: number) => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0);

function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]!; next[j + 1] ^= gmul(g[j]!, EXP[i]!); }
    g = next;
  }
  return g;
}

/** The `ecLen` Reed-Solomon check bytes of `data`. */
export function rsEncode(data: number[], ecLen: number): number[] {
  const g = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const f = d ^ res[0]!;
    res.shift(); res.push(0);
    if (f) for (let i = 0; i < ecLen; i++) res[i] ^= gmul(g[i + 1]!, f);
  }
  return res;
}

// ---- tables (level L) ----
// version -> [total codewords, EC codewords per block, blocks]
const L_TABLE: Record<number, [number, number, number]> = {
  1: [26, 7, 1], 2: [44, 10, 1], 3: [70, 15, 1], 4: [100, 20, 1], 5: [134, 26, 1],
  6: [172, 18, 2], 7: [196, 20, 2], 8: [242, 24, 2], 9: [292, 30, 2], 10: [346, 18, 4],
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const dataCodewords = (v: number) => { const [tot, ec, blocks] = L_TABLE[v]!; return tot - ec * blocks; };

/** BCH(15,5) format information for level L (bits 01) and a mask, already XORed with 101010000010010. */
export function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let r = data << 10;
  for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10);
  return ((data << 10) | r) ^ 0x5412;
}
/** BCH(18,6) version information. */
function versionBits(v: number): number {
  let r = v << 12;
  for (let i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1f25 << (i - 12);
  return (v << 12) | r;
}

/** The interleaved data + check codewords for a UTF-8 text; returns them with the chosen version. */
export function codewords(text: string): { version: number; bytes: number[] } {
  const raw = [...new TextEncoder().encode(text)];
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const bits = 4 + (v < 10 ? 8 : 16) + raw.length * 8;
    if (bits <= dataCodewords(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error("text too long for the QR encoder (max 271 bytes)");
  const bits: number[] = [];
  const put = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(0b0100, 4);
  put(raw.length, version < 10 ? 8 : 16);
  for (const b of raw) put(b, 8);
  const cap = dataCodewords(version) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0; data.length < dataCodewords(version); pad++) data.push(pad % 2 ? 0x11 : 0xec);

  const [, ecLen, nBlocks] = L_TABLE[version]!;
  const shortLen = Math.floor(data.length / nBlocks);
  const longCount = data.length % nBlocks; // the last blocks carry one more byte
  const blocks: number[][] = [];
  let pos = 0;
  for (let b = 0; b < nBlocks; b++) { const len = shortLen + (b >= nBlocks - longCount ? 1 : 0); blocks.push(data.slice(pos, pos + len)); pos += len; }
  const ecs = blocks.map((b) => rsEncode(b, ecLen));
  const out: number[] = [];
  for (let i = 0; i < shortLen + 1; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]!);
  return { version, bytes: out };
}

// ---- matrix ----
const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < n; i++) { if (get(i) === get(i - 1)) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; } }
    if (run >= 5) p += 3 + run - 5;
  };
  for (let r = 0; r < n; r++) { line((i) => m[r]![i]!); line((i) => m[i]![r]!); }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = m[r]![c]; if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1]) p += 3; }
  const pat = [true, false, true, true, true, false, true, false, false, false, false];
  const rev = [...pat].reverse();
  const match = (get: (i: number) => boolean, at: number, q: boolean[]) => q.every((v, i) => get(at + i) === v);
  for (let r = 0; r < n; r++) for (let c = 0; c + 11 <= n; c++) {
    if (match((i) => m[r]![i]!, c, pat) || match((i) => m[r]![i]!, c, rev)) p += 40;
    if (match((i) => m[i]![r]!, c, pat) || match((i) => m[i]![r]!, c, rev)) p += 40;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** The QR symbol for `text` as a square boolean matrix (true = dark). */
export function qrMatrix(text: string): boolean[][] {
  const { version, bytes } = codewords(text);
  const n = 17 + version * 4;
  const m: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false)); // function modules
  const set = (r: number, c: number, v: boolean) => { if (r >= 0 && c >= 0 && r < n && c < n) { m[r]![c] = v; fn[r]![c] = true; } };

  const finder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark = inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(r0 + dr, c0 + dc, dark);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[version]!;
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  const drawFormat = (mask: number) => {
    const f = formatBits(mask);
    const bit = (i: number) => ((f >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
    set(7, 8, bit(6)); set(8, 8, bit(7)); set(8, 7, bit(8));
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) set(8, n - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) set(n - 15 + i, 8, bit(i));
    set(n - 8, 8, true); // the always-dark module
  };
  drawFormat(0); // reserve
  if (version >= 7) {
    const v = versionBits(version);
    for (let i = 0; i < 18; i++) { const b = ((v >> i) & 1) === 1; const a = n - 11 + (i % 3), d = Math.floor(i / 3); set(a, d, b); set(d, a, b); }
  }

  // data placement: zig-zag from the bottom right, skipping column 6
  const bits: boolean[] = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push(((b >> i) & 1) === 1);
  let k = 0, up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [col, col - 1]) if (!fn[r]![c]) m[r]![c] = k < bits.length ? bits[k++]! : false;
    }
    up = !up;
  }

  let best: boolean[][] | undefined, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const t = m.map((row) => row.slice());
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fn[r]![c] && MASKS[mask]!(r, c)) t[r]![c] = !t[r]![c];
    const saved = m;
    // draw this mask's format bits onto the candidate
    const f = formatBits(mask);
    const bit = (i: number) => ((f >> i) & 1) === 1;
    const put = (r: number, c: number, v: boolean) => { t[r]![c] = v; };
    for (let i = 0; i <= 5; i++) put(i, 8, bit(i));
    put(7, 8, bit(6)); put(8, 8, bit(7)); put(8, 7, bit(8));
    for (let i = 9; i < 15; i++) put(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) put(8, n - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) put(n - 15 + i, 8, bit(i));
    put(n - 8, 8, true);
    void saved;
    const s = penalty(t);
    if (s < bestScore) { bestScore = s; best = t; }
  }
  return best!;
}

/**
 * Compact terminal rendering: two modules per character row with half blocks, black on white (explicit colours, so it
 * scans on dark and light terminals alike), a quiet zone around it.
 */
export function qrText(text: string, quiet = 3): string {
  const m = qrMatrix(text);
  const n = m.length + quiet * 2;
  const at = (r: number, c: number) => { const rr = r - quiet, cc = c - quiet; return rr >= 0 && cc >= 0 && rr < m.length && cc < m.length && m[rr]![cc]!; };
  const lines: string[] = [];
  for (let r = 0; r < n; r += 2) {
    let s = "";
    for (let c = 0; c < n; c++) {
      const top = at(r, c), bottom = at(r + 1, c);
      s += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(`\x1b[30;47m${s}\x1b[0m`);
  }
  return lines.join("\n");
}
