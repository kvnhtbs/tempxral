const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { setAuthCookie, clearAuthCookie, optionalAuth } = require('../auth');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts', message: 'Demasiados intentos. Prueba de nuevo en unos minutos.' }
});

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!USERNAME_RE.test(username || '')) {
    return res.status(400).json({ error: 'invalid_username', message: 'Usuario: 3-20 caracteres (letras, números, _).' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'invalid_password', message: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'username_taken', message: 'Ese usuario ya existe.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    const user = result.rows[0];
    setAuthCookie(res, user);
    res.json({ username: user.username });
  } catch (err) {
    console.error('Error en /register:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo crear la cuenta.' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'missing_fields', message: 'Usuario y contraseña son obligatorios.' });
  }
  try {
    const result = await pool.query('SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)', [username]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' });
    }
    setAuthCookie(res, user);
    res.json({ username: user.username });
  } catch (err) {
    console.error('Error en /login:', err);
    res.status(500).json({ error: 'server_error', message: 'No se pudo iniciar sesión.' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', optionalAuth, (req, res) => {
  res.json({ username: req.user ? req.user.username : null });
});

module.exports = router;
