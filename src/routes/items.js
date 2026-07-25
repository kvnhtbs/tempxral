const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { resizeAndSave } = require('../resizeImage');
const { checkImage } = require('../moderation');
const { sweepInactiveRooms } = require('./rooms');

const router = express.Router();

const DEFAULT_LIFESPAN_HOURS = 24;
const ALLOWED_DURATIONS_HOURS = [12, 24, 48];
const REPORT_THRESHOLD = 3;
const ROOM_HIDE_RATIO_THRESHOLD = 0.5; // si el 50% o más del contenido de una sala queda oculto...
const ROOM_MIN_ITEMS_FOR_RATIO_CHECK = 3; // ...y tiene al menos 3 publicaciones, se expira la sala
const PAGE_SIZE = 24;
const MAX_FILES_PER_POST = 10;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: MAX_FILES_PER_POST },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('only_images'));
    }
    cb(null, true);
  }
});

const reportLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
const voteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
const commentLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

const BASE_COLUMNS = `
  c.id, c.author_username, c.title, c.caption, c.duration_hours, c.created_at, c.expires_at,
  COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = 1), 0)::int AS likes,
  COALESCE((SELECT COUNT(*) FROM votes v WHERE v.item_id = c.id AND v.value = -1), 0)::int AS dislikes,
  COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.item_id = c.id), 0)::int AS comment_count,
  (SELECT v.value FROM votes v WHERE v.item_id = c.id AND v.user_id = $1) AS my_vote,
  EXISTS(SELECT 1 FROM extensions e WHERE e.item_id = c.id AND e.user_id = $1 AND e.extended_on = CURRENT_DATE) AS extended_today,
  EXISTS(SELECT 1 FROM reports r WHERE r.item_id = c.id AND r.user_id = $1) AS reported_by_me
`;

// Construye la consulta de listado con parámetros posicionales seguros
// (nada de reemplazos de texto frágiles sobre el SQL ya escrito).
function buildListQuery({ roomId, before, limit, userId }) {
  const params = [userId];
  let sql = `SELECT ${BASE_COLUMNS} FROM content_items c WHERE c.hidden_reason IS NULL AND c.expires_at > now()`;

  if (roomId) {
    params.push(roomId);
    sql += ` AND c.room_id = $${params.length}`;
  } else {
    sql += ` AND c.room_id IS NULL`;
  }
  if (before) {
    params.push(before);
    sql += ` AND c.created_at < $${params.length}`;
  }
  params.push(limit);
  sql += ` ORDER BY c.created_at DESC LIMIT $${params.length}`;
  return { sql, params };
}

async function attachMedia(rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map(r => r.id);
  const mediaResult = await pool.query(
    'SELECT item_id, file_path, position FROM content_media WHERE item_id = ANY($1) ORDER BY item_id, position',
    [ids]
  );
  const grouped = {};
  for (const m of mediaResult.rows) {
    if (!grouped[m.item_id]) grouped[m.item_id] = [];
    grouped[m.item_id].push('/uploads/' + m.file_path);
  }
  return rows.map(r => ({ ...r, media: grouped[r.id] || [] }));
}

function shapeRow(row) {
  const media = row.media || [];
  return {
    id: row.id,
    author: row.author_username,
    title: row.title || null,
    caption: row.caption || null,
    durationHours: row.duration_hours,
    media,
    imageUrl: media[0] || null,
    isAlbum: media.length > 1,
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

    let roomId = null;
    if (req.query.room) {
      await sweepInactiveRooms();
      const roomResult = await pool.query('SELECT id, expires_at FROM rooms WHERE slug = $1', [req.query.room]);
      if (roomResult.rowCount === 0) {
        return res.status(404).json({ error: 'room_not_found', message: 'Esa sala no existe.' });
      }
      const room = roomResult.rows[0];
      if (room.expires_at && new Date(room.expires_at).getTime() <= Date.now()) {
        return res.json({ items: [], hasMore: false, nextCursor: null, roomExpired: true });
      }
      roomId = room.id;
    }

    const { sql, params } = buildListQuery({ roomId, before, limit: limit + 1, userId });
    const result = await pool.query(sql, params);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const withMedia = await attachMedia(rows);

    res.json({
      items: withMedia.map(shapeRow),
      hasMore,
      nextCursor: rows.length ? rows[rows.length - 1].created_at : null
    });
  } catch (err) {
    console.error('Error en GET /items:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cargar la cuadrícula.' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const userId = req.user ? req.user.id : null;
    const result = await pool.query(
      `SELECT ${BASE_COLUMNS} FROM content_items c WHERE c.id = $2 AND c.hidden_reason IS NULL AND c.expires_at > now() LIMIT 1`,
      [userId, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Esta publicación ya no está disponible.' });
    }
    const [withMedia] = await attachMedia(result.rows);
    const comments = await pool.query(
      'SELECT id, author_username, body, created_at FROM comments WHERE item_id = $1 ORDER BY created_at ASC LIMIT 300',
      [id]
    );
    res.json({
      item: shapeRow(withMedia),
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
  upload.array('files', MAX_FILES_PER_POST)(req, res, async (err) => {
    if (err) {
      const message = err.message === 'only_images' ? 'Solo se admiten imágenes por ahora.' : 'No se pudo procesar el archivo (¿quizá son más de ' + MAX_FILES_PER_POST + '?).';
      return res.status(400).json({ error: 'upload_error', message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'missing_file', message: 'Falta al menos una imagen.' });
    }

    const savedPaths = [];
    try {
      // Resolver sala (opcional)
      let roomId = null;
      if (req.body.roomSlug) {
        await sweepInactiveRooms();
        const roomResult = await pool.query('SELECT id, expires_at FROM rooms WHERE slug = $1', [req.body.roomSlug]);
        const room = roomResult.rows[0];
        const roomActive = room && (!room.expires_at || new Date(room.expires_at).getTime() > Date.now());
        if (!roomActive) {
          return res.status(400).json({ error: 'invalid_room', message: 'Esa sala ya no existe o ha expirado.' });
        }
        roomId = room.id;
      }

      // Redimensionar + marcar de agua + moderar cada archivo. Si alguno se
      // rechaza, se cancela la publicación completa (todo o nada, para que
      // un álbum no quede "a medias").
      const filenames = [];
      for (let i = 0; i < req.files.length; i++) {
        const filename = await resizeAndSave(req.files[i].buffer, UPLOADS_DIR);
        const fullPath = path.join(UPLOADS_DIR, filename);
        savedPaths.push(fullPath);

        const savedBuffer = fs.readFileSync(fullPath);
        const modResult = await checkImage(savedBuffer);
        if (!modResult.allowed) {
          for (const p of savedPaths) { try { fs.unlinkSync(p); } catch (e2) { /* ya no estaba */ } }
          return res.status(422).json({
            error: 'content_rejected',
            message: 'La imagen ' + (i + 1) + ' de ' + req.files.length + ' no se puede publicar (' + modResult.reason + ').'
          });
        }
        filenames.push(filename);
      }

      const requestedHours = parseInt(req.body && req.body.durationHours, 10);
      const lifespanHours = ALLOWED_DURATIONS_HOURS.includes(requestedHours) ? requestedHours : DEFAULT_LIFESPAN_HOURS;
      const expiresAt = new Date(Date.now() + lifespanHours * 3600 * 1000);
      const rawTitle = (req.body && req.body.title || '').trim().slice(0, 120);
      const title = rawTitle.length > 0 ? rawTitle : null;
      const rawCaption = (req.body && req.body.caption || '').trim().slice(0, 500);
      const caption = rawCaption.length > 0 ? rawCaption : null;

      const itemResult = await pool.query(
        `INSERT INTO content_items (author_id, author_username, title, caption, duration_hours, media_type, file_path, expires_at, room_id)
         VALUES ($1, $2, $3, $4, $5, 'image', $6, $7, $8)
         RETURNING id, author_username, title, caption, duration_hours, created_at, expires_at`,
        [req.user.id, req.user.username, title, caption, lifespanHours, filenames[0], expiresAt, roomId]
      );
      const itemRow = itemResult.rows[0];

      const mediaValues = filenames.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
      const mediaParams = [itemRow.id];
      filenames.forEach((f, i) => { mediaParams.push(f, i); });
      await pool.query(
        `INSERT INTO content_media (item_id, file_path, position) VALUES ${mediaValues}`,
        mediaParams
      );

      if (roomId) {
        await pool.query('UPDATE rooms SET last_activity_at = now() WHERE id = $1', [roomId]);
      }

      res.status(201).json(shapeRow({
        ...itemRow,
        media: filenames.map(f => '/uploads/' + f),
        likes: 0, dislikes: 0, comment_count: 0, my_vote: null, extended_today: false, reported_by_me: false
      }));
    } catch (e) {
      console.error('Error al guardar la publicación:', e);
      for (const p of savedPaths) { try { fs.unlinkSync(p); } catch (e2) { /* ya no estaba */ } }
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
      `UPDATE content_items SET expires_at = expires_at + (duration_hours || ' hours')::interval
       WHERE id = $1 AND hidden_reason IS NULL RETURNING expires_at, duration_hours`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Esta publicación ya no está disponible.' });
    }
    res.json({ expiresAt: result.rows[0].expires_at, extendedHours: result.rows[0].duration_hours });
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
      const updated = await pool.query(
        `UPDATE content_items SET hidden_reason = 'reported', expires_at = now() WHERE id = $1 RETURNING room_id`,
        [id]
      );
      hidden = true;

      // Si esta publicación pertenece a una sala temporal y ahora un % alto
      // de su contenido está oculto por reportes, se da la sala por
      // problemática y se expira de inmediato (no se borra, igual que
      // cualquier otra expiración).
      const roomId = updated.rows[0] && updated.rows[0].room_id;
      if (roomId) {
        const stats = await pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE hidden_reason IS NOT NULL)::int AS hidden_count
           FROM content_items WHERE room_id = $1`,
          [roomId]
        );
        const { total, hidden_count } = stats.rows[0];
        if (total >= ROOM_MIN_ITEMS_FOR_RATIO_CHECK && hidden_count / total >= ROOM_HIDE_RATIO_THRESHOLD) {
          await pool.query(
            `UPDATE rooms SET expires_at = now() WHERE id = $1 AND expires_at IS NOT NULL AND expires_at > now()`,
            [roomId]
          );
        }
      }
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
