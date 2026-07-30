const fs = require('fs');
const path = require('path');
const { initDatabase } = require('../src/db');

async function upgrade() {
  console.log('🚀 Iniciando actualización de Tempxral...');
  
  const pool = initDatabase();
  const client = await pool.connect();

  try {
    // Crear tabla de migraciones si no existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Leer todas las migraciones
    const migrationsDir = path.join(__dirname, '../sql/migrations');
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
      // Verificar si ya fue aplicada
      const { rows } = await client.query(
        'SELECT id FROM migrations WHERE filename = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`⏭️  Migración ya aplicada: ${file}`);
        continue;
      }

      console.log(`🔄 Aplicando migración: ${file}`);
      
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      
      await client.query(
        'INSERT INTO migrations (filename) VALUES ($1)',
        [file]
      );
      
      console.log(`✅ Migración aplicada: ${file}`);
    }

    console.log('🎉 Actualización completada exitosamente!');
  } catch (error) {
    console.error('❌ Error durante la actualización:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

upgrade();
