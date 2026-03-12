import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const buildDir = join(rootDir, "build");
const pngPath = join(buildDir, "icon.png");
const iconsetDir = join(buildDir, "icon.iconset");
const icnsPath = join(buildDir, "icon.icns");
const fallbackIcnsPath = join(rootDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "Resources", "electron.icns");
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

const drawIcon = () => {
  const pixels = Buffer.alloc(canvasSize * canvasSize * 4);
  const pageFrom = rgba("#18252f");
  const pageTo = rgba("#0b1015");
  const glowColor = rgba("#6ee7b7", 0.22);
  const shadowColor = rgba("#04090d", 0.34);
  const panelFrom = rgba("#1b2732", 0.98);
  const panelTo = rgba("#0e151c", 0.98);
  const lightFrom = rgba("#f4fbff", 0.98);
  const lightTo = rgba("#d2e0e6", 0.92);

  fillCanvas(pixels, () => [0, 0, 0, 0]);

  fillRoundedRect(pixels, 120, 120, 784, 784, 190, (x, y) => {
    const amount = clamp(((x - 120) / 784) * 0.58 + ((y - 120) / 784) * 0.42, 0, 1);
    return mixColor(pageFrom, pageTo, amount);
  });

  fillCircle(pixels, 286, 236, 278, glowColor, 130);

  fillRoundedRect(pixels, 232, 244, 596, 596, 114, () => shadowColor);
  fillRoundedRect(pixels, 214, 214, 596, 596, 114, (x, y) => {
    const amount = clamp(((x - 214) / 596) * 0.46 + ((y - 214) / 596) * 0.54, 0, 1);
    return mixColor(panelFrom, panelTo, amount);
  });

  fillRoundedRect(pixels, 284, 286, 456, 108, 54, (x, y) => {
    const amount = clamp(((x - 284) / 456) * 0.35 + ((y - 286) / 108) * 0.65, 0, 1);
    return mixColor(lightFrom, lightTo, amount);
  });
  fillRoundedRect(pixels, 316, 320, 144, 16, 8, () => rgba("#16222b", 0.92));
  fillRoundedRect(pixels, 316, 350, 100, 16, 8, () => rgba("#556775", 0.56));
  fillCircle(pixels, 668, 340, 12, rgba("#10b981"));
  fillCircle(pixels, 706, 340, 12, rgba("#0ea5e9", 0.96));

  fillRoundedRect(pixels, 284, 454, 196, 196, 52, (x, y) => {
    const amount = clamp(((x - 284) / 196) * 0.24 + ((y - 454) / 196) * 0.76, 0, 1);
    return mixColor(rgba("#18c98c"), rgba("#0e8b65"), amount);
  });
  fillRoundedRect(pixels, 322, 500, 118, 22, 11, () => rgba("#083223", 0.85));
  fillRoundedRect(pixels, 322, 540, 86, 18, 9, () => rgba("#e5fff3", 0.7));

  fillRoundedRect(pixels, 544, 454, 196, 196, 52, (x, y) => {
    const amount = clamp(((x - 544) / 196) * 0.22 + ((y - 454) / 196) * 0.78, 0, 1);
    return mixColor(rgba("#1bb3f4"), rgba("#0d7dbd"), amount);
  });
  fillRoundedRect(pixels, 582, 500, 118, 22, 11, () => rgba("#0a2c3c", 0.82));
  fillRoundedRect(pixels, 582, 540, 86, 18, 9, () => rgba("#eaf8ff", 0.72));

  fillRoundedRect(pixels, 284, 682, 456, 56, 28, () => rgba("#16222b", 0.88));
  fillRoundedRect(pixels, 320, 700, 150, 18, 9, () => rgba("#e8f0f4", 0.84));
  fillRoundedRect(pixels, 578, 700, 126, 18, 9, () => rgba("#8ea0af", 0.42));

  writeFileSync(pngPath, encodePng(canvasSize, canvasSize, pixels));
};

const writeIconVariant = (size, name) => {
  execFileSync("sips", ["-z", String(size), String(size), pngPath, "--out", join(iconsetDir, name)], {
    stdio: "ignore",
  });
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

try {
  execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath], {
    stdio: "ignore",
  });
} catch {
  copyFileSync(fallbackIcnsPath, icnsPath);
  console.warn("PROGRAMS fell back to Electron's default .icns asset for this build.");
}

console.log(`Generated ${icnsPath}`);
