// Byte-mode QR, error correction M, versions 1–6. Enough for a report URL.

const DATA = [0, 16, 28, 44, 64, 86, 108];
const ECC = [0, 10, 16, 26, 18, 24, 16];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
const REMAINDER = [0, 0, 7, 7, 7, 7, 7];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];
const ECL = { L: 1, M: 0, Q: 3, H: 2 };

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i += 1) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsDivisor(degree) {
  let result = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j += 1) {
      next[j] ^= result[j];
      next[j + 1] ^= gfMul(result[j], EXP[i]);
    }
    result = next;
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length - 1).fill(0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) result[i] ^= gfMul(divisor[i + 1], factor);
  }
  return result;
}

export function formatBits(level, mask) {
  const data = (ECL[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function pushBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function pickVersion(nbytes) {
  for (let version = 1; version <= 6; version += 1) {
    if (4 + 8 + nbytes * 8 <= DATA[version] * 8) return version;
  }
  return 0;
}

function dataCodewords(bytes, version) {
  const bits = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, 8);
  for (const value of bytes) pushBits(bits, value, 8);
  const maxBits = DATA[version] * 8;
  pushBits(bits, 0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    let word = 0;
    for (let bit = 0; bit < 8; bit += 1) word = (word << 1) | bits[i + bit];
    words.push(word);
  }
  const pads = [0xec, 0x11];
  let pad = 0;
  while (words.length < DATA[version]) {
    words.push(pads[pad]);
    pad ^= 1;
  }
  return words;
}

function interleave(words, version) {
  const blocks = BLOCKS[version];
  const span = words.length / blocks;
  const divisor = rsDivisor(ECC[version]);
  const dataBlocks = [];
  const eccBlocks = [];
  for (let block = 0; block < blocks; block += 1) {
    const slice = words.slice(block * span, (block + 1) * span);
    dataBlocks.push(slice);
    eccBlocks.push(rsRemainder(slice, divisor));
  }
  const out = [];
  for (let i = 0; i < span; i += 1) {
    for (let block = 0; block < blocks; block += 1) out.push(dataBlocks[block][i]);
  }
  for (let i = 0; i < ECC[version]; i += 1) {
    for (let block = 0; block < blocks; block += 1) out.push(eccBlocks[block][i]);
  }
  return out;
}

function codewordBits(words, version) {
  const bits = [];
  for (const word of words) pushBits(bits, word, 8);
  for (let i = 0; i < REMAINDER[version]; i += 1) bits.push(0);
  return bits;
}

function drawFinder(set, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const black = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(row + r, col + c, black);
    }
  }
}

function drawAlign(set, row, col) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
  }
}

function functionPattern(version) {
  const size = 17 + 4 * version;
  const func = new Uint8Array(size * size);
  const modules = new Uint8Array(size * size);
  const set = (row, col, black) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    func[row * size + col] = 1;
    modules[row * size + col] = black ? 1 : 0;
  };
  drawFinder(set, 0, 0);
  drawFinder(set, 0, size - 7);
  drawFinder(set, size - 7, 0);
  for (const row of ALIGN[version]) {
    for (const col of ALIGN[version]) {
      if (!func[row * size + col]) drawAlign(set, row, col);
    }
  }
  for (let i = 0; i < size; i += 1) {
    if (!func[6 * size + i]) set(6, i, i % 2 === 0);
    if (!func[i * size + 6]) set(i, 6, i % 2 === 0);
  }
  const reserve = (row, col) => set(row, col, false);
  for (let i = 0; i <= 5; i += 1) reserve(i, 8);
  reserve(7, 8);
  reserve(8, 8);
  reserve(8, 7);
  for (let i = 9; i < 15; i += 1) reserve(8, 14 - i);
  for (let i = 0; i < 8; i += 1) reserve(8, size - 1 - i);
  for (let i = 8; i < 15; i += 1) reserve(size - 15 + i, 8);
  reserve(size - 8, 8);
  modules[(size - 8) * size + 8] = 1;
  return { size, func, modules };
}

function maskBit(mask, row, col) {
  switch (mask) {
    case 0: return ((row + col) & 1) === 0;
    case 1: return (row & 1) === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return ((Math.floor(row / 2) + Math.floor(col / 3)) & 1) === 0;
    case 5: return ((row * col) % 2 + (row * col) % 3) === 0;
    case 6: return (((row * col) % 2 + (row * col) % 3) & 1) === 0;
    default: return ((((row + col) & 1) + ((row * col) % 3)) & 1) === 0;
  }
}

function placeData(modules, func, size, bits, mask) {
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const at = y * size + x;
        if (func[at]) continue;
        const bit = index < bits.length ? bits[index] : 0;
        index += 1;
        modules[at] = bit ^ (maskBit(mask, y, x) ? 1 : 0);
      }
    }
  }
  if (index !== bits.length) throw new Error(`QR bit count ${index} does not match ${bits.length}`);
}

function applyFormat(modules, size, mask) {
  const bits = formatBits("M", mask);
  const bit = (i) => (bits >>> i) & 1;
  for (let i = 0; i <= 5; i += 1) modules[i * size + 8] = bit(i);
  modules[7 * size + 8] = bit(6);
  modules[8 * size + 8] = bit(7);
  modules[8 * size + 7] = bit(8);
  for (let i = 9; i < 15; i += 1) modules[8 * size + (14 - i)] = bit(i);
  for (let i = 0; i < 8; i += 1) modules[8 * size + (size - 1 - i)] = bit(i);
  for (let i = 8; i < 15; i += 1) modules[(size - 15 + i) * size + 8] = bit(i);
  modules[(size - 8) * size + 8] = 1;
}

function addHistory(run, hist, size) {
  let length = run;
  if (hist[0] === 0) length += size;
  for (let i = hist.length - 1; i > 0; i -= 1) hist[i] = hist[i - 1];
  hist[0] = length;
}

function countPatterns(hist) {
  const n = hist[1];
  const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
  let found = 0;
  if (core && hist[0] >= n * 4 && hist[6] >= n) found += 1;
  if (core && hist[6] >= n * 4 && hist[0] >= n) found += 1;
  return found;
}

function terminate(color, run, hist, size) {
  let length = run;
  if (color === 1) {
    addHistory(length, hist, size);
    length = 0;
  }
  length += size;
  addHistory(length, hist, size);
  return countPatterns(hist);
}

function penalty(modules, size) {
  let score = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < size; i += 1) {
      let color = 0;
      let run = 0;
      const hist = [0, 0, 0, 0, 0, 0, 0];
      for (let j = 0; j < size; j += 1) {
        const value = pass === 0 ? modules[i * size + j] : modules[j * size + i];
        if (value === color) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          addHistory(run, hist, size);
          if (color === 0) score += countPatterns(hist) * 40;
          color = value;
          run = 1;
        }
      }
      score += terminate(color, run, hist, size) * 40;
    }
  }
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = modules[row * size + col];
      if (
        value === modules[row * size + col + 1]
        && value === modules[(row + 1) * size + col]
        && value === modules[(row + 1) * size + col + 1]
      ) score += 3;
    }
  }
  let dark = 0;
  for (const value of modules) dark += value;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export function qrMatrix(text, maskChoice = null) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  if (!version) return null;
  const base = functionPattern(version);
  const bits = codewordBits(interleave(dataCodewords(bytes, version), version), version);
  const chosen = Number.isInteger(maskChoice) && maskChoice >= 0 && maskChoice <= 7
    ? [maskChoice]
    : [0, 1, 2, 3, 4, 5, 6, 7];
  let best = null;
  for (const mask of chosen) {
    const modules = base.modules.slice();
    placeData(modules, base.func, base.size, bits, mask);
    applyFormat(modules, base.size, mask);
    const score = penalty(modules, base.size);
    if (!best || score < best.score) best = { modules, score, mask };
  }
  return { size: base.size, modules: best.modules, mask: best.mask, version };
}
