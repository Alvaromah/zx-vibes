import { PNG } from 'pngjs';
import type { Machine } from './machine.js';

export interface ScreenshotOptions {
  /**
   * Integer upscale factor (nearest-neighbor). Default 2: 8px ROM text at
   * native 256x192 is too small for vision models to read reliably.
   */
  scale?: number;
}

/** Encodes an RGBA framebuffer as a PNG, optionally upscaled. */
export function rgbaToPNG(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: ScreenshotOptions = {}
): Buffer {
  const scale = Math.max(1, Math.floor(opts.scale ?? 2));
  const png = new PNG({ width: width * scale, height: height * scale });

  if (scale === 1) {
    png.data.set(rgba);
  } else {
    const outWidth = width * scale;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const dst = ((y * scale + dy) * outWidth + (x * scale + dx)) * 4;
            png.data[dst] = rgba[src]!;
            png.data[dst + 1] = rgba[src + 1]!;
            png.data[dst + 2] = rgba[src + 2]!;
            png.data[dst + 3] = rgba[src + 3]!;
          }
        }
      }
    }
  }

  return PNG.sync.write(png);
}

/** Renders the machine's current display (352x296 with border) to PNG. */
export function screenshotPNG(m: Machine, opts: ScreenshotOptions = {}): Buffer {
  const size = m.display.getDisplaySize();
  return rgbaToPNG(m.framebufferRGBA(), size.width, size.height, opts);
}
