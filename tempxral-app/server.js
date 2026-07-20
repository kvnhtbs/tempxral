require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./src/routes/auth');
const itemsRoutes = require('./src/routes/items');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.set('trust proxy', 1); // necesario detrás de Render/Railway/Fly para cookies "secure" y rate limit por IP real

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '365d', immutable: true }));

app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Sirve el frontend estático (misma app, mismo dominio: sin líos de CORS)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manejador de errores por defecto
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'server_error', message: 'Algo ha fallado en el servidor.' });
});

app.listen(PORT, () => {
  console.log(`Tempxral escuchando en el puerto ${PORT}`);
});
