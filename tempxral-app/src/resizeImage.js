const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');

const MAX_DIM = 1080;
const JPEG_QUALITY = 78;

/**
 * Redimensiona un buffer de imagen y lo guarda como JPEG en uploadsDir.
 * Devuelve el nombre de archivo generado (no la ruta completa).
 */
async function resizeAndSave(buffer, uploadsDir) {
  const filename = crypto.randomUUID() + '.jpg';
  const fullPath = path.join(uploadsDir, filename);
  await sharp(buffer)
    .rotate() // respeta la orientación EXIF
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(fullPath);
  return filename;
}

module.exports = { resizeAndSave, MAX_DIM, JPEG_QUALITY };
