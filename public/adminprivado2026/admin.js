// ============================================
// Admin Panel — versión light
// Solo: Número principal vigente + reportes (refunds + ingresos)
// ============================================

const API_URL = '';
let currentToken = localStorage.getItem('adminToken') || null;
let currentAdmin = null;

// Máximo de slots permitidos por el backend (USER_LINES_MAX_SLOTS).
// Lo descubrimos del response de GET /api/admin/user-lines y lo guardamos acá.
let USER_LINES_MAX = 30;

// ============================================
// HELPERS
// ============================================
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatMoney(n) {
    const v = Number(n) || 0;
    return '$' + v.toLocaleString('es-AR');
}

function formatDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    } catch (_) {
        return String(iso);
    }
}

function todayISO() {
    const d = new Date();
    // ART = UTC-3
    const offsetMs = 3 * 60 * 60 * 1000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

function isoDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const offsetMs = 3 * 60 * 60 * 1000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

function showToast(msg, type) {
    const c = document.getElementById('toastContainer');
    if (!c) { console.log('[toast]', msg); return; }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transition = 'opacity 0.25s';
        setTimeout(() => t.remove(), 280);
    }, 3200);
}

async function authFetch(url, opts) {
    const o = opts || {};
    o.headers = Object.assign({}, o.headers || {}, {
        'Authorization': 'Bearer ' + currentToken
    });
    if (o.body && !o.headers['Content-Type']) {
        o.headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(API_URL + url, o);
    if (r.status === 401) {
        // Token expiró — forzar logout
        handleLogout();
        throw new Error('Sesión expirada');
    }
    return r;
}

// ============================================
// AUTH
// ============================================
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';

    if (!username || !password) {
        errEl.textContent = 'Completá usuario y contraseña';
        return;
    }

    try {
        const r = await fetch(API_URL + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await r.json();

        if (!r.ok || !data.token) {
            errEl.textContent = data.error || data.message || 'Credenciales inválidas';
            return;
        }

        const adminRoles = ['admin', 'depositor', 'withdrawer'];
        if (!adminRoles.includes(data.user && data.user.role)) {
            errEl.textContent = 'Tu cuenta no tiene permisos de administrador';
            return;
        }

        currentToken = data.token;
        currentAdmin = data.user;
        localStorage.setItem('adminToken', currentToken);
        showApp();
    } catch (err) {
        console.error('Login error:', err);
        errEl.textContent = 'Error de conexión';
    }
}

function handleLogout() {
    currentToken = null;
    currentAdmin = null;
    localStorage.removeItem('adminToken');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
}

function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const nameEl = document.getElementById('adminName');
    if (nameEl) nameEl.textContent = (currentAdmin && currentAdmin.username) || 'Admin';
    // Cargar la sección por defecto
    loadUserLines();
}

// ============================================
// NAVEGACIÓN ENTRE SECCIONES
// ============================================
function showSection(sectionKey) {
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));

    const map = {
        numero: 'numeroSection',
        comunidad: 'comunidadSection',
        reportDaily: 'reportDailySection',
        reportWeekly: 'reportWeeklySection',
        reportMonthly: 'reportMonthlySection',
        ingresos: 'ingresosSection',
        equipamiento: 'equipamientoSection',
        welcomebonus: 'welcomebonusSection',
        notifs: 'notifsSection',
        notifsHistory: 'notifsHistorySection'
    };
    const sectionId = map[sectionKey];
    if (sectionId) {
        const sec = document.getElementById(sectionId);
        if (sec) sec.classList.add('active');
    }
    const navEl = document.querySelector('.nav-item[data-section="' + sectionKey + '"]');
    if (navEl) navEl.classList.add('active');

    // Lazy-load por sección
    if (sectionKey === 'numero') {
        loadUserLines();
    } else if (sectionKey === 'comunidad') {
        loadUserCommunities();
    } else if (sectionKey === 'reportDaily') {
        ensureRefundDateDefaults('daily');
        loadRefundsReport('daily');
    } else if (sectionKey === 'reportWeekly') {
        ensureRefundDateDefaults('weekly');
        loadRefundsReport('weekly');
    } else if (sectionKey === 'reportMonthly') {
        ensureRefundDateDefaults('monthly');
        loadRefundsReport('monthly');
    } else if (sectionKey === 'ingresos') {
        loadIngresosReport();
    } else if (sectionKey === 'equipamiento') {
        loadEquipmentReport();
    } else if (sectionKey === 'welcomebonus') {
        loadWelcomeBonusReport();
    } else if (sectionKey === 'notifs') {
        // Setear vista previa con valores actuales
        updateNotifPreview();
        // Cargar el estado de la promo activa (si la hay).
        loadPromoAlertStatus();
    } else if (sectionKey === 'notifsHistory') {
        loadNotifsHistory();
    }
}

function ensureRefundDateDefaults(type) {
    const fromEl = document.getElementById(type + 'From');
    const toEl = document.getElementById(type + 'To');
    if (fromEl && !fromEl.value) fromEl.value = isoDaysAgo(30);
    if (toEl && !toEl.value) toEl.value = todayISO();
}

// ============================================
// NÚMERO PRINCIPAL VIGENTE — config (slots por prefijo + default)
// ============================================
function renderUserLinesSlots(slots) {
    const container = document.getElementById('userLinesSlots');
    if (!container) return;
    const data = Array.isArray(slots) ? slots : [];
    // Si no hay ningún slot guardado, arrancamos con uno vacío para que el
    // admin no vea la sección completamente desierta.
    const items = data.length > 0 ? data : [{ prefix: '', phone: '' }];
    container.innerHTML = items.map((s, i) => slotHtml(i, s.prefix || '', s.phone || '')).join('');
    updateAddLineButton();
}

function slotHtml(i, prefix, phone) {
    return `
        <div class="user-line-slot" data-slot-index="${i}" style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;position:relative;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="background:linear-gradient(135deg,#d4af37 0%,#f7931e 100%);color:#000;font-weight:800;font-size:11px;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
                <span style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Equipo ${i + 1}</span>
                <button type="button" onclick="removeLineSlot(${i})" title="Eliminar este equipo" style="margin-left:auto;background:rgba(255,80,80,0.12);border:1px solid rgba(255,80,80,0.35);color:#ff8080;font-size:11px;padding:4px 8px;border-radius:6px;cursor:pointer;font-weight:600;">🗑️ Quitar</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
                <label style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Inicio de usuario</label>
                <input type="text" class="user-line-prefix" placeholder="ej: ato (matchea atojoaquin, atomartin…)" value="${escapeHtml(prefix)}" style="padding:9px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.5);color:#fff;font-size:13px;width:100%;box-sizing:border-box;">
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
                <label style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Número vigente</label>
                <input type="text" class="user-line-phone" placeholder="+54 9 11 5555 1111" value="${escapeHtml(phone)}" style="padding:9px 10px;border-radius:7px;border:1px solid rgba(212,175,55,0.25);background:rgba(0,0,0,0.5);color:#ffd700;font-size:14px;font-weight:700;font-family:monospace;letter-spacing:1px;width:100%;box-sizing:border-box;">
            </div>
        </div>
    `;
}

function currentSlotsCount() {
    const c = document.getElementById('userLinesSlots');
    return c ? c.querySelectorAll('.user-line-slot').length : 0;
}

function addLineSlot() {
    const container = document.getElementById('userLinesSlots');
    if (!container) return;
    const i = currentSlotsCount();
    if (i >= USER_LINES_MAX) {
        showToast(`Máximo ${USER_LINES_MAX} líneas`, 'error');
        return;
    }
    container.insertAdjacentHTML('beforeend', slotHtml(i, '', ''));
    updateAddLineButton();
    // Foco en el primer input del slot recién agregado
    const last = container.lastElementChild;
    if (last) {
        const first = last.querySelector('.user-line-prefix');
        if (first) first.focus();
    }
}

function removeLineSlot(index) {
    const container = document.getElementById('userLinesSlots');
    if (!container) return;
    const slot = container.querySelector(`.user-line-slot[data-slot-index="${index}"]`);
    if (!slot) return;
    slot.remove();
    // Renumerar los slots restantes para que sigan siendo 1, 2, 3…
    const remaining = container.querySelectorAll('.user-line-slot');
    remaining.forEach((el, i) => {
        el.setAttribute('data-slot-index', i);
        const num = el.querySelector('span'); // primer span = badge con número
        if (num) num.textContent = String(i + 1);
        const label = el.querySelectorAll('span')[1];
        if (label) label.textContent = `Equipo ${i + 1}`;
        const removeBtn = el.querySelector('button[onclick^="removeLineSlot"]');
        if (removeBtn) removeBtn.setAttribute('onclick', `removeLineSlot(${i})`);
    });
    updateAddLineButton();
}

function updateAddLineButton() {
    const btn = document.getElementById('addLineBtn');
    if (!btn) return;
    const count = currentSlotsCount();
    if (count >= USER_LINES_MAX) {
        btn.disabled = true;
        btn.textContent = `Máximo alcanzado (${USER_LINES_MAX})`;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    } else {
        btn.disabled = false;
        btn.textContent = `➕ Agregar otra línea / equipo (${count}/${USER_LINES_MAX})`;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}

async function loadUserLines() {
    try {
        const r = await authFetch('/api/admin/user-lines');
        if (!r.ok) {
            renderUserLinesSlots([]);
            return;
        }
        const data = await r.json();
        if (typeof data.maxSlots === 'number' && data.maxSlots > 0) {
            USER_LINES_MAX = data.maxSlots;
        }
        renderUserLinesSlots(data.slots || []);
        const def = document.getElementById('userLinesDefaultPhone');
        if (def) def.value = data.defaultPhone || '';
    } catch (err) {
        console.error('loadUserLines error:', err);
        renderUserLinesSlots([]);
    }
}

async function saveUserLines() {
    const container = document.getElementById('userLinesSlots');
    if (!container) return;
    const prefixInputs = container.querySelectorAll('.user-line-prefix');
    const phoneInputs = container.querySelectorAll('.user-line-phone');
    const slots = [];
    for (let i = 0; i < prefixInputs.length; i++) {
        const prefix = (prefixInputs[i].value || '').trim();
        const phone = (phoneInputs[i].value || '').trim();
        if (!prefix && !phone) continue;
        if (prefix && !phone) {
            showToast('El prefijo "' + prefix + '" no tiene número', 'error');
            return;
        }
        slots.push({ prefix, phone });
    }
    const defaultPhone = (document.getElementById('userLinesDefaultPhone').value || '').trim();
    try {
        const r = await authFetch('/api/admin/user-lines', {
            method: 'PUT',
            body: JSON.stringify({ slots, defaultPhone })
        });
        const data = await r.json();
        if (r.ok) {
            showToast('Números guardados correctamente', 'success');
        } else {
            showToast(data.error || 'Error al guardar números', 'error');
        }
    } catch (err) {
        console.error('saveUserLines error:', err);
        showToast('Error al guardar números', 'error');
    }
}

// ============================================
// LINKS DE COMUNIDAD POR USUARIO — config (slots por prefijo + default)
// Mismo patron que user-lines pero con campo `link` en lugar de `phone`.
// ============================================
let USER_COMMUNITIES_MAX = 30;

function renderUserCommunitiesSlots(slots) {
    const container = document.getElementById('userCommunitiesSlots');
    if (!container) return;
    const data = Array.isArray(slots) ? slots : [];
    const items = data.length > 0 ? data : [{ prefix: '', link: '' }];
    container.innerHTML = items.map((s, i) => communitySlotHtml(i, s.prefix || '', s.link || '')).join('');
    updateAddCommunityButton();
}

function communitySlotHtml(i, prefix, link) {
    return `
        <div class="user-community-slot" data-slot-index="${i}" style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;position:relative;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="background:linear-gradient(135deg,#25d366 0%,#128c7e 100%);color:#000;font-weight:800;font-size:11px;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
                <span style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Equipo ${i + 1}</span>
                <button type="button" onclick="removeCommunitySlot(${i})" title="Eliminar este equipo" style="margin-left:auto;background:rgba(255,80,80,0.12);border:1px solid rgba(255,80,80,0.35);color:#ff8080;font-size:11px;padding:4px 8px;border-radius:6px;cursor:pointer;font-weight:600;">🗑️ Quitar</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
                <label style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Inicio de usuario</label>
                <input type="text" class="user-community-prefix" placeholder="ej: ato (matchea atojoaquin, atomartin…)" value="${escapeHtml(prefix)}" style="padding:9px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.5);color:#fff;font-size:13px;width:100%;box-sizing:border-box;">
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
                <label style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Link de comunidad</label>
                <input type="text" class="user-community-link" placeholder="https://chat.whatsapp.com/..." value="${escapeHtml(link)}" style="padding:9px 10px;border-radius:7px;border:1px solid rgba(37,211,102,0.25);background:rgba(0,0,0,0.5);color:#25d366;font-size:13px;font-weight:600;font-family:monospace;width:100%;box-sizing:border-box;">
            </div>
        </div>
    `;
}

function currentCommunitySlotsCount() {
    const c = document.getElementById('userCommunitiesSlots');
    return c ? c.querySelectorAll('.user-community-slot').length : 0;
}

function addCommunitySlot() {
    const container = document.getElementById('userCommunitiesSlots');
    if (!container) return;
    const i = currentCommunitySlotsCount();
    if (i >= USER_COMMUNITIES_MAX) {
        showToast(`Máximo ${USER_COMMUNITIES_MAX} links`, 'error');
        return;
    }
    container.insertAdjacentHTML('beforeend', communitySlotHtml(i, '', ''));
    updateAddCommunityButton();
    const last = container.lastElementChild;
    if (last) {
        const first = last.querySelector('.user-community-prefix');
        if (first) first.focus();
    }
}

function removeCommunitySlot(index) {
    const container = document.getElementById('userCommunitiesSlots');
    if (!container) return;
    const slot = container.querySelector(`.user-community-slot[data-slot-index="${index}"]`);
    if (!slot) return;
    slot.remove();
    const remaining = container.querySelectorAll('.user-community-slot');
    remaining.forEach((el, i) => {
        el.setAttribute('data-slot-index', i);
        const num = el.querySelector('span');
        if (num) num.textContent = String(i + 1);
        const label = el.querySelectorAll('span')[1];
        if (label) label.textContent = `Equipo ${i + 1}`;
        const removeBtn = el.querySelector('button[onclick^="removeCommunitySlot"]');
        if (removeBtn) removeBtn.setAttribute('onclick', `removeCommunitySlot(${i})`);
    });
    updateAddCommunityButton();
}

function updateAddCommunityButton() {
    const btn = document.getElementById('addCommunityBtn');
    if (!btn) return;
    const count = currentCommunitySlotsCount();
    if (count >= USER_COMMUNITIES_MAX) {
        btn.disabled = true;
        btn.textContent = `Máximo alcanzado (${USER_COMMUNITIES_MAX})`;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    } else {
        btn.disabled = false;
        btn.textContent = `➕ Agregar otro link / equipo (${count}/${USER_COMMUNITIES_MAX})`;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}

async function loadUserCommunities() {
    try {
        const r = await authFetch('/api/admin/user-communities');
        if (!r.ok) {
            renderUserCommunitiesSlots([]);
            return;
        }
        const data = await r.json();
        if (typeof data.maxSlots === 'number' && data.maxSlots > 0) {
            USER_COMMUNITIES_MAX = data.maxSlots;
        }
        renderUserCommunitiesSlots(data.slots || []);
        const def = document.getElementById('userCommunitiesDefaultLink');
        if (def) def.value = data.defaultLink || '';
    } catch (err) {
        console.error('loadUserCommunities error:', err);
        renderUserCommunitiesSlots([]);
    }
}

async function saveUserCommunities() {
    const container = document.getElementById('userCommunitiesSlots');
    if (!container) return;
    const prefixInputs = container.querySelectorAll('.user-community-prefix');
    const linkInputs = container.querySelectorAll('.user-community-link');
    const slots = [];
    for (let i = 0; i < prefixInputs.length; i++) {
        const prefix = (prefixInputs[i].value || '').trim();
        const link = (linkInputs[i].value || '').trim();
        if (!prefix && !link) continue;
        if (prefix && !link) {
            showToast('El prefijo "' + prefix + '" no tiene link', 'error');
            return;
        }
        if (link && !/^https?:\/\//i.test(link)) {
            showToast('El link "' + link + '" debe empezar con http:// o https://', 'error');
            return;
        }
        slots.push({ prefix, link });
    }
    const defaultLink = (document.getElementById('userCommunitiesDefaultLink').value || '').trim();
    try {
        const r = await authFetch('/api/admin/user-communities', {
            method: 'PUT',
            body: JSON.stringify({ slots, defaultLink })
        });
        const data = await r.json();
        if (r.ok) {
            showToast('Links de comunidad guardados', 'success');
        } else {
            showToast(data.error || 'Error al guardar links', 'error');
        }
    } catch (err) {
        console.error('saveUserCommunities error:', err);
        showToast('Error al guardar links', 'error');
    }
}

// ============================================
// REPORTES — REEMBOLSOS
// ============================================
async function loadRefundsReport(type) {
    const containerId = type + 'ReportContent';
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';

    const from = document.getElementById(type + 'From').value;
    const to = document.getElementById(type + 'To').value;

    const params = new URLSearchParams({ type });
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
        const r = await authFetch('/api/admin/reports/refunds?' + params.toString());
        if (!r.ok) {
            container.innerHTML = '<div class="empty-state">❌ Error cargando reporte</div>';
            return;
        }
        const data = await r.json();
        renderRefundsReport(container, data, type);
    } catch (err) {
        console.error('loadRefundsReport error:', err);
        container.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

// Cache de la data del reporte por tipo. Lo usa filterRefundsTable para
// re-renderizar solo la tabla de detalle al filtrar por usuario sin ir
// nuevamente al backend.
const refundsDataByType = {};

function renderRefundsReport(container, data, type) {
    const s = data.summary || {};
    const refunds = data.refunds || [];
    const series = data.series || [];

    refundsDataByType[type] = data;

    let html = '';

    // Resumen
    html += '<div class="report-summary">';
    html += '  <div class="stat-card"><span class="label">Reclamos</span><span class="value">' + (s.totalCount || 0) + '</span></div>';
    html += '  <div class="stat-card"><span class="label">Monto total</span><span class="value">' + formatMoney(s.totalAmount) + '</span></div>';
    html += '  <div class="stat-card"><span class="label">Usuarios únicos</span><span class="value">' + (s.uniqueUsers || 0) + '</span></div>';
    html += '</div>';

    // Serie por día
    if (series.length > 0) {
        html += '<h3 style="color:#d4af37;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:18px 0 10px;">Reclamos por día</h3>';
        html += '<table class="report-table"><thead><tr><th>Día</th><th>Reclamos</th><th>Monto</th></tr></thead><tbody>';
        for (const row of series) {
            html += '<tr>';
            html += '  <td>' + escapeHtml(row.day) + '</td>';
            html += '  <td>' + row.count + '</td>';
            html += '  <td>' + formatMoney(row.amount) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
    }

    // Encabezado de detalle + buscador por usuario
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:24px 0 10px;">';
    html += '  <h3 style="color:#d4af37;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0;">Detalle de reclamos</h3>';
    html += '  <input type="text" id="' + type + 'UserSearch" placeholder="🔍 Buscar usuario…" oninput="filterRefundsTable(\'' + type + '\')" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:13px;min-width:200px;flex:0 1 280px;">';
    html += '</div>';
    html += '<div id="' + type + 'RefundsTableContainer">' + renderRefundsTableHtml(refunds) + '</div>';

    container.innerHTML = html;
}

function renderRefundsTableHtml(refunds) {
    if (!refunds || refunds.length === 0) {
        return '<div class="empty-state">No hay reclamos para mostrar.</div>';
    }
    let html = '<table class="report-table"><thead><tr><th>Usuario</th><th>Período</th><th>Monto</th><th>Estado</th><th>Reclamado</th></tr></thead><tbody>';
    for (const ref of refunds) {
        const status = ref.status || 'completed';
        const statusCell = status === 'pending_credit_failed'
            ? '<span style="color:#ff6666;font-weight:700;" title="' + escapeHtml(ref.creditError || '') + '">⚠️ PENDIENTE</span>'
            : '<span style="color:#25d366;">✅ OK</span>';
        html += '<tr>';
        html += '  <td><strong>' + escapeHtml(ref.username) + '</strong></td>';
        html += '  <td>' + escapeHtml(ref.period || '-') + '</td>';
        html += '  <td>' + formatMoney(ref.amount) + '</td>';
        html += '  <td>' + statusCell + '</td>';
        html += '  <td>' + escapeHtml(formatDate(ref.claimedAt)) + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function filterRefundsTable(type) {
    const data = refundsDataByType[type];
    if (!data) return;
    const input = document.getElementById(type + 'UserSearch');
    const q = (input?.value || '').toLowerCase().trim();
    const all = data.refunds || [];
    const filtered = q
        ? all.filter(r => (r.username || '').toLowerCase().includes(q))
        : all;
    const tableContainer = document.getElementById(type + 'RefundsTableContainer');
    if (!tableContainer) return;
    tableContainer.innerHTML = renderRefundsTableHtml(filtered);
    // Pequeno hint de cuantos matchearon cuando hay filtro activo
    if (q) {
        const hint = document.createElement('div');
        hint.style.cssText = 'color:#888;font-size:12px;margin-top:6px;';
        hint.textContent = `Mostrando ${filtered.length} de ${all.length} reclamos`;
        tableContainer.appendChild(hint);
    }
}

// ============================================
// REPORTES — INGRESOS DIARIOS DE USUARIOS
// ============================================
async function loadIngresosReport() {
    const container = document.getElementById('ingresosReportContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';

    const days = document.getElementById('ingresosDays').value || 30;

    try {
        const r = await authFetch('/api/admin/reports/logins?days=' + encodeURIComponent(days));
        if (!r.ok) {
            container.innerHTML = '<div class="empty-state">❌ Error cargando reporte</div>';
            return;
        }
        const data = await r.json();
        renderIngresosReport(container, data);
    } catch (err) {
        console.error('loadIngresosReport error:', err);
        container.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function renderIngresosReport(container, data) {
    const t = data.totals || {};
    const series = data.series || [];

    let html = '';

    // Resumen
    html += '<div class="report-summary">';
    html += '  <div class="stat-card"><span class="label">Total usuarios</span><span class="value">' + (t.totalUsers || 0) + '</span></div>';
    html += '  <div class="stat-card"><span class="label">Activos últimas 24h</span><span class="value">' + (t.activeLast24h || 0) + '</span></div>';
    html += '  <div class="stat-card"><span class="label">Nuevos últimas 24h</span><span class="value">' + (t.newLast24h || 0) + '</span></div>';
    html += '  <div class="stat-card"><span class="label">Nuevos en el rango</span><span class="value">' + (t.newInRange || 0) + '</span></div>';
    html += '</div>';

    // Serie por día — orden descendente (más reciente arriba)
    if (series.length === 0) {
        html += '<div class="empty-state">Sin datos en el rango.</div>';
    } else {
        html += '<h3 style="color:#d4af37;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:18px 0 10px;">Ingresos por día</h3>';
        html += '<table class="report-table"><thead><tr><th>Día</th><th>Usuarios nuevos</th><th>Usuarios activos (último login ese día)</th></tr></thead><tbody>';
        for (let i = series.length - 1; i >= 0; i--) {
            const row = series[i];
            html += '<tr>';
            html += '  <td>' + escapeHtml(row.day) + '</td>';
            html += '  <td>' + row.newUsers + '</td>';
            html += '  <td>' + row.activeUsers + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
    }

    container.innerHTML = html;
}

// ============================================
// REPORTE — EQUIPAMIENTO POR USUARIO
// Quien tiene la PWA instalada y quien tiene notificaciones activas.
// ============================================
async function loadEquipmentReport() {
    const container = document.getElementById('equipmentReportContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';

    try {
        const r = await authFetch('/api/admin/reports/equipment');
        if (!r.ok) {
            container.innerHTML = '<div class="empty-state">❌ Error cargando reporte</div>';
            return;
        }
        const data = await r.json();
        renderEquipmentReport(container, data);
    } catch (err) {
        console.error('loadEquipmentReport error:', err);
        container.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

// Cache de la data de equipamiento. Lo usa filterEquipmentTable para
// re-renderizar solo la tabla al filtrar por usuario.
let equipmentDataCache = null;

// Estado de orden actual de la tabla Equipamiento. Persiste entre renders
// y se aplica en filterEquipmentTable() tambien para que el filtro respete
// el sort.
let _equipmentSortKey = 'appLastSeenDesc';

function _sortEquipmentUsers(users, key) {
    const arr = users.slice();
    const tsAppSeen = (u) => u && u.appLastSeen ? new Date(u.appLastSeen).getTime() : 0;
    const tsLastLogin = (u) => u && u.lastLogin ? new Date(u.lastLogin).getTime() : 0;
    if (key === 'appLastSeenDesc') {
        arr.sort((a, b) => tsAppSeen(b) - tsAppSeen(a) || (a.username || '').localeCompare(b.username || ''));
    } else if (key === 'appLastSeenAsc') {
        arr.sort((a, b) => {
            const ta = tsAppSeen(a), tb = tsAppSeen(b);
            // Sin actividad (0) va al final cuando ordenamos ascendente.
            if (ta === 0 && tb === 0) return (a.username || '').localeCompare(b.username || '');
            if (ta === 0) return 1;
            if (tb === 0) return -1;
            return ta - tb;
        });
    } else if (key === 'lastLoginDesc') {
        arr.sort((a, b) => tsLastLogin(b) - tsLastLogin(a) || (a.username || '').localeCompare(b.username || ''));
    } else if (key === 'usernameAsc') {
        arr.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
    }
    return arr;
}

function renderEquipmentReport(container, data) {
    const t = data.totals || {};
    const users = Array.isArray(data.users) ? data.users : [];
    const total = t.totalUsers || 0;
    const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;

    equipmentDataCache = data;

    let html = '';

    // Resumen
    html += '<div class="report-summary">';
    html += '  <div class="stat-card"><span class="label">Total usuarios</span><span class="value">' + total + '</span></div>';
    html += '  <div class="stat-card"><span class="label">📱 Con app instalada</span><span class="value">' + (t.withApp || 0) + ' <small style="font-size:11px;color:#888;">(' + pct(t.withApp || 0) + '%)</small></span></div>';
    html += '  <div class="stat-card"><span class="label">🔔 Con notificaciones</span><span class="value">' + (t.withNotifs || 0) + ' <small style="font-size:11px;color:#888;">(' + pct(t.withNotifs || 0) + '%)</small></span></div>';
    html += '  <div class="stat-card"><span class="label">✅ Con ambos</span><span class="value">' + (t.withBoth || 0) + ' <small style="font-size:11px;color:#888;">(' + pct(t.withBoth || 0) + '%)</small></span></div>';
    html += '</div>';

    if (users.length === 0) {
        html += '<div class="empty-state">Sin usuarios registrados.</div>';
        container.innerHTML = html;
        return;
    }

    // Encabezado de detalle + buscador + selector de orden
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0 10px;">';
    html += '  <h3 style="color:#d4af37;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0;">Detalle por usuario</h3>';
    html += '  <div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '    <select id="equipmentSortSelect" onchange="changeEquipmentSort(this.value)" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:13px;cursor:pointer;">';
    html += '      <option value="appLastSeenDesc"' + (_equipmentSortKey === 'appLastSeenDesc' ? ' selected' : '') + '>↓ Actividad (más reciente)</option>';
    html += '      <option value="appLastSeenAsc"' + (_equipmentSortKey === 'appLastSeenAsc' ? ' selected' : '') + '>↑ Actividad (más antigua)</option>';
    html += '      <option value="lastLoginDesc"' + (_equipmentSortKey === 'lastLoginDesc' ? ' selected' : '') + '>↓ Último ingreso</option>';
    html += '      <option value="usernameAsc"' + (_equipmentSortKey === 'usernameAsc' ? ' selected' : '') + '>A-Z usuario</option>';
    html += '    </select>';
    html += '    <input type="text" id="equipmentUserSearch" placeholder="🔍 Buscar usuario…" oninput="filterEquipmentTable()" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:13px;min-width:200px;flex:0 1 280px;">';
    html += '  </div>';
    html += '</div>';
    const sorted = _sortEquipmentUsers(users, _equipmentSortKey);
    html += '<div id="equipmentTableContainer">' + renderEquipmentTableHtml(sorted) + '</div>';

    container.innerHTML = html;
}

function changeEquipmentSort(key) {
    _equipmentSortKey = key;
    filterEquipmentTable();
}

// Convierte un ISO string en "hace X dias/horas/min" + estado visual.
// Si la PWA no se abre desde hace mucho, asumimos desinstalada aunque
// el token siga vivo en FCM.
function _formatAppLastSeen(iso) {
    if (!iso) return { text: 'Nunca', color: '#888', staleness: 'never' };
    const t = new Date(iso).getTime();
    const ms = Date.now() - t;
    if (ms < 0) return { text: 'Ahora', color: '#25d366', staleness: 'fresh' };
    const min = Math.floor(ms / 60000);
    const hrs = Math.floor(min / 60);
    const days = Math.floor(hrs / 24);
    let text;
    if (days >= 1) text = 'hace ' + days + (days === 1 ? ' día' : ' días');
    else if (hrs >= 1) text = 'hace ' + hrs + ' h';
    else if (min >= 1) text = 'hace ' + min + ' min';
    else text = 'recién';
    let color, staleness;
    if (days >= 14) { color = '#ef4444'; staleness = 'gone'; }       // probablemente borró
    else if (days >= 7) { color = '#f59e0b'; staleness = 'stale'; }  // sin abrir hace varios días
    else { color = '#25d366'; staleness = 'fresh'; }
    return { text, color, staleness };
}

function _formatPlatform(p) {
    switch (p) {
        case 'android': return '<span style="color:#3ddc84;font-weight:700;">🤖 Android</span>';
        case 'ios':     return '<span style="color:#a3a3a3;font-weight:700;">🍎 iPhone</span>';
        case 'desktop': return '<span style="color:#888;">💻 Desktop</span>';
        default:        return '<span style="color:#666;">—</span>';
    }
}

function renderEquipmentTableHtml(users) {
    if (!users || users.length === 0) {
        return '<div class="empty-state">No hay usuarios para mostrar.</div>';
    }
    let html = '<table class="report-table"><thead><tr>';
    html += '<th>Usuario</th>';
    html += '<th>Equipo</th>';
    html += '<th>📱 App</th>';
    html += '<th>Última vez en la app</th>';
    html += '<th>🔔 Notifs</th>';
    html += '<th>Último ingreso</th>';
    html += '</tr></thead><tbody>';
    for (const u of users) {
        const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('es-AR') : '—';
        const seen = _formatAppLastSeen(u.appLastSeen);
        let appCell;
        if (!u.hasApp) {
            appCell = '<span style="color:#888;">—</span>';
        } else if (seen.staleness === 'gone') {
            appCell = '<span style="color:#ef4444;font-weight:700;">⚠️ Inactiva</span>';
        } else if (seen.staleness === 'stale') {
            appCell = '<span style="color:#f59e0b;font-weight:700;">⏳ Sin abrir</span>';
        } else {
            appCell = '<span style="color:#25d366;font-weight:700;">✅ Activa</span>';
        }
        const seenCell = '<small style="color:' + seen.color + ';">' + escapeHtml(seen.text) + '</small>';
        const notifCell = u.hasNotifs
            ? '<span style="color:#25d366;font-weight:700;">✅ Sí</span>'
            : '<span style="color:#888;">—</span>';
        html += '<tr>';
        html += '<td>' + escapeHtml(u.username) + '</td>';
        html += '<td>' + _formatPlatform(u.platform) + '</td>';
        html += '<td>' + appCell + '</td>';
        html += '<td>' + seenCell + '</td>';
        html += '<td>' + notifCell + '</td>';
        html += '<td><small>' + escapeHtml(lastLogin) + '</small></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function filterEquipmentTable() {
    if (!equipmentDataCache) return;
    const input = document.getElementById('equipmentUserSearch');
    const q = (input?.value || '').toLowerCase().trim();
    const all = equipmentDataCache.users || [];
    const filtered = q
        ? all.filter(u => (u.username || '').toLowerCase().includes(q))
        : all;
    const sorted = _sortEquipmentUsers(filtered, _equipmentSortKey);
    const tableContainer = document.getElementById('equipmentTableContainer');
    if (!tableContainer) return;
    tableContainer.innerHTML = renderEquipmentTableHtml(sorted);
    if (q) {
        const hint = document.createElement('div');
        hint.style.cssText = 'color:#888;font-size:12px;margin-top:6px;';
        hint.textContent = `Mostrando ${sorted.length} de ${all.length} usuarios`;
        tableContainer.appendChild(hint);
    }
}

// ============================================
// HISTORIAL DE NOTIFICACIONES
// Lista de las notifs enviadas con audiencia, tipo, contadores de
// respuesta. Permite filtrar por tipo y limitar la cantidad.
// ============================================
async function loadNotifsHistory() {
    const container = document.getElementById('notifsHistoryContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';

    const limit = document.getElementById('notifsHistoryLimit')?.value || '50';
    const type = document.getElementById('notifsHistoryTypeFilter')?.value || '';
    const params = new URLSearchParams();
    params.set('limit', limit);
    if (type) params.set('type', type);

    try {
        const r = await authFetch('/api/admin/notifications/history?' + params.toString());
        if (!r.ok) {
            container.innerHTML = '<div class="empty-state">❌ Error cargando historial</div>';
            return;
        }
        const data = await r.json();
        renderNotifsHistory(container, data);
    } catch (err) {
        console.error('loadNotifsHistory error:', err);
        container.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function _typeLabel(t) {
    if (t === 'whatsapp_promo') return '<span style="background:#1a73e8;color:#fff;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;">📲 WhatsApp</span>';
    if (t === 'money_giveaway') return '<span style="background:#d4af37;color:#1a1a1a;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;">💰 Regalo</span>';
    return '<span style="background:rgba(255,255,255,0.10);color:#ccc;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:600;">🔔 Plain</span>';
}

function renderNotifsHistory(container, data) {
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">No hay notificaciones registradas todavía.</div>';
        return;
    }

    let html = '<table class="report-table"><thead><tr>';
    html += '<th>Fecha</th>';
    html += '<th>Audiencia</th>';
    html += '<th>Tipo</th>';
    html += '<th>Título / mensaje</th>';
    html += '<th>Detalle promo</th>';
    html += '<th>Llegó a</th>';
    html += '<th>📲 Clicks WA</th>';
    html += '<th>💰 Reclamos</th>';
    html += '</tr></thead><tbody>';

    for (const it of items) {
        const sent = it.sentAt ? new Date(it.sentAt).toLocaleString('es-AR') : '—';
        const sched = it.scheduledFor ? new Date(it.scheduledFor).toLocaleString('es-AR') : null;
        const audience = it.audienceType === 'prefix'
            ? '<small style="color:#d4af37;">prefix: <strong>' + escapeHtml(it.audiencePrefix || '') + '*</strong></small>'
            : '<small style="color:#aaa;">Todos</small>';

        let promoDetail = '—';
        if (it.type === 'whatsapp_promo' && it.promoCode) {
            const exp = it.promoExpiresAt ? new Date(it.promoExpiresAt).toLocaleString('es-AR') : '?';
            promoDetail = '<small><code style="background:rgba(0,0,0,0.4);padding:1px 6px;border-radius:4px;color:#ffd700;">' +
                escapeHtml(it.promoCode) + '</code><br>' +
                '<span style="color:#888;">Vence: ' + escapeHtml(exp) + '</span></small>';
        } else if (it.type === 'money_giveaway' && it.giveawayAmount) {
            promoDetail = '<small><strong style="color:#25d366;">$' + Number(it.giveawayAmount).toLocaleString('es-AR') + '</strong>' +
                ' / persona<br><span style="color:#888;">Duración: ' + (it.giveawayDurationMins || '?') + ' min</span></small>';
        }

        const reach = (it.successCount || 0) + ' / ' + (it.totalUsers || 0);
        const clicks = it.type === 'whatsapp_promo'
            ? '<strong style="color:#1a73e8;">' + (it.waClicks || 0) + '</strong>'
            : '<small style="color:#666;">—</small>';
        const claims = it.type === 'money_giveaway'
            ? '<strong style="color:#25d366;">' + (it.giveawayClaims || 0) + '</strong>'
            : '<small style="color:#666;">—</small>';

        html += '<tr>';
        html += '<td><small>' + escapeHtml(sent) + (sched ? '<br><span style="color:#d4af37;">⏰ programada</span>' : '') + '</small></td>';
        html += '<td>' + audience + '</td>';
        html += '<td>' + _typeLabel(it.type) + '</td>';
        html += '<td><strong style="color:#fff;font-size:12px;">' + escapeHtml(it.title || '') + '</strong>' +
                '<br><small style="color:#bbb;">' + escapeHtml(it.body || '') + '</small></td>';
        html += '<td>' + promoDetail + '</td>';
        html += '<td><small>' + reach + '</small></td>';
        html += '<td>' + clicks + '</td>';
        html += '<td>' + claims + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<div style="color:#888;font-size:11px;margin-top:8px;">Mostrando ' + items.length + ' notificaciones.</div>';

    container.innerHTML = html;
}

// ============================================
// REVALIDAR TOKENS FCM (on-demand)
// Dispara la validacion via dry-run de FCM para detectar tokens muertos
// (usuarios que desinstalaron la app). Despues recarga el reporte que
// el admin estaba viendo (equipment o welcomebonus).
// ============================================
async function revalidateThenReload(which) {
    // Encontrar el contenedor para mostrar el estado mientras corre.
    const containerId = which === 'welcomebonus' ? 'welcomeBonusReportContent' : 'equipmentReportContent';
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '<div class="empty-state">🔍 Revalidando tokens en Google FCM… Puede tardar varios segundos según cantidad de usuarios.</div>';
    }

    try {
        const r = await authFetch('/api/admin/reports/revalidate-tokens', { method: 'POST' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) {
            const msg = data.error || ('HTTP ' + r.status);
            if (container) container.innerHTML = '<div class="empty-state">❌ ' + escapeHtml(msg) + '</div>';
            // Recargar de todos modos para que el admin vea el estado.
            setTimeout(() => {
                if (which === 'welcomebonus') loadWelcomeBonusReport();
                else loadEquipmentReport();
            }, 1500);
            return;
        }
        const seconds = Math.round((data.elapsedMs || 0) / 1000);
        const msg = `✅ Revalidados ${data.total} tokens en ${seconds}s. Limpiados: ${data.cleaned}. Errores transitorios: ${data.errors}.`;
        if (typeof showToast === 'function') showToast(msg, 'success');
        else alert(msg);
        // Recargar el reporte para reflejar las limpiezas.
        if (which === 'welcomebonus') loadWelcomeBonusReport();
        else loadEquipmentReport();
    } catch (err) {
        console.error('revalidateThenReload error:', err);
        if (container) container.innerHTML = '<div class="empty-state">❌ Error de conexión al revalidar.</div>';
    }
}

// ============================================
// REPORTE — BONO DE BIENVENIDA $10.000
// Usuarios que reclamaron el bono + estado actual de app/notifs.
// Permite ver quien desinstalo o desactivo notifs despues de cobrar.
// ============================================
async function loadWelcomeBonusReport() {
    const container = document.getElementById('welcomeBonusReportContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';

    try {
        const r = await authFetch('/api/admin/reports/welcome-bonus');
        if (!r.ok) {
            container.innerHTML = '<div class="empty-state">❌ Error cargando reporte</div>';
            return;
        }
        const data = await r.json();
        renderWelcomeBonusReport(container, data);
    } catch (err) {
        console.error('loadWelcomeBonusReport error:', err);
        container.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

let welcomeBonusDataCache = null;
let _welcomeBonusSortKey = 'appLastSeenDesc';

function _sortWelcomeBonusClaims(claims, key) {
    const arr = claims.slice();
    const tsAppSeen = (c) => c && c.appLastSeen ? new Date(c.appLastSeen).getTime() : 0;
    const tsClaimed = (c) => c && c.claimedAt ? new Date(c.claimedAt).getTime() : 0;
    if (key === 'appLastSeenDesc') {
        arr.sort((a, b) => tsAppSeen(b) - tsAppSeen(a) || (a.username || '').localeCompare(b.username || ''));
    } else if (key === 'appLastSeenAsc') {
        arr.sort((a, b) => {
            const ta = tsAppSeen(a), tb = tsAppSeen(b);
            if (ta === 0 && tb === 0) return (a.username || '').localeCompare(b.username || '');
            if (ta === 0) return 1;
            if (tb === 0) return -1;
            return ta - tb;
        });
    } else if (key === 'claimedDesc') {
        arr.sort((a, b) => tsClaimed(b) - tsClaimed(a) || (a.username || '').localeCompare(b.username || ''));
    } else if (key === 'usernameAsc') {
        arr.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
    }
    return arr;
}

function renderWelcomeBonusReport(container, data) {
    const t = data.totals || {};
    const claims = Array.isArray(data.claims) ? data.claims : [];
    const total = t.totalClaimed || 0;
    const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;

    welcomeBonusDataCache = data;

    let html = '';

    // Resumen
    html += '<div class="report-summary">';
    html += '  <div class="stat-card"><span class="label">🎁 Total reclamos</span><span class="value">' + total + '</span></div>';
    html += '  <div class="stat-card"><span class="label">📱 Aún con app</span><span class="value">' + (t.stillHasApp || 0) + ' <small style="font-size:11px;color:#888;">(' + pct(t.stillHasApp || 0) + '%)</small></span></div>';
    html += '  <div class="stat-card"><span class="label">🔔 Aún con notifs</span><span class="value">' + (t.stillHasNotifs || 0) + ' <small style="font-size:11px;color:#888;">(' + pct(t.stillHasNotifs || 0) + '%)</small></span></div>';
    html += '  <div class="stat-card"><span class="label">✅ Aún con ambos</span><span class="value">' + (t.stillBoth || 0) + ' <small style="font-size:11px;color:#888;">(' + pct(t.stillBoth || 0) + '%)</small></span></div>';
    html += '  <div class="stat-card"><span class="label">⚠️ Desinstalaron app</span><span class="value" style="color:#ef4444;">' + (t.lostApp || 0) + '</span></div>';
    html += '  <div class="stat-card"><span class="label">⚠️ Desactivaron notifs</span><span class="value" style="color:#ef4444;">' + (t.lostNotifs || 0) + '</span></div>';
    html += '</div>';

    if (claims.length === 0) {
        html += '<div class="empty-state">Nadie reclamó el bono todavía.</div>';
        container.innerHTML = html;
        return;
    }

    // Encabezado de detalle + buscador + selector de orden
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0 10px;">';
    html += '  <h3 style="color:#d4af37;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0;">Detalle por usuario</h3>';
    html += '  <div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '    <select id="welcomeBonusSortSelect" onchange="changeWelcomeBonusSort(this.value)" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:13px;cursor:pointer;">';
    html += '      <option value="appLastSeenDesc"' + (_welcomeBonusSortKey === 'appLastSeenDesc' ? ' selected' : '') + '>↓ Actividad (más reciente)</option>';
    html += '      <option value="appLastSeenAsc"' + (_welcomeBonusSortKey === 'appLastSeenAsc' ? ' selected' : '') + '>↑ Actividad (más antigua)</option>';
    html += '      <option value="claimedDesc"' + (_welcomeBonusSortKey === 'claimedDesc' ? ' selected' : '') + '>↓ Fecha de reclamo</option>';
    html += '      <option value="usernameAsc"' + (_welcomeBonusSortKey === 'usernameAsc' ? ' selected' : '') + '>A-Z usuario</option>';
    html += '    </select>';
    html += '    <input type="text" id="welcomeBonusUserSearch" placeholder="🔍 Buscar usuario…" oninput="filterWelcomeBonusTable()" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:13px;min-width:200px;flex:0 1 280px;">';
    html += '  </div>';
    html += '</div>';
    const sorted = _sortWelcomeBonusClaims(claims, _welcomeBonusSortKey);
    html += '<div id="welcomeBonusTableContainer">' + renderWelcomeBonusTableHtml(sorted) + '</div>';

    container.innerHTML = html;
}

function changeWelcomeBonusSort(key) {
    _welcomeBonusSortKey = key;
    filterWelcomeBonusTable();
}

function renderWelcomeBonusTableHtml(claims) {
    if (!claims || claims.length === 0) {
        return '<div class="empty-state">No hay reclamos para mostrar.</div>';
    }
    let html = '<table class="report-table"><thead><tr>';
    html += '<th>Usuario</th>';
    html += '<th>Equipo</th>';
    html += '<th>Reclamado</th>';
    html += '<th>📱 App ahora</th>';
    html += '<th>Última vez en la app</th>';
    html += '<th>🔔 Notifs ahora</th>';
    html += '<th>Estado</th>';
    html += '</tr></thead><tbody>';
    for (const c of claims) {
        const claimed = c.claimedAt ? new Date(c.claimedAt).toLocaleString('es-AR') : '—';
        const seen = _formatAppLastSeen(c.appLastSeen);
        let appCell;
        if (!c.hasApp) {
            appCell = '<span style="color:#ef4444;font-weight:700;">⚠️ Borró</span>';
        } else if (seen.staleness === 'gone') {
            appCell = '<span style="color:#ef4444;font-weight:700;">⚠️ Inactiva</span>';
        } else if (seen.staleness === 'stale') {
            appCell = '<span style="color:#f59e0b;font-weight:700;">⏳ Sin abrir</span>';
        } else {
            appCell = '<span style="color:#25d366;font-weight:700;">✅ Activa</span>';
        }
        const seenCell = '<small style="color:' + seen.color + ';">' + escapeHtml(seen.text) + '</small>';
        const notifCell = c.hasNotifs
            ? '<span style="color:#25d366;font-weight:700;">✅ Sí</span>'
            : '<span style="color:#ef4444;font-weight:700;">⚠️ Desactivó</span>';
        const statusBadge = c.status === 'pending_credit_failed'
            ? '<span style="background:#7f1d1d;color:#fee;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">PENDIENTE</span>'
            : '<span style="background:rgba(37,211,102,0.18);color:#25d366;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">OK</span>';
        html += '<tr>';
        html += '<td>' + escapeHtml(c.username) + '</td>';
        html += '<td>' + _formatPlatform(c.platform) + '</td>';
        html += '<td><small>' + escapeHtml(claimed) + '</small></td>';
        html += '<td>' + appCell + '</td>';
        html += '<td>' + seenCell + '</td>';
        html += '<td>' + notifCell + '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function filterWelcomeBonusTable() {
    if (!welcomeBonusDataCache) return;
    const input = document.getElementById('welcomeBonusUserSearch');
    const q = (input?.value || '').toLowerCase().trim();
    const all = welcomeBonusDataCache.claims || [];
    const filtered = q
        ? all.filter(c => (c.username || '').toLowerCase().includes(q))
        : all;
    const sorted = _sortWelcomeBonusClaims(filtered, _welcomeBonusSortKey);
    const tableContainer = document.getElementById('welcomeBonusTableContainer');
    if (!tableContainer) return;
    tableContainer.innerHTML = renderWelcomeBonusTableHtml(sorted);
    if (q) {
        const hint = document.createElement('div');
        hint.style.cssText = 'color:#888;font-size:12px;margin-top:6px;';
        hint.textContent = `Mostrando ${sorted.length} de ${all.length} reclamos`;
        tableContainer.appendChild(hint);
    }
}

// ============================================
// NOTIFICACIONES PUSH MASIVAS
// ============================================
function updateNotifPreview() {
    const titleEl = document.getElementById('notifTitle');
    const bodyEl = document.getElementById('notifBody');
    const pTitle = document.getElementById('notifPreviewTitle');
    const pBody = document.getElementById('notifPreviewBody');
    if (!titleEl || !bodyEl) return;
    if (pTitle) pTitle.textContent = titleEl.value.trim() || 'Título…';
    if (pBody) pBody.textContent = bodyEl.value.trim() || 'Mensaje…';
}

function getSelectedNotifTarget() {
    const r = document.querySelector('input[name="notifTarget"]:checked');
    return r ? r.value : 'all';
}

function updateNotifTargetUI() {
    const group = document.getElementById('notifPrefixGroup');
    if (!group) return;
    const isPrefix = getSelectedNotifTarget() === 'prefix';
    group.style.display = isPrefix ? '' : 'none';
}

function togglePromoAlertFields() {
    const cb = document.getElementById('promoAlertEnabled');
    const fields = document.getElementById('promoAlertFields');
    if (!cb || !fields) return;
    fields.style.display = cb.checked ? 'flex' : 'none';
}

async function loadPromoAlertStatus() {
    const box = document.getElementById('promoAlertStatus');
    if (!box) return;
    try {
        const r = await authFetch('/api/admin/promo-alert');
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { box.style.display = 'none'; return; }
        const promo = data.promo;
        if (!promo) { box.style.display = 'none'; return; }
        const expiresMs = promo.expiresAt ? new Date(promo.expiresAt).getTime() : 0;
        if (data.expired || expiresMs <= Date.now()) {
            box.style.display = 'none';
            return;
        }
        const minsLeft = Math.max(1, Math.round((expiresMs - Date.now()) / 60000));
        let leftText;
        if (minsLeft >= 60) {
            const h = Math.floor(minsLeft / 60);
            const m = minsLeft % 60;
            leftText = h + 'h' + (m ? ' ' + m + 'min' : '');
        } else {
            leftText = minsLeft + ' min';
        }
        box.style.display = 'block';
        box.innerHTML =
            '✅ <strong>Promo activa</strong> — vence en <strong>' + escapeHtml(leftText) + '</strong><br>' +
            '<span style="color:#fff;">Mensaje:</span> ' + escapeHtml(promo.message) + '<br>' +
            '<span style="color:#fff;">Código:</span> <code style="background:rgba(0,0,0,0.4);padding:1px 6px;border-radius:4px;color:#ffd700;">' + escapeHtml(promo.code) + '</code>' +
            (promo.prefix ? ' · <span style="color:#888;">solo a usernames "' + escapeHtml(promo.prefix) + '*"</span>' : '') +
            '<br><button onclick="cancelPromoAlert()" style="margin-top:8px;background:rgba(220,38,38,0.85);color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">✕ Cancelar promo ahora</button>';
    } catch (err) {
        console.warn('loadPromoAlertStatus error:', err);
        box.style.display = 'none';
    }
}

async function cancelPromoAlert() {
    if (!window.confirm('¿Cancelar la promo activa? Los clientes vuelven a ver el botón QUIERO CARGAR normal.')) return;
    try {
        const r = await authFetch('/api/admin/promo-alert', { method: 'DELETE' });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.success) {
            showToast('Promo cancelada', 'success');
            loadPromoAlertStatus();
        } else {
            showToast('Error: ' + (data.error || 'desconocido'), 'error');
        }
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

async function sendBulkNotification() {
    const title = (document.getElementById('notifTitle').value || '').trim();
    const body = (document.getElementById('notifBody').value || '').trim();
    const target = getSelectedNotifTarget();
    const prefix = target === 'prefix'
        ? (document.getElementById('notifPrefix').value || '').trim()
        : '';
    const result = document.getElementById('notifResult');

    // Lectura de campos de promo (opcional).
    const promoEnabled = !!document.getElementById('promoAlertEnabled')?.checked;
    const promoMessage = (document.getElementById('promoAlertMessage')?.value || '').trim();
    const promoCode = (document.getElementById('promoAlertCode')?.value || '').trim().toUpperCase();
    const promoDurationHours = Number(document.getElementById('promoAlertDuration')?.value || 1);

    if (!title) {
        showToast('Falta el título', 'error');
        return;
    }
    if (!body) {
        showToast('Falta el mensaje', 'error');
        return;
    }
    if (target === 'prefix' && !prefix) {
        showToast('Indicá el inicio de usuario (ej: ato)', 'error');
        return;
    }
    if (promoEnabled) {
        if (!promoMessage) { showToast('Falta el mensaje del cartel de promo', 'error'); return; }
        if (!promoCode) { showToast('Falta el código de promo', 'error'); return; }
        if (!isFinite(promoDurationHours) || promoDurationHours <= 0) {
            showToast('Duración de promo inválida', 'error'); return;
        }
    }

    const audienceLabel = prefix
        ? `usuarios cuyo nombre empieza con "${prefix}"`
        : 'TODOS los usuarios';
    const ok = window.confirm(
        `Vas a enviar esta notificación a ${audienceLabel} (con app instalada y notifs activadas).\n\n` +
        `Título: ${title}\nMensaje: ${body}\n\n¿Confirmás el envío?`
    );
    if (!ok) return;

    const btn = document.querySelector('#notifsSection button.btn-primary');
    const defaultBtnText = '🚀 Enviar notificación';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
    if (result) {
        result.style.display = 'block';
        result.innerHTML = `⏳ Enviando notificación a ${escapeHtml(audienceLabel)}…`;
    }

    try {
        const payload = {
            title,
            body,
            data: { source: 'admin-bulk', tag: 'admin-broadcast' }
        };
        if (prefix) payload.prefix = prefix;
        // Si hay promo, la metemos en el data para que el SW pueda accionarla
        // al click. La promo SE GUARDA tambien server-side en /admin/promo-alert
        // (esa es la fuente de verdad para el polling del client).
        const promoExpiresAtIso = promoEnabled
            ? new Date(Date.now() + promoDurationHours * 3600 * 1000).toISOString()
            : null;
        if (promoEnabled) {
            payload.data.promoCode = promoCode;
            payload.data.promoMessage = promoMessage;
            payload.data.promoExpiresIn = String(promoDurationHours);
        }
        // Metadatos para el row de NotificationHistory que crea el server.
        payload.historyMeta = {
            type: promoEnabled ? 'whatsapp_promo' : 'plain',
            promoMessage: promoEnabled ? promoMessage : null,
            promoCode:    promoEnabled ? promoCode : null,
            promoExpiresAt: promoExpiresAtIso
        };

        // 1) Enviar la notificacion. El server crea el row de historial
        //    y nos devuelve historyId.
        const r = await authFetch('/api/notifications/send-all', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await r.json();

        // 2) Si hay promo, recien ahora creamos la promo (con el historyId
        //    asociado) asi los clicks del cartel suman al row correcto.
        if (promoEnabled && r.ok && data.success) {
            try {
                const promoR = await authFetch('/api/admin/promo-alert', {
                    method: 'POST',
                    body: JSON.stringify({
                        message: promoMessage,
                        code: promoCode,
                        durationHours: promoDurationHours,
                        prefix: prefix || null,
                        notificationHistoryId: data.historyId || null
                    })
                });
                if (!promoR.ok) {
                    const e = await promoR.json().catch(() => ({}));
                    showToast('Notif enviada pero falló crear promo: ' + (e.error || promoR.status), 'error');
                }
            } catch (e) {
                showToast('Notif enviada pero falló crear promo: ' + e.message, 'error');
            }
        }
        if (r.ok && data.success) {
            const targetLine = data.prefix
                ? `Audiencia: <strong>usuarios "${escapeHtml(data.prefix)}*"</strong><br>`
                : `Audiencia: <strong>todos los usuarios</strong><br>`;
            const promoLine = promoEnabled
                ? `<br>🎁 Promo activa: <strong>${escapeHtml(promoCode)}</strong> por ${promoDurationHours}h`
                : '';
            const summary =
                `✅ <strong>Envío completado</strong><br>` +
                targetLine +
                `Usuarios alcanzados: <strong>${data.totalUsers ?? '?'}</strong><br>` +
                `Le llegó a: <strong style="color:#3fc886;">${data.successCount ?? 0}</strong>` +
                (data.failureCount
                    ? ` · No le llegó a: <strong style="color:#ff8080;">${data.failureCount}</strong>`
                    : '') +
                (data.cleanedTokens
                    ? `<br><small style="color:#888;">Tokens inválidos limpiados: ${data.cleanedTokens}</small>`
                    : '') +
                promoLine;
            if (result) result.innerHTML = summary;
            showToast('Notificación enviada', 'success');
            // Reset form (mantener target/prefix por si quiere mandar de nuevo)
            document.getElementById('notifTitle').value = '';
            document.getElementById('notifBody').value = '';
            // Reset promo fields (asi al siguiente envio no replica sin querer)
            const promoCb = document.getElementById('promoAlertEnabled');
            if (promoCb) { promoCb.checked = false; togglePromoAlertFields(); }
            const pm = document.getElementById('promoAlertMessage'); if (pm) pm.value = '';
            const pc = document.getElementById('promoAlertCode'); if (pc) pc.value = '';
            updateNotifPreview();
            loadPromoAlertStatus();
        } else {
            const msg = data.error || data.message || 'Error desconocido';
            if (result) result.innerHTML = `❌ Error: ${escapeHtml(msg)}`;
            showToast('Error enviando', 'error');
        }
    } catch (err) {
        console.error('sendBulkNotification error:', err);
        if (result) result.innerHTML = `❌ Error de conexión: ${escapeHtml(err.message)}`;
        showToast('Error de conexión', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = defaultBtnText; }
    }
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Sidebar nav
    document.querySelectorAll('.nav-item').forEach((el) => {
        el.addEventListener('click', function (e) {
            e.preventDefault();
            const key = el.getAttribute('data-section');
            if (key) showSection(key);
        });
    });

    // Live preview de la notificación masiva
    const ntEl = document.getElementById('notifTitle');
    const nbEl = document.getElementById('notifBody');
    if (ntEl) ntEl.addEventListener('input', updateNotifPreview);
    if (nbEl) nbEl.addEventListener('input', updateNotifPreview);

    // Si ya hay token guardado, intentar entrar directo
    if (currentToken) {
        // Verificar token contra /api/users/me — si responde 200 y rol válido, mostrar app
        fetch(API_URL + '/api/users/me', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        }).then(async (r) => {
            if (!r.ok) throw new Error('invalid');
            const data = await r.json();
            const adminRoles = ['admin', 'depositor', 'withdrawer'];
            if (!adminRoles.includes(data.role)) throw new Error('not admin');
            currentAdmin = data;
            showApp();
        }).catch(() => {
            currentToken = null;
            localStorage.removeItem('adminToken');
        });
    }
});
