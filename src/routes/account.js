const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, clearAuthCookie } = require('../auth');

const router = express.Router();

// Mis publicaciones (incluye las ocultas/expiradas propias, para que el usuario vea su historial)
router.get('/me/items', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, file_path, created_at, expires_at, hidden_reason
       FROM content_items
       WHERE author_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    const now = Date.now();
    res.json({
      items: result.rows.map(r => ({
        id: r.id,
        title: r.title || null,
        imageUrl: '/uploads/' + r.file_path,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        status: r.hidden_reason ? 'oculta_por_reportes' : (new Date(r.expires_at).getTime() > now ? 'activa' : 'expirada')
      }))
    });
  } catch (e) {
    console.error('Error en GET /account/me/items:', e);
    res.status(500).json({ error: 'server_error', message: 'No se pudieron cargar tus publicaciones.' });
  }
});

router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'invalid_password', message: 'La contraseña nueva debe tener al menos 6 caracteres.' });
  }
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Cuenta no encontrada.' });
    const ok = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials', message: 'La contraseña actual no es correcta.' });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true, message: 'Contraseña actualizada.' });
  } catch (e) {
    console.error('Error al cambiar contraseña:', e);
    res.status(500).json({ error: 'server_error', message: 'No se pudo cambiar la contraseña.' });
  }
});

// Elimina la cuenta. Los contenidos publicados NO se borran (se anonimiza la autoría:
// author_id queda a NULL vía ON DELETE SET NULL, pero author_username y las imágenes
// se conservan tal cual estaban), consistente con la filosofía de "nunca se borra".
router.delete('/', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Cuenta no encontrada.' });
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials', message: 'Contraseña incorrecta.' });
    await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    clearAuthCookie(res);
    res.json({ ok: true, message: 'Cuenta eliminada. Tus publicaciones se mantienen visibles, sin asociarlas ya a tu usuario.' });
  } catch (e) {
    console.error('Error al eliminar cuenta:', e);
    res.status(500).json({ error: 'server_error', message: 'No se pudo eliminar la cuenta.' });
  }
});

module.exports = router;
