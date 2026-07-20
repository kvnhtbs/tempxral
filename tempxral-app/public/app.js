(function () {
  const EXTEND_HOURS = 24;

  const state = { currentUser: null, items: [], mode: 'login' };

  const $ = (sel) => document.querySelector(sel);
  const authArea = $('#txp-auth-area');
  const banner = $('#txp-banner');
  const gridArea = $('#txp-grid-area');
  const statusRow = $('#txp-status-row');
  const overlay = $('#txp-overlay');
  const modalTitle = $('#txp-modal-title');
  const modalSub = $('#txp-modal-sub');
  const modalErr = $('#txp-modal-err');
  const modalSwitch = $('#txp-modal-switch');
  const usernameInput = $('#txp-username');
  const passwordInput = $('#txp-password');
  const toastEl = $('#txp-toast');
  const fileInput = $('#txp-file-input');

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...options
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* sin cuerpo JSON */ }
    if (!res.ok) {
      const message = (data && data.message) || 'Ha ocurrido un error.';
      const err = new Error(message);
      err.status = res.status;
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function requireAuth(action) {
    if (state.currentUser) { action(); return; }
    toast('Necesitas una cuenta para hacer eso.');
    openModal('register');
  }

  function openModal(mode) {
    state.mode = mode;
    modalErr.textContent = '';
    usernameInput.value = ''; passwordInput.value = '';
    if (mode === 'login') {
      modalTitle.textContent = 'Inicia sesión';
      modalSub.textContent = 'Bienvenido de nuevo a Tempxral';
      modalSwitch.textContent = '¿No tienes cuenta? Regístrate';
      $('#txp-modal-submit').textContent = 'Entrar';
    } else {
      modalTitle.textContent = 'Crea tu cuenta';
      modalSub.textContent = 'Necesaria para subir, votar, ampliar tiempo o reportar';
      modalSwitch.textContent = '¿Ya tienes cuenta? Inicia sesión';
      $('#txp-modal-submit').textContent = 'Registrarme';
    }
    overlay.classList.add('open');
    usernameInput.focus();
  }
  function closeModal() { overlay.classList.remove('open'); }

  $('#txp-modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  modalSwitch.addEventListener('click', () => openModal(state.mode === 'login' ? 'register' : 'login'));
  $('#txp-banner-register').addEventListener('click', () => openModal('register'));

  $('#txp-modal-submit').addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    modalErr.textContent = '';
    try {
      const data = await api('/api/auth/' + state.mode, {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.currentUser = data.username;
      closeModal();
      toast(state.mode === 'register' ? 'Cuenta creada. ¡Bienvenido, ' + data.username + '!' : 'Sesión iniciada. Hola de nuevo, ' + data.username + '.');
      render();
    } catch (e) {
      modalErr.textContent = e.message;
    }
  });

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* seguimos igual */ }
    state.currentUser = null;
    toast('Sesión cerrada.');
    render();
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Solo se admiten imágenes por ahora.'); return; }
    requireAuth(async () => {
      toast('Subiendo imagen…');
      try {
        const form = new FormData();
        form.append('file', file);
        const item = await api('/api/items', { method: 'POST', body: form });
        state.items.unshift(item);
        toast('Imagen publicada. Estará visible 48h.');
        render();
      } catch (e) {
        toast(e.message || 'No se pudo subir la imagen.');
      }
    });
  });
  $('#txp-upload-btn').addEventListener('click', () => {
    if (!state.currentUser) { requireAuth(() => {}); return; }
    fileInput.click();
  });

  async function vote(itemId, value) {
    requireAuth(async () => {
      try {
        const result = await api('/api/items/' + itemId + '/vote', {
          method: 'POST',
          body: JSON.stringify({ value })
        });
        const item = state.items.find(i => i.id === itemId);
        if (item) Object.assign(item, result);
        render();
      } catch (e) {
        toast(e.message || 'No se pudo registrar el voto.');
      }
    });
  }

  async function extend(itemId) {
    requireAuth(async () => {
      try {
        const result = await api('/api/items/' + itemId + '/extend', { method: 'POST' });
        const item = state.items.find(i => i.id === itemId);
        if (item) { item.expiresAt = result.expiresAt; item.extendedToday = true; }
        toast('+' + EXTEND_HOURS + 'h añadidas al tiempo de vida.');
        render();
      } catch (e) {
        toast(e.message || 'No se pudo ampliar el tiempo.');
      }
    });
  }

  async function report(itemId) {
    requireAuth(async () => {
      try {
        const result = await api('/api/items/' + itemId + '/report', { method: 'POST' });
        if (result.hidden) {
          state.items = state.items.filter(i => i.id !== itemId);
        } else {
          const item = state.items.find(i => i.id === itemId);
          if (item) item.reportedByMe = true;
        }
        toast(result.message);
        render();
      } catch (e) {
        toast(e.message || 'No se pudo enviar el reporte.');
      }
    });
  }

  function timeLeftParts(expiresAt) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return null;
    const totalMin = Math.floor(ms / 60000);
    return { ms, days: Math.floor(totalMin / 1440), hours: Math.floor((totalMin % 1440) / 60), mins: totalMin % 60 };
  }

  function relativeSince(iso) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return 'hace ' + Math.max(mins, 1) + ' min';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return 'hace ' + hours + 'h';
    return 'hace ' + Math.floor(hours / 24) + 'd';
  }

  function renderAuth() {
    authArea.innerHTML = '';
    if (state.currentUser) {
      const span = document.createElement('span');
      span.className = 'who';
      span.innerHTML = 'Conectado como <b>' + escapeHtml(state.currentUser) + '</b>';
      const btn = document.createElement('button');
      btn.className = 'txp-btn ghost';
      btn.textContent = 'Cerrar sesión';
      btn.addEventListener('click', logout);
      authArea.appendChild(span);
      authArea.appendChild(btn);
      banner.style.display = 'none';
    } else {
      const loginBtn = document.createElement('button');
      loginBtn.className = 'txp-btn';
      loginBtn.textContent = 'Iniciar sesión';
      loginBtn.addEventListener('click', () => openModal('login'));
      const registerBtn = document.createElement('button');
      registerBtn.className = 'txp-btn primary';
      registerBtn.textContent = 'Registrarme';
      registerBtn.addEventListener('click', () => openModal('register'));
      authArea.appendChild(loginBtn);
      authArea.appendChild(registerBtn);
      banner.style.display = 'flex';
    }
  }

  function renderGrid() {
    const now = Date.now();
    const visible = state.items.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (visible.length === 0) {
      gridArea.innerHTML = '<div class="txp-empty">Aún no hay contenido activo en la cuadrícula.<br>Sube la primera imagen: no se podrá borrar, solo se desvanecerá con el tiempo.</div>';
      return;
    }

    gridArea.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'txp-grid';

    visible.forEach((item) => {
      const parts = timeLeftParts(item.expiresAt);
      if (!parts) return; // ya expiró en el navegador, esperará al próximo refresco del servidor
      const totalLifespan = new Date(item.expiresAt) - new Date(item.createdAt);
      const remaining = new Date(item.expiresAt) - now;
      const fraction = Math.max(0, Math.min(1, remaining / totalLifespan));
      const isUrgent = fraction < 0.15;

      const card = document.createElement('div');
      card.className = 'txp-card' + (isUrgent ? ' urgent' : '');
      card.style.setProperty('--fade-gray', String(1 - fraction * 0.85));
      card.style.opacity = String(0.55 + fraction * 0.45);

      const timeLabel = parts.days > 0 ? parts.days + 'd ' + parts.hours + 'h restantes' : parts.hours + 'h ' + parts.mins + 'm restantes';

      card.innerHTML = `
        <div class="txp-imgwrap">
          <img src="${item.imageUrl}" alt="Contenido publicado por ${escapeHtml(item.author)}" loading="lazy">
          <button class="txp-report-btn ${item.reportedByMe ? 'reported' : ''}" data-report="1" title="${item.reportedByMe ? 'Ya reportado' : 'Reportar contenido inapropiado'}">&#9873;</button>
        </div>
        <div class="txp-meta">
          <span>@${escapeHtml(item.author)}</span>
          <span>${relativeSince(item.createdAt)}</span>
        </div>
        <div class="txp-countdown ${isUrgent ? 'urgent' : ''}"><span class="time">${timeLabel}</span></div>
        <div class="txp-drain"><div style="width:${Math.round(fraction * 100)}%; background:${isUrgent ? 'var(--rust)' : 'var(--moss)'}"></div></div>
        <div class="txp-actions">
          <div class="txp-votes">
            <button class="txp-stamp like ${item.myVote === 1 ? 'active' : ''}" data-vote="1">▲ ${item.likes}</button>
            <button class="txp-stamp dislike ${item.myVote === -1 ? 'active' : ''}" data-vote="-1">▼ ${item.dislikes}</button>
          </div>
          <span class="txp-score">Total: ${item.net > 0 ? '+' + item.net : item.net}</span>
          <button class="txp-extend" data-extend="1" ${item.extendedToday ? 'disabled' : ''}>${item.extendedToday ? 'Ampliado hoy' : '+' + EXTEND_HOURS + 'h'}</button>
        </div>
      `;

      card.querySelectorAll('[data-vote]').forEach(btn => btn.addEventListener('click', () => vote(item.id, parseInt(btn.getAttribute('data-vote'), 10))));
      const extBtn = card.querySelector('[data-extend]');
      if (extBtn) extBtn.addEventListener('click', () => extend(item.id));
      const reportBtn = card.querySelector('[data-report]');
      if (reportBtn) reportBtn.addEventListener('click', () => report(item.id));

      grid.appendChild(card);
    });

    gridArea.appendChild(grid);
  }

  function render() {
    renderAuth();
    renderGrid();
    statusRow.textContent = state.items.length + ' publicación(es) activas';
  }

  async function refreshItems() {
    try {
      const data = await api('/api/items');
      state.items = data.items;
      render();
    } catch (e) {
      statusRow.textContent = 'No se pudo conectar con el servidor. Reintentando…';
    }
  }

  async function init() {
    try {
      const me = await api('/api/auth/me');
      state.currentUser = me.username;
    } catch (e) { /* seguimos como visitante */ }
    await refreshItems();
    setInterval(refreshItems, 20000);
  }

  init();
})();
