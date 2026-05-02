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
        importLines: 'importLinesSection',
        reportDaily: 'reportDailySection',
        reportWeekly: 'reportWeeklySection',
        reportMonthly: 'reportMonthlySection',
        ingresos: 'ingresosSection',
        equipamiento: 'equipamientoSection',
        welcomebonus: 'welcomebonusSection',
        topEngagement: 'topEngagementSection',
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
    } else if (sectionKey === 'importLines') {
        loadLineImportStats();
        resetLineImportForm();
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
    } else if (sectionKey === 'topEngagement') {
        loadStatsAll();
    } else if (sectionKey === 'notifs') {
        // Setear vista previa con valores actuales
        updateNotifPreview();
        // Cargar el estado de la promo y del regalo activos (si los hay).
        loadPromoAlertStatus();
        loadGiveawayStatusAdmin();
        // Lista de notifs programadas pendientes.
        loadScheduledNotifications();
        // Sincronizar la UI del radio extra con el estado inicial.
        if (typeof updateNotifExtraUI === 'function') updateNotifExtraUI();
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
    const items = data.length > 0 ? data : [{ prefix: '', phone: '', teamName: '' }];
    container.innerHTML = items.map((s, i) => slotHtml(i, s.prefix || '', s.phone || '', s.teamName || '')).join('');
    updateAddLineButton();
}

function slotHtml(i, prefix, phone, teamName) {
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
                <label style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Nombre del equipo</label>
                <input type="text" class="user-line-team" placeholder="ej: Atomic (se muestra arriba a la izquierda en la app del usuario)" maxlength="24" value="${escapeHtml(teamName)}" style="padding:9px 10px;border-radius:7px;border:1px solid rgba(155,48,255,0.25);background:rgba(0,0,0,0.5);color:#c89bff;font-size:13px;font-weight:600;width:100%;box-sizing:border-box;">
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
        const defTeam = document.getElementById('userLinesDefaultTeam');
        if (defTeam) defTeam.value = data.defaultTeamName || '';
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
    const teamInputs = container.querySelectorAll('.user-line-team');
    const slots = [];
    for (let i = 0; i < prefixInputs.length; i++) {
        const prefix = (prefixInputs[i].value || '').trim();
        const phone = (phoneInputs[i].value || '').trim();
        const teamName = (teamInputs[i] && teamInputs[i].value || '').trim();
        if (!prefix && !phone && !teamName) continue;
        if (prefix && !phone) {
            showToast('El prefijo "' + prefix + '" no tiene número', 'error');
            return;
        }
        slots.push({ prefix, phone, teamName });
    }
    const defaultPhone = (document.getElementById('userLinesDefaultPhone').value || '').trim();
    const defaultTeamEl = document.getElementById('userLinesDefaultTeam');
    const defaultTeamName = (defaultTeamEl && defaultTeamEl.value || '').trim();
    try {
        const r = await authFetch('/api/admin/user-lines', {
            method: 'PUT',
            body: JSON.stringify({ slots, defaultPhone, defaultTeamName })
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
// TOP 100 ENGAGEMENT
// Tabla unica con score combinado + breakdowns por reembolsos, clicks
// WhatsApp, y reclamos de regalo. Sortable por cada columna.
// ============================================
let _topEngagementCache = null;
let _topEngagementSortKey = 'score'; // default
let _topEngagementSortDir = 'desc';

async function loadTopEngagement() {
    const container = document.getElementById('topEngagementContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">⏳ Calculando ranking…</div>';
    try {
        const r = await authFetch('/api/admin/reports/top-engagement');
        if (!r.ok) {
            container.innerHTML = '<div class="empty-state">❌ Error cargando ranking</div>';
            return;
        }
        const data = await r.json();
        _topEngagementCache = data;
        renderTopEngagement(container, data);
    } catch (err) {
        console.error('loadTopEngagement error:', err);
        container.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function _sortTopEngagement(list, key, dir) {
    const arr = list.slice();
    const num = (x) => typeof x === 'number' ? x : 0;
    const time = (x) => x ? new Date(x).getTime() : 0;
    const sign = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
        let va, vb;
        switch (key) {
            case 'username':       va = (a.username || '').toLowerCase(); vb = (b.username || '').toLowerCase(); return va.localeCompare(vb) * sign;
            case 'refundCount':    va = num(a.refundCount); vb = num(b.refundCount); break;
            case 'refundTotal':    va = num(a.refundTotal); vb = num(b.refundTotal); break;
            case 'waClickCount':   va = num(a.waClickCount); vb = num(b.waClickCount); break;
            case 'giveawayCount':  va = num(a.giveawayCount); vb = num(b.giveawayCount); break;
            case 'giveawayTotal':  va = num(a.giveawayTotal); vb = num(b.giveawayTotal); break;
            case 'lastActivityAt': va = time(a.lastActivityAt); vb = time(b.lastActivityAt); break;
            case 'score':
            default:               va = num(a.score); vb = num(b.score); break;
        }
        return (va - vb) * sign;
    });
    return arr;
}

function changeTopEngagementSort(key) {
    if (_topEngagementSortKey === key) {
        _topEngagementSortDir = _topEngagementSortDir === 'desc' ? 'asc' : 'desc';
    } else {
        _topEngagementSortKey = key;
        _topEngagementSortDir = 'desc';
    }
    if (_topEngagementCache) {
        const container = document.getElementById('topEngagementContent');
        if (container) renderTopEngagement(container, _topEngagementCache);
    }
}

function renderTopEngagement(container, data) {
    const top = Array.isArray(data.top) ? data.top : [];
    if (top.length === 0) {
        container.innerHTML = '<div class="empty-state">Todavía no hay engagement registrado.</div>';
        return;
    }
    const sorted = _sortTopEngagement(top, _topEngagementSortKey, _topEngagementSortDir);

    const sortedAt = data.generatedAt ? new Date(data.generatedAt).toLocaleString('es-AR') : '';
    const arrow = (k) => _topEngagementSortKey === k ? (_topEngagementSortDir === 'desc' ? ' ↓' : ' ↑') : '';
    const th = (k, label) => `<th style="cursor:pointer;user-select:none;" onclick="changeTopEngagementSort('${k}')">${label}${arrow(k)}</th>`;

    let html = '';
    html += '<div style="margin-bottom:10px;color:#888;font-size:11px;">' +
            'Ranking calculado: ' + escapeHtml(sortedAt) +
            ' · Usuarios únicos con interacción: <strong style="color:#d4af37;">' + (data.totalUniqueUsers || 0) + '</strong>' +
            '</div>';

    html += '<table class="report-table"><thead><tr>';
    html += '<th>#</th>';
    html += th('username', 'Usuario');
    html += th('score', '⭐ Score');
    html += th('refundCount', '💸 Reembolsos');
    html += th('refundTotal', '💸 Total $');
    html += th('waClickCount', '📲 Clicks WA');
    html += th('giveawayCount', '💰 Regalos');
    html += th('giveawayTotal', '💰 Total $');
    html += th('lastActivityAt', '📅 Última actividad');
    html += '</tr></thead><tbody>';

    sorted.forEach((u, idx) => {
        const rank = idx + 1;
        const lastAct = u.lastActivityAt ? new Date(u.lastActivityAt).toLocaleString('es-AR') : '—';
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        html += '<tr>';
        html += '<td><strong>' + medal + '</strong></td>';
        html += '<td><strong style="color:#fff;">' + escapeHtml(u.username || '') + '</strong></td>';
        html += '<td><strong style="color:#d4af37;">' + (u.score || 0) + '</strong></td>';
        html += '<td>' + (u.refundCount || 0) + '</td>';
        html += '<td><small>$' + Number(u.refundTotal || 0).toLocaleString('es-AR') + '</small></td>';
        html += '<td>' + (u.waClickCount || 0) + '</td>';
        html += '<td>' + (u.giveawayCount || 0) + '</td>';
        html += '<td><small>$' + Number(u.giveawayTotal || 0).toLocaleString('es-AR') + '</small></td>';
        html += '<td><small style="color:#aaa;">' + escapeHtml(lastAct) + '</small></td>';
        html += '</tr>';
    });
    html += '</tbody></table>';

    container.innerHTML = html;
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
    html += '<th>Acción</th>';
    html += '</tr></thead><tbody>';

    // Stash de los items para que el handler de "Reusar" los pueda leer
    // sin tener que parsear el DOM.
    _notifsHistoryStash = {};

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

        // Guardar el item para que reuseNotif lo encuentre por id.
        const stashId = it._id || it.id || (it.sentAt + '_' + (it.title || '')).slice(0, 80);
        _notifsHistoryStash[stashId] = it;

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
        html += '<td><button type="button" class="reuse-notif-btn" data-stash-id="' + escapeHtml(String(stashId)) + '" ' +
                'style="padding:6px 10px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#d4af37,#f7931e);color:#000;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;" ' +
                'title="Cargar título, mensaje y audiencia en el composer">🔄 Reusar</button></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<div style="color:#888;font-size:11px;margin-top:8px;">Mostrando ' + items.length + ' notificaciones.</div>';

    container.innerHTML = html;

    // Wireup de los botones "Reusar" via delegacion.
    container.querySelectorAll('.reuse-notif-btn').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
            const id = btn.getAttribute('data-stash-id');
            const it = _notifsHistoryStash[id];
            if (!it) return;
            reuseNotifInComposer(it);
        });
    });
}

let _notifsHistoryStash = {};

// Toma una notif del historial y la carga en el composer (titulo, mensaje,
// audiencia, tipo de extra y los campos extra si aplica). Despues hace
// scroll hasta el composer para que el admin solo le de "Enviar ahora" o
// edite lo que quiera. NO la envia automaticamente.
function reuseNotifInComposer(it) {
    showSection('notifs');

    const titleEl = document.getElementById('notifTitle');
    const bodyEl = document.getElementById('notifBody');
    if (titleEl) titleEl.value = it.title || '';
    if (bodyEl) bodyEl.value = it.body || '';

    // Audiencia: todos vs prefix.
    const allRadio = document.querySelector('input[name="notifTarget"][value="all"]');
    const prefixRadio = document.querySelector('input[name="notifTarget"][value="prefix"]');
    const prefixInput = document.getElementById('notifPrefix');
    if (it.audienceType === 'prefix' && it.audiencePrefix) {
        if (prefixRadio) prefixRadio.checked = true;
        if (prefixInput) prefixInput.value = it.audiencePrefix;
    } else {
        if (allRadio) allRadio.checked = true;
        if (prefixInput) prefixInput.value = '';
    }
    if (typeof updateNotifTargetUI === 'function') updateNotifTargetUI();

    // Tipo extra: none / promo / giveaway.
    let extraType = 'none';
    if (it.type === 'whatsapp_promo') extraType = 'promo';
    else if (it.type === 'money_giveaway') extraType = 'giveaway';

    const extraRadio = document.querySelector('input[name="notifExtra"][value="' + extraType + '"]');
    if (extraRadio) extraRadio.checked = true;
    if (typeof updateNotifExtraUI === 'function') updateNotifExtraUI();

    // Campos especificos del extra (IDs reales del HTML).
    if (extraType === 'promo') {
        const msg = document.getElementById('promoAlertMessage');
        const code = document.getElementById('promoAlertCode');
        const dur = document.getElementById('promoAlertDuration'); // <select> con horas
        if (msg) msg.value = it.promoMessage || '';
        if (code) code.value = it.promoCode || '';
        if (dur && it.promoExpiresAt && it.sentAt) {
            const diffMs = new Date(it.promoExpiresAt).getTime() - new Date(it.sentAt).getTime();
            const h = Math.round(diffMs / 3600000);
            if (h > 0) {
                // Solo setea si la opcion existe en el select.
                const opt = Array.from(dur.options).find(o => Number(o.value) === h);
                if (opt) dur.value = String(h);
            }
        }
    } else if (extraType === 'giveaway') {
        const amount = document.getElementById('giveawayAmountInput');
        const budget = document.getElementById('giveawayBudgetInput');
        const max = document.getElementById('giveawayMaxClaimsInput');
        const dur = document.getElementById('giveawayDurationInput'); // <select> con minutos
        if (amount) amount.value = it.giveawayAmount || '';
        if (budget) budget.value = it.giveawayBudget || '';
        if (max) max.value = it.giveawayMaxClaims || '';
        if (dur && it.giveawayDurationMins) {
            const opt = Array.from(dur.options).find(o => Number(o.value) === Number(it.giveawayDurationMins));
            if (opt) dur.value = String(it.giveawayDurationMins);
        }
    }

    if (typeof updateNotifPreview === 'function') updateNotifPreview();

    // Scroll suave al composer para que se vea que se cargo.
    setTimeout(() => {
        const t = document.getElementById('notifTitle');
        if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (t) t.focus();
    }, 100);

    showToast('Notif cargada en el composer — editá si querés y dale enviar', 'success');
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

// ===== Manejador del radio "extra" (none / promo WA / regalo de plata) =====
function getSelectedNotifExtra() {
    const r = document.querySelector('input[name="notifExtra"]:checked');
    return r ? r.value : 'none';
}

function updateNotifExtraUI() {
    const extra = getSelectedNotifExtra();
    const promoWrap = document.getElementById('promoAlertWrap');
    const giveawayWrap = document.getElementById('giveawayWrap');
    const promoCheck = document.getElementById('promoAlertEnabled');
    if (promoWrap) promoWrap.style.display = (extra === 'promo') ? 'block' : 'none';
    if (giveawayWrap) giveawayWrap.style.display = (extra === 'giveaway') ? 'block' : 'none';
    if (promoCheck) promoCheck.checked = (extra === 'promo');
    if (extra === 'promo') {
        const fields = document.getElementById('promoAlertFields');
        if (fields) fields.style.display = 'flex';
    }
}

async function loadGiveawayStatusAdmin() {
    const box = document.getElementById('giveawayStatus');
    if (!box) return;
    try {
        const r = await authFetch('/api/admin/money-giveaway');
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.giveaway) { box.style.display = 'none'; return; }
        const g = data.giveaway;
        const expiresMs = new Date(g.expiresAt).getTime();
        const minsLeft = Math.max(0, Math.round((expiresMs - Date.now()) / 60000));
        if (minsLeft <= 0 && g.status === 'active') { box.style.display = 'none'; return; }
        const claims = data.claims || [];
        box.style.display = 'block';
        box.innerHTML =
            '✅ <strong>Regalo activo</strong> — vence en <strong>' + minsLeft + ' min</strong><br>' +
            '<span style="color:#fff;">Por persona:</span> $' + Number(g.amount).toLocaleString('es-AR') +
            ' · <span style="color:#fff;">Tope plata:</span> $' + Number(g.totalBudget).toLocaleString('es-AR') +
            ' · <span style="color:#fff;">Máx personas:</span> ' + g.maxClaims + '<br>' +
            '<span style="color:#fff;">Reclamados hasta ahora:</span> <strong>' + (g.claimedCount || 0) + '</strong>' +
            ' · <span style="color:#fff;">Plata regalada:</span> <strong>$' + Number(g.totalGiven || 0).toLocaleString('es-AR') + '</strong>' +
            (g.prefix ? ' · <span style="color:#888;">solo "' + escapeHtml(g.prefix) + '*"</span>' : '') +
            '<br><button onclick="cancelGiveaway()" style="margin-top:8px;background:rgba(220,38,38,0.85);color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">✕ Cancelar regalo ahora</button>';
    } catch (err) {
        console.warn('loadGiveawayStatusAdmin error:', err);
        box.style.display = 'none';
    }
}

async function cancelGiveaway() {
    if (!window.confirm('¿Cancelar el regalo activo? Los usuarios que aún no reclamaron quedan sin poder hacerlo.')) return;
    try {
        const r = await authFetch('/api/admin/money-giveaway', { method: 'DELETE' });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.success) {
            showToast('Regalo cancelado', 'success');
            loadGiveawayStatusAdmin();
        } else {
            showToast('Error: ' + (data.error || 'desconocido'), 'error');
        }
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

// ===== Programacion de notificaciones =====
function toggleScheduleFields() {
    const cb = document.getElementById('scheduleEnabled');
    const fields = document.getElementById('scheduleFields');
    if (!cb || !fields) return;
    fields.style.display = cb.checked ? 'block' : 'none';
    if (cb.checked) {
        // Default datetime: ahora + 1 hora.
        const dt = document.getElementById('scheduleDateTime');
        if (dt && !dt.value) {
            const future = new Date(Date.now() + 60 * 60 * 1000);
            // Convertir a formato datetime-local en TZ local del browser.
            const pad = n => String(n).padStart(2, '0');
            dt.value = `${future.getFullYear()}-${pad(future.getMonth()+1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
        }
    }
}

async function loadScheduledNotifications() {
    const box = document.getElementById('scheduledNotifsList');
    if (!box) return;
    box.innerHTML = '<span style="color:#666;">Cargando…</span>';
    try {
        const r = await authFetch('/api/admin/notifications/scheduled');
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { box.innerHTML = '<span style="color:#888;">Error cargando.</span>'; return; }
        const items = (data.items || []).filter(it => it.status === 'pending');
        if (items.length === 0) {
            box.innerHTML = '<span style="color:#666;">No hay notificaciones programadas.</span>';
            return;
        }
        let html = '';
        for (const s of items) {
            const when = new Date(s.scheduledFor).toLocaleString('es-AR');
            const extra = s.extraType === 'promo' ? `<span style="color:#ffd700;">📲 Promo ${escapeHtml(s.promoCode || '')}</span>`
                        : s.extraType === 'giveaway' ? `<span style="color:#25d366;">💰 Regalo $${Number(s.giveawayAmount||0).toLocaleString('es-AR')}/persona</span>`
                        : `<span style="color:#aaa;">Sin extra</span>`;
            const aud = s.audiencePrefix
                ? `<small style="color:#d4af37;">a "${escapeHtml(s.audiencePrefix)}*"</small>`
                : `<small style="color:#888;">a todos</small>`;
            html +=
              `<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;margin-bottom:8px;">` +
                `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">` +
                  `<div style="flex:1;min-width:200px;">` +
                    `<strong style="color:#fff;">${escapeHtml(s.title)}</strong> ${aud}<br>` +
                    `<small style="color:#aaa;">${escapeHtml(s.body)}</small><br>` +
                    `<small style="color:#d4af37;">⏰ ${escapeHtml(when)}</small> · ${extra}` +
                  `</div>` +
                  `<button onclick="cancelScheduledNotif('${escapeHtml(s.id)}')" style="background:rgba(220,38,38,0.85);color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;">✕ Cancelar</button>` +
                `</div>` +
              `</div>`;
        }
        box.innerHTML = html;
    } catch (err) {
        box.innerHTML = '<span style="color:#888;">Error de conexión.</span>';
    }
}

async function cancelScheduledNotif(id) {
    if (!window.confirm('¿Cancelar esta notificación programada? No se enviará.')) return;
    try {
        const r = await authFetch('/api/admin/notifications/scheduled/' + encodeURIComponent(id), { method: 'DELETE' });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.success) {
            showToast('Programación cancelada', 'success');
            loadScheduledNotifications();
        } else {
            showToast('Error: ' + (data.error || 'desconocido'), 'error');
        }
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
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
    let body = (document.getElementById('notifBody').value || '').trim();
    const target = getSelectedNotifTarget();
    const prefix = target === 'prefix'
        ? (document.getElementById('notifPrefix').value || '').trim()
        : '';
    const result = document.getElementById('notifResult');

    // Tipo de extra (none / promo WA / regalo de plata).
    const extra = getSelectedNotifExtra();
    const promoEnabled = (extra === 'promo');
    const giveawayEnabled = (extra === 'giveaway');

    // Lectura de campos de promo WA (si aplica).
    const promoMessage = (document.getElementById('promoAlertMessage')?.value || '').trim();
    const promoCode = (document.getElementById('promoAlertCode')?.value || '').trim().toUpperCase();
    const promoDurationHours = Number(document.getElementById('promoAlertDuration')?.value || 1);

    // Lectura de campos de regalo de plata (si aplica).
    const giveawayAmount = Number(document.getElementById('giveawayAmountInput')?.value || 0);
    const giveawayBudget = Number(document.getElementById('giveawayBudgetInput')?.value || 0);
    const giveawayMaxClaims = Number(document.getElementById('giveawayMaxClaimsInput')?.value || 0);
    const giveawayDurationMinutes = Number(document.getElementById('giveawayDurationInput')?.value || 30);

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
    if (giveawayEnabled) {
        if (!isFinite(giveawayAmount) || giveawayAmount <= 0) {
            showToast('Falta el monto por persona del regalo', 'error'); return;
        }
        if (!isFinite(giveawayBudget) || giveawayBudget < giveawayAmount) {
            showToast('Tope de plata inválido (debe ser >= monto por persona)', 'error'); return;
        }
        if (!isFinite(giveawayMaxClaims) || giveawayMaxClaims < 1) {
            showToast('Falta la cantidad máxima de personas', 'error'); return;
        }
        if (![10, 20, 30, 40, 50, 60].includes(giveawayDurationMinutes)) {
            showToast('Duración del regalo inválida', 'error'); return;
        }
        // Auto-mencionar el monto en el body del push (solo para envio
        // inmediato; el flujo programado lo agrega el server al ejecutar).
        if (!document.getElementById('scheduleEnabled')?.checked) {
            const moneyStr = '$' + giveawayAmount.toLocaleString('es-AR');
            body = body + ` · 🎁 Te regalamos ${moneyStr} — abrí la app y reclamalo`;
        }
    }

    // ===== Si esta programado, NO mandamos el push ahora — creamos un
    // ScheduledNotification y el worker lo dispara a la hora pactada. =====
    const scheduleEnabled = !!document.getElementById('scheduleEnabled')?.checked;
    if (scheduleEnabled) {
        const dtStr = document.getElementById('scheduleDateTime')?.value;
        if (!dtStr) { showToast('Falta la fecha/hora programada', 'error'); return; }
        const scheduledFor = new Date(dtStr);
        if (!isFinite(scheduledFor.getTime())) {
            showToast('Fecha programada inválida', 'error'); return;
        }
        if (scheduledFor.getTime() <= Date.now() + 60_000) {
            showToast('La fecha debe ser al menos 1 minuto en el futuro', 'error'); return;
        }
        const oneWeek = 7 * 24 * 3600 * 1000;
        if (scheduledFor.getTime() > Date.now() + oneWeek) {
            showToast('No se puede programar más de 1 semana adelante', 'error'); return;
        }

        const ok = window.confirm(
            `Programar para: ${scheduledFor.toLocaleString('es-AR')}\n\n` +
            `Título: ${title}\nMensaje: ${body}\n\n¿Confirmás?`
        );
        if (!ok) return;

        const btn = document.querySelector('#notifsSection button.btn-primary');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Programando…'; }
        try {
            const payload = {
                scheduledFor: scheduledFor.toISOString(),
                title,
                body,
                prefix: prefix || null,
                extraType: promoEnabled ? 'promo' : (giveawayEnabled ? 'giveaway' : 'none')
            };
            if (promoEnabled) {
                payload.promoMessage = promoMessage;
                payload.promoCode = promoCode;
                payload.promoDurationHours = promoDurationHours;
            }
            if (giveawayEnabled) {
                payload.giveawayAmount = giveawayAmount;
                payload.giveawayBudget = giveawayBudget;
                payload.giveawayMaxClaims = giveawayMaxClaims;
                payload.giveawayDurationMinutes = giveawayDurationMinutes;
            }
            const sR = await authFetch('/api/admin/notifications/schedule', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const sData = await sR.json().catch(() => ({}));
            if (sR.ok && sData.success) {
                showToast('✅ Programada para ' + scheduledFor.toLocaleString('es-AR'), 'success');
                if (result) {
                    result.style.display = 'block';
                    result.innerHTML = '⏰ <strong>Programada</strong> para ' +
                        escapeHtml(scheduledFor.toLocaleString('es-AR')) +
                        '. Aparece abajo en "Notificaciones programadas".';
                }
                document.getElementById('notifTitle').value = '';
                document.getElementById('notifBody').value = '';
                document.getElementById('scheduleEnabled').checked = false;
                toggleScheduleFields();
                loadScheduledNotifications();
            } else {
                showToast('Error: ' + (sData.error || sR.status), 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🚀 Enviar notificación'; }
        }
        return;
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

        // Calcular fechas de vencimiento para snapshots de historial.
        const promoExpiresAtIso = promoEnabled
            ? new Date(Date.now() + promoDurationHours * 3600 * 1000).toISOString()
            : null;
        const giveawayExpiresAtIso = giveawayEnabled
            ? new Date(Date.now() + giveawayDurationMinutes * 60 * 1000).toISOString()
            : null;

        if (promoEnabled) {
            payload.data.promoCode = promoCode;
            payload.data.promoMessage = promoMessage;
            payload.data.promoExpiresIn = String(promoDurationHours);
        }
        if (giveawayEnabled) {
            payload.data.giveawayAmount = String(giveawayAmount);
            payload.data.giveawayDurationMinutes = String(giveawayDurationMinutes);
        }

        // Tipo del row de historial.
        let histType = 'plain';
        if (promoEnabled) histType = 'whatsapp_promo';
        else if (giveawayEnabled) histType = 'money_giveaway';

        payload.historyMeta = {
            type: histType,
            promoMessage: promoEnabled ? promoMessage : null,
            promoCode:    promoEnabled ? promoCode : null,
            promoExpiresAt: promoExpiresAtIso,
            giveawayAmount: giveawayEnabled ? giveawayAmount : null,
            giveawayDurationMins: giveawayEnabled ? giveawayDurationMinutes : null,
            giveawayExpiresAt: giveawayExpiresAtIso
        };

        // 1) Enviar la notificacion. El server crea el row de historial
        //    y nos devuelve historyId.
        const r = await authFetch('/api/notifications/send-all', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await r.json();

        // 2a) Si hay promo, crear la promo vinculada al historyId.
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

        // 2b) Si hay regalo, crear el giveaway vinculado al historyId.
        if (giveawayEnabled && r.ok && data.success) {
            try {
                const gR = await authFetch('/api/admin/money-giveaway', {
                    method: 'POST',
                    body: JSON.stringify({
                        amount: giveawayAmount,
                        totalBudget: giveawayBudget,
                        maxClaims: giveawayMaxClaims,
                        durationMinutes: giveawayDurationMinutes,
                        prefix: prefix || null,
                        notificationHistoryId: data.historyId || null
                    })
                });
                if (!gR.ok) {
                    const e = await gR.json().catch(() => ({}));
                    showToast('Notif enviada pero falló crear regalo: ' + (e.error || gR.status), 'error');
                }
            } catch (e) {
                showToast('Notif enviada pero falló crear regalo: ' + e.message, 'error');
            }
        }
        if (r.ok && data.success) {
            const targetLine = data.prefix
                ? `Audiencia: <strong>usuarios "${escapeHtml(data.prefix)}*"</strong><br>`
                : `Audiencia: <strong>todos los usuarios</strong><br>`;
            let extraLine = '';
            if (promoEnabled) {
                extraLine = `<br>🎁 Promo activa: <strong>${escapeHtml(promoCode)}</strong> por ${promoDurationHours}h`;
            } else if (giveawayEnabled) {
                extraLine = `<br>💰 Regalo activo: $${giveawayAmount.toLocaleString('es-AR')}/persona, hasta ${giveawayMaxClaims} personas o $${giveawayBudget.toLocaleString('es-AR')}, por ${giveawayDurationMinutes}min`;
            }
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
                extraLine;
            if (result) result.innerHTML = summary;
            showToast('Notificación enviada', 'success');
            // Reset form (mantener target/prefix por si quiere mandar de nuevo)
            document.getElementById('notifTitle').value = '';
            document.getElementById('notifBody').value = '';
            // Reset extras: volver a "Solo notif".
            const noneRadio = document.querySelector('input[name="notifExtra"][value="none"]');
            if (noneRadio) { noneRadio.checked = true; updateNotifExtraUI(); }
            const promoCb = document.getElementById('promoAlertEnabled');
            if (promoCb) { promoCb.checked = false; }
            ['promoAlertMessage', 'promoAlertCode',
             'giveawayAmountInput', 'giveawayBudgetInput', 'giveawayMaxClaimsInput'
            ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            updateNotifPreview();
            loadPromoAlertStatus();
            loadGiveawayStatusAdmin();
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

    // Picker de emojis para notif (insertan en title o body segun el ultimo
    // campo enfocado).
    initNotifEmojiPicker();

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

// ============================================
// EMOJI PICKER PARA NOTIFICACIONES
// Inserta el emoji clickeado en la posicion del cursor del ULTIMO campo
// (title o body) que el admin enfoco. Si nunca enfoco ninguno, va al body.
// ============================================
const NOTIF_EMOJIS = [
    '🎁','💰','🤑','💸','💵','🎰','🃏','🎲','🎯','🏆',
    '🔥','⚡','🚨','📢','📣','🔔','⏰','⏳','🎉','🎊',
    '🎟️','🎫','💎','⭐','🌟','✨','🚀','🎮','🏅','🥇',
    '✅','❌','⚠️','💯','🆕','🆓','🔝','🆗','🔄','📲',
    '💪','👇','👀','🙌','👋','🫵','💬','📩','📌','📍'
];

let _lastNotifField = 'notifBody';

function initNotifEmojiPicker() {
    const picker = document.getElementById('notifEmojiPicker');
    if (!picker) return;

    // Track del ultimo campo enfocado para saber donde insertar el emoji.
    ['notifTitle', 'notifBody'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('focus', () => { _lastNotifField = id; });
            // Tambien al hacer click en el campo (por si vienen de blur otro).
            el.addEventListener('click', () => { _lastNotifField = id; });
        }
    });

    // Renderizar los botones de emoji.
    picker.innerHTML = NOTIF_EMOJIS.map((e) =>
        `<button type="button" class="notif-emoji-btn" data-emoji="${e}" ` +
        `style="font-size:18px;line-height:1;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:6px;cursor:pointer;transition:background 0.15s;" ` +
        `title="Insertar ${e}">${e}</button>`
    ).join('');

    picker.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.notif-emoji-btn');
        if (!btn) return;
        const emoji = btn.getAttribute('data-emoji');
        if (!emoji) return;
        insertEmojiInField(_lastNotifField, emoji);
    });
}

function insertEmojiInField(fieldId, emoji) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const start = el.selectionStart != null ? el.selectionStart : el.value.length;
    const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    // Respeta el maxlength del input — si nos pasariamos, no insertamos.
    const max = parseInt(el.getAttribute('maxlength') || '0', 10);
    if (max > 0 && (before.length + emoji.length + after.length) > max) {
        showToast('No entra el emoji — superaria el límite de ' + max + ' caracteres', 'info');
        return;
    }
    el.value = before + emoji + after;
    // Posicionar cursor despues del emoji.
    const newPos = start + emoji.length;
    try { el.setSelectionRange(newPos, newPos); } catch (_) {}
    el.focus();
    // Disparar input event para que la live preview se actualice.
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ============================================
// TOP ESTADISTICAS — segmentacion + recuperacion + ROI
// ============================================
function showStatsTab(tab) {
    document.querySelectorAll('.stats-tab-pane').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.stats-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'rgba(255,255,255,0.06)';
        b.style.borderColor = 'rgba(255,255,255,0.10)';
        b.style.color = '#bbb';
    });
    const pane = document.getElementById('statsTab' + tab[0].toUpperCase() + tab.slice(1));
    if (pane) pane.style.display = '';
    const btn = document.querySelector('.stats-tab-btn[data-tab="' + tab + '"]');
    if (btn) {
        btn.classList.add('active');
        btn.style.background = 'rgba(212,175,55,0.20)';
        btn.style.borderColor = 'rgba(212,175,55,0.45)';
        btn.style.color = '#ffd700';
    }
    if (tab === 'players') loadPlayersList();
    if (tab === 'roi') loadRoiBucket();
    if (tab === 'playbook') renderPlaybook();
}

async function loadStatsAll() {
    await Promise.all([loadStatsRefreshState(), loadCsvImportState(), loadSegmentsAndWeekly()]);
}

// --- CSV import desde JUGAYGANA ---
async function loadCsvImportState() {
    try {
        const r = await authFetch('/api/admin/stats/import-csv');
        if (!r.ok) return;
        const d = await r.json();
        renderCsvImportState(d.state || {}, d.lastImport || null);
    } catch (e) { console.warn('loadCsvImportState', e); }
}

function renderCsvImportState(state, lastImport) {
    const el = document.getElementById('csvImportState');
    if (!el) return;
    if (state.running) {
        el.innerHTML = '⏳ Procesando: <strong style="color:#d6b3ff;">' +
            (state.valid || 0) + ' válidas / ' + (state.skipped || 0) + ' descartadas</strong>';
    } else if (lastImport) {
        const when = new Date(lastImport.uploadedAt).toLocaleString('es-AR');
        const period = lastImport.periodFrom && lastImport.periodTo
            ? new Date(lastImport.periodFrom).toLocaleDateString('es-AR') + ' - ' + new Date(lastImport.periodTo).toLocaleDateString('es-AR')
            : 'periodo no detectado';
        el.innerHTML = '✅ Último import: <strong>' + escapeHtml(when) + '</strong> · ' +
            (lastImport.uniqueUsers || 0) + ' jugadores · ' +
            (lastImport.validRows || 0) + ' transacciones · ' +
            'periodo ' + period;
    } else {
        el.innerHTML = 'Sin imports todavía.';
    }
}

let _csvImportPollInterval = null;

async function handleCsvImportUrl() {
    const input = document.getElementById('csvImportUrl');
    const btn = document.getElementById('csvImportUrlBtn');
    const url = (input && input.value || '').trim();
    if (!url) {
        showToast('Pegá un link de Google Sheets', 'info');
        return;
    }
    if (!/docs\.google\.com\/spreadsheets/.test(url)) {
        showToast('No parece un link de Google Sheets', 'error');
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Descargando…'; }
    try {
        const r = await authFetch('/api/admin/stats/import-csv-url', {
            method: 'POST',
            body: JSON.stringify({ url })
        });
        const d = await r.json();
        if (d.success === false && d.message) {
            showToast(d.message, 'info');
        } else if (d.skipped) {
            showToast(d.message || 'Sheet ya importado previamente', 'info');
        } else if (d.error) {
            showToast(d.error, 'error');
        } else {
            showToast('Sheet descargado, procesando…', 'success');
            startCsvImportPolling();
            if (input) input.value = '';
        }
    } catch (e) {
        console.error(e);
        showToast('Error iniciando import', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔗 Importar desde link'; }
    }
}

function startCsvImportPolling() {
    if (_csvImportPollInterval) clearInterval(_csvImportPollInterval);
    _csvImportPollInterval = setInterval(async () => {
        await loadCsvImportState();
        const stEl = document.getElementById('csvImportState');
        if (stEl && stEl.innerHTML.startsWith('✅')) {
            clearInterval(_csvImportPollInterval);
            _csvImportPollInterval = null;
            await loadSegmentsAndWeekly();
            if (document.getElementById('statsTabPlayers').style.display !== 'none') loadPlayersList();
            if (document.getElementById('statsTabRoi').style.display !== 'none') loadRoiBucket();
            showToast('✅ Import completo, panel actualizado', 'success');
        }
    }, 2000);
}

async function handleCsvImport(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
        showToast('El archivo supera 100MB. Pediendo a alguien que lo recorte.', 'error');
        return;
    }
    const btn = document.getElementById('csvImportBtn');
    if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; btn.textContent = '⏳ Leyendo archivo…'; }

    try {
        // Leer como texto (no binario) — soporta .csv y .txt.
        const text = await file.text();
        if (btn) btn.textContent = '⏳ Subiendo (' + Math.round(text.length / 1024) + ' KB)…';

        const r = await fetch(API_URL + '/api/admin/stats/import-csv', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + currentToken,
                'Content-Type': 'text/csv'
            },
            body: text
        });
        const d = await r.json();

        if (d.success === false && d.message) {
            showToast(d.message, 'info');
        } else if (d.skipped) {
            showToast(d.message || 'Archivo ya importado previamente', 'info');
        } else {
            showToast('Import iniciado en background', 'success');
            startCsvImportPolling();
        }
    } catch (e) {
        console.error(e);
        showToast('Error procesando el archivo', 'error');
    } finally {
        if (btn) {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.textContent = '📤 Subir CSV de JUGAYGANA';
        }
        // Reset el input para que se pueda volver a subir el mismo archivo.
        ev.target.value = '';
    }
}

async function loadStatsRefreshState() {
    try {
        const r = await authFetch('/api/admin/stats/refresh', { method: 'GET' });
        if (!r.ok) return;
        const d = await r.json();
        renderRefreshState(d.state || {});
    } catch (e) { console.warn('loadStatsRefreshState', e); }
}

function renderRefreshState(s) {
    const el = document.getElementById('statsRefreshState');
    if (!el) return;
    if (s.running) {
        const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
        el.innerHTML = '⏳ Refrescando JUGAYGANA: <strong style="color:#ffd700;">' + s.done + ' / ' + s.total + '</strong> (' + pct + '%)' +
            (s.errors ? ' — <span style="color:#ff8080;">' + s.errors + ' errores</span>' : '');
    } else if (s.finishedAt) {
        const when = new Date(s.finishedAt).toLocaleString('es-AR');
        el.innerHTML = '✅ Último refresh: <strong>' + escapeHtml(when) + '</strong> — ' + (s.done || 0) + ' jugadores procesados' +
            (s.errors ? ' (' + s.errors + ' errores)' : '');
    } else {
        el.innerHTML = 'Esperando primer refresh…';
    }
}

let _refreshPollInterval = null;
async function triggerStatsRefresh() {
    const btn = document.getElementById('statsRefreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Iniciando…'; }
    try {
        const r = await authFetch('/api/admin/stats/refresh', { method: 'POST' });
        const d = await r.json();
        if (d.success === false && d.message) {
            showToast(d.message, 'info');
        } else {
            showToast('Refresh iniciado en background', 'success');
        }
        renderRefreshState(d.state || {});
        // Polear cada 3s mientras corre.
        if (_refreshPollInterval) clearInterval(_refreshPollInterval);
        _refreshPollInterval = setInterval(async () => {
            await loadStatsRefreshState();
            const stEl = document.getElementById('statsRefreshState');
            if (stEl && stEl.innerHTML.startsWith('✅')) {
                clearInterval(_refreshPollInterval);
                _refreshPollInterval = null;
                // Recargar las tablas con datos frescos.
                await loadSegmentsAndWeekly();
                if (document.getElementById('statsTabPlayers').style.display !== 'none') loadPlayersList();
                if (document.getElementById('statsTabRoi').style.display !== 'none') loadRoiBucket();
            }
        }, 3000);
    } catch (e) {
        showToast('Error iniciando refresh', 'error');
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔁 Refrescar JUGAYGANA'; }
    }
}

async function loadSegmentsAndWeekly() {
    try {
        const r = await authFetch('/api/admin/stats/segments');
        if (!r.ok) return;
        const d = await r.json();
        renderWeeklyHeader(d.weekly || {});
        renderRecoveryHeader(d.recovery || {});
        renderSegmentsMatrix(d.matrix || {}, d.tierTotals || {}, d.activityTotals || {});
    } catch (e) { console.warn('loadSegmentsAndWeekly', e); }
}

function renderWeeklyHeader(w) {
    const el = document.getElementById('statsWeeklyHeader');
    if (!el) return;
    const arrow = w.delta > 0 ? '📈' : (w.delta < 0 ? '📉' : '➡️');
    const color = w.delta > 0 ? '#25d366' : (w.delta < 0 ? '#ff5050' : '#aaa');
    el.innerHTML = '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">' +
        '<div style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Comparativo semanal</div>' +
        '<div style="font-size:14px;color:#fff;">Jugadores activos esta semana: <strong style="color:#ffd700;font-size:18px;">' + (w.activeThisWeek || 0) + '</strong>' +
        '   |   Semana pasada: ' + (w.activeLastWeek || 0) +
        '   |   Δ: <strong style="color:' + color + ';">' + arrow + ' ' + (w.delta > 0 ? '+' : '') + (w.delta || 0) + ' (' + (w.deltaPct >= 0 ? '+' : '') + (w.deltaPct || 0) + '%)</strong></div>' +
        '</div>';
}

function renderRecoveryHeader(r) {
    const el = document.getElementById('statsRecoveryHeader');
    if (!el) return;
    if (!r.sent) {
        el.innerHTML = '<div style="background:rgba(0,0,0,0.30);border:1px dashed rgba(255,255,255,0.10);border-radius:10px;padding:12px;color:#888;font-size:12px;">📲 Sin pushes de recuperación enviados todavía. Mandá uno desde la matriz de abajo.</div>';
        return;
    }
    const recovered = r.recovered || 0;
    const recPct = r.sent > 0 ? Math.round((recovered / r.sent) * 100) : 0;
    el.innerHTML = '<div style="background:rgba(37,211,102,0.06);border:1px solid rgba(37,211,102,0.25);border-radius:10px;padding:12px;">' +
        '<div style="color:#25d366;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Efectividad de recuperación (últ. 30d)</div>' +
        '<div style="font-size:13px;color:#fff;line-height:1.6;">' +
        'Pushes enviados: <strong>' + r.sent + '</strong>   |   ' +
        'Recuperaron real: <strong style="color:#25d366;">' + recovered + ' (' + recPct + '%)</strong>   |   ' +
        'Solo bono (oportunistas): <strong style="color:#ffaa00;">' + (r.opportunist || 0) + '</strong>   |   ' +
        'Sin respuesta: <strong style="color:#888;">' + (r.no_response || 0) + '</strong>   |   ' +
        'Pendientes: <strong>' + (r.pending || 0) + '</strong><br>' +
        'Bonos dados: <strong>$' + Number(r.totalBonus || 0).toLocaleString('es-AR') + '</strong>   →   ' +
        'Cargas reales generadas: <strong style="color:#25d366;">$' + Number(r.totalRealDeposit || 0).toLocaleString('es-AR') + '</strong>   =   ' +
        '<strong style="color:#ffd700;">ROI ' + (r.roiX || 0) + '×</strong>' +
        '</div></div>';
}

function renderSegmentsMatrix(matrix, tierTotals, activityTotals) {
    const el = document.getElementById('statsSegmentsMatrix');
    if (!el) return;
    const tiers = ['VIP', 'ORO', 'PLATA', 'BRONCE', 'NUEVO', 'SIN_DATOS'];
    const states = ['ACTIVO', 'EN_RIESGO', 'PERDIDO', 'INACTIVO', 'NUEVO'];
    const tierLabel = {VIP:'🏆 VIP', ORO:'🥇 ORO', PLATA:'🥈 PLATA', BRONCE:'🥉 BRONCE', NUEVO:'🆕 NUEVO', SIN_DATOS:'⚪ Sin datos'};
    const stateLabel = {ACTIVO:'✅ Activo', EN_RIESGO:'⚠️ En riesgo', PERDIDO:'💔 Perdido', INACTIVO:'☠️ Inactivo', NUEVO:'🆕 Nuevo'};
    const cellColor = {
        ACTIVO: 'rgba(37,211,102,0.10)',
        EN_RIESGO: 'rgba(255,170,0,0.15)',
        PERDIDO: 'rgba(255,80,80,0.18)',
        INACTIVO: 'rgba(120,120,120,0.10)',
        NUEVO: 'rgba(26,115,232,0.12)'
    };

    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr><th style="text-align:left;padding:8px;color:#aaa;border-bottom:1px solid rgba(255,255,255,0.10);">Tier \\ Estado</th>';
    for (const s of states) {
        html += '<th style="padding:8px;color:#aaa;border-bottom:1px solid rgba(255,255,255,0.10);text-align:center;">' + stateLabel[s] + '<br><small style="color:#666;font-weight:400;">' + (activityTotals[s] || 0) + ' total</small></th>';
    }
    html += '<th style="padding:8px;color:#aaa;border-bottom:1px solid rgba(255,255,255,0.10);text-align:center;">Σ tier</th></tr></thead><tbody>';

    for (const t of tiers) {
        html += '<tr>';
        html += '<td style="padding:8px;color:#fff;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.05);">' + tierLabel[t] + '</td>';
        for (const s of states) {
            const c = matrix[t + '-' + s] || 0;
            const isUrgent = (t === 'VIP' || t === 'ORO') && (s === 'EN_RIESGO' || s === 'PERDIDO');
            const showBtn = c > 0 && (s === 'EN_RIESGO' || s === 'PERDIDO' || s === 'INACTIVO');
            html += '<td style="padding:8px;text-align:center;background:' + cellColor[s] + ';border-bottom:1px solid rgba(255,255,255,0.05);' + (isUrgent ? 'border:2px solid #ff5050;' : '') + '">';
            html += '<div style="font-size:18px;font-weight:800;color:#fff;">' + c + '</div>';
            if (showBtn) {
                html += '<button onclick="openRecoveryModal(\'' + t + '\',\'' + s + '\')" style="margin-top:4px;font-size:10px;padding:3px 8px;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.20);color:#fff;border-radius:4px;cursor:pointer;font-weight:600;">📲 Push</button>';
            }
            html += '</td>';
        }
        html += '<td style="padding:8px;text-align:center;color:#ffd700;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.05);">' + (tierTotals[t] || 0) + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<div style="margin-top:10px;color:#888;font-size:11px;">Las celdas con borde rojo (VIP/ORO en riesgo o perdidos) son las más urgentes. Tocá "📲 Push" para mandar recuperación a ese segmento (cooldown 7d por user).</div>';
    el.innerHTML = html;
}

async function loadPlayersList() {
    const c = document.getElementById('statsPlayersContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';
    const params = new URLSearchParams();
    const tier = document.getElementById('playersFilterTier').value;
    const status = document.getElementById('playersFilterStatus').value;
    const opp = document.getElementById('playersFilterOpp').value;
    const sortBy = document.getElementById('playersSortBy').value;
    if (tier) params.set('tier', tier);
    if (status) params.set('activityStatus', status);
    if (opp) params.set('opportunist', opp);
    if (sortBy) params.set('sortBy', sortBy);
    params.set('limit', '200');
    try {
        const r = await authFetch('/api/admin/stats/players?' + params.toString());
        if (!r.ok) { c.innerHTML = '<div class="empty-state">Error cargando.</div>'; return; }
        const d = await r.json();
        renderPlayersList(c, d.players || []);
    } catch (e) {
        c.innerHTML = '<div class="empty-state">Error de conexión.</div>';
    }
}

function renderPlayersList(container, players) {
    if (players.length === 0) {
        container.innerHTML = '<div class="empty-state">No hay jugadores con esos filtros. Tal vez todavía no se ejecutó el refresh.</div>';
        return;
    }
    const tierBadge = {VIP:'🏆', ORO:'🥇', PLATA:'🥈', BRONCE:'🥉', NUEVO:'🆕', SIN_DATOS:'⚪'};
    const stateBadge = {ACTIVO:'✅', EN_RIESGO:'⚠️', PERDIDO:'💔', INACTIVO:'☠️', NUEVO:'🆕'};
    let html = '<table class="report-table"><thead><tr>';
    html += '<th>Tier</th><th>Estado</th><th>Usuario</th><th>Cargas $</th><th>#</th><th>Retiros $</th><th>Bonos dados</th><th>Neto a la casa</th><th>Última carga</th><th>Última app</th><th></th>';
    html += '</tr></thead><tbody>';
    for (const p of players) {
        const last = p.lastRealDepositDate ? new Date(p.lastRealDepositDate).toLocaleDateString('es-AR') : '—';
        const lastApp = p.lastSeenApp ? new Date(p.lastSeenApp).toLocaleDateString('es-AR') : '—';
        const oppFlag = p.isOpportunist ? ' <span style="color:#ff5050;font-weight:800;" title="Oportunista — toma bonos sin cargar real">🚩</span>' : '';
        const netColor = (p.netToHouse30d || 0) >= 0 ? '#25d366' : '#ff5050';
        html += '<tr>';
        html += '<td>' + (tierBadge[p.tier] || '') + ' <small>' + escapeHtml(p.tier || '') + '</small></td>';
        html += '<td>' + (stateBadge[p.activityStatus] || '') + '</td>';
        html += '<td><strong style="color:#fff;">' + escapeHtml(p.username || '') + '</strong>' + oppFlag + '</td>';
        html += '<td>$' + Number(p.realDeposits30d || 0).toLocaleString('es-AR') + '</td>';
        html += '<td>' + (p.realChargesCount30d || 0) + '</td>';
        html += '<td>$' + Number(p.withdraws30d || 0).toLocaleString('es-AR') + '</td>';
        html += '<td>$' + Number(p.bonusGiven30d || 0).toLocaleString('es-AR') + '</td>';
        html += '<td><strong style="color:' + netColor + ';">$' + Number(p.netToHouse30d || 0).toLocaleString('es-AR') + '</strong></td>';
        html += '<td><small>' + last + '</small></td>';
        html += '<td><small>' + lastApp + '</small></td>';
        html += '<td><button onclick="suggestStrategyFor(\'' + escapeHtml(p.username) + '\',\'' + p.tier + '\',\'' + p.activityStatus + '\')" style="padding:4px 8px;background:rgba(212,175,55,0.20);border:1px solid rgba(212,175,55,0.45);color:#ffd700;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700;" title="Ver estrategia recomendada">🎯</button></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<div style="color:#888;font-size:11px;margin-top:8px;">Mostrando ' + players.length + ' jugadores. Las columnas son del cache — tocá "Refrescar JUGAYGANA" si están desactualizados.</div>';
    container.innerHTML = html;
}

async function loadRoiBucket() {
    const c = document.getElementById('statsRoiContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';
    try {
        const r = await authFetch('/api/admin/stats/roi-bonus');
        if (!r.ok) { c.innerHTML = '<div class="empty-state">Error cargando.</div>'; return; }
        const d = await r.json();
        renderRoiBuckets(c, d.buckets || []);
    } catch (e) {
        c.innerHTML = '<div class="empty-state">Error de conexión.</div>';
    }
}

function renderRoiBuckets(container, buckets) {
    if (buckets.length === 0) {
        container.innerHTML = '<div class="empty-state">Todavía no hay claims de giveaways en los últimos 30 días.</div>';
        return;
    }
    let html = '<table class="report-table"><thead><tr>';
    html += '<th>Monto del bono</th><th>Veces reclamado</th><th>Total regalado</th><th>Usuarios únicos</th><th>De ellos cargaron real</th><th>Cargas reales generadas</th><th>ROI</th>';
    html += '</tr></thead><tbody>';
    for (const b of buckets) {
        const conv = b.uniqueUsers > 0 ? Math.round((b.usersThatDeposited / b.uniqueUsers) * 100) : 0;
        const roiColor = b.roiX >= 3 ? '#25d366' : (b.roiX >= 1 ? '#ffd700' : '#ff5050');
        html += '<tr>';
        html += '<td><strong style="color:#fff;">$' + Number(b.amount).toLocaleString('es-AR') + '</strong></td>';
        html += '<td>' + b.count + '</td>';
        html += '<td>$' + Number(b.totalGiven).toLocaleString('es-AR') + '</td>';
        html += '<td>' + b.uniqueUsers + '</td>';
        html += '<td>' + b.usersThatDeposited + ' <small style="color:#888;">(' + conv + '%)</small></td>';
        html += '<td>$' + Number(b.realDepositsFromThem).toLocaleString('es-AR') + '</td>';
        html += '<td><strong style="color:' + roiColor + ';font-size:14px;">' + b.roiX + '×</strong></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<div style="color:#888;font-size:11px;margin-top:8px;">ROI = (cargas reales generadas) / (total regalado). Verde ≥ 3× = excelente. Amarillo 1-3× = OK. Rojo &lt;1× = perdés plata regalando.</div>';
    container.innerHTML = html;
}

const PLAYBOOK_DATA = [
    {seg: '🏆 VIP - ACTIVO', strategy: 'Hacerlo sentir único', bonus: 'Giveaway VIP $5k-$10k exclusivo + atención WA preferencial', freq: '1x/mes sorpresa', why: 'Ya está dando. No molestar, solo recordarle que es especial.'},
    {seg: '🏆 VIP - EN_RIESGO', strategy: '🚨 ALERTA ROJA', bonus: 'Bono $10k+ personalizado + mensaje del "dueño" + WhatsApp directo', freq: '1x máximo', why: 'Vale invertir fuerte en retener al top.'},
    {seg: '🏆 VIP - PERDIDO', strategy: 'Último intento valor alto', bonus: '$15k + mensaje personal', freq: '1x', why: 'Si no vuelve, abandonar — el LTV ya se cobró.'},
    {seg: '🥇 ORO - ACTIVO', strategy: 'Mantener engaged', bonus: 'Reembolsos visibles + giveaway $2k-$5k', freq: 'Cada 7-10 días', why: 'Empujoncito constante mantiene el hábito.'},
    {seg: '🥇 ORO - EN_RIESGO', strategy: 'Push fuerte', bonus: 'Bono $5k + recordatorio WA', freq: '1-2x', why: 'Recuperar rápido antes que sea PERDIDO.'},
    {seg: '🥇 ORO - PERDIDO', strategy: 'Bono medio + storytelling', bonus: '$5k-$8k + mensaje "volvé hoy"', freq: '1x', why: 'Recuperación con ROI razonable.'},
    {seg: '🥈 PLATA - ACTIVO', strategy: 'Subir el ticket', bonus: '"Cargá $10k → te damos $2k extra"', freq: 'Quincenal', why: 'Incentivás cargas más grandes.'},
    {seg: '🥈 PLATA - EN_RIESGO', strategy: 'Reactivar', bonus: 'Bono $1k-$3k', freq: '1x', why: 'Suficiente para tentar sin gastar mucho.'},
    {seg: '🥈 PLATA - PERDIDO', strategy: 'Bono chico', bonus: '$2k', freq: '1x', why: 'Si no vuelve, no rentable más.'},
    {seg: '🥉 BRONCE - ACTIVO', strategy: 'Fidelización', bonus: 'Racha de cargas (5 cargas seguidas = $1k extra)', freq: 'Continuo', why: 'Los hacés sentir parte de algo.'},
    {seg: '🥉 BRONCE - EN_RIESGO/PERDIDO', strategy: 'Bono mínimo', bonus: '$500-$1.500', freq: '1x máximo', why: 'No rentable invertir mucho.'},
    {seg: '🆕 NUEVO', strategy: 'Onboarding agresivo', bonus: 'Welcome $10k visible + bonus continuidad $3k al hacer 2da carga', freq: 'Período crítico 14 días', why: 'Engancharlo en el hábito.'},
    {seg: '☠️ INACTIVO 30d+', strategy: 'Último resort', bonus: '$2k-$5k + "te extrañamos"', freq: 'Cada 30-60 días', why: 'Si no responde a la 2da, dejar de gastar.'},
    {seg: '🚩 OPORTUNISTA', strategy: 'CORTAR BONOS', bonus: 'Solo notifs sin plata', freq: 'Nunca darle bono', why: 'Drenan tu caja sin contraprestación.'},
    {seg: '💸 GANADOR a la casa', strategy: 'NO inflar con bonos', bonus: 'Servicio premium si es VIP/ORO, pero sin plata extra', freq: '—', why: 'Ya están extrayendo valor.'}
];
function renderPlaybook() {
    const c = document.getElementById('statsPlaybookContent');
    if (!c) return;
    let html = '<div style="color:#aaa;font-size:12px;margin-bottom:12px;">Estrategia recomendada por celda. Usá esto como guía rápida cuando mandes pushes individuales o masivos.</div>';
    html += '<table class="report-table"><thead><tr>';
    html += '<th>Segmento</th><th>Estrategia</th><th>Bono</th><th>Frecuencia</th><th>Por qué</th>';
    html += '</tr></thead><tbody>';
    for (const p of PLAYBOOK_DATA) {
        html += '<tr>';
        html += '<td><strong style="color:#fff;">' + p.seg + '</strong></td>';
        html += '<td><strong style="color:#ffd700;">' + escapeHtml(p.strategy) + '</strong></td>';
        html += '<td>' + escapeHtml(p.bonus) + '</td>';
        html += '<td><small>' + escapeHtml(p.freq) + '</small></td>';
        html += '<td><small style="color:#aaa;">' + escapeHtml(p.why) + '</small></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    c.innerHTML = html;
}

function suggestStrategyFor(username, tier, status) {
    // Encontrar la entrada del playbook que corresponde.
    const segKey = tier + ' - ' + status;
    let match = PLAYBOOK_DATA.find(p => p.seg.includes(tier) && p.seg.includes(status));
    if (!match) match = PLAYBOOK_DATA.find(p => p.seg.includes(tier));
    const bonus = match ? match.bonus : 'A definir';
    const strategy = match ? match.strategy : 'Sin recomendación';
    const why = match ? match.why : '';
    showToast('🎯 ' + username + ' (' + segKey + ')\\nEstrategia: ' + strategy + '\\nBono: ' + bonus + '\\n\\n' + why, 'info');
}

function openRecoveryModal(tier, status) {
    const match = PLAYBOOK_DATA.find(p => p.seg.includes(tier) && p.seg.includes(status))
              || PLAYBOOK_DATA.find(p => p.seg.includes(tier));
    const bonusHint = match ? match.bonus : 'a tu criterio';
    const segLabel = tier + ' - ' + status;
    const title = prompt('Título de la notif para todos los ' + segLabel + ':\\n\\n(Sugerido: "Te extrañamos 🎁")', '🎁 Volvé hoy y aprovechá');
    if (title == null) return;
    const body = prompt('Mensaje:\\n\\nEstrategia recomendada para este segmento:\\n→ ' + bonusHint, 'Tenemos algo especial para vos. Entrá ahora a reclamarlo.');
    if (body == null) return;
    const bonusAmountStr = prompt('Monto del bono individual (deja 0 para solo notif sin bono):\\n\\nGuía: ' + bonusHint, '0');
    if (bonusAmountStr == null) return;
    const bonusAmount = Number(bonusAmountStr) || 0;

    const body2 = {
        tier, activityStatus: status,
        excludeOpportunists: true,
        title, body,
        bonusType: bonusAmount > 0 ? 'giveaway' : 'none',
        giveawayAmount: bonusAmount,
        giveawayBudget: bonusAmount * 1000,  // tope generoso por ahora
        giveawayMaxClaims: 1000,
        giveawayDurationMinutes: 60
    };
    authFetch('/api/admin/stats/recovery-push', {
        method: 'POST',
        body: JSON.stringify(body2)
    }).then(r => r.json()).then(d => {
        if (d.success) {
            showToast('✅ Push registrado a ' + d.sentCount + ' jugadores' + (d.skipped ? ' (' + d.skipped + ' en cooldown)' : '') + '. Para disparar el envío real, usá el composer de Notificaciones con la lista.', 'success');
        } else {
            showToast(d.message || 'No se pudo enviar', 'error');
        }
    }).catch(() => showToast('Error de conexión', 'error'));
}

// ============================================
// IMPORT DE LÍNEAS DESDE DRIVE / .XLSX
// ============================================
let _lineImportLastPreviewBuffer = null; // ArrayBuffer del último file leído
let _lineImportLastTeamName = null;

function resetLineImportForm() {
    const fileEl = document.getElementById('lineImportFile');
    const teamEl = document.getElementById('lineImportTeamName');
    const resultEl = document.getElementById('lineImportResult');
    const confirmBtn = document.getElementById('lineImportConfirmBtn');
    if (fileEl) fileEl.value = '';
    if (teamEl) teamEl.value = '';
    if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
    _lineImportLastPreviewBuffer = null;
    _lineImportLastTeamName = null;
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.4';
    }
}

async function loadLineImportStats() {
    const el = document.getElementById('lineImportStats');
    if (!el) return;
    el.innerHTML = '<span style="color:#888;">Cargando estadísticas…</span>';
    try {
        const r = await authFetch('/api/admin/user-lines/stats');
        const d = await r.json();
        if (!r.ok) {
            el.innerHTML = '<span style="color:#ff6b6b;">Error: ' + escapeHtml(d.error || 'desconocido') + '</span>';
            return;
        }
        const chips = [];
        chips.push(_chip('Total usuarios', d.totalUsers, '#888'));
        chips.push(_chip('Asignados a línea', d.totalAssigned, '#9b30ff'));
        chips.push(_chip('Sin asignar (usan prefijo)', d.totalUnassigned, '#888'));
        let html = chips.join('');
        if (Array.isArray(d.lines) && d.lines.length > 0) {
            html += '<div style="width:100%;margin-top:8px;border-top:1px dashed rgba(255,255,255,0.08);padding-top:8px;display:flex;flex-direction:column;gap:4px;">';
            html += '<span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Distribución actual</span>';
            for (const l of d.lines) {
                html += '<div style="display:flex;justify-content:space-between;gap:10px;font-size:11px;color:#bbb;">';
                html += '<span><strong style="color:#c89bff;">' + escapeHtml(l.teamName || '(sin team)') + '</strong> · <code style="background:rgba(0,0,0,0.4);padding:1px 6px;border-radius:3px;font-family:monospace;">' + escapeHtml(l.linePhone) + '</code></span>';
                html += '<span style="color:#fff;font-weight:700;">' + (l.count || 0) + ' usuarios</span>';
                html += '</div>';
            }
            html += '</div>';
        }
        el.innerHTML = html;
    } catch (e) {
        console.error(e);
        el.innerHTML = '<span style="color:#ff6b6b;">Error de conexión</span>';
    }
}

function _chip(label, value, color) {
    return '<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,0,0,0.4);padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">' +
        '<span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">' + escapeHtml(label) + '</span>' +
        '<strong style="color:' + color + ';font-size:14px;">' + value + '</strong>' +
        '</span>';
}

async function _readLineImportFileBuffer() {
    const fileEl = document.getElementById('lineImportFile');
    if (!fileEl || !fileEl.files || fileEl.files.length === 0) {
        showToast('Seleccioná un archivo .xlsx', 'error');
        return null;
    }
    const file = fileEl.files[0];
    if (file.size > 14 * 1024 * 1024) {
        showToast('El archivo supera 14 MB. Subir uno más chico.', 'error');
        return null;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
        showToast('El archivo debe ser .xlsx (Excel). Si tu Drive es Google Sheets: Archivo → Descargar → Excel.', 'error');
        return null;
    }
    return await file.arrayBuffer();
}

async function _sendLineImport(buffer, teamName, dryRun) {
    const url = '/api/admin/user-lines/import?teamName=' + encodeURIComponent(teamName) + '&dryRun=' + (dryRun ? 'true' : 'false');
    const r = await fetch(API_URL + url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + currentToken,
            'Content-Type': 'application/octet-stream'
        },
        body: buffer
    });
    if (r.status === 401) { handleLogout(); throw new Error('Sesión expirada'); }
    return await r.json();
}

async function previewLineImport() {
    const teamEl = document.getElementById('lineImportTeamName');
    const teamName = teamEl ? teamEl.value.trim() : '';
    if (!teamName) {
        showToast('Falta el nombre del equipo', 'error');
        if (teamEl) teamEl.focus();
        return;
    }

    const buffer = await _readLineImportFileBuffer();
    if (!buffer) return;

    const previewBtn = document.getElementById('lineImportPreviewBtn');
    const confirmBtn = document.getElementById('lineImportConfirmBtn');
    if (previewBtn) {
        previewBtn.disabled = true;
        previewBtn.style.opacity = '0.5';
        previewBtn.textContent = '⏳ Analizando…';
    }
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.4';
    }

    try {
        const d = await _sendLineImport(buffer, teamName, true);
        if (!d.success) {
            showToast(d.error || 'Error en la vista previa', 'error');
            return;
        }
        // Guardar buffer para que confirmar use exactamente lo mismo (sin re-leer file)
        _lineImportLastPreviewBuffer = buffer;
        _lineImportLastTeamName = teamName;
        renderLineImportResult(d, true);
        // Habilitar el confirm siempre — incluso con 0 matches el admin puede
        // querer "confirmar" para tener visibilidad/log. Si matched=0 es no-op.
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
            if (d.summary && d.summary.matched === 0) {
                confirmBtn.textContent = '⚠️ Confirmar (0 matches → no-op)';
            } else {
                confirmBtn.textContent = '✅ Confirmar importación (' + (d.summary.matched || 0) + ' usuarios)';
            }
        }
    } catch (e) {
        console.error(e);
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (previewBtn) {
            previewBtn.disabled = false;
            previewBtn.style.opacity = '1';
            previewBtn.textContent = '👁️ Vista previa (no escribe)';
        }
    }
}

async function confirmLineImport() {
    if (!_lineImportLastPreviewBuffer || !_lineImportLastTeamName) {
        showToast('Hacé "Vista previa" primero', 'error');
        return;
    }
    const teamEl = document.getElementById('lineImportTeamName');
    const teamName = teamEl ? teamEl.value.trim() : '';
    if (teamName !== _lineImportLastTeamName) {
        showToast('Cambiaste el equipo. Hacé "Vista previa" de nuevo.', 'error');
        return;
    }
    if (!confirm('¿Confirmar la importación para el equipo "' + teamName + '"? Esta acción modifica usuarios en la base de datos.')) {
        return;
    }

    const previewBtn = document.getElementById('lineImportPreviewBtn');
    const confirmBtn = document.getElementById('lineImportConfirmBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        confirmBtn.textContent = '⏳ Escribiendo…';
    }
    if (previewBtn) { previewBtn.disabled = true; previewBtn.style.opacity = '0.5'; }

    try {
        const d = await _sendLineImport(_lineImportLastPreviewBuffer, teamName, false);
        if (!d.success) {
            showToast(d.error || 'Error en la importación', 'error');
            return;
        }
        renderLineImportResult(d, false);
        showToast('✅ Importación aplicada · ' + (d.summary && d.summary.matched || 0) + ' usuarios asignados', 'success');
        _lineImportLastPreviewBuffer = null;
        _lineImportLastTeamName = null;
        // Refrescar stats arriba
        loadLineImportStats();
    } catch (e) {
        console.error(e);
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            confirmBtn.textContent = '✅ Confirmar importación';
        }
        if (previewBtn) {
            previewBtn.disabled = false;
            previewBtn.style.opacity = '1';
        }
    }
}

function renderLineImportResult(d, isDryRun) {
    const el = document.getElementById('lineImportResult');
    if (!el) return;

    const s = d.summary || {};
    const sheets = Array.isArray(d.sheets) ? d.sheets : [];
    const conflicts = Array.isArray(d.conflicts) ? d.conflicts : [];
    const notFoundSample = Array.isArray(d.notFoundSample) ? d.notFoundSample : [];

    const banner = isDryRun
        ? '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.4);color:#ffd700;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:700;margin-bottom:14px;">👁️ Vista previa — no se modificó nada en la DB. Revisá el resultado abajo y apretá "Confirmar" si está OK.</div>'
        : '<div style="background:rgba(0,255,136,0.10);border:1px solid rgba(0,255,136,0.4);color:#00ff88;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:700;margin-bottom:14px;">✅ Importación aplicada · ' + (d.writeResult && d.writeResult.modifiedCount || 0) + ' documentos modificados.</div>';

    let html = banner;

    // Resumen
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">';
    html += _chip('Equipo', escapeHtml(d.teamName || ''), '#c89bff');
    html += _chip('Hojas', s.totalSheets || 0, '#fff');
    html += _chip('Filas totales', s.totalRows || 0, '#fff');
    html += _chip('Matcheados', s.matched || 0, '#00ff88');
    html += _chip('No encontrados', s.notFound || 0, (s.notFound > 0 ? '#ffaa00' : '#888'));
    html += _chip('Conflictos', s.conflicts || 0, (s.conflicts > 0 ? '#ff6b6b' : '#888'));
    html += '</div>';

    // Tabla por hoja
    if (sheets.length > 0) {
        html += '<div style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;margin-bottom:14px;">';
        html += '<div style="padding:8px 12px;background:rgba(155,48,255,0.10);color:#c89bff;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Detalle por hoja (línea)</div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<thead><tr style="color:#888;text-align:left;">';
        html += '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);">Hoja</th>';
        html += '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);">Línea (teléfono)</th>';
        html += '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;">Filas</th>';
        html += '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;">Match</th>';
        html += '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;">No enc.</th>';
        html += '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;">Reasignados</th>';
        html += '</tr></thead><tbody>';
        for (const sh of sheets) {
            html += '<tr style="color:#ddd;">';
            html += '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);">' + escapeHtml(sh.sheetName || '') + '</td>';
            html += '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-family:monospace;color:#ffd700;">' + escapeHtml(sh.linePhone || '') + '</td>';
            html += '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;">' + (sh.totalRows || 0) + '</td>';
            html += '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;color:#00ff88;font-weight:700;">' + (sh.matched || 0) + '</td>';
            html += '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;color:' + ((sh.notFound || 0) > 0 ? '#ffaa00' : '#666') + ';">' + (sh.notFound || 0) + '</td>';
            html += '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;color:' + ((sh.reassigned || 0) > 0 ? '#9b30ff' : '#666') + ';">' + (sh.reassigned || 0) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
    }

    // Conflictos
    if (conflicts.length > 0) {
        html += '<details style="background:rgba(255,107,107,0.05);border:1px solid rgba(255,107,107,0.3);border-radius:8px;padding:10px 12px;margin-bottom:10px;">';
        html += '<summary style="color:#ff6b6b;font-size:12px;font-weight:700;cursor:pointer;">⚠️ ' + conflicts.length + ' username(s) en más de una hoja del archivo (no se asignaron)</summary>';
        html += '<div style="margin-top:8px;max-height:200px;overflow:auto;font-size:11px;color:#ffaaaa;font-family:monospace;">';
        for (const c of conflicts) {
            html += '<div>' + escapeHtml(c.username) + ' → hojas: ' + c.sheets.map(escapeHtml).join(' / ') + '</div>';
        }
        html += '</div></details>';
    }

    // No encontrados (sample)
    if (notFoundSample.length > 0) {
        html += '<details style="background:rgba(255,170,0,0.05);border:1px solid rgba(255,170,0,0.3);border-radius:8px;padding:10px 12px;">';
        html += '<summary style="color:#ffaa00;font-size:12px;font-weight:700;cursor:pointer;">📋 Primeros ' + notFoundSample.length + ' usernames no encontrados en la DB (los ignoramos como pediste)</summary>';
        html += '<div style="margin-top:8px;max-height:200px;overflow:auto;font-size:11px;color:#ffd9a0;font-family:monospace;">';
        for (const nf of notFoundSample) {
            html += '<div>' + escapeHtml(nf.username) + ' <span style="color:#888;">(' + escapeHtml(nf.sheet) + ')</span></div>';
        }
        html += '</div></details>';
    }

    el.innerHTML = html;
    el.style.display = 'block';
}

async function clearTeamLineAssignments() {
    const inp = document.getElementById('lineImportClearTeamName');
    const team = inp ? inp.value.trim() : '';
    if (!team) {
        showToast('Escribí el nombre exacto del equipo', 'error');
        return;
    }
    if (!confirm('¿Limpiar TODAS las asignaciones de línea del equipo "' + team + '"? Los usuarios afectados volverán a usar el matcher por prefijo.')) {
        return;
    }
    try {
        const r = await authFetch('/api/admin/user-lines/clear-team', {
            method: 'POST',
            body: JSON.stringify({ teamName: team })
        });
        const d = await r.json();
        if (!r.ok) {
            showToast(d.error || 'Error', 'error');
            return;
        }
        showToast('✅ Limpiados ' + (d.cleared || 0) + ' usuarios del equipo "' + team + '"', 'success');
        if (inp) inp.value = '';
        loadLineImportStats();
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}
