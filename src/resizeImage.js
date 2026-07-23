const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');

const MAX_DIM = 1080;
const JPEG_QUALITY = 78;

function watermarkSvg(imgWidth, imgHeight) {
  const fontSize = Math.max(14, Math.round(imgWidth * 0.032));
  const padding = Math.round(fontSize * 0.9);
  return Buffer.from(`
    <svg width="${imgWidth}" height="${imgHeight}">
      <style>
        .txp-wm {
          font-family: 'Arial', sans-serif;
          font-size: ${fontSize}px;
          font-weight: 700;
          fill: #ffffff;
          fill-opacity: 0.55;
          stroke: #000000;
          stroke-opacity: 0.25;
          stroke-width: 1;
        }
      </style>
      <text x="${imgWidth - padding}" y="${imgHeight - padding}" text-anchor="end" class="txp-wm">Tempxral</text>
    </svg>
  `);
}

/**
 * Redimensiona un buffer de imagen, le añade la marca de agua "Tempxral"
 * en la esquina inferior derecha, y lo guarda como JPEG en uploadsDir.
 * Devuelve el nombre de archivo generado (no la ruta completa).
 */
async function resizeAndSave(buffer, uploadsDir) {
  const filename = crypto.randomUUID() + '.jpg';
  const fullPath = path.join(uploadsDir, filename);

  // sharp.metadata() refleja las dimensiones de ENTRADA, no las del resize
  // pendiente en el pipeline. Por eso redimensionamos primero a un buffer real,
  // y solo entonces medimos para construir la marca de agua al tamaño correcto.
  const resizedBuffer = await sharp(buffer)
    .rotate() // respeta la orientación EXIF
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  const { width, height } = await sharp(resizedBuffer).metadata();

  await sharp(resizedBuffer)
    .composite([{ input: watermarkSvg(width, height), top: 0, left: 0 }])
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(fullPath);

  return filename;
}

module.exports = { resizeAndSave, MAX_DIM, JPEG_QUALITY };
