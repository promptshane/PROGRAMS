import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const buildDir = join(rootDir, "build");
const pngPath = join(buildDir, "icon.png");
const iconsetDir = join(buildDir, "icon.iconset");
const icnsPath = join(buildDir, "icon.icns");
const canvasSize = 1024;

const ensureDarwin = () => {
  if (process.platform !== "darwin") {
    throw new Error("PROGRAMS icon generation currently supports macOS only.");
  }
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const mix = (start, end, amount) => Math.round(start + (end - start) * amount);

const rgba = (hex, alpha = 1) => {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    Math.round(clamp(alpha, 0, 1) * 255),
  ];
};

const mixColor = (start, end, amount, alpha = 1) => [
  mix(start[0], end[0], amount),
  mix(start[1], end[1], amount),
  mix(start[2], end[2], amount),
  Math.round(clamp(alpha, 0, 1) * 255),
];

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const sizeBuffer = Buffer.alloc(4);
  sizeBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  const payload = Buffer.concat([typeBuffer, data]);
  crcBuffer.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([sizeBuffer, payload, crcBuffer]);
};

const encodePng = (width, height, rgbaBytes) => {
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    scanlines[rowOffset] = 0;
    rgbaBytes.copy(scanlines, rowOffset + 1, y * stride, y * stride + stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const encodeIcns = (entries) => {
  const blocks = entries.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const fileHeader = Buffer.alloc(8);
  const totalSize = 8 + blocks.reduce((sum, block) => sum + block.length, 0);

  fileHeader.write("icns", 0, 4, "ascii");
  fileHeader.writeUInt32BE(totalSize, 4);

  return Buffer.concat([fileHeader, ...blocks]);
};

const pointInRoundedRect = (px, py, x, y, width, height, radius) => {
  const right = x + width;
  const bottom = y + height;
  const cx = clamp(px, x + radius, right - radius);
  const cy = clamp(py, y + radius, bottom - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
};

const fillCanvas = (pixels, colorAt) => {
  for (let y = 0; y < canvasSize; y += 1) {
    for (let x = 0; x < canvasSize; x += 1) {
      const index = (y * canvasSize + x) * 4;
      const color = colorAt(x, y);
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
};

const blendPixel = (pixels, x, y, color) => {
  if (x < 0 || y < 0 || x >= canvasSize || y >= canvasSize) {
    return;
  }

  const index = (y * canvasSize + x) * 4;
  const sourceAlpha = color[3] / 255;
  if (sourceAlpha <= 0) {
    return;
  }

  const targetAlpha = pixels[index + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  const safeAlpha = outAlpha || 1;

  pixels[index] = Math.round((color[0] * sourceAlpha + pixels[index] * targetAlpha * (1 - sourceAlpha)) / safeAlpha);
  pixels[index + 1] = Math.round(
    (color[1] * sourceAlpha + pixels[index + 1] * targetAlpha * (1 - sourceAlpha)) / safeAlpha,
  );
  pixels[index + 2] = Math.round(
    (color[2] * sourceAlpha + pixels[index + 2] * targetAlpha * (1 - sourceAlpha)) / safeAlpha,
  );
  pixels[index + 3] = Math.round(outAlpha * 255);
};

const fillRoundedRect = (pixels, x, y, width, height, radius, colorAt) => {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.ceil(x + width);
  const bottom = Math.ceil(y + height);

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      if (!pointInRoundedRect(px + 0.5, py + 0.5, x, y, width, height, radius)) {
        continue;
      }

      blendPixel(pixels, px, py, colorAt(px, py));
    }
  }
};

const fillCircle = (pixels, centerX, centerY, radius, color, feather = 0) => {
  const left = Math.floor(centerX - radius);
  const top = Math.floor(centerY - radius);
  const right = Math.ceil(centerX + radius);
  const bottom = Math.ceil(centerY + radius);

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const dx = px + 0.5 - centerX;
      const dy = py + 0.5 - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) {
        continue;
      }

      const softness = feather > 0 ? clamp((radius - distance) / feather, 0, 1) : 1;
      blendPixel(pixels, px, py, [color[0], color[1], color[2], Math.round(color[3] * softness)]);
    }
  }
};

const pointInPolygon = (px, py, points) => {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const fillPolygon = (pixels, points, colorAt) => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.floor(Math.min(...xs));
  const top = Math.floor(Math.min(...ys));
  const right = Math.ceil(Math.max(...xs));
  const bottom = Math.ceil(Math.max(...ys));

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      if (!pointInPolygon(px + 0.5, py + 0.5, points)) {
        continue;
      }

      blendPixel(pixels, px, py, colorAt(px, py));
    }
  }
};

const drawIcon = () => {
  const pixels = Buffer.alloc(canvasSize * canvasSize * 4);
  const backgroundTop = rgba("#11295d");
  const backgroundBottom = rgba("#07112a");
  const shadowColor = rgba("#020814", 0.34);
  const highlightGlow = rgba("#3e67c6", 0.24);
  const boltAura = rgba("#ffe36c", 0.18);
  const boltShadow = rgba("#03122e", 0.28);
  const boltTop = rgba("#fff4a3");
  const boltBottom = rgba("#ffbf00");
  const cardX = 96;
  const cardY = 96;
  const cardSize = 832;
  const cardRadius = 210;
  const boltPoints = [
    [590, 138],
    [340, 542],
    [478, 542],
    [420, 886],
    [688, 462],
    [548, 462],
  ];
  const shadowBoltPoints = boltPoints.map(([x, y]) => [x + 16, y + 22]);

  fillCanvas(pixels, () => [0, 0, 0, 0]);

  fillRoundedRect(pixels, cardX + 12, cardY + 22, cardSize, cardSize, cardRadius, () => shadowColor);
  fillRoundedRect(pixels, cardX, cardY, cardSize, cardSize, cardRadius, (x, y) => {
    const amount = clamp(((x - cardX) / cardSize) * 0.42 + ((y - cardY) / cardSize) * 0.58, 0, 1);
    return mixColor(backgroundTop, backgroundBottom, amount);
  });

  fillRoundedRect(pixels, cardX, cardY, cardSize, cardSize, cardRadius, (x, y) => {
    const distance = Math.sqrt((x - 292) ** 2 + (y - 252) ** 2);
    const alpha = Math.pow(clamp(1 - distance / 320, 0, 1), 1.8) * (highlightGlow[3] / 255);
    return [highlightGlow[0], highlightGlow[1], highlightGlow[2], Math.round(alpha * 255)];
  });
  fillRoundedRect(pixels, cardX, cardY, cardSize, cardSize, cardRadius, (x, y) => {
    const distance = Math.sqrt((x - 508) ** 2 + (y - 506) ** 2);
    const alpha = Math.pow(clamp(1 - distance / 260, 0, 1), 1.6) * (boltAura[3] / 255);
    return [boltAura[0], boltAura[1], boltAura[2], Math.round(alpha * 255)];
  });

  fillPolygon(pixels, shadowBoltPoints, () => boltShadow);
  fillPolygon(pixels, boltPoints, (x, y) => {
    const amount = clamp(((x - 340) / 348) * 0.22 + ((y - 138) / 748) * 0.78, 0, 1);
    return mixColor(boltTop, boltBottom, amount);
  });

  writeFileSync(pngPath, encodePng(canvasSize, canvasSize, pixels));
};

const writeIconVariant = (size, name) => {
  execFileSync("sips", ["-z", String(size), String(size), pngPath, "--out", join(iconsetDir, name)], {
    stdio: "ignore",
  });
};

const writeIcns = () => {
  const entries = [
    ["icp4", readFileSync(join(iconsetDir, "icon_16x16.png"))],
    ["icp5", readFileSync(join(iconsetDir, "icon_32x32.png"))],
    ["icp6", readFileSync(join(iconsetDir, "icon_32x32@2x.png"))],
    ["ic07", readFileSync(join(iconsetDir, "icon_128x128.png"))],
    ["ic08", readFileSync(join(iconsetDir, "icon_256x256.png"))],
    ["ic09", readFileSync(join(iconsetDir, "icon_512x512.png"))],
    ["ic10", readFileSync(join(iconsetDir, "icon_512x512@2x.png"))],
  ];

  writeFileSync(icnsPath, encodeIcns(entries));
};

ensureDarwin();
rmSync(iconsetDir, { recursive: true, force: true });
rmSync(icnsPath, { force: true });
mkdirSync(iconsetDir, { recursive: true });

drawIcon();

[
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
].forEach(([size, name]) => writeIconVariant(size, name));

writeIcns();

console.log(`Generated ${icnsPath}`);
