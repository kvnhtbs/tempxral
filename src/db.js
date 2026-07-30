const { Pool } = require('pg');

let pool = null;
let isConnecting = false;

function initDatabase() {
  if (!pool) {
    if (isConnecting) {
      // Esperar si ya hay una conexión en curso
      return pool;
    }
    
    isConnecting = true;
    
    try {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 10, // Reducido para evitar sobrecarga en Render
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      // Eventos de conexión
      pool.on('connect', () => {
        console.log('📊 Conectado a PostgreSQL');
        isConnecting = false;
      });

      pool.on('error', (err) => {
        console.error('❌ Error en PostgreSQL:', err.message);
        // No cerramos el pool aquí para permitir reconexión
      });

      pool.on('remove', () => {
        console.log('📊 Cliente eliminado del pool');
      });

      // Health check inicial
      pool.query('SELECT 1')
        .then(() => {
          console.log('✅ Health check de DB exitoso');
        })
        .catch((err) => {
          console.error('❌ Health check falló:', err.message);
        });

    } catch (error) {
      console.error('❌ Error inicializando base de datos:', error.message);
      isConnecting = false;
      throw error;
    }
  }
  
  return pool;
}

// Middleware para inyectar la conexión a la DB en las peticiones
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

// Función para obtener un cliente de la conexión
async function getClient() {
  if (!pool) {
    initDatabase();
  }
  try {
    return await pool.connect();
  } catch (error) {
    console.error('❌ Error obteniendo cliente de DB:', error.message);
    throw error;
  }
}

// Función para ejecutar queries con parámetros
async function query(text, params = []) {
  if (!pool) {
    initDatabase();
  }
  
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    // Solo log en desarrollo
    if (process.env.NODE_ENV !== 'production') {
      console.log('📊 Query ejecutado:', { 
        text: text.substring(0, 100), 
        duration, 
        rows: res.rowCount 
      });
    }
    
    return res;
  } catch (error) {
    console.error('❌ Error en query:', { 
      text: text.substring(0, 100), 
      error: error.message 
    });
    throw error;
  }
}

// Función para obtener estadísticas de la DB
async function getDbStats() {
  if (!pool) {
    initDatabase();
  }
  
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
    console.error('❌ Error obteniendo estadísticas de DB:', error.message);
    return null;
  }
}

// Función para verificar la conexión
async function checkConnection() {
  if (!pool) {
    try {
      initDatabase();
    } catch (error) {
      return false;
    }
  }
  
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('❌ Error de conexión a la base de datos:', error.message);
    return false;
  }
}

// Función para cerrar el pool (útil para tests o shutdown)
async function closePool() {
  if (pool) {
    try {
      await pool.end();
      pool = null;
      isConnecting = false;
      console.log('📊 Pool de conexiones cerrado');
    } catch (error) {
      console.error('❌ Error cerrando pool:', error.message);
    }
  }
}

module.exports = { 
  initDatabase, 
  dbMiddleware, 
  getClient, 
  query,
  getDbStats,
  checkConnection,
  closePool
};
