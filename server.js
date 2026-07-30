require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const rateLimit = require('express-rate-limit');

const { initDatabase, dbMiddleware } = require('./src/db');
const { initWebSocket } = require('./src/websocket');
const authRoutes = require('./src/routes/auth');
const itemsRoutes = require('./src/routes/items');
const statsRoutes = require('./src/routes/stats');

const app = express();
const server = http.createServer(app);

// Inicializar WebSocket
const io = initWebSocket(server);

// Configuración de rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 peticiones por ventana
  message: 'Demasiadas peticiones desde esta IP',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Conectar a la base de datos
const db = initDatabase();
app.use(dbMiddleware);

// Rutas públicas
app.use(express.static('public'));

// Rutas API con rate limiting
app.use('/api/auth', limiter, authRoutes);
app.use('/api/items', limiter, itemsRoutes);
app.use('/api/stats', limiter, statsRoutes);

// Ruta para health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    websocket: io ? 'connected' : 'disconnected'
  });
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor'
  });
});

// Puerto
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🔌 WebSocket habilitado en ws://localhost:${PORT}`);
  console.log(`📊 Dashboard disponible en http://localhost:${PORT}/dashboard.html`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Recibida señal SIGTERM
