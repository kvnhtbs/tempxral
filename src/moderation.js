const https = require('https');

// ---------------------------------------------------------------------------
// Moderación automática de imágenes, sin cola manual: se ejecuta al subir,
// en el momento, y la imagen se acepta o se rechaza al instante.
//
// Usa Sightengine (sightengine.com) como proveedor por defecto porque tiene
// API sencilla, plan de pruebas gratuito, y modelos específicos de desnudez/
// contenido ofensivo. Necesitas tu propia cuenta y claves — configúralas como
// variables de entorno:
//   MODERATION_ENABLED=true
//   SIGHTENGINE_API_USER=...
//   SIGHTENGINE_API_SECRET=...
//
// Si no configuras estas variables, la comprobación queda DESACTIVADA por
// defecto (para no romper la app antes de que decidas un proveedor), y se
// registra un aviso en los logs en cada subida. No lo dejes así si vas a
// publicar contenido para adultos de verdad.
//
// IMPORTANTE — esto NO sustituye una herramienta de detección de material de
// abuso sexual infantil (CSAM). Sightengine (y servicios similares) detectan
// desnudez/contenido sexual en general, pero no están diseñados para
// identificar CSAM específicamente. Para eso existen programas dedicados
// (Thorn Safer, Microsoft PhotoDNA) que comparan contra bases de datos de
// material ya identificado por organismos como NCMEC, y muchos ofrecen acceso
// gratuito o reducido a plataformas pequeñas precisamente por ser una
// prioridad de protección infantil. Si vas a alojar contenido para adultos en
// abierto, esto no es opcional — solicita acceso a uno de esos programas
// antes de lanzar de verdad.
// ---------------------------------------------------------------------------

const ENABLED = process.env.MODERATION_ENABLED === 'true';
const API_USER = process.env.SIGHTENGINE_API_USER;
const API_SECRET = process.env.SIGHTENGINE_API_SECRET;

// Umbrales de "esto se rechaza automáticamente" (0-1, cuanto más alto más estricto)
const THRESHOLDS = {
  sexual_activity: 0.6,
  sexual_display: 0.75,
  gore: 0.7,
  violence: 0.8
};

function postMultipart(buffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----txpBoundary' + Date.now();
    const parts = [];
    const fields = { models: 'nudity-2.1,gore-2.0,offensive', api_user: API_USER, api_secret: API_SECRET };
    for (const [key, value] of Object.entries(fields)) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    }
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="upload.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
    const head = Buffer.from(parts.join(''), 'utf8');
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([head, buffer, tail]);

    const req = https.request({
      hostname: 'api.sightengine.com',
      path: '/1.0/check.json',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('moderation_timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Comprueba una imagen (buffer YA redimensionado, antes de escribirla a disco
 * de forma pública). Devuelve { allowed: boolean, reason?: string }.
 * Si la moderación no está configurada, siempre permite (fail-open) pero
 * avisa por consola.
 */
async function checkImage(buffer) {
  if (!ENABLED || !API_USER || !API_SECRET) {
    console.warn('[moderación] MODERATION_ENABLED no está configurado — la imagen se publica SIN comprobar.');
    return { allowed: true, skipped: true };
  }
  try {
    const result = await postMultipart(buffer);
    if (result.status !== 'success') {
      console.error('[moderación] respuesta inesperada de Sightengine:', result);
      return { allowed: true, skipped: true }; // fail-open ante error del proveedor
    }
    const nudity = result.nudity || {};
    const gore = (result.gore && result.gore.prob) || 0;
    const offensive = (result.offensive && result.offensive.prob) || 0;

    if ((nudity.sexual_activity || 0) >= THRESHOLDS.sexual_activity) return { allowed: false, reason: 'contenido sexual explícito' };
    if ((nudity.sexual_display || 0) >= THRESHOLDS.sexual_display) return { allowed: false, reason: 'desnudez explícita' };
    if (gore >= THRESHOLDS.gore) return { allowed: false, reason: 'contenido gore/violento' };
    if (offensive >= THRESHOLDS.violence) return { allowed: false, reason: 'contenido ofensivo' };

    return { allowed: true };
  } catch (e) {
    console.error('[moderación] error llamando a Sightengine:', e.message);
    return { allowed: true, skipped: true }; // fail-open si el proveedor falla, para no tumbar la app
  }
}

module.exports = { checkImage };
