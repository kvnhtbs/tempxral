const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../auth');

const router = express.Router();

const ALLOWED_ROOM_DURATIONS_HOURS = [1, 6, 24, 72];
const MAX_ACTIVE_ROOMS_TOTAL = 30;
const MIN_ACCOUNT_AGE_HOURS = 1;      // antigüedad mínima de cuenta para crear una sala
const COOLDOWN_AFTER_EXPIRY_HOURS = 2; // espera tras expirar tu última sala, antes de crear otra
const INACTIVITY_EXPIRY_HOURS = 6;     // una sala sin publicaciones nuevas en este tiempo, se da por expirada

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'sala';
}

// "Barre" salas temporales inactivas: si nadie ha publicado en ellas en
// INACTIVITY_EXPIRY_HOURS, se dan por expiradas ya mismo (se actualiza
// expires_at a "ahora", en vez de esperar a su fecha original). No toca las
// salas permanentes (expires_at IS NULL). Se llama de forma oportunista antes
// de listar/crear salas — no hace falta un cron aparte.
async function sweepInactiveRooms() {
  await pool.query(`
    UPDATE rooms SET expires_at = now()
    WHERE expires_at IS NOT NULL
      AND expires_at > now()
      AND last_activity_at < now() - ($1 || ' hours')::interval
  `, [INACTIVITY_EXPIRY_HOURS]);
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    await sweepInactiveRooms();
    const result = await pool.query(
      `SELECT r.id, r.slug, r.name, r.expires_at, r.created_at,
              COALESCE((SELECT COUNT(*) FROM content_items c WHERE c.room_id = r.id AND c.hidden_reason IS NULL AND c.expires_at > now()), 0)::int AS active_count
       FROM rooms r
       WHERE r.expires_at IS NULL OR r.expires_at > now()
       ORDER BY r.expires_at IS NULL DESC, r.created_at DESC
       LIMIT 100`
    );
    res.json({
      rooms: result.rows.map(r => ({
        slug: r.slug,
        name: r.name,
        isTemporary: r.expires_at !== null,
        expiresAt: r.expires_at,
        activeCount: r.active_count
      }))
    });
  } catch (err) {
    console.error('Error en GET /rooms:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudieron cargar las salas.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name || '').trim().slice(0, 60);
  const requestedHours = parseInt(req.body && req.body.durationHours, 10);
  const durationHours = ALLOWED_ROOM_DURATIONS_HOURS.includes(requestedHours) ? requestedHours : 24;

  if (name.length < 2) {
    return res.status(400).json({ error: 'invalid_name', message: 'El nombre de la sala debe tener al menos 2 caracteres.' });
  }

  try {
    await sweepInactiveRooms();

    const user = await pool.query('SELECT created_at FROM users WHERE id = $1', [req.user.id]);
    const accountAgeHours = (Date.now() - new Date(user.rows[0].created_at).getTime()) / 3600000;
    if (accountAgeHours < MIN_ACCOUNT_AGE_HOURS) {
      return res.status(403).json({
        error: 'account_too_new',
        message: 'Tu cuenta es muy reciente para crear una sala. Vuelve en un rato.'
      });
    }

    const myLastRoom = await pool.query(
      `SELECT name, expires_at FROM rooms WHERE created_by = $1 AND expires_at IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (myLastRoom.rowCount > 0) {
      const last = myLastRoom.rows[0];
      const expiresAtMs = new Date(last.expires_at).getTime();
      if (expiresAtMs > Date.now()) {
        return res.status(409).json({
          error: 'room_limit_reached',
          message: 'Ya tienes una sala activa ("' + last.name + '"). Espera a que expire para crear otra.'
        });
      }
      const hoursSinceExpiry = (Date.now() - expiresAtMs) / 3600000;
      if (hoursSinceExpiry < COOLDOWN_AFTER_EXPIRY_HOURS) {
        const remaining = Math.ceil(COOLDOWN_AFTER_EXPIRY_HOURS - hoursSinceExpiry);
        return res.status(429).json({
          error: 'room_cooldown',
          message: 'Tu última sala acaba de expirar. Espera ' + remaining + 'h más antes de crear otra.'
        });
      }
    }

    const totalActive = await pool.query(
      `SELECT COUNT(*)::int AS n FROM rooms WHERE expires_at IS NOT NULL AND expires_at > now()`
    );
    if (totalActive.rows[0].n >= MAX_ACTIVE_ROOMS_TOTAL) {
      return res.status(409).json({
        error: 'global_room_limit_reached',
        message: 'Ahora mismo hay demasiadas salas activas en Tempxral. Inténtalo más tarde.'
      });
    }

    const base = slugify(name);
    const slug = base + '-' + crypto.randomBytes(3).toString('hex');
    const expiresAt = new Date(Date.now() + durationHours * 3600 * 1000);
    const result = await pool.query(
      `INSERT INTO rooms (slug, name, created_by, expires_at, last_activity_at) VALUES ($1, $2, $3, $4, now())
       RETURNING slug, name, expires_at`,
      [slug, name, req.user.id, expiresAt]
    );
    const r = result.rows[0];
    res.status(201).json({ slug: r.slug, name: r.name, isTemporary: true, expiresAt: r.expires_at, activeCount: 0 });
  } catch (err) {
    console.error('Error al crear sala:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo crear la sala.' });
  }
});

module.exports = router;
module.exports.sweepInactiveRooms = sweepInactiveRooms;
module.exports.INACTIVITY_EXPIRY_HOURS = INACTIVITY_EXPIRY_HOURS;
