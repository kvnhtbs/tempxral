const express = require('express');
const multer = require('multer');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { resizeAndSave } = require('../resizeImage');

const router = express.Router();

const DEFAULT_LIFESPAN_HOURS = 24;
const ALLOWED_DURATIONS_HOURS = [12, 24, 48];
const EXTEND_HOURS = 6;
const REPORT_THRESHOLD = 3;
const PAGE_SIZE = 24;
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

function listQuery(hasCursor) {
  return `
    SELECT
      c.id, c.author_username, c.title, c.file_path, c.created_at, c.expires_at,
      COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = 1), 0)::int AS likes,
      COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = -1), 0)::int AS dislikes,
      COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.item_id = c.id), 0)::int AS comment_count,
      (SELECT v.value FROM votes v WHERE v.item_id = c.id AND v.user_id = $1) AS my_vote,
      EXISTS(SELECT 1 FROM extensions e WHERE e.item_id = c.id AND e.user_id = $1 AND e.extended_on = CURRENT_DATE) AS extended_today,
      EXISTS(SELECT 1 FROM reports r WHERE r.item_id = c.id AND r.user_id = $1) AS reported_by_me
    FROM content_items c
    WHERE c.hidden_reason IS NULL AND c.expires_at > now()
    ${hasCursor ? 'AND c.created_at < $2' : ''}
    ORDER BY c.created_at DESC
    LIMIT ${hasCursor ? '$3' : '$2'}
  `;
}

function shapeRow(row) {
  return {
    id: row.id,
    author: row.author_username,
    title: row.title || null,
    imageUrl: '/uploads/' + row.file_path,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    likes: row.likes,
    dislikes: row.dislikes,
    net: row.likes - row.dislikes,
    commentCount: row.comment_count || 0,
    myVote: row.my_vote || null,
    extendedToday: row.extended_today,
    reportedByMe: row.reported_by_me
  };
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_SIZE, 1), 60);
    const before = req.query.before && !isNaN(Date.parse(req.query.before)) ? req.query.before : null;

    const result = before
      ? await pool.query(listQuery(true), [userId, before, limit + 1])
      : await pool.query(listQuery(false), [userId, limit + 1]);

    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    res.json({
      items: rows.map(shapeRow),
      hasMore,
      nextCursor: rows.length ? rows[rows.length - 1].created_at : null
    });
  } catch (err) {
    console.error('Error en GET /items:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cargar la cuadrícula.' });
  }
});

const commentLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

const DETAIL_QUERY = `
  SELECT
    c.id, c.author_username, c.title, c.file_path, c.created_at, c.expires_at,
    COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = 1), 0)::int AS likes,
    COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = -1), 0)::int AS dislikes,
    COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.item_id = c.id), 0)::int AS comment_count,
    (SELECT v.value FROM votes v WHERE v.item_id = c.id AND v.user_id = $1) AS my_vote,
    EXISTS(SELECT 1 FROM extensions e WHERE e.item_id = c.id AND e.user_id = $1 AND e.extended_on = CURRENT_DATE) AS extended_today,
    EXISTS(SELECT 1 FROM reports r WHERE r.item_id = c.id AND r.user_id = $1) AS reported_by_me
  FROM content_items c
  WHERE c.id = $2 AND c.hidden_reason IS NULL AND c.expires_at > now()
  LIMIT 1
`;

router.get('/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const userId = req.user ? req.user.id : null;
    const result = await pool.query(DETAIL_QUERY, [userId, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Esta publicación ya no está disponible.' });
    }
    const comments = await pool.query(
      'SELECT id, author_username, body, created_at FROM comments WHERE item_id = $1 ORDER BY created_at ASC LIMIT 300',
      [id]
    );
    res.json({
      item: shapeRow(result.rows[0]),
      comments: comments.rows.map(c => ({ id: c.id, author: c.author_username, body: c.body, createdAt: c.created_at }))
    });
  } catch (err) {
    console.error('Error en GET /items/:id:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cargar la publicación.' });
  }
});

router.post('/:id/comments', requireAuth, commentLimiter, async (req, res) => {
  const { id } = req.params;
  const body = (req.body && req.body.body || '').trim().slice(0, 500);
  if (body.length === 0) {
    return res.status(400).json({ error: 'empty_comment', message: 'El comentario no puede estar vacío.' });
  }
  try {
    const item = await pool.query('SELECT id FROM content_items WHERE id = $1 AND hidden_reason IS NULL AND expires_at > now()', [id]);
    if (item.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Esta publicación ya no está disponible.' });
    }
    const result = await pool.query(
      `INSERT INTO comments (item_id, author_id, author_username, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, author_username, body, created_at`,
      [id, req.user.id, req.user.username, body]
    );
    const c = result.rows[0];
    res.status(201).json({ id: c.id, author: c.author_username, body: c.body, createdAt: c.created_at });
  } catch (err) {
    console.error('Error al comentar:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo publicar el comentario.' });
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
      const requestedHours = parseInt(req.body && req.body.durationHours, 10);
      const lifespanHours = ALLOWED_DURATIONS_HOURS.includes(requestedHours) ? requestedHours : DEFAULT_LIFESPAN_HOURS;
      const expiresAt = new Date(Date.now() + lifespanHours * 3600 * 1000);
      const rawTitle = (req.body && req.body.title || '').trim().slice(0, 120);
      const title = rawTitle.length > 0 ? rawTitle : null;
      const result = await pool.query(
        `INSERT INTO content_items (author_id, author_username, title, media_type, file_path, expires_at)
         VALUES ($1, $2, $3, 'image', $4, $5)
         RETURNING id, author_username, title, file_path, created_at, expires_at`,
        [req.user.id, req.user.username, title, filename, expiresAt]
      );
      const row = result.rows[0];
      res.status(201).json(shapeRow({ ...row, likes: 0, dislikes: 0, comment_count: 0, my_vote: null, extended_today: false, reported_by_me: false }));
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
