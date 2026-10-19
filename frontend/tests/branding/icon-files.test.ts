import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts));

const SVG_FILES = ["src/app/icon.svg", "public/brand/app-icon.svg", "public/brand/logo-mark.svg"];

// 스펙 21 4절 색(원본 그대로)
const SEGMENT_COLORS = [
  ["#43b1fc", "#339dfc", "#1a7afc"],
  ["#2bc692", "#1fbc89", "#35d298"],
  ["#ffd634", "#fdc220", "#ffaf14"],
  ["#fc7557", "#fd684d", "#fd7e5e"],
].flat();
const TILE_COLORS = ["#222a3a", "#161c2a"];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngChunk {
  type: string;
  data: Buffer;
}

function pngChunks(png: Buffer): PngChunk[] {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function pngSize(png: Buffer): [number, number] {
  const ihdr = pngChunks(png)[0];
  expect(ihdr.type).toBe("IHDR");
  return [ihdr.data.readUInt32BE(0), ihdr.data.readUInt32BE(4)];
}

/** 이미지 데이터와 해상도 외의 청크(텍스트·EXIF·C2PA caBX 등)가 없다. */
function expectNoMetadata(png: Buffer) {
  const allowed = new Set(["IHDR", "PLTE", "tRNS", "pHYs", "IDAT", "IEND"]);
  expect(pngChunks(png).map((chunk) => chunk.type).filter((type) => !allowed.has(type))).toEqual([]);
}

describe("로고 SVG", () => {
  it.each(SVG_FILES)("%s: 8KB 이하의 진짜 벡터(viewBox, 도형·그라데이션만)", (path) => {
    const buffer = read(path);
    expect(buffer.length).toBeLessThanOrEqual(8 * 1024);
    const svg = buffer.toString("utf8");
    expect(svg).toMatch(/^<svg [^>]*viewBox="[\d.\s-]+"/);
    for (const banned of [/<image/i, /data:/i, /<script/i, /href="http/i, /<text/i, /<foreignObject/i, /base64/i]) {
      expect(svg).not.toMatch(banned);
    }
    const elements = new Set(Array.from(svg.matchAll(/<([a-zA-Z]+)/g), (match) => match[1]));
    const allowed = new Set(["svg", "defs", "linearGradient", "radialGradient", "stop", "rect", "circle", "path"]);
    expect([...elements].filter((name) => !allowed.has(name))).toEqual([]);
    expect(svg.match(/<path /g)).toHaveLength(4);
    for (const color of SEGMENT_COLORS) expect(svg).toContain(`"${color}"`);
  });

  it("app/icon.svg는 public/brand/app-icon.svg와 같고, 어두운 타일 색을 쓴다", () => {
    const icon = read("src/app/icon.svg");
    expect(icon.equals(read("public/brand/app-icon.svg"))).toBe(true);
    const svg = icon.toString("utf8");
    expect(svg).toContain('viewBox="0 0 512 512"');
    for (const color of TILE_COLORS) expect(svg).toContain(`"${color}"`);
  });

  it("평면 마크에는 타일이 없다", () => {
    const svg = read("public/brand/logo-mark.svg").toString("utf8");
    expect(svg).not.toMatch(/<rect|<circle/);
    for (const color of TILE_COLORS) expect(svg).not.toContain(color);
  });
});

describe("아이콘 파일", () => {
  it("app/favicon.ico는 16·32·48 세 장을 담은 ICO다", () => {
    const ico = read("src/app/favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const entry = 6 + 16 * i;
      const width = ico.readUInt8(entry) || 256;
      const height = ico.readUInt8(entry + 1) || 256;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      const image = ico.subarray(offset, offset + length);
      expect(pngSize(image)).toEqual([width, height]);
      expectNoMetadata(image);
      expect(width).toBe(height);
      sizes.push(width);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("app/apple-icon.png는 180×180이고 투명 부분 없이 꽉 찬다", () => {
    const png = read("src/app/apple-icon.png");
    expect(pngSize(png)).toEqual([180, 180]);
    // 색 형식 2(RGB, 알파 없음)
    expect(pngChunks(png)[0].data.readUInt8(9)).toBe(2);
    expect(pngChunks(png).some((chunk) => chunk.type === "tRNS")).toBe(false);
    expectNoMetadata(png);
  });

  it("Next.js 기본 아이콘(public/favicon.ico)은 지웠다", () => {
    expect(existsSync(join(root, "public", "favicon.ico"))).toBe(false);
  });
});
