// public/dashboard.js
let socket = null;
let notifications = [];

// ========== UTILIDADES ==========
function getToken() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'token') return decodeURIComponent(value);
    }
    return null;
}

function decodeToken(token) {
    try {
        const payload = token.split('.')[1];
        return JSON.parse(atob(payload));
    } catch {
        return null;
    }
}

// ========== AUTENTICACIÓN ==========
function checkAuth() {
    const token = getToken();
    if (!token) {
        window.location.href = '/login.html';
        return false;
    }
    
    const userData = decodeToken(token);
    if (!userData) {
        window.location.href = '/login.html';
        return false;
    }
    
    document.getElementById('username-display').textContent = `👤 ${userData.username}`;
    document.getElementById('user-info').textContent = `Bienvenido, ${userData.username}`;
    connectWebSocket(token);
    return true;
}

// ========== WEBSOCKET ==========
function connectWebSocket(token) {
    if (socket && socket.connected) return;
    
    socket = io({
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
        console.log('✅ Conectado al WebSocket');
    });

    socket.on('notification', (notification) => {
        console.log('📨 Nueva notificación:', notification);
        addNotification(notification);
        updateNotificationBadge();
        showToast(notification.message);
    });

    socket.on('disconnect', () => {
        console.log('❌ Desconectado del WebSocket');
    });
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #333;
        color: white;
        padding: 1rem 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
        max-width: 300px;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ========== NOTIFICACIONES ==========
async function loadNotifications() {
    try {
        const token = getToken();
        if (!token) return;
        
        const response = await fetch('/api/stats/notifications', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            notifications = data.notifications || [];
            renderNotifications();
            updateNotificationBadge();
        }
    } catch (error) {
        console.error('Error cargando notificaciones:', error);
    }
}

function renderNotifications() {
    const container = document.getElementById('notifications-list');
    if (!container) return;
    
    if (notifications.length === 0) {
        container.innerHTML = '<div class="loading">No hay notificaciones</div>';
        return;
    }

    container.innerHTML = notifications.map(n => `
        <div class="notification-item ${n.read ? '' : 'unread'}">
            <div>${n.message}</div>
            <div class="time">${new Date(n.created_at).toLocaleString()}</div>
        </div>
    `).join('');
}

function addNotification(notification) {
    notifications.unshift({
        ...notification,
        read: false,
        created_at: notification.timestamp || new Date().toISOString()
    });
    renderNotifications();
}

function updateNotificationBadge() {
    const unread = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notification-badge');
    if (badge) {
        if (unread > 0) {
            badge.style.display = 'inline';
            badge.textContent = unread;
        } else {
            badge.style.display = 'none';
        }
    }
}

// ========== ESTADÍSTICAS ==========
async function loadDashboardStats() {
    try {
        const token = getToken();
        if (!token) return;

        const response = await fetch('/api/stats/user/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        if (!response.ok) {
            throw new Error('Error al cargar estadísticas');
        }

        const data = await response.json();
        renderStats(data);
        renderPopularPosts(data.popular_posts);
    } catch (error) {
        console.error('Error cargando dashboard:', error);
        document.querySelector('#stats-grid .loading').textContent = '❌ Error al cargar datos';
    }
}

function renderStats(data) {
    const stats = data.stats || {};
    const grid = document.getElementById('stats-grid');
    
    grid.innerHTML = `
        <div class="stat-card">
            <div class="number">${stats.total_posts || 0}</div>
            <div class="label">📝 Total publicaciones</div>
        </div>
        <div class="stat-card">
            <div class="number">${stats.active_posts || 0}</div>
            <div class="label">✅ Activas</div>
        </div>
        <div class="stat-card">
            <div class="number">${stats.total_likes || 0}</div>
            <div class="label">❤️ Likes recibidos</div>
        </div>
        <div class="stat-card">
            <div class="number">${stats.total_views || 0}</div>
            <div class="label">👁️ Vistas totales</div>
        </div>
        <div class="stat-card">
            <div class="number">${(stats.avg_lifetime_hours || 0).toFixed(1)}h</div>
            <div class="label">⏱️ Vida promedio</div>
        </div>
        <div class="stat-card">
            <div class="number">${stats.posts_last_7_days || 0}</div>
            <div class="label">📅 Últimos 7 días</div>
        </div>
        <div class="stat-card">
            <div class="number">${data.engagement_rate || 0}</div>
            <div class="label">📊 Tasa de engagement</div>
        </div>
        <div class="stat-card">
            <div class="number">${stats.items_interacted || 0}</div>
            <div class="label">🤝 Interacciones realizadas</div>
        </div>
    `;
}

function renderPopularPosts(posts) {
    const container = document.getElementById('popular-posts-list');
    if (!container) return;
    
    if (!posts || posts.length === 0) {
        container.innerHTML = '<div class="loading">Aún no tienes publicaciones populares</div>';
        return;
    }

    container.innerHTML = posts.map(post => `
        <div style="display:flex;justify-content:space-between;padding:0.75rem;background:#f8f9fa;border-radius:8px;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
            <span
