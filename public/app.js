// public/app.js
let currentUser = null;
let socket = null;
let posts = [];

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

function showFlash(message, type = 'success') {
    const el = document.getElementById('flash-message');
    el.textContent = message;
    el.className = `flash-message ${type}`;
    setTimeout(() => { el.className = 'flash-message'; }, 5000);
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ========== AUTENTICACIÓN ==========
function checkAuth() {
    const token = getToken();
    if (token) {
        const userData = decodeToken(token);
        if (userData) {
            currentUser = userData;
            document.getElementById('auth-links').style.display = 'none';
            document.getElementById('user-menu').style.display = 'flex';
            document.getElementById('username-display').textContent = `👤 ${userData.username}`;
            document.getElementById('hero-buttons').style.display = 'none';
            document.getElementById('upload-section').style.display = 'block';
            connectWebSocket(token);
            return true;
        }
    }
    document.getElementById('auth-links').style.display = 'flex';
    document.getElementById('user-menu').style.display = 'none';
    document.getElementById('hero-buttons').style.display = 'flex';
    document.getElementById('upload-section').style.display = 'none';
    return false;
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
        showToast(notification.message);
        // Actualizar badge si estamos en dashboard
        updateNotificationBadge();
    });

    socket.on('disconnect', () => {
        console.log('❌ Desconectado del WebSocket');
    });
}

function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    // Si estamos en dashboard, cargar notificaciones
    if (window.location.pathname.includes('dashboard.html')) {
        loadNotifications();
    }
}

// ========== PUBLICACIONES ==========
async function loadPosts() {
    try {
        const response = await fetch('/api/items');
        if (response.ok) {
            const data = await response.json();
            posts = data;
            renderPosts(posts);
        }
    } catch (error) {
        console.error('Error cargando publicaciones:', error);
    }
}

function renderPosts(postsData) {
    const grid = document.getElementById('posts-grid');
    
    if (!postsData || postsData.length === 0) {
        grid.innerHTML = '<div style="text-align:center;padding:2rem;color:#666;width:100%;">No hay publicaciones aún. ¡Sé el primero en publicar!</div>';
        return;
    }

    grid.innerHTML = postsData.map(post => `
        <div class="post-card" data-id="${post.id}">
            ${post.image_url ? `<img src="${post.image_url}" alt="${post.title || 'Publicación'}">` : ''}
            <div class="content">
                ${post.title ? `<div class="title">${post.title}</div>` : ''}
                ${post.description ? `<div class="description">${post.description}</div>` : ''}
                <div class="meta">
                    <span>👤 ${post.username || 'Anónimo'}</span>
                    <span>⏱️ ${new Date(post.created_at).toLocaleDateString()}</span>
                </div>
                <div class="actions">
                    <button class="like-btn ${post.user_liked ? 'liked' : ''}" data-id="${post.id}">
                        ${post.user_liked ? '❤️' : '🤍'} <span class="like-count">${post.likes || 0}</span>
                    </button>
                    <button class="comment-btn" data-id="${post.id}">💬 ${post.comments || 0}</button>
                    ${post.user_id === currentUser?.id ? `
                        <button class="delete-btn" data-id="${post.id}">🗑️</button>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('');

    // Event listeners
    document.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', () => handleLike(btn.dataset.id));
    });
}

// ========== INTERACCIONES ==========
async function handleLike(postId) {
    if (!currentUser) {
        showFlash('Debes iniciar sesión para dar like', 'error');
        return;
    }

    try {
        const token = getToken();
        const response = await fetch(`/api/items/${postId}/like`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            // Actualizar UI
            const btn = document.querySelector(`.like-btn[data-id="${postId}"]`);
            if (btn) {
                const count = btn.querySelector('.like-count');
                count.textContent = data.likes || 0;
                btn.classList.toggle('liked');
                btn.innerHTML = btn.classList.contains('liked') 
                    ? `❤️ <span class="like-count">${data.likes || 0}</span>`
                    : `🤍 <span class="like-count">${data.likes || 0}</span>`;
            }
        } else if (response.status === 401) {
            showFlash('Sesión expirada. Inicia sesión nuevamente', 'error');
            setTimeout(() => window.location.href = '/login.html', 1500);
        }
    } catch (error) {
        console.error('Error dando like:', error);
    }
}

// ========== SUBIR PUBLICACIÓN ==========
document.getElementById('upload-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentUser) {
        showFlash('Debes iniciar sesión para publicar', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('title', document.getElementById('post-title').value);
    formData.append('description', document.getElementById('post-description').value);
    formData.append('duration', document.getElementById('post-duration').value);
    formData.append('image', document.getElementById('post-image').files[0]);

    try {
        const token = getToken();
        const response = await fetch('/api/items', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (response.ok) {
            showFlash('¡Publicación creada exitosamente!', 'success');
            document.getElementById('upload-form').reset();
            loadPosts();
        } else {
            const error = await response.json();
            showFlash(error.error || 'Error al publicar', 'error');
        }
    } catch (error) {
        console.error('Error publicando:', error);
        showFlash('Error al publicar', 'error');
    }
});

// ========== LOGOUT ==========
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        if (socket) socket.disconnect();
        document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        window.location.href = '/';
    } catch (error) {
        console.error('Error cerrando sesión:', error);
    }
});

// ========== INICIALIZACIÓN ==========
document.addEventListener('DOMContentLoaded', () => {
    const authed = checkAuth();
    loadPosts();
    
    // Si estamos en dashboard, cargar notificaciones
    if (window.location.pathname.includes('dashboard.html')) {
        loadNotifications();
    }
});

// ========== NOTIFICACIONES (para dashboard) ==========
async function loadNotifications() {
    try {
        const token = getToken();
        if (!token) return;
        
        const response = await fetch('/api/stats/notifications', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const list = document.getElementById('notifications-list');
            if (!list) return;
            
            if (!data.notifications || data.notifications.length === 0) {
                list.innerHTML = '<div style="text-align:center;padding:1rem;color:#666;">No hay notificaciones</div>';
                return;
            }
            
            list.innerHTML = data.notifications.map(n => `
                <div style="padding:0.75rem;border-bottom:1px solid #ddd;${n.read ? '' : 'background:rgba(0,123,255,0.1);'}">
                    <div>${n.message}</div>
                    <small style="color:#999;">${new Date(n.created_at).toLocaleString()}</small>
                </div>
            `).join('');
            
            // Actualizar badge
            const unread = data.notifications.filter(n => !n.read).length;
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
    } catch (error) {
        console.error('Error cargando notificaciones:', error);
    }
}
