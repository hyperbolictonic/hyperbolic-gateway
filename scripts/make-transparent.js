import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

function processImage(inputJpgPath, outputPngPath, threshold = 18, softEdge = 40) {
  const jpegData = fs.readFileSync(inputJpgPath);
  const raw = jpeg.decode(jpegData, { useTArray: true });
  const png = new PNG({ width: raw.width, height: raw.height });

  for (let i = 0; i < raw.data.length; i += 4) {
    const r = raw.data[i];
    const g = raw.data[i + 1];
    const b = raw.data[i + 2];
    
    // Perceptual brightness
    const brightness = Math.max(r, g, b);

    if (brightness <= threshold) {
      // Pure black -> 100% transparent
      png.data[i] = 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
      png.data[i + 3] = 0;
    } else if (brightness < threshold + softEdge) {
      // Soft antialiased edge
      const factor = (brightness - threshold) / softEdge;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = Math.round(factor * 255);
    } else {
      // Full emblem pixel
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(outputPngPath, buffer);
  console.log(`Saved transparent PNG: ${outputPngPath}`);
}

const assetsDir = path.join(process.cwd(), 'public', 'assets');

processImage(
  path.join(assetsDir, 'ono-sendai.jpg'),
  path.join(assetsDir, 'ono-sendai.png')
);

processImage(
  path.join(assetsDir, 'kuang-grade.jpg'),
  path.join(assetsDir, 'kuang-grade.png')
);

processImage(
  path.join(assetsDir, 'mark-eleven.jpg'),
  path.join(assetsDir, 'mark-eleven.png')
);
