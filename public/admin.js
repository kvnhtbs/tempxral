(function () {
  const $ = (sel) => document.querySelector(sel);
  const authArea = $('#txp-auth-area');
  const gate = $('#txp-admin-gate');
  const panel = $('#txp-admin-panel');
  const content = $('#txp-admin-content');
  const toastEl = $('#txp-toast');

  let currentTab = 'reported';
  let currentUsername = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...options
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'Error');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function relTime(iso) {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return 'hace ' + Math.max(mins, 1) + ' min';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return 'hace ' + hours + 'h';
    return 'hace ' + Math.floor(hours / 24) + 'd';
  }

  document.querySelectorAll('.txp-admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.txp-admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.getAttribute('data-tab');
      loadTab();
    });
  });

  async function loadTab() {
    content.innerHTML = '<div class="txp-loading">Cargando…</div>';
    if (currentTab === 'reported') return loadItems('reported');
    if (currentTab === 'all') return loadItems('all');
    if (currentTab === 'hidden') return loadItems('hidden');
    if (currentTab === 'comments') return loadComments();
    if (currentTab === 'rooms') return loadRooms();
    if (currentTab === 'users') return loadUsers();
  }

  async function loadComments() {
    try {
      const data = await api('/api/admin/comments');
      if (data.comments.length === 0) {
        content.innerHTML = '<p style="color:var(--muted-light); font-family:var(--font-mono); font-size:13px;">No hay comentarios todavía.</p>';
        return;
      }
      content.innerHTML = data.comments.map(c => `
        <div class="txp-admin-row">
          ${c.cover ? `<img src="${c.cover}" alt="">` : ''}
          <div class="info">
            <div class="title">@${escapeHtml(c.author)} en "${c.itemTitle ? escapeHtml(c.itemTitle) : 'sin título'}"</div>
            <div>${escapeHtml(c.body)}</div>
            <div class="meta">${relTime(c.createdAt)}</div>
          </div>
          <div class="txp-admin-actions">
            <button class="txp-admin-danger" data-delete-comment="${c.id}">Eliminar</button>
          </div>
        </div>
      `).join('');

      content.querySelectorAll('[data-delete-comment]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar este comentario?')) return;
          try {
            await api('/api/admin/comments/' + btn.getAttribute('data-delete-comment'), { method: 'DELETE' });
            toast('Comentario eliminado.');
            loadTab();
          } catch (e) { toast(e.message || 'No se pudo eliminar.'); }
        });
      });
    } catch (e) {
      content.innerHTML = '<p style="color:var(--rust);">' + escapeHtml(e.message || 'Error al cargar.') + '</p>';
    }
  }

  async function loadItems(filter) {
    try {
      const data = await api('/api/admin/items?filter=' + filter);
      if (data.items.length === 0) {
        content.innerHTML = '<p style="color:var(--muted-light); font-family:var(--font-mono); font-size:13px;">Nada que mostrar aquí.</p>';
        return;
      }
      content.innerHTML = data.items.map(it => `
        <div class="txp-admin-row" data-item="${it.id}">
          <img src="${it.media[0] || ''}" alt="">
          ${it.media.length > 1 ? `<div style="font-family:var(--font-mono); font-size:10px; color:var(--muted-light); align-self:flex-start;">+${it.media.length - 1} más</div>` : ''}
          <div class="info">
            ${it.reportCount > 0 ? `<span class="badge">${it.reportCount} reporte(s)</span>` : ''}
            ${it.hiddenReason ? `<span class="badge">oculta: ${escapeHtml(it.hiddenReason)}</span>` : ''}
            <div class="title">${it.title ? escapeHtml(it.title) : '<em>Sin título</em>'} — @${escapeHtml(it.author)}</div>
            ${it.caption ? `<div>${escapeHtml(it.caption)}</div>` : ''}
            <div class="meta">${relTime(it.createdAt)} · expira ${relTime(it.expiresAt)}</div>
          </div>
          <div class="txp-admin-actions">
            <button class="txp-admin-danger" data-delete-item="${it.id}">Eliminar definitivamente</button>
          </div>
        </div>
      `).join('');

      content.querySelectorAll('[data-delete-item]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar esta publicación y sus archivos para siempre? No se puede deshacer.')) return;
          try {
            const result = await api('/api/admin/items/' + btn.getAttribute('data-delete-item'), { method: 'DELETE' });
            toast(result.message);
            loadTab();
          } catch (e) { toast(e.message || 'No se pudo eliminar.'); }
        });
      });
    } catch (e) {
      content.innerHTML = '<p style="color:var(--rust);">' + escapeHtml(e.message || 'Error al cargar.') + '</p>';
    }
  }

  async function loadRooms() {
    try {
      const data = await api('/api/admin/rooms');
      if (data.rooms.length === 0) {
        content.innerHTML = '<p style="color:var(--muted-light); font-family:var(--font-mono); font-size:13px;">No hay salas todavía.</p>';
        return;
      }
      content.innerHTML = data.rooms.map(r => `
        <div class="txp-admin-row">
          <div class="info">
            <div class="title">${escapeHtml(r.name)} <span class="meta">/${escapeHtml(r.slug)}</span></div>
            <div class="meta">
              ${r.expiresAt ? 'Temporal · ' + relTime(r.expiresAt) + (new Date(r.expiresAt) < new Date() ? ' (expirada)' : ' (activa)') : 'Permanente'}
              · creada por ${r.createdBy ? '@' + escapeHtml(r.createdBy) : '(sistema)'} · ${r.itemCount} publicación(es)
            </div>
          </div>
          <div class="txp-admin-actions">
            <button class="txp-admin-danger" data-delete-room="${r.id}">Eliminar sala</button>
          </div>
        </div>
      `).join('');

      content.querySelectorAll('[data-delete-room]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar esta sala? Sus publicaciones pasarán a General.')) return;
          try {
            const result = await api('/api/admin/rooms/' + btn.getAttribute('data-delete-room'), { method: 'DELETE' });
            toast(result.message);
            loadTab();
          } catch (e) { toast(e.message || 'No se pudo eliminar.'); }
        });
      });
    } catch (e) {
      content.innerHTML = '<p style="color:var(--rust);">' + escapeHtml(e.message || 'Error al cargar.') + '</p>';
    }
  }

  async function loadUsers() {
    content.innerHTML = `
      <div class="txp-admin-search"><input type="text" id="txp-user-search" placeholder="Buscar usuario…"></div>
      <div id="txp-users-list"><div class="txp-loading">Cargando…</div></div>
    `;
    const search = $('#txp-user-search');
    search.addEventListener('input', () => renderUsers(search.value));
    await renderUsers('');
  }

  async function renderUsers(q) {
    const list = $('#txp-users-list');
    try {
      const data = await api('/api/admin/users?q=' + encodeURIComponent(q));
      if (data.users.length === 0) {
        list.innerHTML = '<p style="color:var(--muted-light); font-family:var(--font-mono); font-size:13px;">Sin resultados.</p>';
        return;
      }
      list.innerHTML = data.users.map(u => `
        <div class="txp-admin-row">
          <div class="info">
            <div class="title">@${escapeHtml(u.username)} ${u.isAdmin ? '<span class="badge" style="background:var(--moss);">admin</span>' : ''}</div>
            <div class="meta">${u.itemCount} publicación(es) · ${u.reportsReceived} reporte(s) recibidos · registrado ${relTime(u.createdAt)}</div>
          </div>
          <div class="txp-admin-actions">
            <button class="txp-admin-danger" data-delete-user="${u.id}" data-also-content="false">Eliminar cuenta</button>
            <button class="txp-admin-danger" data-delete-user="${u.id}" data-also-content="true">Eliminar cuenta + contenido</button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('[data-delete-user]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const alsoContent = btn.getAttribute('data-also-content') === 'true';
          const confirmMsg = alsoContent
            ? '¿Eliminar esta cuenta Y TODO su contenido para siempre?'
            : '¿Eliminar esta cuenta? Su contenido se mantiene, sin autoría.';
          if (!confirm(confirmMsg)) return;
          try {
            const result = await api('/api/admin/users/' + btn.getAttribute('data-delete-user') + '?alsoDeleteContent=' + alsoContent, { method: 'DELETE' });
            toast(result.message);
            renderUsers(q);
          } catch (e) { toast(e.message || 'No se pudo eliminar.'); }
        });
      });
    } catch (e) {
      list.innerHTML = '<p style="color:var(--rust);">' + escapeHtml(e.message || 'Error al cargar.') + '</p>';
    }
  }

  async function init() {
    try {
      const me = await api('/api/auth/me');
      currentUsername = me.username;
    } catch (e) { /* visitante */ }

    authArea.innerHTML = currentUsername
      ? `<span class="who">Conectado como <b>${escapeHtml(currentUsername)}</b></span>`
      : `<span class="who">No has iniciado sesión</span>`;

    if (!currentUsername) {
      gate.innerHTML = '<p style="color:var(--muted-light);">Necesitas iniciar sesión en <a href="/" style="color:var(--paper);">la web principal</a> con una cuenta de administrador.</p>';
      return;
    }

    try {
      await api('/api/admin/me');
      panel.style.display = 'block';
      loadTab();
    } catch (e) {
      gate.innerHTML = '<p style="color:var(--muted-light);">Tu cuenta (@' + escapeHtml(currentUsername) + ') no tiene permisos de administrador.</p>';
    }
  }

  init();
})();
