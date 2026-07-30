const { Pool } = require('pg');

let pool = null;

function initDatabase() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('connect', () => {
      console.log('📊 Conectado a PostgreSQL');
    });

    pool.on('error', (err) => {
      console.error('❌ Error en PostgreSQL:', err.message);
    });
  }
  return pool;
}

function dbMiddleware(req, res, next) {
  if (!pool) {
    try {
      initDatabase();
    } catch (error) {
      return res.status(500).json({ 
        error: 'Error de conexión a la base de datos',
        details: error.message 
      });
    }
  }
  req.db = pool;
  next();
}

async function query(text, params = []) {
  if (!pool) initDatabase();
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error('❌ Error en query:', error.message);
    throw error;
  }
}

async function checkConnection() {
  if (!pool) initDatabase();
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { 
  initDatabase, 
  dbMiddleware, 
  query,
  checkConnection
};
