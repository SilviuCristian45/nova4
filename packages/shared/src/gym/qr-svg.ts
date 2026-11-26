/**
 * Pure, zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, Error Correction Level M, Versions 1..10).
 * Supports UTF-8 payloads up to 213 bytes — ideal for printed gym check-in URLs.
 */

interface VersionSpec {
  version: number;
  size: number;
  totalDataCodewords: number;
  ecCodewordsPerBlock: number;
  blocksGroup1: [count: number, dataCodewords: number];
  blocksGroup2: [count: number, dataCodewords: number];
  alignmentCenters: number[];
}

// ISO/IEC 18004 Table 9 for Error Correction Level M, Versions 1..10.
const VERSION_SPECS: readonly VersionSpec[] = [
  { version: 1, size: 21, totalDataCodewords: 16, ecCodewordsPerBlock: 10, blocksGroup1: [1, 16], blocksGroup2: [0, 0], alignmentCenters: [] },
  { version: 2, size: 25, totalDataCodewords: 28, ecCodewordsPerBlock: 16, blocksGroup1: [1, 28], blocksGroup2: [0, 0], alignmentCenters: [6, 18] },
  { version: 3, size: 29, totalDataCodewords: 44, ecCodewordsPerBlock: 26, blocksGroup1: [1, 44], blocksGroup2: [0, 0], alignmentCenters: [6, 22] },
  { version: 4, size: 33, totalDataCodewords: 64, ecCodewordsPerBlock: 18, blocksGroup1: [2, 32], blocksGroup2: [0, 0], alignmentCenters: [6, 26] },
  { version: 5, size: 37, totalDataCodewords: 86, ecCodewordsPerBlock: 24, blocksGroup1: [2, 43], blocksGroup2: [0, 0], alignmentCenters: [6, 30] },
  { version: 6, size: 41, totalDataCodewords: 108, ecCodewordsPerBlock: 16, blocksGroup1: [4, 27], blocksGroup2: [0, 0], alignmentCenters: [6, 34] },
  { version: 7, size: 45, totalDataCodewords: 124, ecCodewordsPerBlock: 18, blocksGroup1: [4, 31], blocksGroup2: [0, 0], alignmentCenters: [6, 22, 38] },
  { version: 8, size: 49, totalDataCodewords: 154, ecCodewordsPerBlock: 22, blocksGroup1: [2, 38], blocksGroup2: [2, 39], alignmentCenters: [6, 24, 42] },
  { version: 9, size: 53, totalDataCodewords: 182, ecCodewordsPerBlock: 22, blocksGroup1: [3, 36], blocksGroup2: [2, 37], alignmentCenters: [6, 26, 46] },
  { version: 10, size: 57, totalDataCodewords: 216, ecCodewordsPerBlock: 26, blocksGroup1: [4, 43], blocksGroup2: [1, 44], alignmentCenters: [6, 28, 50] },
];

// GF(256) exp/log tables with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly: Uint8Array<ArrayBuffer> = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    for (let j = 0; j < ecCount - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[ecCount - 1] = gfMul(gen[ecCount], factor);
  }
  return rem;
}

function encodeBits(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);
  // Character count indicator: 8 bits for versions 1..9, 16 bits for version 10+
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  for (const b of bytes) {
    pushBits(b, 8);
  }

  const maxBits = spec.totalDataCodewords * 8;
  // Terminator (up to 4 zero bits)
  const terminatorLen = Math.min(4, maxBits - bits.length);
  pushBits(0, terminatorLen);
  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = new Uint8Array(spec.totalDataCodewords);
  let idx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i + b];
    }
    codewords[idx++] = byte;
  }

  // Alternating pad bytes 0xEC, 0x11
  let toggle = true;
  while (idx < spec.totalDataCodewords) {
    codewords[idx++] = toggle ? 0xec : 0x11;
    toggle = !toggle;
  }

  return codewords;
}

function interleaveBlocks(data: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.blocksGroup1[0]; i++) {
    const slice = data.subarray(offset, offset + spec.blocksGroup1[1]);
    offset += spec.blocksGroup1[1];
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecCodewordsPerBlock));
  }
  for (let i = 0; i < spec.blocksGroup2[0]; i++) {
    const slice = data.subarray(offset, offset + spec.blocksGroup2[1]);
    offset += spec.blocksGroup2[1];
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecCodewordsPerBlock));
  }

  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  const totalLen =
    spec.totalDataCodewords +
    (spec.blocksGroup1[0] + spec.blocksGroup2[0]) * spec.ecCodewordsPerBlock;
  const result = new Uint8Array(totalLen);
  let out = 0;

  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result[out++] = block[i];
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const block of ecBlocks) {
      result[out++] = block[i];
    }
  }
  return result;
}

function computeFormatBits(maskPattern: number): number {
  // Error correction level M = 00
  const data = (0b00 << 3) | (maskPattern & 0b111);
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) {
      rem ^= 0x537 << i;
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version: number): number {
  let rem = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (rem & (1 << (i + 12))) {
      rem ^= 0x1f25 << i;
    }
  }
  return (version << 12) | rem;
}

function createBaseMatrix(spec: VersionSpec): { modules: boolean[][]; isFunction: boolean[][] } {
  const n = spec.size;
  const modules: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const isFunction: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= n || c < 0 || c >= n) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (top: number, left: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const r = top + dy;
        const c = left + dx;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const dist = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
        const dark = dist !== 2 && dist !== 4;
        setFunc(r, c, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, n - 7);
  drawFinder(n - 7, 0);

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const centers = spec.alignmentCenters;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const cr = centers[i];
      const cc = centers[j];
      // Skip corners overlapping finders
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dist = Math.max(Math.abs(dy), Math.abs(dx));
          setFunc(cr + dy, cc + dx, dist !== 1);
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = n - 8; i < n; i++) {
    setFunc(8, i, false);
    setFunc(i, 8, false);
  }
  setFunc(n - 8, 8, true);

  // Version info for versions 7+
  if (spec.version >= 7) {
    const vBits = computeVersionBits(spec.version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) !== 0;
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  return { modules, isFunction };
}

function drawFormatBits(modules: boolean[][], maskPattern: number): void {
  const n = modules.length;
  const bits = computeFormatBits(maskPattern);

  // First copy around top-left finder
  for (let i = 0; i <= 5; i++) modules[8][i] = ((bits >>> (14 - i)) & 1) !== 0;
  modules[8][7] = ((bits >>> 8) & 1) !== 0;
  modules[8][8] = ((bits >>> 7) & 1) !== 0;
  modules[7][8] = ((bits >>> 6) & 1) !== 0;
  for (let i = 9; i < 15; i++) modules[14 - i][8] = ((bits >>> (14 - i)) & 1) !== 0;

  // Second copy along bottom-left and top-right finders
  for (let i = 0; i < 8; i++) modules[8][n - 1 - i] = ((bits >>> i) & 1) !== 0;
  for (let i = 8; i < 15; i++) modules[n - 15 + i][8] = ((bits >>> i) & 1) !== 0;
  modules[n - 8][8] = true;
}

function maskCondition(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function placeDataBits(
  baseModules: boolean[][],
  isFunction: boolean[][],
  codewords: Uint8Array,
  mask: number,
): boolean[][] {
  const n = baseModules.length;
  const modules = baseModules.map((row) => row.slice());
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (isFunction[r][c]) continue;
        let dark = false;
        if (bitIdx < totalBits) {
          dark = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
          bitIdx++;
        }
        if (maskCondition(mask, r, c)) {
          dark = !dark;
        }
        modules[r][c] = dark;
      }
    }
    upward = !upward;
  }

  drawFormatBits(modules, mask);
  return modules;
}

function computePenalty(modules: boolean[][]): number {
  const n = modules.length;
  let penalty = 0;

  // Rule 1: runs of 5+ same-colored modules in rows and columns
  for (let r = 0; r < n; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < n; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < n; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < n; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const color = modules[r][c];
      if (modules[r][c + 1] === color && modules[r + 1][c] === color && modules[r + 1][c + 1] === color) {
        penalty += 3;
      }
    }
  }

  // Rule 4: dark/light balance
  let darkCount = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules[r][c]) darkCount++;
    }
  }
  const percent = (darkCount * 100) / (n * n);
  const k = Math.floor(Math.abs(percent - 50) / 5);
  penalty += k * 10;

  return penalty;
}

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSION_SPECS.find((s) => {
    const headerBits = 4 + (s.version <= 9 ? 8 : 16);
    const maxBytes = Math.floor((s.totalDataCodewords * 8 - headerBits) / 8);
    return bytes.length <= maxBytes;
  });

  if (!spec) {
    throw new Error(`QR payload too long (${bytes.length} bytes, max 213 bytes)`);
  }

  const dataCodewords = encodeBits(bytes, spec);
  const finalCodewords = interleaveBlocks(dataCodewords, spec);
  const { modules: base, isFunction } = createBaseMatrix(spec);

  let bestMatrix: boolean[][] | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = placeDataBits(base, isFunction, finalCodewords, mask);
    const penalty = computePenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = candidate;
    }
  }

  return bestMatrix!;
}

export function renderQrSvg(
  text: string,
  options: { margin?: number; fgColor?: string; bgColor?: string } = {},
): string {
  const margin = options.margin ?? 4;
  const fg = options.fgColor ?? "#0c0c0d";
  const bg = options.bgColor ?? "#ffffff";
  const matrix = generateQrMatrix(text);
  const n = matrix.length;
  const viewSize = n + margin * 2;

  const paths: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        paths.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="${viewSize}" height="${viewSize}" fill="${bg}"/><path d="${paths.join("")}" fill="${fg}"/></svg>`;
}
