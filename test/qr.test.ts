import { describe, expect, test } from "bun:test";
import { codewords, formatBits, qrMatrix, qrText, rsEncode } from "../src/qr";

describe("QR encoder", () => {
  test("Reed-Solomon against the well-known HELLO WORLD 1-M vector", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsEncode(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  test("format information for level L (ISO 18004 table)", () => {
    expect(formatBits(0).toString(2).padStart(15, "0")).toBe("111011111000100");
    expect(formatBits(4).toString(2).padStart(15, "0")).toBe("110011000101111");
  });
  test("data codewords: mode, length, bytes, pad bytes, check bytes", () => {
    const { version, bytes } = codewords("Hi");
    expect(version).toBe(1);
    expect(bytes.slice(0, 5)).toEqual([0x40, 0x24, 0x86, 0x90, 0xec]); // 0100 00000010 'H' 'i' 0000, then pad 0xEC
    expect(bytes.length).toBe(26);
  });
  test("symbol structure: size, finder patterns, timing, version growth, limits", () => {
    const m = qrMatrix("http://my-mac.local:7420/?pin=123456");
    expect(m.length).toBe(29); // version 3
    for (const [r, c] of [[0, 0], [0, 22], [22, 0]] as const) {
      expect(m[r]![c]).toBe(true); expect(m[r + 3]![c + 3]).toBe(true); expect(m[r + 1]![c + 1]).toBe(false);
    }
    expect(m[6]![8]).toBe(true); expect(m[6]![9]).toBe(false); // timing
    expect(qrMatrix("x".repeat(250)).length).toBe(57); // version 10, several blocks
    expect(() => qrMatrix("x".repeat(300))).toThrow("too long");
  });
  test("terminal rendering is half blocks with explicit colours", () => {
    const s = qrText("hello");
    const rows = s.split("\n");
    expect(rows[0]!.startsWith("\x1b[30;47m")).toBe(true);
    expect(s).toMatch(/[▀▄█]/);
    expect(rows.length).toBe(Math.ceil((21 + 6) / 2));
  });
});
