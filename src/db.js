const { Pool } = require('pg');

let pool;

function initDatabase() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20, // Número máximo de clientes en el pool
      idleTimeoutMillis: 30000, // Tiempo máximo que un cliente puede estar inactivo
      connectionTimeoutMillis: 2000, // Tiempo máximo para establecer conexión
    });

    // Eventos de conexión para debugging
    pool.on('connect', () => {
      console.log('📊 Conectado a PostgreSQL');
    });

    pool.on('error', (err) => {
      console.error('❌ Error inesperado en PostgreSQL:', err);
    });

    // Función de health check para verificar la conexión
    pool.on('acquire', (client) => {
      // Verificar que la conexión sigue viva
      client.query('SELECT 1').catch((err) => {
        console.error('❌ Error en health check de conexión:', err);
      });
    });
  }

  return pool;
}

// Middleware para inyectar la conexión a la DB en las peticiones
function dbMiddleware(req, res, next) {
  req.db = pool;
  next();
}

// Función para obtener un cliente de la conexión (para transacciones)
async function getClient() {
  return await pool.connect();
}

// Función para ejecutar queries con parámetros
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('📊 Query ejecutado:', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('❌ Error en query:', { text, error: error.message });
    throw error;
  }
}

// Función para obtener estadísticas de la DB
async function getDbStats() {
  try {
    const result = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM items) as items,
        (SELECT COUNT(*) FROM items WHERE expires_at > NOW()) as active_items,
        (SELECT COUNT(*) FROM likes) as likes,
        (SELECT COUNT(*) FROM comments) as comments,
        (SELECT COUNT(*) FROM views) as views,
        (SELECT COUNT(*) FROM notifications WHERE read = false) as unread_notifications
    `);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de DB:', error);
    return null;
  }
}

// Función para verificar la conexión
async function checkConnection() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('❌ Error de conexión a la base de datos:', error);
    return false;
  }
}

module.exports = { 
  initDatabase, 
  dbMiddleware, 
  getClient, 
  query,
  getDbStats,
  checkConnection,
  pool // Exportar pool para acceso directo si es necesario
};
