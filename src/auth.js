const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'txp_token';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Falta JWT_SECRET en las variables de entorno. Genera uno largo y aleatorio.');
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, user) {
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Adjunta req.user si hay un token válido; si no, req.user queda undefined (no bloquea).
function optionalAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: payload.sub, username: payload.username };
    } catch (e) {
      // token inválido o caducado: seguimos como visitante
    }
  }
  next();
}

// Exige sesión válida o corta con 401.
function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'auth_required', message: 'Necesitas iniciar sesión para hacer esto.' });
    }
    next();
  });
}

// Exige sesión de administrador. Comprueba is_admin en la base de datos en
// cada petición (no en el JWT), así que conceder/quitar admin surte efecto
// al momento sin tener que esperar a que caduque la sesión.
function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const { pool } = require('./db');
      const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
      if (!result.rows[0] || !result.rows[0].is_admin) {
        return res.status(403).json({ error: 'forbidden', message: 'No tienes permisos de administrador.' });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: 'server_error', message: 'No se pudo comprobar tus permisos.' });
    }
  });
}

module.exports = { COOKIE_NAME, signToken, setAuthCookie, clearAuthCookie, optionalAuth, requireAuth, requireAdmin };
