require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  console.log('Aplicando sql/schema.sql a la base de datos...');
  await pool.query(sql);
  console.log('Listo. Tablas creadas o ya existentes.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Fallo al migrar:', err);
  process.exit(1);
});
