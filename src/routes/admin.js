const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

router.get('/me', requireAdmin, (req, res) => {
  res.json({ ok: true, username: req.user.username });
});

// Lista publicaciones para moderar. filter=reported (por defecto) | all | hidden
router.get('/items', requireAdmin, async (req, res) => {
  const filter = req.query.filter || 'reported';
  let whereClause = '1=1';
  if (filter === 'reported') whereClause = 'report_count > 0 AND hidden_reason IS NULL';
  if (filter === 'hidden') whereClause = 'hidden_reason IS NOT NULL';
  try {
    const result = await pool.query(`
      SELECT * FROM (
        SELECT c.id, c.author_username, c.title, c.caption, c.hidden_reason, c.created_at, c.expires_at,
               (SELECT COUNT(*)::int FROM reports r WHERE r.item_id = c.id) AS report_count,
               (SELECT array_agg('/uploads/' || file_path ORDER BY position) FROM content_media m WHERE m.item_id = c.id) AS media
        FROM content_items c
      ) sub
      WHERE ${whereClause}
      ORDER BY report_count DESC, created_at DESC
      LIMIT 200
    `);

    res.json({
      items: result.rows.map(r => ({
        id: r.id,
        author: r.author_username,
        title: r.title,
        caption: r.caption,
        hiddenReason: r.hidden_reason,
        reportCount: r.report_count,
        media: r.media || [],
        createdAt: r.created_at,
        expiresAt: r.expires_at
      }))
    });
  } catch (err) {
    console.error('Error en GET /admin/items:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cargar el listado.' });
  }
});

router.delete('/items/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const media = await pool.query('SELECT file_path FROM content_media WHERE item_id = $1', [id]);
    const result = await pool.query('DELETE FROM content_items WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Esa publicación no existe.' });
    }
    for (const row of media.rows) {
      const filePath = path.join(UPLOADS_DIR, row.file_path);
      try { fs.unlinkSync(filePath); } catch (e) { /* ya no estaba */ }
    }
    res.json({ ok: true, message: 'Publicación eliminada permanentemente (' + media.rows.length + ' archivo(s)).' });
  } catch (err) {
    console.error('Error al eliminar item (admin):', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo eliminar.' });
  }
});

router.delete('/comments/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM comments WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found', message: 'Ese comentario no existe.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar comentario (admin):', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo eliminar.' });
  }
});

router.get('/rooms', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.slug, r.name, r.expires_at, r.created_at, u.username AS created_by_username,
             (SELECT COUNT(*)::int FROM content_items c WHERE c.room_id = r.id) AS item_count
      FROM rooms r
      LEFT JOIN users u ON u.id = r.created_by
      ORDER BY r.created_at DESC
      LIMIT 200
    `);
    res.json({
      rooms: result.rows.map(r => ({
        id: r.id, slug: r.slug, name: r.name, expiresAt: r.expires_at, createdAt: r.created_at,
        createdBy: r.created_by_username, itemCount: r.item_count
      }))
    });
  } catch (err) {
    console.error('Error en GET /admin/rooms:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cargar el listado.' });
  }
});

router.delete('/rooms/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found', message: 'Esa sala no existe.' });
    res.json({ ok: true, message: 'Sala eliminada. Sus publicaciones quedan sin sala (pasan a General).' });
  } catch (err) {
    console.error('Error al eliminar sala (admin):', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo eliminar.' });
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  const search = (req.query.q || '').trim();
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.is_admin, u.created_at,
             (SELECT COUNT(*)::int FROM content_items c WHERE c.author_id = u.id) AS item_count,
             (SELECT COUNT(*)::int FROM reports r JOIN content_items c ON c.id = r.item_id WHERE c.author_id = u.id) AS reports_received
      FROM users u
      WHERE $1 = '' OR u.username ILIKE '%' || $1 || '%'
      ORDER BY u.created_at DESC
      LIMIT 100
    `, [search]);
    res.json({
      users: result.rows.map(u => ({
        id: u.id, username: u.username, isAdmin: u.is_admin, createdAt: u.created_at,
        itemCount: u.item_count, reportsReceived: u.reports_received
      }))
    });
  } catch (err) {
    console.error('Error en GET /admin/users:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cargar el listado.' });
  }
});

// Elimina un usuario. Si alsoDeleteContent=true, borra también todo lo que
// haya publicado (archivos incluidos), no solo la cuenta.
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const alsoDeleteContent = req.query.alsoDeleteContent === 'true';
  try {
    if (alsoDeleteContent) {
      const items = await pool.query('SELECT id FROM content_items WHERE author_id = $1', [id]);
      for (const item of items.rows) {
        const media = await pool.query('SELECT file_path FROM content_media WHERE item_id = $1', [item.id]);
        for (const row of media.rows) {
          try { fs.unlinkSync(path.join(UPLOADS_DIR, row.file_path)); } catch (e) { /* ya no estaba */ }
        }
      }
      await pool.query('DELETE FROM content_items WHERE author_id = $1', [id]);
    }
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found', message: 'Ese usuario no existe.' });
    res.json({ ok: true, message: alsoDeleteContent ? 'Usuario y su contenido eliminados.' : 'Usuario eliminado (su contenido pasa a autoría anónima).' });
  } catch (err) {
    console.error('Error al eliminar usuario (admin):', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo eliminar.' });
  }
});

module.exports = router;
