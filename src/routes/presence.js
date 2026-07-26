const express = require('express');
const router = express.Router();

// Presencia sencilla en memoria: cada navegador manda un "ping" cada
// pocos segundos con un id anónimo suyo (generado en el propio navegador,
// no es un identificador personal). Contamos cuántos ids distintos han
// hecho ping en los últimos ONLINE_WINDOW_MS. No usa base de datos porque
// es información puramente efímera — se resetea si el servidor reinicia,
// lo cual está bien para lo que es (una cifra aproximada de ambiente, no
// una métrica de negocio).
const ONLINE_WINDOW_MS = 2 * 60 * 1000; // 2 minutos sin ping = se cuenta como desconectado
const lastSeen = new Map();

function sweep() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  for (const [id, ts] of lastSeen.entries()) {
    if (ts < cutoff) lastSeen.delete(id);
  }
}

router.post('/ping', (req, res) => {
  const visitorId = (req.body && req.body.visitorId || '').slice(0, 100);
  if (visitorId) lastSeen.set(visitorId, Date.now());
  sweep();
  res.json({ online: lastSeen.size });
});

router.get('/', (req, res) => {
  sweep();
  res.json({ online: lastSeen.size });
});

module.exports = router;
