const { Server } = require('socket.io');

let io;

function initWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    path: '/socket.io'
  });

  // Middleware de autenticación para WebSockets
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Autenticación requerida'));
    }
    
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.username = decoded.username;
      next();
    } catch (err) {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Usuario conectado: ${socket.username} (${socket.userId})`);
    
    // Unir al usuario a su sala personal
    socket.join(`user-${socket.userId}`);
    
    // Notificar que el usuario está online
    io.emit('user-online', {
      userId: socket.userId,
      username: socket.username
    });

    // Manejar desconexión
    socket.on('disconnect', () => {
      console.log(`🔌 Usuario desconectado: ${socket.username}`);
      io.emit('user-offline', {
        userId: socket.userId,
        username: socket.username
      });
    });

    // Manejar errores
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  return io;
}

// Función para enviar notificaciones
function sendNotification(userId, notification) {
  if (!io) {
    console.warn('⚠️ WebSocket no inicializado');
    return;
  }
  
  const payload = {
    ...notification,
    read: false,
    timestamp: new Date().toISOString()
  };
  
  io.to(`user-${userId}`).emit('notification', payload);
  console.log(`📨 Notificación enviada a usuario ${userId}:`, notification.message);
}

// Función para notificar actividad en una publicación
function notifyPostActivity(postOwnerId, actorId, actorUsername, action, postId, postTitle) {
  const message = `${actorUsername} ${action} tu publicación "${postTitle || 'sin título'}"`;
  sendNotification(postOwnerId, {
    message,
    type: 'post_activity',
    action,
    postId,
    actorId,
    actorUsername,
    read: false,
    timestamp: new Date().toISOString()
  });
}

module.exports = { initWebSocket, sendNotification, notifyPostActivity };