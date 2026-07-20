const express = require('express');
const multer = require('multer');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { resizeAndSave } = require('../resizeImage');

const router = express.Router();

const DEFAULT_LIFESPAN_HOURS = 48;
const EXTEND_HOURS = 24;
const REPORT_THRESHOLD = 3;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('only_images'));
    }
    cb(null, true);
  }
});

const reportLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
const voteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

const LIST_QUERY = `
  SELECT
    c.id, c.author_username, c.file_path, c.created_at, c.expires_at,
    COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = 1), 0)::int AS likes,
    COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = -1), 0)::int AS dislikes,
    (SELECT v.value FROM votes v WHERE v.item_id = c.id AND v.user_id = $1) AS my_vote,
    EXISTS(SELECT 1 FROM extensions e WHERE e.item_id = c.id AND e.user_id = $1 AND e.extended_on = CURRENT_DATE) AS extended_today,
    EXISTS(SELECT 1 FROM reports r WHERE r.item_id = c.id AND r.user_id = $1) AS reported_by_me
  FROM content_items c
  WHERE c.hidden_reason IS NULL AND c.expires_at > now()
  ORDER BY c.created_at DESC
  LIMIT 200
`;

function shapeRow(row) {
  return {
    id: row.id,
    author: row.author_username,
    imageUrl: '/uploads/' + row.file_path,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    likes: row.likes,
    dislikes: row.dislikes,
    net: row.likes - row.dislikes,
    myVote: row.my_vote || null,
    extendedToday: row.extended_today,
    reportedByMe: row.reported_by_me
  };
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await pool.query(LIST_QUERY, [userId]);
    res.json({ items: result.rows.map(shapeRow) });
  } catch (err) {
    console.error('Error en GET /items:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cargar la cuadrícula.' });
  }
});

router.post('/', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const message = err.message === 'only_images' ? 'Solo se admiten imágenes por ahora.' : 'No se pudo procesar el archivo.';
      return res.status(400).json({ error: 'upload_error', message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'Falta el archivo de imagen.' });
    }
    try {
      const filename = await resizeAndSave(req.file.buffer, UPLOADS_DIR);
      const expiresAt = new Date(Date.now() + DEFAULT_LIFESPAN_HOURS * 3600 * 1000);
      const result = await pool.query(
        `INSERT INTO content_items (author_id, author_username, media_type, file_path, expires_at)
         VALUES ($1, $2, 'image', $3, $4)
         RETURNING id, author_username, file_path, created_at, expires_at`,
        [req.user.id, req.user.username, filename, expiresAt]
      );
      const row = result.rows[0];
      res.status(201).json(shapeRow({ ...row, likes: 0, dislikes: 0, my_vote: null, extended_today: false, reported_by_me: false }));
    } catch (e) {
      console.error('Error al guardar la publicación:', e);
      res.status(500).json({ error: 'server_error', message: 'No se pudo publicar la imagen.' });
    }
  });
});

router.post('/:id/vote', requireAuth, voteLimiter, async (req, res) => {
  const { id } = req.params;
  const value = Number(req.body && req.body.value);
  if (value !== 1 && value !== -1) {
    return res.status(400).json({ error: 'invalid_value', message: 'El voto debe ser 1 o -1.' });
  }
  try {
    const existing = await pool.query('SELECT value FROM votes WHERE item_id = $1 AND user_id = $2', [id, req.user.id]);
    if (existing.rowCount > 0 && existing.rows[0].value === value) {
      await pool.query('DELETE FROM votes WHERE item_id = $1 AND user_id = $2', [id, req.user.id]);
    } else {
      await pool.query(
        `INSERT INTO votes (item_id, user_id, value) VALUES ($1, $2, $3)
         ON CONFLICT (item_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
        [id, req.user.id, value]
      );
    }
    const counts = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
       FROM votes WHERE item_id = $1`,
      [id]
    );
    const myVote = await pool.query('SELECT value FROM votes WHERE item_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({
      likes: counts.rows[0].likes,
      dislikes: counts.rows[0].dislikes,
      net: counts.rows[0].likes - counts.rows[0].dislikes,
      myVote: myVote.rows[0] ? myVote.rows[0].value : null
    });
  } catch (e) {
    console.error('Error al votar:', e);
    res.status(500).json({ error: 'server_error', message: 'No se pudo registrar el voto.' });
  }
});

router.post('/:id/extend', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('INSERT INTO extensions (item_id, user_id, extended_on) VALUES ($1, $2, CURRENT_DATE)', [id, req.user.id]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'already_extended', message: 'Ya ampliaste el tiempo de esto hoy. Vuelve mañana.' });
    }
    console.error('Error al ampliar tiempo:', e);
    return res.status(500).json({ error: 'server_error', message: 'No se pudo ampliar el tiempo.' });
  }
  try {
    const result = await pool.query(
      `UPDATE content_items SET expires_at = expires_at + ($2 || ' hours')::interval
       WHERE id = $1 AND hidden_reason IS NULL RETURNING expires_at`,
      [id, EXTEND_HOURS]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Esta publicación ya no está disponible.' });
    }
    res.json({ expiresAt: result.rows[0].expires_at });
  } catch (e) {
    console.error('Error al actualizar expiración:', e);
    res.status(500).json({ error: 'server_error', message: 'No se pudo ampliar el tiempo.' });
  }
});

router.post('/:id/report', requireAuth, reportLimiter, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('INSERT INTO reports (item_id, user_id) VALUES ($1, $2)', [id, req.user.id]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'already_reported', message: 'Ya reportaste esta publicación.' });
    }
    console.error('Error al reportar:', e);
    return res.status(500).json({ error: 'server_error', message: 'No se pudo enviar el reporte.' });
  }
  try {
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM reports WHERE item_id = $1', [id]);
    let hidden = false;
    if (count.rows[0].n >= REPORT_THRESHOLD) {
      await pool.query(`UPDATE content_items SET hidden_reason = 'reported', expires_at = now() WHERE id = $1`, [id]);
      hidden = true;
    }
    res.json({
      ok: true,
      hidden,
      message: hidden
        ? 'Gracias. Tras varios reportes, esta publicación se ha ocultado de la cuadrícula.'
        : 'Gracias, hemos registrado tu reporte.'
    });
  } catch (e) {
    console.error('Error al comprobar umbral de reportes:', e);
    res.status(500).json({ error: 'server_error', message: 'No se pudo completar el reporte.' });
  }
});

module.exports = router;
