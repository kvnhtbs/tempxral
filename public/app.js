(function () {

  const state = { currentUser: null, items: [], mode: 'login', nextCursor: null, hasMore: false, loadingMore: false, pagesLoaded: 1, rooms: [], currentRoom: 'all' };

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
  const lightboxOverlay = $('#txp-lightbox-overlay');
  const lightboxBody = $('#txp-lightbox-body');
  const accountOverlay = $('#txp-account-overlay');
  const accountBody = $('#txp-account-body');
  const loadMoreBtn = $('#txp-load-more-btn');
  const roomsBar = $('#txp-rooms-bar');

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
    const checksRow = $('#txp-register-checks');
    $('#txp-check-age').checked = false;
    $('#txp-check-terms').checked = false;
    if (mode === 'login') {
      modalTitle.textContent = 'Inicia sesión';
      modalSub.textContent = 'Bienvenido de nuevo a Tempxral';
      modalSwitch.textContent = '¿No tienes cuenta? Regístrate';
      $('#txp-modal-submit').textContent = 'Entrar';
      checksRow.style.display = 'none';
    } else {
      modalTitle.textContent = 'Crea tu cuenta';
      modalSub.textContent = 'Necesaria para subir, votar, ampliar tiempo o reportar';
      modalSwitch.textContent = '¿Ya tienes cuenta? Inicia sesión';
      $('#txp-modal-submit').textContent = 'Registrarme';
      checksRow.style.display = 'flex';
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
    if (state.mode === 'register') {
      if (!$('#txp-check-age').checked || !$('#txp-check-terms').checked) {
        modalErr.textContent = 'Tienes que marcar ambas casillas para registrarte.';
        return;
      }
    }
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

  const uploadOverlay = $('#txp-upload-overlay');
  const uploadErr = $('#txp-upload-err');

  $('#txp-upload-btn').addEventListener('click', () => {
    requireAuth(() => {
      uploadErr.textContent = '';
      fileInput.value = '';
      $('#txp-file-count').textContent = '';
      $('#txp-title-input').value = '';
      $('#txp-caption-input').value = '';
      $('#txp-duration-select').value = '24';
      $('#txp-new-room-fields').style.display = 'none';
      $('#txp-new-room-name').value = '';
      $('#txp-room-select').disabled = false;
      populateRoomSelect();
      uploadOverlay.classList.add('open');
    });
  });
  $('#txp-upload-modal-close').addEventListener('click', () => uploadOverlay.classList.remove('open'));
  uploadOverlay.addEventListener('click', (e) => { if (e.target === uploadOverlay) uploadOverlay.classList.remove('open'); });

  fileInput.addEventListener('change', () => {
    const n = fileInput.files.length;
    $('#txp-file-count').textContent = n === 0 ? '' : n === 1 ? '1 imagen seleccionada' : n + ' imágenes seleccionadas (álbum)';
  });

  $('#txp-upload-submit-btn').addEventListener('click', async () => {
    const files = Array.from(fileInput.files || []);
    uploadErr.textContent = '';
    if (files.length === 0) { uploadErr.textContent = 'Elige al menos una imagen.'; return; }
    if (files.some(f => !f.type.startsWith('image/'))) { uploadErr.textContent = 'Solo se admiten imágenes por ahora.'; return; }
    if (files.length > 10) { uploadErr.textContent = 'Máximo 10 imágenes por publicación.'; return; }

    const durationSelect = $('#txp-duration-select');
    const titleInput = $('#txp-title-input');
    const captionInput = $('#txp-caption-input');
    const roomSelect = $('#txp-room-select');
    const newRoomFieldsOpen = $('#txp-new-room-fields').style.display !== 'none';
    const submitBtn = $('#txp-upload-submit-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Publicando…';
    try {
      let roomSlug = roomSelect.value;

      if (newRoomFieldsOpen) {
        const roomName = $('#txp-new-room-name').value.trim();
        if (roomName.length < 2) { throw new Error('Ponle un nombre a la sala nueva (mínimo 2 caracteres).'); }
        const roomDuration = $('#txp-new-room-duration').value;
        const newRoom = await api('/api/rooms', {
          method: 'POST',
          body: JSON.stringify({ name: roomName, durationHours: roomDuration })
        });
        roomSlug = newRoom.slug;
        await loadRooms();
      }

      const form = new FormData();
      files.forEach(f => form.append('files', f));
      form.append('title', titleInput.value.trim().slice(0, 120));
      form.append('caption', captionInput.value.trim().slice(0, 500));
      form.append('durationHours', durationSelect.value);
      if (roomSlug) form.append('roomSlug', roomSlug);

      const item = await api('/api/items', { method: 'POST', body: form });

      const belongsToCurrentView =
        state.currentRoom === 'all' ||
        (state.currentRoom === 'general' && !roomSlug) ||
        (state.currentRoom !== 'all' && state.currentRoom !== 'general' && state.currentRoom === roomSlug);

      uploadOverlay.classList.remove('open');
      toast((item.isAlbum ? 'Álbum publicado' : 'Imagen publicada') + '. Estará visible ' + durationSelect.value + 'h... para empezar.');

      if (belongsToCurrentView) {
        state.items.unshift(item);
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Se publicó en una sala que no es la que estás viendo ahora mismo:
        // no lo metemos en la lista actual (saldría descolocado), pero
        // refrescamos la barra de salas para que el contador se actualice.
        loadRooms();
      }
    } catch (e) {
      uploadErr.textContent = e.message || 'No se pudo subir la imagen.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publicar';
    }
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
        toast('+' + result.extendedHours + 'h añadidas al tiempo de vida.');
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

  // ---------- Lightbox (imagen ampliada + comentarios) ----------

  function closeLightbox() {
    lightboxOverlay.classList.remove('open');
    history.pushState({}, '', window.location.pathname);
  }
  $('#txp-lightbox-close').addEventListener('click', closeLightbox);
  lightboxOverlay.addEventListener('click', (e) => { if (e.target === lightboxOverlay) closeLightbox(); });

  let lightboxIndex = 0;

  async function openLightbox(itemId) {
    lightboxIndex = 0;
    lightboxOverlay.classList.add('open');
    lightboxBody.innerHTML = '<div class="txp-loading">Cargando…</div>';
    history.pushState({}, '', '?item=' + itemId);
    try {
      const data = await api('/api/items/' + itemId);
      renderLightbox(data.item, data.comments);
    } catch (e) {
      lightboxBody.innerHTML = '<div class="txp-empty">' + escapeHtml(e.message || 'No se pudo cargar.') + '</div>';
    }
  }

  function renderLightbox(item, comments) {
    const media = item.media && item.media.length ? item.media : [item.imageUrl];
    if (lightboxIndex >= media.length) lightboxIndex = 0;
    const currentSrc = media[lightboxIndex];

    const commentsHtml = comments.length === 0
      ? '<p class="txp-no-comments">Sé el primero en comentar.</p>'
      : comments.map(c => `
          <div class="txp-comment" data-comment-id="${c.id}">
            <span class="txp-comment-author">@${escapeHtml(c.author)}</span>
            <span class="txp-comment-body">${escapeHtml(c.body)}</span>
            <button class="txp-comment-like ${c.likedByMe ? 'active' : ''}" data-comment-like="${c.id}">♥ ${c.likeCount || 0}</button>
          </div>`).join('');

    lightboxBody.innerHTML = `
      <div class="txp-lightbox-toprow">
        <button class="txp-download-btn" id="txp-share-btn" type="button">🔗 Compartir</button>
        <a class="txp-download-btn" href="${currentSrc}" download="tempxral-${item.id}-${lightboxIndex + 1}.jpg">⬇ Descargar</a>
      </div>
      <div class="txp-carousel">
        <img class="txp-lightbox-img" src="${currentSrc}" alt="${escapeHtml(item.title || 'Contenido de ' + item.author)}">
        ${media.length > 1 ? `
          <button class="txp-carousel-nav prev" data-carousel="prev">&#8249;</button>
          <button class="txp-carousel-nav next" data-carousel="next">&#8250;</button>
        ` : ''}
      </div>
      ${media.length > 1 ? `<div class="txp-carousel-dots">${lightboxIndex + 1} / ${media.length}</div>` : ''}
      <div class="txp-lightbox-info">
        ${item.title ? `<h3 class="txp-lightbox-title">${escapeHtml(item.title)}</h3>` : ''}
        ${item.caption ? `<p class="txp-lightbox-caption">${escapeHtml(item.caption)}</p>` : ''}
        <div class="txp-meta"><span>@${escapeHtml(item.author)}</span><span>${relativeSince(item.createdAt)}</span></div>
        <div class="txp-stats-row">👁 ${item.viewCount || 0} vistas · ⬇ ${item.downloadCount || 0} descargas · ⏳ ${item.extendCount || 0} ampliaciones</div>
        <div class="txp-actions">
          <div class="txp-votes">
            <button class="txp-stamp like ${item.myVote === 1 ? 'active' : ''}" data-lb-vote="1">▲ ${item.likes}</button>
            <button class="txp-stamp dislike ${item.myVote === -1 ? 'active' : ''}" data-lb-vote="-1">▼ ${item.dislikes}</button>
          </div>
          <span class="txp-score">Total: ${item.net > 0 ? '+' + item.net : item.net}</span>
          <button class="txp-extend" data-lb-extend="1" ${item.extendedToday ? 'disabled' : ''}>${item.extendedToday ? 'Ampliado hoy' : '+' + item.durationHours + 'h'}</button>
        </div>
        <h4 class="txp-comments-title">Comentarios (${comments.length})</h4>
        <div class="txp-comments-list">${commentsHtml}</div>
        <div class="txp-comment-form">
          <input type="text" id="txp-comment-input" placeholder="Escribe un comentario…" maxlength="500">
          <button class="txp-btn primary" id="txp-comment-submit">Comentar</button>
        </div>
      </div>
    `;

    lightboxBody.querySelectorAll('[data-comment-like]').forEach(btn => btn.addEventListener('click', () => {
      requireAuth(async () => {
        const commentId = btn.getAttribute('data-comment-like');
        try {
          const result = await api('/api/items/' + item.id + '/comments/' + commentId + '/like', { method: 'POST' });
          const c = comments.find(c => c.id === commentId);
          if (c) { c.likeCount = result.likeCount; c.likedByMe = result.likedByMe; }
          renderLightbox(item, comments);
        } catch (e) { toast(e.message || 'No se pudo dar like.'); }
      });
    }));

    const prevBtn = lightboxBody.querySelector('[data-carousel="prev"]');
    const nextBtn = lightboxBody.querySelector('[data-carousel="next"]');
    if (prevBtn) prevBtn.addEventListener('click', () => { lightboxIndex = (lightboxIndex - 1 + media.length) % media.length; renderLightbox(item, comments); });
    if (nextBtn) nextBtn.addEventListener('click', () => { lightboxIndex = (lightboxIndex + 1) % media.length; renderLightbox(item, comments); });

    const downloadBtn = lightboxBody.querySelector('.txp-download-btn[href]');
    if (downloadBtn) downloadBtn.addEventListener('click', () => {
      api('/api/items/' + item.id + '/download', { method: 'POST' }).catch(() => {});
    });

    const shareBtn = $('#txp-share-btn');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      const url = window.location.origin + '/?item=' + item.id;
      try {
        await navigator.clipboard.writeText(url);
        toast('Enlace copiado.');
      } catch (e) {
        toast(url); // si el navegador bloquea el portapapeles, al menos se lo mostramos
      }
    });

    lightboxBody.querySelectorAll('[data-lb-vote]').forEach(btn => btn.addEventListener('click', () => {
      requireAuth(async () => {
        try {
          const result = await api('/api/items/' + item.id + '/vote', { method: 'POST', body: JSON.stringify({ value: parseInt(btn.getAttribute('data-lb-vote'), 10) }) });
          Object.assign(item, result);
          const gridItem = state.items.find(i => i.id === item.id);
          if (gridItem) Object.assign(gridItem, result);
          renderLightbox(item, comments);
          render();
        } catch (e) { toast(e.message || 'No se pudo votar.'); }
      });
    }));

    const extBtn = lightboxBody.querySelector('[data-lb-extend]');
    if (extBtn) extBtn.addEventListener('click', () => requireAuth(async () => {
      try {
        const result = await api('/api/items/' + item.id + '/extend', { method: 'POST' });
        item.expiresAt = result.expiresAt;
        item.extendedToday = true;
        const gridItem = state.items.find(i => i.id === item.id);
        if (gridItem) { gridItem.expiresAt = result.expiresAt; gridItem.extendedToday = true; }
        toast('+' + result.extendedHours + 'h añadidas.');
        renderLightbox(item, comments);
        render();
      } catch (e) { toast(e.message || 'No se pudo ampliar el tiempo.'); }
    }));

    const commentSubmit = lightboxBody.querySelector('#txp-comment-submit');
    const commentInput = lightboxBody.querySelector('#txp-comment-input');
    commentSubmit.addEventListener('click', () => requireAuth(async () => {
      const body = commentInput.value.trim();
      if (!body) return;
      try {
        const created = await api('/api/items/' + item.id + '/comments', { method: 'POST', body: JSON.stringify({ body }) });
        comments.push(created);
        const gridItem = state.items.find(i => i.id === item.id);
        if (gridItem) gridItem.commentCount = (gridItem.commentCount || 0) + 1;
        renderLightbox(item, comments);
        render();
      } catch (e) { toast(e.message || 'No se pudo publicar el comentario.'); }
    }));
    commentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commentSubmit.click(); });
  }

  // ---------- Panel de cuenta ----------

  $('#txp-account-close').addEventListener('click', () => accountOverlay.classList.remove('open'));
  accountOverlay.addEventListener('click', (e) => { if (e.target === accountOverlay) accountOverlay.classList.remove('open'); });

  async function openAccountPanel() {
    accountOverlay.classList.add('open');
    accountBody.innerHTML = '<div class="txp-loading">Cargando…</div>';
    try {
      const data = await api('/api/account/me/items');
      renderAccountPanel(data.items);
    } catch (e) {
      accountBody.innerHTML = '<div class="txp-empty">' + escapeHtml(e.message || 'No se pudo cargar tu cuenta.') + '</div>';
    }
  }

  const STATUS_LABELS = { activa: 'Activa', expirada: 'Expirada', oculta_por_reportes: 'Oculta por reportes' };

  function renderAccountPanel(items) {
    const itemsHtml = items.length === 0
      ? '<p class="txp-no-comments">Todavía no has subido nada.</p>'
      : items.map(it => `
          <div class="txp-account-item">
            <img src="${it.imageUrl}" alt="${escapeHtml(it.title || 'Tu publicación')}">
            <div>
              <div>${it.title ? escapeHtml(it.title) : '<em>Sin título</em>'}</div>
              <div class="txp-account-item-status">${STATUS_LABELS[it.status] || it.status}</div>
            </div>
          </div>`).join('');

    accountBody.innerHTML = `
      <p class="sub" style="margin-bottom:14px;">Conectado como <b>${escapeHtml(state.currentUser)}</b></p>

      <h4 class="txp-comments-title">Mis publicaciones</h4>
      <div class="txp-account-items">${itemsHtml}</div>

      <h4 class="txp-comments-title">Cambiar contraseña</h4>
      <div class="txp-field"><input type="password" id="txp-acc-current-pw" placeholder="Contraseña actual"></div>
      <div class="txp-field"><input type="password" id="txp-acc-new-pw" placeholder="Contraseña nueva (mín. 6 caracteres)"></div>
      <div class="txp-modal-err" id="txp-acc-pw-err"></div>
      <button class="txp-btn" id="txp-acc-pw-submit">Actualizar contraseña</button>

      <h4 class="txp-comments-title" style="color:var(--rust);">Eliminar mi cuenta</h4>
      <div class="txp-field"><input type="password" id="txp-acc-del-pw" placeholder="Confirma tu contraseña"></div>
      <div class="txp-modal-err" id="txp-acc-del-err"></div>
      <button class="txp-btn" style="border-color:var(--rust); color:var(--rust);" id="txp-acc-del-submit">Eliminar cuenta definitivamente</button>
    `;

    $('#txp-acc-pw-submit').addEventListener('click', async () => {
      const currentPassword = $('#txp-acc-current-pw').value;
      const newPassword = $('#txp-acc-new-pw').value;
      const errEl = $('#txp-acc-pw-err');
      errEl.textContent = '';
      try {
        await api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
        toast('Contraseña actualizada.');
        $('#txp-acc-current-pw').value = '';
        $('#txp-acc-new-pw').value = '';
      } catch (e) { errEl.textContent = e.message; }
    });

    $('#txp-acc-del-submit').addEventListener('click', async () => {
      const password = $('#txp-acc-del-pw').value;
      const errEl = $('#txp-acc-del-err');
      errEl.textContent = '';
      if (!confirm('¿Seguro que quieres eliminar tu cuenta? No podrás deshacerlo.')) return;
      try {
        await api('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) });
        state.currentUser = null;
        accountOverlay.classList.remove('open');
        toast('Cuenta eliminada.');
        await refreshItems();
      } catch (e) { errEl.textContent = e.message; }
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
      const accountBtn = document.createElement('button');
      accountBtn.className = 'txp-btn ghost';
      accountBtn.textContent = 'Mi cuenta';
      accountBtn.addEventListener('click', openAccountPanel);
      const btn = document.createElement('button');
      btn.className = 'txp-btn ghost';
      btn.textContent = 'Cerrar sesión';
      btn.addEventListener('click', logout);
      authArea.appendChild(span);
      authArea.appendChild(accountBtn);
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
        <div class="txp-imgwrap${item.isAlbum ? ' album' : ''}">
          <img src="${item.imageUrl}" alt="${escapeHtml(item.title || 'Contenido publicado por ' + item.author)}" loading="lazy" data-open-lightbox="1">
          <button class="txp-report-btn ${item.reportedByMe ? 'reported' : ''}" data-report="1" title="${item.reportedByMe ? 'Ya reportado' : 'Reportar contenido inapropiado'}">&#9873;</button>
          ${item.isAlbum ? `<span class="txp-album-badge">📷 1/${item.media.length}</span>` : ''}
        </div>
        ${item.title ? `<div class="txp-card-title">${escapeHtml(item.title)}</div>` : ''}
        ${item.caption ? `<div class="txp-card-caption">${escapeHtml(item.caption)}</div>` : ''}
        ${(state.currentRoom === 'all' && item.roomName) ? `<div class="txp-card-room">📍 ${escapeHtml(item.roomName)}</div>` : ''}
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
          <button class="txp-extend" data-extend="1" ${item.extendedToday ? 'disabled' : ''}>${item.extendedToday ? 'Ampliado hoy' : '+' + item.durationHours + 'h'}</button>
        </div>
        <button class="txp-comments-btn" data-open-lightbox="1">💬 ${item.commentCount || 0} comentario(s)</button>
      `;

      card.querySelectorAll('[data-open-lightbox]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(item.id); }));
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('[data-open-lightbox]')) return; // ya lo maneja su propio listener
        openLightbox(item.id);
      });

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
    statusRow.textContent = state.items.length + ' publicación(es) mostradas';
    loadMoreBtn.style.display = state.hasMore ? 'inline-block' : 'none';
    loadMoreBtn.textContent = 'Cargar más';
    loadMoreBtn.disabled = false;
  }

  function roomQuerySuffix() {
    if (state.currentRoom === 'all') return '';
    if (state.currentRoom === 'general') return '&room=general';
    return '&room=' + encodeURIComponent(state.currentRoom);
  }

  async function refreshItems() {
    if (state.pagesLoaded > 1) return; // no interrumpir si el usuario ya cargó más páginas
    try {
      const data = await api('/api/items?limit=24' + roomQuerySuffix());
      state.items = data.items;
      state.nextCursor = data.nextCursor;
      state.hasMore = data.hasMore;
      render();
    } catch (e) {
      statusRow.textContent = 'No se pudo conectar con el servidor. Reintentando…';
    }
  }

  async function loadMore() {
    if (state.loadingMore || !state.hasMore || !state.nextCursor) return;
    state.loadingMore = true;
    loadMoreBtn.textContent = 'Cargando…';
    loadMoreBtn.disabled = true;
    try {
      const data = await api('/api/items?before=' + encodeURIComponent(state.nextCursor) + roomQuerySuffix());
      state.items = state.items.concat(data.items);
      state.nextCursor = data.nextCursor;
      state.hasMore = data.hasMore;
      state.pagesLoaded += 1;
      render();
    } catch (e) {
      toast(e.message || 'No se pudo cargar más contenido.');
    } finally {
      state.loadingMore = false;
    }
  }
  loadMoreBtn.addEventListener('click', loadMore);

  async function switchRoom(mode) {
    state.currentRoom = mode; // 'all' | 'general' | <slug>
    state.pagesLoaded = 1;
    state.items = [];
    gridArea.innerHTML = '<div class="txp-loading">Cargando contenido…</div>';
    renderRoomsBar();
    await refreshItems();
  }

  async function loadRooms() {
    try {
      const data = await api('/api/rooms');
      state.rooms = data.rooms;
      renderRoomsBar();
      populateRoomSelect();
    } catch (e) { /* si falla, simplemente no se muestran salas */ }
  }

  function renderRoomsBar() {
    roomsBar.innerHTML = '';

    const allPill = document.createElement('button');
    allPill.className = 'txp-room-pill' + (state.currentRoom === 'all' ? ' active' : '');
    allPill.textContent = 'Todo';
    allPill.title = 'Todo lo publicado, en cualquier sala';
    allPill.addEventListener('click', () => switchRoom('all'));
    roomsBar.appendChild(allPill);

    const generalPill = document.createElement('button');
    generalPill.className = 'txp-room-pill' + (state.currentRoom === 'general' ? ' active' : '');
    generalPill.textContent = 'General';
    generalPill.title = 'Solo lo publicado sin sala asignada';
    generalPill.addEventListener('click', () => switchRoom('general'));
    roomsBar.appendChild(generalPill);

    state.rooms.forEach(room => {
      const pill = document.createElement('button');
      pill.className = 'txp-room-pill' + (state.currentRoom === room.slug ? ' active' : '') + (room.isTemporary ? ' temp' : '');
      pill.innerHTML = escapeHtml(room.name) + ' <span class="count">' + room.activeCount + '</span>';
      pill.title = room.isTemporary ? 'Sala temporal' : 'Sala permanente';
      pill.addEventListener('click', () => switchRoom(room.slug));
      roomsBar.appendChild(pill);
    });

    const newRoomBtn = document.createElement('button');
    newRoomBtn.className = 'txp-room-pill';
    newRoomBtn.style.borderStyle = 'dashed';
    newRoomBtn.textContent = '+ Nueva sala';
    newRoomBtn.addEventListener('click', () => requireAuth(() => {
      $('#txp-newroom-err').textContent = '';
      $('#txp-newroom-name').value = '';
      $('#txp-newroom-duration').value = '24';
      $('#txp-newroom-overlay').classList.add('open');
    }));
    roomsBar.appendChild(newRoomBtn);
  }

  function populateRoomSelect() {
    const select = $('#txp-room-select');
    select.innerHTML = '<option value="">General</option>' +
      state.rooms.map(r => `<option value="${escapeHtml(r.slug)}">${escapeHtml(r.name)}</option>`).join('');
    if (state.currentRoom) select.value = state.currentRoom;
  }

  $('#txp-new-room-toggle').addEventListener('click', () => {
    const fields = $('#txp-new-room-fields');
    const isOpen = fields.style.display !== 'none';
    fields.style.display = isOpen ? 'none' : 'block';
    $('#txp-room-select').disabled = !isOpen;
  });

  $('#txp-newroom-close').addEventListener('click', () => $('#txp-newroom-overlay').classList.remove('open'));
  $('#txp-newroom-overlay').addEventListener('click', (e) => { if (e.target === $('#txp-newroom-overlay')) $('#txp-newroom-overlay').classList.remove('open'); });

  $('#txp-newroom-submit').addEventListener('click', async () => {
    const name = $('#txp-newroom-name').value.trim();
    const durationHours = $('#txp-newroom-duration').value;
    const errEl = $('#txp-newroom-err');
    errEl.textContent = '';
    if (name.length < 2) { errEl.textContent = 'Ponle un nombre a la sala (mínimo 2 caracteres).'; return; }
    try {
      const room = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name, durationHours }) });
      await loadRooms();
      $('#txp-newroom-overlay').classList.remove('open');
      toast('Sala "' + room.name + '" creada. Dura ' + durationHours + 'h.');
      switchRoom(room.slug);
    } catch (e) {
      errEl.textContent = e.message || 'No se pudo crear la sala.';
    }
  });

  $('#txp-logo-home').addEventListener('click', () => {
    // "Ir a inicio": cierra cualquier ventana abierta, vuelve a la vista
    // "Todo" y sube arriba del todo.
    overlay.classList.remove('open');
    closeLightbox();
    accountOverlay.classList.remove('open');
    uploadOverlay.classList.remove('open');
    $('#txp-newroom-overlay').classList.remove('open');
    if (state.currentRoom !== 'all') {
      switchRoom('all');
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      overlay.classList.remove('open');
      closeLightbox();
      accountOverlay.classList.remove('open');
      uploadOverlay.classList.remove('open');
      $('#txp-newroom-overlay').classList.remove('open');
      return;
    }
    if (!lightboxOverlay.classList.contains('open')) return;
    if (e.key === 'ArrowLeft') { const btn = lightboxBody.querySelector('[data-carousel="prev"]'); if (btn) btn.click(); }
    if (e.key === 'ArrowRight') { const btn = lightboxBody.querySelector('[data-carousel="next"]'); if (btn) btn.click(); }
  });

  // ---------- Presencia: cuántas personas hay ahora mismo en la web ----------
  function getVisitorId() {
    let id = sessionStorage.getItem('txp_visitor_id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : 'v-' + Date.now() + '-' + Math.random().toString(16).slice(2));
      sessionStorage.setItem('txp_visitor_id', id);
    }
    return id;
  }

  async function pingPresence() {
    try {
      const data = await api('/api/presence/ping', { method: 'POST', body: JSON.stringify({ visitorId: getVisitorId() }) });
      const el = $('#txp-online-count');
      if (el) el.textContent = data.online === 1 ? '1 persona conectada ahora' : data.online + ' personas conectadas ahora';
    } catch (e) { /* si falla, simplemente no se actualiza esta vez */ }
  }

  async function init() {
    try {
      const me = await api('/api/auth/me');
      state.currentUser = me.username;
    } catch (e) { /* seguimos como visitante */ }
    await loadRooms();
    await refreshItems();
    pingPresence();
    setInterval(refreshItems, 20000);
    setInterval(loadRooms, 30000);
    setInterval(pingPresence, 20000);

    const sharedItemId = new URLSearchParams(window.location.search).get('item');
    if (sharedItemId) openLightbox(sharedItemId);
  }

  init();
})();
