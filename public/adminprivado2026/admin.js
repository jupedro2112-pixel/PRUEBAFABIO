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
        topEngagement: 'topEngagementSection',
        notifs: 'notifsSection',
        notifsHistory: 'notifsHistorySection',
        automations: 'automationsSection',
        teams: 'teamsSection'
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
    } else if (sectionKey === 'topEngagement') {
        loadStatsAll();
    } else if (sectionKey === 'automations') {
        loadAutomations();
    } else if (sectionKey === 'teams') {
        loadTeams();
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
            <!-- Adjuntar listado .xlsx para esta línea (import-exact inline) -->
            <div style="margin-top:6px;border-top:1px dashed rgba(0,212,255,0.20);padding-top:10px;">
                <button type="button" onclick="toggleSlotImport(${i})" id="slotImportToggle-${i}" style="width:100%;background:rgba(0,212,255,0.05);border:1px dashed rgba(0,212,255,0.30);padding:9px;border-radius:7px;color:#00d4ff;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                    📋 Adjuntar listado de usuarios para esta línea
                </button>
                <div id="slotImport-${i}" style="display:none;margin-top:10px;background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.20);border-radius:8px;padding:10px;">
                    <p style="margin:0 0 8px;color:#aaa;font-size:11px;line-height:1.5;">
                        Subí un .xlsx con una columna de usernames. El sistema asigna el número de arriba a esos usuarios. Si un usuario todavía no se registró, queda pre-asignado y recibe la línea cuando entre por primera vez.
                    </p>
                    <input type="file" id="slotImportFile-${i}" accept=".xlsx,.xls" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:12px;box-sizing:border-box;margin-bottom:8px;">
                    <div style="display:flex;gap:6px;">
                        <button type="button" onclick="slotImportPreview(${i})" style="flex:1;padding:9px;font-size:12px;font-weight:700;background:rgba(0,212,255,0.12);border:1px solid rgba(0,212,255,0.40);color:#00d4ff;border-radius:6px;cursor:pointer;">👁 Vista previa</button>
                        <button type="button" id="slotImportConfirm-${i}" onclick="slotImportConfirm(${i})" disabled style="flex:1;padding:9px;font-size:12px;font-weight:700;background:rgba(37,211,102,0.12);border:1px solid rgba(37,211,102,0.40);color:#25d366;border-radius:6px;cursor:not-allowed;opacity:0.5;">✅ Confirmar</button>
                    </div>
                    <div id="slotImportResult-${i}" style="margin-top:10px;"></div>
                </div>
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

// IMPORT POR SLOT y desde tab "Importar líneas": UI removida temporalmente
// (los endpoints en el backend siguen funcionando — sólo la UI se sacó).
// Cuando se rearme la UI, las funciones a recrear son: toggleSlotImport,
// previewSlotImport, confirmSlotImport, renderSlotImportResult,
// refreshSlotImportStats, _readSlotInputs, previewLineImport,
// confirmLineImport, loadLineImportStats, clearTeamLineAssignments.
// Por ahora sólo se preserva el cache vacío para no romper referencias.

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
    html += '<th>📞 Línea asignada</th>';
    html += '<th>📱 Dispositivo</th>';
    html += '<th>App</th>';
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

        // Celda de línea: nombre del equipo (con la línea si vino con etiqueta)
        // y debajo el teléfono. Si no tiene asignación, queda con un guion gris.
        let lineCell;
        if (u.lineTeamName || u.linePhone) {
            const team = u.lineTeamName ? escapeHtml(u.lineTeamName) : '<span style="color:#888;">—</span>';
            const phone = u.linePhone
                ? '<small style="color:#ffd700;font-family:monospace;display:block;">' + escapeHtml(u.linePhone) + '</small>'
                : '';
            lineCell = '<div style="line-height:1.3;"><strong style="color:#c89bff;">' + team + '</strong>' + phone + '</div>';
        } else {
            lineCell = '<span style="color:#666;">— sin línea —</span>';
        }

        html += '<tr>';
        html += '<td>' + escapeHtml(u.username) + '</td>';
        html += '<td>' + lineCell + '</td>';
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

// Cache del último estado del giveaway activo. Se usa para:
//   - poder formatear el countdown sin re-fetchar cada segundo
//   - decidir si bloquear el radio "Regalo de plata" en el form de notif
let _activeGiveawayCache = null;
let _giveawayTickerInterval = null;

async function loadGiveawayStatusAdmin() {
    const box = document.getElementById('giveawayStatus');
    if (!box) return;
    try {
        const r = await authFetch('/api/admin/money-giveaway');
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.giveaway) {
            box.style.display = 'none';
            _activeGiveawayCache = null;
            _stopGiveawayTicker();
            _toggleGiveawayRadioLock(false);
            return;
        }
        const g = data.giveaway;
        const expiresMs = new Date(g.expiresAt).getTime();
        const minsLeft = Math.max(0, Math.round((expiresMs - Date.now()) / 60000));
        if (minsLeft <= 0 && g.status === 'active') {
            box.style.display = 'none';
            _activeGiveawayCache = null;
            _stopGiveawayTicker();
            _toggleGiveawayRadioLock(false);
            return;
        }
        _activeGiveawayCache = { giveaway: g, audience: data.audience || null, expiresMs };
        _renderGiveawayStatusBox();
        _startGiveawayTicker();
        _toggleGiveawayRadioLock(true);
    } catch (err) {
        console.warn('loadGiveawayStatusAdmin error:', err);
        box.style.display = 'none';
        _activeGiveawayCache = null;
        _stopGiveawayTicker();
        _toggleGiveawayRadioLock(false);
    }
}

// Bloquea el radio "Regalo de plata" del form de notificaciones cuando hay
// un giveaway activo. Evita que el admin pise el regalo activo con uno nuevo.
function _toggleGiveawayRadioLock(lock) {
    const radio = document.querySelector('input[name="notifExtra"][value="giveaway"]');
    if (!radio) return;
    const labelWrap = radio.closest('label') || radio.parentElement;
    if (lock) {
        radio.disabled = true;
        if (radio.checked) {
            // Si estaba seleccionado, lo movemos a "ninguno"
            const noneRadio = document.querySelector('input[name="notifExtra"][value="none"]');
            if (noneRadio) {
                noneRadio.checked = true;
                noneRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        if (labelWrap) {
            labelWrap.style.opacity = '0.45';
            labelWrap.style.cursor = 'not-allowed';
            labelWrap.title = 'Hay un regalo activo. Cancelalo o esperá a que venza para crear otro.';
        }
    } else {
        radio.disabled = false;
        if (labelWrap) {
            labelWrap.style.opacity = '';
            labelWrap.style.cursor = '';
            labelWrap.title = '';
        }
    }
}

function _renderGiveawayStatusBox() {
    const box = document.getElementById('giveawayStatus');
    if (!box || !_activeGiveawayCache) return;
    const { giveaway: g, audience, expiresMs } = _activeGiveawayCache;
    const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('es-AR');

    // Countdown formato MM:SS
    const msLeft = Math.max(0, expiresMs - Date.now());
    const totalSecs = Math.floor(msLeft / 1000);
    const minsPart = Math.floor(totalSecs / 60);
    const secsPart = totalSecs % 60;
    const countdownStr = String(minsPart).padStart(2, '0') + ':' + String(secsPart).padStart(2, '0');

    // Progreso (lo que ya se reclamó)
    const claimedPct = g.maxClaims > 0 ? Math.round((g.claimedCount / g.maxClaims) * 100) : 0;
    const givenPct = g.totalBudget > 0 ? Math.round((g.totalGiven / g.totalBudget) * 100) : 0;

    // Audiencia: a cuánta gente le llegó el push (compite por reclamar)
    const audienceLine = audience
        ? '<span style="color:#fff;">📲 Llegó a:</span> <strong style="color:#ffd700;">' + (audience.delivered || 0) + ' personas</strong>'
            + (audience.totalUsers > audience.delivered ? ' <small style="color:#888;">(de ' + audience.totalUsers + ' targeteados, ' + audience.failed + ' tokens muertos)</small>' : '')
            + (audience.audiencePrefix ? ' · <span style="color:#888;">target: ' + escapeHtml(audience.audiencePrefix) + '*</span>' : '')
        : '<span style="color:#888;">📲 Audiencia: sin notif vinculada</span>';

    box.style.display = 'block';
    box.style.padding = '14px 16px';
    box.style.background = 'rgba(37,211,102,0.12)';
    box.style.border = '2px solid rgba(37,211,102,0.55)';
    box.style.fontSize = '13px';
    box.style.lineHeight = '1.6';

    // Badge prominente que muestra si el regalo está restringido a usuarios
    // sin saldo. Si NO lo está, mostramos un warning rojo para que el admin
    // se dé cuenta a simple vista de que cualquiera puede reclamarlo.
    const zeroBalanceBadge = g.requireZeroBalance
        ? '<span style="background:#ffaa00;color:#000;font-weight:800;padding:4px 10px;border-radius:6px;font-size:11px;text-transform:uppercase;letter-spacing:1px;" title="Solo usuarios con saldo $0 en JUGAYGANA pueden reclamar">🎯 Solo sin saldo</span>'
        : '<span style="background:#ff5050;color:#fff;font-weight:800;padding:4px 10px;border-radius:6px;font-size:11px;text-transform:uppercase;letter-spacing:1px;" title="Cualquier usuario puede reclamar — no se verifica saldo">⚠ Abierto a todos</span>';

    box.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">' +
            '<span style="background:#25d366;color:#000;font-weight:800;padding:4px 10px;border-radius:6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;">🎁 Regalo activo</span>' +
            zeroBalanceBadge +
            '<span style="color:#fff;font-weight:700;font-size:14px;">Vence en <span style="color:#ffd700;font-family:monospace;font-size:16px;">' + countdownStr + '</span></span>' +
        '</div>' +
        '<div style="margin-bottom:6px;">' + audienceLine + '</div>' +
        '<div style="margin-bottom:6px;">' +
            '<span style="color:#fff;">💰 Por persona:</span> ' + fmtMoney(g.amount) +
            ' · <span style="color:#fff;">Tope plata:</span> ' + fmtMoney(g.totalBudget) +
            ' · <span style="color:#fff;">Máx personas:</span> ' + g.maxClaims +
            (g.prefix ? ' · <span style="color:#888;">solo "' + escapeHtml(g.prefix) + '*"</span>' : '') +
        '</div>' +
        '<div style="margin-bottom:6px;">' +
            '<span style="color:#fff;">✅ Reclamados:</span> <strong>' + (g.claimedCount || 0) + ' / ' + g.maxClaims + '</strong> ' +
            '<small style="color:#888;">(' + claimedPct + '%)</small>' +
            ' · <span style="color:#fff;">Plata regalada:</span> <strong>' + fmtMoney(g.totalGiven) + '</strong> ' +
            '<small style="color:#888;">(' + givenPct + '%)</small>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.05);border-left:3px solid #ffaa00;padding:8px 10px;margin:10px 0;border-radius:4px;font-size:11px;color:#ffd9a0;">' +
            '⚠️ Mientras este regalo esté activo, el botón "Regalo de plata" en el form está bloqueado. Cancelalo o esperá a que venza para crear otro.' +
        '</div>' +
        '<button onclick="cancelGiveaway()" style="background:rgba(220,38,38,0.85);color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">✕ Cancelar regalo ahora</button>';
}

function _startGiveawayTicker() {
    _stopGiveawayTicker();
    _giveawayTickerInterval = setInterval(() => {
        if (!_activeGiveawayCache) { _stopGiveawayTicker(); return; }
        // Si ya venció, refrescar desde el server (probablemente cerró)
        if (Date.now() >= _activeGiveawayCache.expiresMs) {
            loadGiveawayStatusAdmin();
            return;
        }
        // Cada 30s refrescamos los counters reales (claimedCount cambia con
        // cada claim de un user). El countdown lo pintamos cada segundo.
        const tickCount = (_activeGiveawayCache._tick || 0) + 1;
        _activeGiveawayCache._tick = tickCount;
        if (tickCount % 30 === 0) {
            loadGiveawayStatusAdmin();
        } else {
            _renderGiveawayStatusBox();
        }
    }, 1000);
}

function _stopGiveawayTicker() {
    if (_giveawayTickerInterval) {
        clearInterval(_giveawayTickerInterval);
        _giveawayTickerInterval = null;
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
    const giveawayRequireZeroBalance = !!document.getElementById('giveawayRequireZeroBalanceInput')?.checked;

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
        // El input <type="datetime-local"> devuelve "YYYY-MM-DDTHH:mm" sin
        // timezone. La label del form dice "(Argentina)", así que parseamos
        // SIEMPRE como ART (-03:00) explícitamente, sin importar la TZ del
        // navegador del admin (si está de viaje o accede desde otro huso).
        const m = String(dtStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
        if (!m) {
            showToast('Fecha programada inválida (formato)', 'error'); return;
        }
        const scheduledFor = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`);
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
                payload.giveawayRequireZeroBalance = giveawayRequireZeroBalance;
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
                        notificationHistoryId: data.historyId || null,
                        requireZeroBalance: giveawayRequireZeroBalance
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
    if (tab === 'giveaways') loadGiveawaysHistory();
    // 'playbook' fue eliminado: ahora vive integrado en la tab 'segments'.
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
        renderTopMetrics(d);
        renderUrgentFocus(d.urgentSegments || []);
        renderWeeklyHeader(d.weekly || {});
        renderRecoveryHeader(d.recovery || {});
        renderSegmentsMatrix(d.matrix || {}, d.tierTotals || {}, d.activityTotals || {});
        renderTierDeepDive(d);
    } catch (e) { console.warn('loadSegmentsAndWeekly', e); }
}

// ============================================
// NUEVAS MÉTRICAS GLOBALES — chips arriba del panel
// ============================================
function renderTopMetrics(d) {
    const el = document.getElementById('statsTopMetrics');
    if (!el) return;
    const w = d.weekly || {};
    const rec = d.recoverable || {};
    const recv = d.recovery || {};
    const an = d.appNotifs || null;

    const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('es-AR');

    const arrow = (w.delta || 0) > 0 ? '📈' : ((w.delta || 0) < 0 ? '📉' : '➡️');
    const arrowColor = (w.delta || 0) > 0 ? '#25d366' : ((w.delta || 0) < 0 ? '#ff5050' : '#aaa');

    let html = '';
    html += _bigChip('💰 Activos esta semana', String(w.activeThisWeek || 0),
        '<span style="color:' + arrowColor + ';font-size:11px;font-weight:700;">' + arrow + ' ' + (w.delta > 0 ? '+' : '') + (w.delta || 0) + ' (' + (w.deltaPct >= 0 ? '+' : '') + (w.deltaPct || 0) + '%)</span>',
        '#ffd700');
    html += _bigChip('🎯 Recuperables totales', String(rec.total || 0),
        'En riesgo + perdidos + inactivos<br>(sin oportunistas)',
        '#ff7f50');
    html += _bigChip('💎 Potencial de recuperación', fmtMoney(rec.potentialRevenue),
        'Estimación según ticket avg × conv. esperada',
        '#25d366');
    html += _bigChip('📲 ROI pushes (30d)', (recv.roiX || 0) + '×',
        'Bonos: ' + fmtMoney(recv.totalBonus) + ' → cargas: ' + fmtMoney(recv.totalRealDeposit),
        '#9b30ff');

    // Chip de salud del canal de push: cuántos tienen app + notifs hoy,
    // cómo cambió vs ayer / vs hace 7 días, y sparkline de los últimos 30 días.
    if (an) {
        html += _appNotifChip(an);
    }

    el.innerHTML = html;
}

// Chip especial con sparkline del canal app+notifs.
function _appNotifChip(an) {
    const today = Number(an.today || 0);
    const dY = an.deltaYesterday;
    const d7 = an.delta7d;
    const cov = Number(an.coveragePct || 0);

    const fmtDelta = (v) => {
        if (v == null) return '<span style="color:#888;">— sin datos</span>';
        const n = Number(v);
        const sign = n > 0 ? '+' : '';
        const color = n > 0 ? '#25d366' : (n < 0 ? '#ff5050' : '#aaa');
        const arrow = n > 0 ? '↑' : (n < 0 ? '↓' : '·');
        return '<span style="color:' + color + ';font-weight:700;">' + arrow + ' ' + sign + n + '</span>';
    };

    const series = Array.isArray(an.series) ? an.series : [];
    const sparkline = _renderSparkline(series.map(s => Number(s.withBoth || 0)));

    const sub =
        '<div style="display:flex;gap:8px;margin-bottom:6px;">' +
            '<span style="font-size:10px;color:#888;">Ayer:</span> ' + fmtDelta(dY) +
            '<span style="font-size:10px;color:#888;margin-left:6px;">7d:</span> ' + fmtDelta(d7) +
        '</div>' +
        '<div style="color:#aaa;font-size:10px;margin-bottom:4px;">' +
            cov + '% del total · ' + (an.totalUsersToday || 0) + ' usuarios' +
        '</div>' +
        sparkline;

    return _bigChip('📲 Con app + notifs', String(today), sub, '#00d4ff');
}

// Sparkline simple en SVG: 30 puntos, polyline, sin labels.
// Sin librerías — un SVG inline pequeño.
function _renderSparkline(values) {
    if (!Array.isArray(values) || values.length < 2) {
        return '<div style="color:#666;font-size:10px;">Acumulando datos…</div>';
    }
    const w = 200, h = 36;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = w / (values.length - 1);
    const points = values.map((v, i) => {
        const x = i * stepX;
        const y = h - ((v - min) / range) * (h - 4) - 2;
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const last = values[values.length - 1];
    const lastX = (values.length - 1) * stepX;
    const lastY = h - ((last - min) / range) * (h - 4) - 2;
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:36px;display:block;">' +
        '<polyline points="' + points + '" fill="none" stroke="#00d4ff" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="2.5" fill="#00d4ff"/>' +
    '</svg>';
}

function _bigChip(label, value, sub, color) {
    return '<div style="flex:1;min-width:200px;background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;">' +
        '<div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">' + escapeHtml(label) + '</div>' +
        '<div style="color:' + color + ';font-size:24px;font-weight:800;line-height:1;margin-bottom:6px;">' + escapeHtml(value) + '</div>' +
        '<div style="color:#aaa;font-size:11px;line-height:1.4;">' + sub + '</div>' +
        '</div>';
}

// ============================================
// FOCO URGENTE — top 5 segmentos por urgencia
// ============================================
function renderUrgentFocus(segments) {
    const el = document.getElementById('statsUrgentFocus');
    if (!el) return;
    if (!segments || segments.length === 0) {
        el.innerHTML = '<div style="background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.25);border-radius:10px;padding:12px;color:#25d366;font-size:13px;font-weight:600;">✅ No hay segmentos urgentes. Todo bajo control.</div>';
        return;
    }

    const tierLabel = {VIP:'🏆 VIP', ORO:'🥇 ORO', PLATA:'🥈 PLATA', BRONCE:'🥉 BRONCE', NUEVO:'🆕 NUEVO', SIN_DATOS:'⚪ Sin datos'};
    const stateLabel = {ACTIVO:'Activo', EN_RIESGO:'En riesgo', PERDIDO:'Perdido', INACTIVO:'Inactivo', NUEVO:'Nuevo'};

    let html = '<div style="background:linear-gradient(135deg, rgba(255,80,80,0.08), rgba(212,175,55,0.06));border:1px solid rgba(255,80,80,0.30);border-radius:12px;padding:14px;">';
    html += '<div style="color:#ff7f50;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:10px;">🔴 Foco urgente — atacá esto primero</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';

    for (const seg of segments) {
        const playbook = _findPlaybook(seg.tier, seg.state);
        const segLabel = tierLabel[seg.tier] + ' · ' + stateLabel[seg.state];
        const $ = '$' + Number(seg.potentialRevenue || 0).toLocaleString('es-AR');
        const strategy = playbook ? playbook.strategy : 'Recuperación estándar';
        const bonusHint = playbook ? playbook.bonus : '—';

        html += '<div style="display:flex;align-items:center;gap:12px;background:rgba(0,0,0,0.35);padding:10px 12px;border-radius:8px;border-left:3px solid #ff7f50;">';
        html += '<div style="flex:0 0 auto;background:rgba(255,127,80,0.12);color:#ff7f50;font-size:18px;font-weight:800;padding:8px 12px;border-radius:8px;min-width:64px;text-align:center;">' + (seg.count || 0) + '</div>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:2px;">' + escapeHtml(segLabel) + '</div>';
        html += '<div style="color:#aaa;font-size:11px;line-height:1.4;">🎯 <strong style="color:#ffd700;">' + escapeHtml(strategy) + '</strong> · ' + escapeHtml(bonusHint) + ' · ~' + $ + ' potencial</div>';
        html += '</div>';
        html += '<button onclick="openRecoveryModal(\'' + seg.tier + '\',\'' + seg.state + '\')" style="flex:0 0 auto;padding:8px 14px;background:linear-gradient(135deg,#ff7f50,#ff5050);color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;font-size:12px;white-space:nowrap;">📲 Push (' + (seg.count || 0) + ')</button>';
        html += '</div>';
    }
    html += '</div></div>';

    el.innerHTML = html;
}

function _findPlaybook(tier, state) {
    return PLAYBOOK_DATA.find(p => p.seg.includes(tier) && p.seg.includes(state))
        || PLAYBOOK_DATA.find(p => p.seg.includes(tier));
}

// ============================================
// BLOQUES POR TIER — debajo de la matriz
// ============================================
function renderTierDeepDive(d) {
    const el = document.getElementById('statsTierDeepDive');
    if (!el) return;
    const matrix = d.matrix || {};
    const tierTotals = d.tierTotals || {};
    const recoverableByTier = (d.recoverable && d.recoverable.byTier) || {};
    const avgTicketByTier = d.avgTicketByTier || {};

    const tiers = ['VIP', 'ORO', 'PLATA', 'BRONCE', 'NUEVO', 'SIN_DATOS'];
    const states = ['ACTIVO', 'EN_RIESGO', 'PERDIDO', 'INACTIVO', 'NUEVO'];
    const tierLabel = {VIP:'🏆 VIP', ORO:'🥇 ORO', PLATA:'🥈 PLATA', BRONCE:'🥉 BRONCE', NUEVO:'🆕 NUEVO', SIN_DATOS:'⚪ Sin datos'};
    const stateLabel = {ACTIVO:'✅ Activo', EN_RIESGO:'⚠️ En riesgo', PERDIDO:'💔 Perdido', INACTIVO:'☠️ Inactivo', NUEVO:'🆕 Nuevo'};
    const stateColor = {ACTIVO:'#25d366', EN_RIESGO:'#ffaa00', PERDIDO:'#ff5050', INACTIVO:'#888', NUEVO:'#1a73e8'};
    const tierColor = {VIP:'#ffd700', ORO:'#f7931e', PLATA:'#c0c0c0', BRONCE:'#cd7f32', NUEVO:'#1a73e8', SIN_DATOS:'#666'};
    const tierAccent = {VIP:'rgba(255,215,0,0.25)', ORO:'rgba(247,147,30,0.25)', PLATA:'rgba(192,192,192,0.20)', BRONCE:'rgba(205,127,50,0.20)', NUEVO:'rgba(26,115,232,0.20)', SIN_DATOS:'rgba(102,102,102,0.20)'};

    let html = '';
    for (const t of tiers) {
        const total = tierTotals[t] || 0;
        if (total === 0 && t !== 'VIP') continue; // ocultamos tiers vacíos salvo VIP siempre visible
        const recov = recoverableByTier[t] || { count: 0, potentialRevenue: 0 };
        const ticket = avgTicketByTier[t] || 0;

        html += '<div style="background:rgba(0,0,0,0.35);border:1px solid ' + tierAccent[t] + ';border-radius:12px;padding:14px;">';

        // Header del tier
        html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:10px;border-bottom:1px dashed rgba(255,255,255,0.10);">';
        html += '<div style="color:' + tierColor[t] + ';font-size:18px;font-weight:800;">' + tierLabel[t] + '</div>';
        html += '<div style="color:#888;font-size:11px;">' + total + ' jugadores</div>';
        if (ticket > 0) html += '<div style="color:#888;font-size:11px;">·  Ticket avg: <strong style="color:#ffd700;">$' + Number(ticket).toLocaleString('es-AR') + '</strong></div>';
        if (recov.count > 0) html += '<div style="margin-left:auto;background:rgba(255,127,80,0.10);color:#ff7f50;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;">🎯 ' + recov.count + ' recuperables · ~$' + Number(recov.potentialRevenue).toLocaleString('es-AR') + '</div>';
        html += '</div>';

        // Chips por estado
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">';
        for (const s of states) {
            const c = matrix[t + '-' + s] || 0;
            if (c === 0) continue;
            html += '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;font-size:11px;">';
            html += '<span style="color:' + stateColor[s] + ';font-weight:700;">' + stateLabel[s] + '</span>: ';
            html += '<strong style="color:#fff;">' + c + '</strong>';
            html += '</div>';
        }
        html += '</div>';

        // Estrategia recomendada (última fila destacada — embedded del playbook)
        const recoverableStates = ['EN_RIESGO', 'PERDIDO', 'INACTIVO'];
        const hasRecoverable = recoverableStates.some(s => (matrix[t + '-' + s] || 0) > 0);
        if (hasRecoverable) {
            html += '<div style="background:rgba(212,175,55,0.05);border:1px solid rgba(212,175,55,0.25);border-radius:8px;padding:10px 12px;">';
            html += '<div style="color:#ffd700;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">🎯 Recontactación recomendada</div>';
            html += '<div style="display:flex;flex-direction:column;gap:6px;">';
            for (const s of recoverableStates) {
                const c = matrix[t + '-' + s] || 0;
                if (c === 0) continue;
                const pb = _findPlaybook(t, s);
                if (!pb) continue;
                html += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.06);flex-wrap:wrap;">';
                html += '<span style="color:' + stateColor[s] + ';font-weight:700;font-size:11px;min-width:90px;">' + stateLabel[s] + ' (' + c + ')</span>';
                html += '<span style="color:#fff;font-size:12px;flex:1;min-width:200px;"><strong>' + escapeHtml(pb.strategy) + '</strong> · ' + escapeHtml(pb.bonus) + '</span>';
                html += '<span style="color:#888;font-size:10px;font-style:italic;">' + escapeHtml(pb.why) + '</span>';
                html += '<button onclick="openRecoveryModal(\'' + t + '\',\'' + s + '\')" style="padding:5px 10px;background:linear-gradient(135deg,#9b30ff,#6a0dad);color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;">📲 Push (' + c + ')</button>';
                html += '</div>';
            }
            html += '</div></div>';
        } else if (total > 0) {
            // Sólo activos — sugerencia de retención
            const pb = _findPlaybook(t, 'ACTIVO');
            if (pb) {
                html += '<div style="background:rgba(37,211,102,0.05);border:1px solid rgba(37,211,102,0.20);border-radius:8px;padding:10px 12px;">';
                html += '<div style="color:#25d366;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px;">✅ Mantenimiento (todos activos)</div>';
                html += '<div style="color:#fff;font-size:12px;line-height:1.5;"><strong>' + escapeHtml(pb.strategy) + '</strong> · ' + escapeHtml(pb.bonus);
                html += '<br><span style="color:#aaa;font-size:11px;">' + escapeHtml(pb.why) + '</span></div>';
                html += '</div>';
            }
        }

        html += '</div>';
    }

    el.innerHTML = html;
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
    html += '<th>Tier</th><th>Estado</th><th>Usuario</th><th>Cargas $</th><th>#</th><th>Retiros $</th><th>Bonos dados</th><th>Neto a la casa</th><th>🎁 Reclamos</th><th>Última carga</th><th>Última app</th><th></th>';
    html += '</tr></thead><tbody>';
    for (const p of players) {
        const last = p.lastRealDepositDate ? new Date(p.lastRealDepositDate).toLocaleDateString('es-AR') : '—';
        const lastApp = p.lastSeenApp ? new Date(p.lastSeenApp).toLocaleDateString('es-AR') : '—';
        const oppFlag = p.isOpportunist ? ' <span style="color:#ff5050;font-weight:800;" title="Oportunista — toma bonos sin cargar real">🚩</span>' : '';
        const netColor = (p.netToHouse30d || 0) >= 0 ? '#25d366' : '#ff5050';
        // Celda de reclamos: si tiene, muestra count + $ con click → modal de detalle.
        // Si no tiene, muestra "—".
        let claimsCell = '<small style="color:#666;">—</small>';
        if ((p.giveawayClaimsCount || 0) > 0) {
            const total = Number(p.giveawayTotalClaimed || 0).toLocaleString('es-AR');
            claimsCell = '<button onclick="showUserGiveawayDetail(\'' + escapeHtml(p.username) + '\')" style="padding:4px 8px;background:rgba(155,48,255,0.15);border:1px solid rgba(155,48,255,0.40);color:#c89bff;border-radius:5px;cursor:pointer;font-size:11px;font-weight:700;" title="Ver detalle de reclamos">🎁 ' + p.giveawayClaimsCount + ' · $' + total + '</button>';
        }
        html += '<tr>';
        html += '<td>' + (tierBadge[p.tier] || '') + ' <small>' + escapeHtml(p.tier || '') + '</small></td>';
        html += '<td>' + (stateBadge[p.activityStatus] || '') + '</td>';
        html += '<td><strong style="color:#fff;">' + escapeHtml(p.username || '') + '</strong>' + oppFlag + '</td>';
        html += '<td>$' + Number(p.realDeposits30d || 0).toLocaleString('es-AR') + '</td>';
        html += '<td>' + (p.realChargesCount30d || 0) + '</td>';
        html += '<td>$' + Number(p.withdraws30d || 0).toLocaleString('es-AR') + '</td>';
        html += '<td>$' + Number(p.bonusGiven30d || 0).toLocaleString('es-AR') + '</td>';
        html += '<td><strong style="color:' + netColor + ';">$' + Number(p.netToHouse30d || 0).toLocaleString('es-AR') + '</strong></td>';
        html += '<td>' + claimsCell + '</td>';
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
// renderPlaybook() fue eliminada: la información del playbook ahora se muestra
// integrada en renderUrgentFocus() y renderTierDeepDive() dentro del tab
// "Segmentación + Recuperación", para que todo viva en un solo recuadro.

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
            const delivered = d.pushDelivered != null ? d.pushDelivered : d.sentCount;
            const failed = d.pushFailed || 0;
            const skipped = d.skipped || 0;
            let msg = '✅ Push enviado a ' + d.sentCount + ' jugadores';
            if (delivered != null) msg += ' (' + delivered + ' entregados';
            if (failed > 0) msg += ', ' + failed + ' con token inválido';
            if (delivered != null) msg += ')';
            if (skipped > 0) msg += '. ' + skipped + ' en cooldown 7d.';
            if (d.sendError) msg = '⚠️ Push registrado pero envío falló: ' + d.sendError;
            showToast(msg, d.sendError ? 'error' : 'success');
        } else {
            showToast(d.message || 'No se pudo enviar', 'error');
        }
    }).catch(() => showToast('Error de conexión', 'error'));
}

// ============================================
// IMPORT DE LÍNEAS DESDE DRIVE / .XLSX — UI removida temporalmente.
// Los endpoints siguen vivos en el backend (/api/admin/user-lines/import,
// /clear-team, /stats). Cuando se rearme la UI, recrear: resetLineImportForm,
// loadLineImportStats, _readLineImportFileBuffer, _sendLineImport,
// previewLineImport, confirmLineImport, renderLineImportResult,
// clearTeamLineAssignments. Y las funciones por slot: toggleSlotImport,
// previewSlotImport, confirmSlotImport, renderSlotImportResult,
// refreshSlotImportStats, _readSlotInputs.
// ============================================

// TAB "🎁 REGALOS" — analítica completa de Money Giveaways
// ============================================
const _giveawayStatusBadge = {
    active: '🟢 Activo',
    closed_expired: '⏱️ Vencido',
    closed_budget: '💸 $ agotado',
    closed_max: '👥 Cupo agotado',
    cancelled: '🚫 Cancelado'
};
const _giveawayStatusColor = {
    active: '#25d366',
    closed_expired: '#ffaa00',
    closed_budget: '#ff7f50',
    closed_max: '#9b30ff',
    cancelled: '#666'
};

async function loadGiveawaysHistory() {
    const c = document.getElementById('giveawayHistoryContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';

    const params = new URLSearchParams();
    const from = document.getElementById('giveawayFilterFrom').value;
    const to = document.getElementById('giveawayFilterTo').value;
    const status = document.getElementById('giveawayFilterStatus').value;
    const prefix = document.getElementById('giveawayFilterPrefix').value;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status) params.set('status', status);
    if (prefix) params.set('prefix', prefix.trim());
    params.set('limit', '200');

    try {
        const r = await authFetch('/api/admin/giveaways/history?' + params.toString());
        if (!r.ok) { c.innerHTML = '<div class="empty-state">Error cargando.</div>'; return; }
        const d = await r.json();
        renderGiveawayMetrics(d.totals || {});
        renderGiveawayHistoryTable(c, d.giveaways || []);
        // Cerramos cualquier drill-down previo (los IDs viejos ya no existen)
        const dd = document.getElementById('giveawayDrillDown');
        if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state">Error de conexión.</div>';
    }
}

function renderGiveawayMetrics(totals) {
    const el = document.getElementById('giveawayTopMetrics');
    if (!el) return;
    const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
    let html = '';
    html += _bigChip('🎁 Regalos en el rango', String(totals.totalGiveaways || 0),
        'Cantidad de campañas',
        '#c89bff');
    html += _bigChip('💰 Total regalado', fmtMoney(totals.totalGiven),
        'De ' + fmtMoney(totals.totalBudgetSet) + ' presupuestado',
        '#ff7f50');
    html += _bigChip('🎯 Reclamos totales', String(totals.totalClaims || 0),
        'Suma de claims (no únicos)',
        '#25d366');
    html += _bigChip('👥 Usuarios únicos que reclamaron', String(totals.uniqueClaimers || 0),
        'Reclamaron al menos 1 vez en el rango',
        '#ffd700');
    el.innerHTML = html;
}

function renderGiveawayHistoryTable(container, giveaways) {
    if (giveaways.length === 0) {
        container.innerHTML = '<div class="empty-state">No hay regalos en el rango filtrado.</div>';
        return;
    }
    const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
    const fmtDate = (d) => d ? new Date(d).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const fmtDuration = (mins) => {
        if (mins == null) return '—';
        if (mins < 1) return '< 1 min';
        if (mins < 60) return mins + ' min';
        if (mins < 1440) return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'min';
        return Math.floor(mins / 1440) + ' días';
    };

    let html = '<table class="report-table"><thead><tr>';
    html += '<th>Fecha</th><th>Monto/persona</th><th>Cap personas</th><th>Cap $</th><th>Reclamados</th><th>$ dado</th><th>Tiempo hasta agotar</th><th>Estado</th><th>Prefijo</th><th></th>';
    html += '</tr></thead><tbody>';
    for (const g of giveaways) {
        const claimedRatio = (g.maxClaims > 0)
            ? '<strong>' + (g.claimedCount || 0) + '</strong> / ' + g.maxClaims + ' <small style="color:#888;">(' + (g.claimedPct || 0) + '%)</small>'
            : '—';
        const givenRatio = (g.totalBudget > 0)
            ? '<strong>' + fmtMoney(g.totalGiven) + '</strong> / ' + fmtMoney(g.totalBudget) + ' <small style="color:#888;">(' + (g.budgetPct || 0) + '%)</small>'
            : '—';
        const statusBadge = _giveawayStatusBadge[g.status] || g.status;
        const statusColor = _giveawayStatusColor[g.status] || '#888';
        const duration = (g.status !== 'active') ? fmtDuration(g.durationToCloseMinutes) : '<small style="color:#25d366;">⏳ activo</small>';
        const prefix = g.prefix ? '<code style="background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:3px;font-size:11px;">' + escapeHtml(g.prefix) + '</code>' : '<small style="color:#888;">todos</small>';

        html += '<tr>';
        html += '<td><small>' + fmtDate(g.createdAt) + '</small></td>';
        html += '<td><strong style="color:#ffd700;">' + fmtMoney(g.amount) + '</strong></td>';
        html += '<td>' + (g.maxClaims || 0) + '</td>';
        html += '<td>' + fmtMoney(g.totalBudget) + '</td>';
        html += '<td>' + claimedRatio + '</td>';
        html += '<td>' + givenRatio + '</td>';
        html += '<td>' + duration + '</td>';
        html += '<td><span style="color:' + statusColor + ';font-weight:700;">' + statusBadge + '</span></td>';
        html += '<td>' + prefix + '</td>';
        html += '<td><button onclick="showGiveawayDrillDown(\'' + escapeHtml(g.id) + '\')" style="padding:5px 10px;background:rgba(155,48,255,0.15);border:1px solid rgba(155,48,255,0.40);color:#c89bff;border-radius:5px;cursor:pointer;font-size:11px;font-weight:700;">👁️ Ver claims</button></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

async function showGiveawayDrillDown(giveawayId) {
    const dd = document.getElementById('giveawayDrillDown');
    if (!dd) return;
    dd.style.display = 'block';
    dd.innerHTML = '<div style="padding:14px;color:#888;">⏳ Cargando claims…</div>';

    try {
        const r = await authFetch('/api/admin/giveaways/' + encodeURIComponent(giveawayId) + '/claims');
        if (!r.ok) { dd.innerHTML = '<div style="padding:14px;color:#ff5050;">Error cargando claims.</div>'; return; }
        const d = await r.json();
        const g = d.giveaway || {};
        const claims = d.claims || [];
        const velocity = d.claimVelocity;

        const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
        const fmtDate = (s) => s ? new Date(s).toLocaleString('es-AR') : '—';

        let html = '<div style="background:rgba(155,48,255,0.06);border:1px solid rgba(155,48,255,0.30);border-radius:12px;padding:14px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">';
        html += '<div>';
        html += '<div style="color:#c89bff;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">🎁 Detalle del regalo · ' + fmtDate(g.createdAt) + '</div>';
        html += '<div style="color:#fff;font-size:14px;margin-top:4px;">' + fmtMoney(g.amount) + ' por persona · ' + (g.maxClaims || 0) + ' personas máx · ' + fmtMoney(g.totalBudget) + ' presupuesto</div>';
        if (g.prefix) html += '<div style="color:#888;font-size:11px;margin-top:2px;">Target: <code>' + escapeHtml(g.prefix) + '</code></div>';
        html += '</div>';
        html += '<button onclick="closeGiveawayDrillDown()" style="background:transparent;border:1px solid rgba(255,255,255,0.20);color:#aaa;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:11px;">✕ Cerrar</button>';
        html += '</div>';

        if (velocity) {
            html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;font-size:11px;">';
            html += '<span style="background:rgba(0,0,0,0.40);padding:5px 10px;border-radius:5px;color:#ddd;">Primer reclamo: <strong style="color:#25d366;">' + velocity.firstClaimMinutes + ' min</strong> después</span>';
            html += '<span style="background:rgba(0,0,0,0.40);padding:5px 10px;border-radius:5px;color:#ddd;">Último reclamo: <strong style="color:#ffd700;">' + velocity.lastClaimMinutes + ' min</strong> después</span>';
            html += '<span style="background:rgba(0,0,0,0.40);padding:5px 10px;border-radius:5px;color:#ddd;">Velocidad: <strong style="color:#c89bff;">' + velocity.avgPerMinute + ' claims/min</strong></span>';
            html += '</div>';
        }

        if (claims.length === 0) {
            html += '<div style="color:#888;padding:20px;text-align:center;">Nadie reclamó este regalo.</div>';
        } else {
            html += '<div style="max-height:400px;overflow-y:auto;background:rgba(0,0,0,0.30);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">';
            html += '<table class="report-table" style="margin:0;">';
            html += '<thead style="position:sticky;top:0;background:rgba(0,0,0,0.85);"><tr><th>#</th><th>Usuario</th><th>Reclamado</th><th>Monto</th><th>Estado</th></tr></thead>';
            html += '<tbody>';
            claims.forEach((c, i) => {
                const minSinceStart = g.createdAt
                    ? Math.round((new Date(c.claimedAt) - new Date(g.createdAt)) / 60000)
                    : null;
                const sinceStart = (minSinceStart != null) ? ' <small style="color:#888;">(+' + minSinceStart + ' min)</small>' : '';
                const statusBadge = c.status === 'completed'
                    ? '<span style="color:#25d366;">✓ OK</span>'
                    : '<span style="color:#ff5050;" title="' + escapeHtml(c.creditError || '') + '">⚠ ' + c.status + '</span>';
                html += '<tr>';
                html += '<td>' + (i + 1) + '</td>';
                html += '<td><strong style="color:#fff;">' + escapeHtml(c.username) + '</strong></td>';
                html += '<td><small>' + fmtDate(c.claimedAt) + sinceStart + '</small></td>';
                html += '<td>' + fmtMoney(c.amount) + '</td>';
                html += '<td>' + statusBadge + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            html += '</div>';
        }

        html += '</div>';
        dd.innerHTML = html;
        // Scroll suave hacia el drill-down
        dd.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        console.error(e);
        dd.innerHTML = '<div style="padding:14px;color:#ff5050;">Error de conexión.</div>';
    }
}

function closeGiveawayDrillDown() {
    const dd = document.getElementById('giveawayDrillDown');
    if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
}

// Descarga el .xlsx con el plan semanal de recuperación.
async function downloadRecoveryPlan() {
    const btn = document.getElementById('downloadRecoveryPlanBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = '⏳ Generando…'; }
    try {
        const r = await fetch(API_URL + '/api/admin/stats/recovery-export.xlsx', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        if (r.status === 401) { handleLogout(); return; }
        if (!r.ok) {
            // El server devuelve JSON con error si algo falla (ej: 0 recuperables o falta xlsx).
            const ct = r.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                const d = await r.json();
                showToast(d.error || 'Error generando el plan', 'error');
            } else {
                showToast('Error generando el plan (status ' + r.status + ')', 'error');
            }
            return;
        }
        // 200 OK con .xlsx — disparamos descarga via blob.
        const blob = await r.blob();
        const today = new Date().toISOString().slice(0, 10);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'plan-recuperacion-' + today + '.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ Plan descargado', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error de conexión', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '📥 Descargar plan (.xlsx)'; }
    }
}

// Modal con detalle de reclamos de un usuario específico (desde la tab Jugadores).
async function showUserGiveawayDetail(username) {
    try {
        const r = await authFetch('/api/admin/giveaways/user/' + encodeURIComponent(username));
        if (!r.ok) { showToast('Error cargando detalle', 'error'); return; }
        const d = await r.json();

        const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
        const fmtDate = (s) => s ? new Date(s).toLocaleString('es-AR') : '—';

        let body = '🎁 ' + (d.claimsCount || 0) + ' reclamos · ' + fmtMoney(d.totalClaimed) + ' total\\n\\n';
        if ((d.claims || []).length === 0) {
            body += 'Sin reclamos.';
        } else {
            for (const c of d.claims.slice(0, 20)) {
                body += fmtDate(c.claimedAt) + ' — ' + fmtMoney(c.amount);
                if (c.giveaway && c.giveaway.prefix) body += ' (target: ' + c.giveaway.prefix + ')';
                body += '\\n';
            }
            if (d.claims.length > 20) body += '\\n…y ' + (d.claims.length - 20) + ' más';
        }
        // Modal nativo (alert) — el mensaje ya es suficientemente compacto.
        // Si querés modal HTML rico, lo armo en una segunda iteración.
        alert('Detalle de reclamos de ' + username + '\\n\\n' + body);
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

// =====================================================================
// IMPORT EXACTO DE LÍNEA POR LISTADO (.xlsx con 1 columna de usernames)
// =====================================================================
//
// Flujo: el admin carga equipo + etiqueta + teléfono + archivo, hace
// "Vista previa" (dryRun=true) para ver cuántos matchean / no matchean,
// y recién ahí "Confirmar" (dryRun=false) ejecuta los updates en la DB.
//
// El backend valida y reporta. La UI solo orquesta y muestra resultados.

let _exactImportLastFile = null; // archivo cacheado entre preview y confirm

function _exactImportFormValid() {
    const team = (document.getElementById('exactImportTeam').value || '').trim();
    const phone = (document.getElementById('exactImportPhone').value || '').trim();
    const fileInput = document.getElementById('exactImportFile');
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!team) { showToast('Falta el nombre del equipo', 'error'); return null; }
    if (!phone) { showToast('Falta el teléfono de la línea', 'error'); return null; }
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.length < 7) { showToast('Teléfono inválido (faltan dígitos)', 'error'); return null; }
    if (!file) { showToast('Subí un archivo .xlsx', 'error'); return null; }
    if (file.size > 10 * 1024 * 1024) { showToast('El archivo es muy grande (>10MB)', 'error'); return null; }
    const label = (document.getElementById('exactImportLabel').value || '').trim();
    return { team, label, phone: digits, file };
}

async function _exactImportRequest(dryRun) {
    const data = _exactImportFormValid();
    if (!data) return null;
    _exactImportLastFile = data.file;

    const params = new URLSearchParams();
    params.set('teamName', data.team);
    if (data.label) params.set('lineLabel', data.label);
    params.set('linePhone', '+' + data.phone);
    params.set('dryRun', dryRun ? 'true' : 'false');

    try {
        const r = await authFetch('/api/admin/user-lines/import-exact?' + params.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: data.file
        });
        const j = await r.json();
        if (!r.ok || !j.success) {
            const msg = (j && j.error) || ('HTTP ' + r.status);
            showToast('Error: ' + msg, 'error');
            return null;
        }
        return j;
    } catch (e) {
        console.error('exactImport error:', e);
        showToast('Error de conexión', 'error');
        return null;
    }
}

async function exactImportPreview() {
    const out = document.getElementById('exactImportResult');
    if (out) out.innerHTML = '<div style="color:#aaa;font-size:12px;">⏳ Procesando archivo…</div>';

    const j = await _exactImportRequest(true);
    if (!j) {
        if (out) out.innerHTML = '';
        const btn = document.getElementById('exactImportConfirmBtn');
        if (btn) { btn.disabled = true; btn.style.cursor = 'not-allowed'; btn.style.opacity = '0.5'; }
        return;
    }
    _renderExactImportResult(j, true);
    // Habilitar el botón confirmar.
    const btn = document.getElementById('exactImportConfirmBtn');
    if (btn) { btn.disabled = false; btn.style.cursor = 'pointer'; btn.style.opacity = '1'; }
}

async function exactImportConfirm() {
    if (!_exactImportLastFile) {
        showToast('Hacé primero la vista previa', 'error');
        return;
    }
    const ok = window.confirm('¿Confirmás la importación? Esto va a modificar los usuarios matched.');
    if (!ok) return;

    const out = document.getElementById('exactImportResult');
    if (out) out.innerHTML = '<div style="color:#aaa;font-size:12px;">⏳ Escribiendo en la DB…</div>';

    const j = await _exactImportRequest(false);
    if (!j) {
        if (out) out.innerHTML = '';
        return;
    }
    _renderExactImportResult(j, false);
    showToast('✅ Importación completada', 'success');
    // Bloquear de nuevo el botón hasta que se haga otra preview.
    const btn = document.getElementById('exactImportConfirmBtn');
    if (btn) { btn.disabled = true; btn.style.cursor = 'not-allowed'; btn.style.opacity = '0.5'; }
}

function _renderExactImportResult(j, isPreview) {
    const out = document.getElementById('exactImportResult');
    if (!out) return;
    const s = j.summary || {};
    const matched = s.matched || 0;
    const pending = s.notFound || 0; // los renombramos: "pendientes para futuros registros"
    const total = s.uniqueUsernames || 0;
    const reassigned = s.reassignedFromOtherLine || 0;
    const sameLine = s.alreadyOnSameLine || 0;

    let html = '<div style="background:rgba(0,0,0,0.3);border:1px solid rgba(0,212,255,0.30);border-radius:10px;padding:12px;">';
    html += '<div style="color:#00d4ff;font-weight:700;font-size:13px;margin-bottom:8px;">';
    html += isPreview ? '👁 Vista previa' : '✅ Importación ejecutada';
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">';
    html += '<div><span style="color:#888;">Equipo:</span> <strong style="color:#fff;">' + escapeHtml(j.teamName || '—') + '</strong></div>';
    html += '<div><span style="color:#888;">Teléfono:</span> <strong style="color:#ffd700;font-family:monospace;">' + escapeHtml(j.linePhone || '—') + '</strong></div>';
    html += '<div><span style="color:#888;">Total filas leídas:</span> <strong style="color:#fff;">' + (s.totalRowsRead || 0) + '</strong></div>';
    html += '<div><span style="color:#888;">Únicos a importar:</span> <strong style="color:#fff;">' + total + '</strong></div>';
    html += '</div>';

    // Resaltar el split en dos bloques claros para que se entienda que ambos
    // grupos quedan "asignados a la línea", solo que uno aplica ya y el otro
    // cuando se registren.
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">';
    // Bloque 1: ya registrados, asignación inmediata
    html += '<div style="background:rgba(37,211,102,0.06);border:1px solid rgba(37,211,102,0.30);border-radius:8px;padding:10px;">';
    html += '<div style="color:#25d366;font-weight:700;font-size:11px;margin-bottom:4px;">✅ Ya registrados</div>';
    html += '<div style="color:#fff;font-size:18px;font-weight:800;">' + matched + '</div>';
    html += '<div style="color:#888;font-size:10px;line-height:1.4;margin-top:3px;">Se les asigna la línea ahora mismo.</div>';
    html += '</div>';
    // Bloque 2: pendientes para futuros registros (lo que antes decía "no encontrados")
    html += '<div style="background:rgba(255,170,68,0.06);border:1px solid rgba(255,170,68,0.30);border-radius:8px;padding:10px;">';
    html += '<div style="color:#ffaa44;font-weight:700;font-size:11px;margin-bottom:4px;">⏳ Pre-asignados</div>';
    html += '<div style="color:#fff;font-size:18px;font-weight:800;">' + pending + '</div>';
    html += '<div style="color:#888;font-size:10px;line-height:1.4;margin-top:3px;">Quedan en lista de espera. Cuando uno de ellos entre por primera vez, ve esta línea automáticamente.</div>';
    html += '</div>';
    html += '</div>';

    if (reassigned > 0 || sameLine > 0) {
        html += '<div style="margin-top:8px;font-size:11px;color:#aaa;line-height:1.5;">';
        if (reassigned > 0) {
            html += '<div>↻ <strong style="color:#ffaa44;">' + reassigned + '</strong> ya tenían otra línea — los pasamos a esta.</div>';
        }
        if (sameLine > 0) {
            html += '<div>≡ ' + sameLine + ' ya estaban en esta misma línea (sin cambios).</div>';
        }
        html += '</div>';
    }

    if (pending > 0 && Array.isArray(j.notFoundSample) && j.notFoundSample.length > 0) {
        html += '<details style="margin-top:10px;"><summary style="cursor:pointer;color:#ffaa44;font-size:12px;">Ver muestra de pre-asignados (' + j.notFoundSample.length + ')</summary>';
        html += '<div style="background:rgba(0,0,0,0.4);border-radius:6px;padding:8px;margin-top:6px;font-family:monospace;font-size:11px;color:#ccc;max-height:180px;overflow-y:auto;">';
        for (const item of j.notFoundSample) {
            html += escapeHtml(item.username) + '<br>';
        }
        html += '</div></details>';
    }

    if (isPreview) {
        html += '<div style="margin-top:10px;padding:8px 10px;background:rgba(0,212,255,0.05);border-left:3px solid #00d4ff;border-radius:4px;color:#aaa;font-size:11px;line-height:1.5;">';
        html += '<strong style="color:#00d4ff;">¿Qué pasa al confirmar?</strong><br>';
        html += '• Los <strong style="color:#25d366;">' + matched + ' ya registrados</strong> tendrán esta línea apenas confirmes.<br>';
        html += '• Los <strong style="color:#ffaa44;">' + pending + ' pre-asignados</strong> quedan guardados en la lista de espera y reciben esta línea cuando se registren o hagan login por primera vez.';
        html += '</div>';
    } else {
        const w = j.writeResult || {};
        const lk = j.lookupResult || {};
        html += '<div style="margin-top:10px;padding:8px 10px;background:rgba(37,211,102,0.05);border-left:3px solid #25d366;border-radius:4px;color:#aaa;font-size:11px;line-height:1.5;">';
        html += '<strong style="color:#25d366;">✓ Listo.</strong> Usuarios actualizados: <strong style="color:#fff;">' + (w.modifiedCount || 0) + '</strong> · Pre-asignaciones guardadas: <strong style="color:#fff;">' + ((lk.upsertedCount || 0) + (lk.modifiedCount || 0)) + '</strong>';
        html += '</div>';
    }

    html += '</div>';
    out.innerHTML = html;
}

// Limpiar el resultado y deshabilitar el botón "confirmar" si el admin
// edita cualquier campo después de la preview (los datos podrían no
// corresponderse con el archivo cacheado).
document.addEventListener('DOMContentLoaded', () => {
    const fields = ['exactImportTeam', 'exactImportLabel', 'exactImportPhone', 'exactImportFile'];
    for (const id of fields) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('input', () => {
            const btn = document.getElementById('exactImportConfirmBtn');
            if (btn) { btn.disabled = true; btn.style.cursor = 'not-allowed'; btn.style.opacity = '0.5'; }
            const out = document.getElementById('exactImportResult');
            if (out) out.innerHTML = '';
        });
    }
});

// =====================================================================
// AUTOMATIZACIONES — sección completa (tabs: rules / pending / history / calendar)
// =====================================================================
let _autoActiveTab = 'rules';
let _autoRulesCache = [];
let _autoSuggestionsCache = [];
let _autoEditingRuleId = null;

const _autoCategoryLabels = {
    refund: '💰 Reembolsos',
    welcome: '🎁 Welcome',
    engagement: '🔥 Engagement',
    recovery: '🎯 Recovery',
    giveaway: '💸 Giveaways',
    whatsapp: '📞 WhatsApp'
};

const _autoDayOfWeekLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function loadAutomations() {
    Promise.all([_autoFetchRules(), _autoFetchSuggestions()]).then(() => {
        _autoRenderActiveTab();
        _autoUpdatePendingBadge();
    });
}

async function _autoFetchRules() {
    try {
        const r = await authFetch('/api/admin/notification-rules');
        const j = await r.json();
        _autoRulesCache = j.rules || [];
    } catch (e) { console.warn('autoFetchRules', e); }
}

async function _autoFetchSuggestions() {
    try {
        const r = await authFetch('/api/admin/notification-rules/suggestions?status=pending');
        const j = await r.json();
        _autoSuggestionsCache = j.suggestions || [];
        const badge = document.getElementById('autoPendingCountBadge');
        const navBadge = document.getElementById('automationsBadge');
        const count = j.pendingCount || 0;
        if (count > 0) {
            if (badge) { badge.textContent = String(count); badge.style.display = ''; }
            if (navBadge) { navBadge.textContent = String(count); navBadge.style.display = ''; }
        } else {
            if (badge) badge.style.display = 'none';
            if (navBadge) navBadge.style.display = 'none';
        }
    } catch (e) { console.warn('autoFetchSuggestions', e); }
}

function _autoUpdatePendingBadge() {
    const count = _autoSuggestionsCache.length;
    const badge = document.getElementById('autoPendingCountBadge');
    if (badge) {
        if (count > 0) { badge.textContent = String(count); badge.style.display = ''; }
        else badge.style.display = 'none';
    }
}

function switchAutomationsTab(tab) {
    _autoActiveTab = tab;
    document.querySelectorAll('.auto-tab-btn').forEach(b => {
        const isActive = b.getAttribute('data-tab') === tab;
        if (isActive) {
            b.style.background = 'rgba(0,212,255,0.10)';
            b.style.borderColor = 'rgba(0,212,255,0.30)';
            b.style.color = '#00d4ff';
            b.classList.add('active');
        } else {
            b.style.background = 'rgba(0,0,0,0.30)';
            b.style.borderColor = 'rgba(255,255,255,0.10)';
            b.style.color = '#aaa';
            b.classList.remove('active');
        }
    });
    _autoRenderActiveTab();
}

function _autoRenderActiveTab() {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    if (_autoActiveTab === 'rules') c.innerHTML = _autoRenderRulesTab();
    else if (_autoActiveTab === 'pending') c.innerHTML = _autoRenderPendingTab();
    else if (_autoActiveTab === 'history') _autoRenderHistoryTab();
    else if (_autoActiveTab === 'calendar') c.innerHTML = _autoRenderCalendarTab();
}

// ============= TAB: REGLAS =============
function _autoRenderRulesTab() {
    if (_autoRulesCache.length === 0) return '<div class="empty-state">No hay reglas configuradas. Refrescar la página o esperar al primer arranque.</div>';
    const byCat = {};
    for (const r of _autoRulesCache) {
        if (!byCat[r.category]) byCat[r.category] = [];
        byCat[r.category].push(r);
    }
    let html = '';
    for (const cat of Object.keys(byCat)) {
        html += '<div style="margin-bottom:18px;">';
        html += '<h3 style="color:#fff;font-size:14px;margin:0 0 10px;">' + (_autoCategoryLabels[cat] || cat) + ' <span style="color:#666;font-size:11px;font-weight:400;">' + byCat[cat].length + ' reglas</span></h3>';
        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        for (const r of byCat[cat]) {
            html += _autoRenderRuleCard(r);
        }
        html += '</div></div>';
    }
    return html;
}

function _autoRenderRuleCard(r) {
    const enabledColor = r.enabled ? '#25d366' : '#666';
    const enabledLabel = r.enabled ? 'ACTIVA' : 'PAUSADA';
    const cs = r.cronSchedule || {};
    let when = '—';
    if (r.triggerType === 'cron' && cs.hour != null) {
        const h = String(cs.hour).padStart(2, '0');
        const m = String(cs.minute || 0).padStart(2, '0');
        when = h + ':' + m;
        if (cs.dayOfWeek != null) when = _autoDayOfWeekLabels[cs.dayOfWeek] + ' ' + when;
        else if (cs.dayOfMonth != null) when = 'Día ' + cs.dayOfMonth + ' del mes ' + when;
        else when = 'Cada día ' + when;
    }
    const lastFired = r.lastFiredAt ? new Date(r.lastFiredAt).toLocaleString('es-AR') : 'Nunca';
    const bonusBadge = (r.bonus && r.bonus.type !== 'none')
        ? '<span style="background:rgba(255,170,68,0.15);color:#ffaa44;font-size:10px;padding:2px 7px;border-radius:8px;font-weight:700;margin-left:5px;">💸 ' + r.bonus.type + ' $' + (r.bonus.amount || 0) + '</span>'
        : '';
    const apprBadge = r.requiresAdminApproval
        ? '<span style="background:rgba(255,80,80,0.15);color:#ff5050;font-size:10px;padding:2px 7px;border-radius:8px;font-weight:700;margin-left:5px;">✋ Requiere aprobar</span>'
        : '';

    return '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
            '<div style="flex:1;min-width:240px;">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">' +
                    '<span style="background:rgba(0,212,255,0.20);color:#00d4ff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;">' + escapeHtml(r.code) + '</span>' +
                    '<span style="color:' + enabledColor + ';font-size:10px;font-weight:700;">' + enabledLabel + '</span>' +
                    bonusBadge + apprBadge +
                '</div>' +
                '<div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:3px;">' + escapeHtml(r.name) + '</div>' +
                '<div style="color:#888;font-size:11px;line-height:1.5;">⏰ ' + when + ' · 🎯 ' + escapeHtml(r.audienceType) + '</div>' +
                '<div style="color:#aaa;font-size:11px;margin-top:5px;font-style:italic;">"' + escapeHtml(r.title) + ' — ' + escapeHtml(r.body.slice(0, 80)) + (r.body.length > 80 ? '…' : '') + '"</div>' +
                '<div style="color:#666;font-size:10px;margin-top:5px;">Último disparo: ' + lastFired + ' · Total: ' + (r.totalFiresLifetime || 0) + ' envíos · ' + (r.totalSuggestionsLifetime || 0) + ' sugerencias</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                '<button onclick="autoToggleRule(\'' + r.id + '\')" style="padding:6px 11px;font-size:11px;font-weight:700;background:' + (r.enabled ? 'rgba(255,80,80,0.15)' : 'rgba(37,211,102,0.15)') + ';color:' + (r.enabled ? '#ff5050' : '#25d366') + ';border:1px solid currentColor;border-radius:6px;cursor:pointer;">' + (r.enabled ? '⏸ Pausar' : '▶ Activar') + '</button>' +
                '<button onclick="autoEditRule(\'' + r.id + '\')" style="padding:6px 11px;font-size:11px;font-weight:700;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);border-radius:6px;cursor:pointer;">✏ Editar</button>' +
                '<button onclick="autoTestFireRule(\'' + r.id + '\')" style="padding:6px 11px;font-size:11px;font-weight:700;background:rgba(155,48,255,0.15);color:#c89bff;border:1px solid rgba(155,48,255,0.40);border-radius:6px;cursor:pointer;">🧪 Probar</button>' +
            '</div>' +
        '</div>' +
    '</div>';
}

async function autoToggleRule(id) {
    const r = _autoRulesCache.find(x => x.id === id);
    if (!r) return;
    try {
        const resp = await authFetch('/api/admin/notification-rules/' + id, {
            method: 'PATCH',
            body: JSON.stringify({ enabled: !r.enabled })
        });
        const j = await resp.json();
        if (j.success) {
            showToast(j.rule.enabled ? '▶ Regla activada' : '⏸ Regla pausada', 'success');
            await _autoFetchRules();
            _autoRenderActiveTab();
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

function autoEditRule(id) {
    const r = _autoRulesCache.find(x => x.id === id);
    if (!r) return;
    _autoEditingRuleId = id;
    const modal = document.getElementById('autoRuleEditModal');
    const body = document.getElementById('autoRuleEditBody');
    if (!modal || !body) return;
    body.innerHTML =
        '<div style="margin-bottom:10px;color:#888;font-size:11px;"><strong>' + escapeHtml(r.code) + '</strong> · ' + escapeHtml(r.name) + '</div>' +
        '<label style="display:block;color:#aaa;font-size:11px;margin-bottom:4px;">Título</label>' +
        '<input type="text" id="autoEditTitle" value="' + escapeHtml(r.title) + '" maxlength="60" style="width:100%;padding:9px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;box-sizing:border-box;margin-bottom:10px;">' +
        '<label style="display:block;color:#aaa;font-size:11px;margin-bottom:4px;">Cuerpo del mensaje</label>' +
        '<textarea id="autoEditBody" maxlength="180" style="width:100%;padding:9px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;box-sizing:border-box;margin-bottom:10px;min-height:80px;">' + escapeHtml(r.body) + '</textarea>' +
        '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
            '<div style="flex:1;"><label style="display:block;color:#aaa;font-size:11px;margin-bottom:4px;">Hora ART (0-23)</label><input type="number" id="autoEditHour" value="' + ((r.cronSchedule && r.cronSchedule.hour) || 0) + '" min="0" max="23" style="width:100%;padding:9px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;box-sizing:border-box;"></div>' +
            '<div style="flex:1;"><label style="display:block;color:#aaa;font-size:11px;margin-bottom:4px;">Minuto</label><input type="number" id="autoEditMinute" value="' + ((r.cronSchedule && r.cronSchedule.minute) || 0) + '" min="0" max="59" style="width:100%;padding:9px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;box-sizing:border-box;"></div>' +
        '</div>' +
        '<label style="display:block;color:#aaa;font-size:11px;margin-bottom:4px;">Cooldown (minutos por usuario, default 1440 = 24h)</label>' +
        '<input type="number" id="autoEditCooldown" value="' + (r.cooldownMinutes || 1440) + '" min="0" style="width:100%;padding:9px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;box-sizing:border-box;">';
    modal.style.display = 'flex';
}

function closeAutoRuleEdit() {
    const modal = document.getElementById('autoRuleEditModal');
    if (modal) modal.style.display = 'none';
    _autoEditingRuleId = null;
}

async function saveAutoRuleEdit() {
    if (!_autoEditingRuleId) return;
    const title = document.getElementById('autoEditTitle')?.value?.trim();
    const body = document.getElementById('autoEditBody')?.value?.trim();
    const hour = Number(document.getElementById('autoEditHour')?.value);
    const minute = Number(document.getElementById('autoEditMinute')?.value);
    const cooldown = Number(document.getElementById('autoEditCooldown')?.value);
    if (!title || !body) { showToast('Falta título o cuerpo', 'error'); return; }
    if (!isFinite(hour) || hour < 0 || hour > 23) { showToast('Hora inválida', 'error'); return; }
    try {
        const resp = await authFetch('/api/admin/notification-rules/' + _autoEditingRuleId, {
            method: 'PATCH',
            body: JSON.stringify({
                title, body,
                cronSchedule: {
                    hour, minute,
                    dayOfWeek: _autoRulesCache.find(r => r.id === _autoEditingRuleId)?.cronSchedule?.dayOfWeek,
                    dayOfMonth: _autoRulesCache.find(r => r.id === _autoEditingRuleId)?.cronSchedule?.dayOfMonth
                },
                cooldownMinutes: cooldown
            })
        });
        const j = await resp.json();
        if (j.success) {
            showToast('✅ Cambios guardados', 'success');
            closeAutoRuleEdit();
            await _autoFetchRules();
            _autoRenderActiveTab();
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function autoTestFireRule(id) {
    try {
        const resp = await authFetch('/api/admin/notification-rules/' + id + '/test-fire', { method: 'POST' });
        const j = await resp.json();
        if (j.success) {
            const sample = (j.audienceSample || []).slice(0, 5).join(', ');
            alert('🧪 Dry run\\nRegla: ' + j.ruleCode + '\\nAudiencia resuelta: ' + j.audienceCount + ' usuarios\\n\\nMuestra: ' + (sample || '(vacío)') + '\\n\\nNo se envió nada.');
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// ============= TAB: PENDIENTES =============
function _autoRenderPendingTab() {
    if (_autoSuggestionsCache.length === 0) {
        return '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">✅ Sin sugerencias pendientes. Cuando una regla con bonus dispare, aparecerá acá.</div>';
    }
    let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
    for (const s of _autoSuggestionsCache) {
        const ageMin = Math.floor((Date.now() - new Date(s.suggestedAt).getTime()) / 60000);
        const expHours = Math.max(0, Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 3600000));
        const bonusText = (s.bonus && s.bonus.type !== 'none')
            ? '💸 ' + s.bonus.type + ' $' + s.bonus.amount + ' x ' + s.audienceCount + ' usuarios = $' + (s.bonus.amount * s.audienceCount).toLocaleString('es-AR') + ' total'
            : '📢 Sin bonus, solo push';
        html += '<div style="background:rgba(255,170,68,0.05);border:1px solid rgba(255,170,68,0.30);border-radius:10px;padding:14px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
                '<div style="flex:1;min-width:240px;">' +
                    '<div style="margin-bottom:5px;"><span style="background:rgba(0,212,255,0.20);color:#00d4ff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;">' + escapeHtml(s.ruleCode) + '</span> <span style="color:#888;font-size:11px;margin-left:4px;">hace ' + ageMin + ' min</span></div>' +
                    '<div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:3px;">' + escapeHtml(s.ruleName) + '</div>' +
                    '<div style="color:#aaa;font-size:11px;margin-bottom:6px;font-style:italic;">"' + escapeHtml(s.title) + ' — ' + escapeHtml(s.body) + '"</div>' +
                    '<div style="color:#ffaa44;font-size:11px;font-weight:700;margin-bottom:3px;">' + bonusText + '</div>' +
                    '<div style="color:#888;font-size:10px;">Audiencia: ' + s.audienceCount + ' usuarios · Expira en ' + expHours + 'h</div>' +
                '</div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                    '<button onclick="autoApproveSuggestion(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;border-radius:7px;cursor:pointer;">✅ Aprobar y enviar</button>' +
                    '<button onclick="autoRejectSuggestion(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:rgba(255,80,80,0.15);color:#ff5050;border:1px solid rgba(255,80,80,0.40);border-radius:7px;cursor:pointer;">❌ Descartar</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
}

async function autoApproveSuggestion(id) {
    const s = _autoSuggestionsCache.find(x => x.id === id);
    if (!s) return;
    const bonusInfo = (s.bonus && s.bonus.type !== 'none')
        ? '\\n\\nESTA APROBACIÓN VA A CREAR UN ' + s.bonus.type.toUpperCase() + ' DE $' + s.bonus.amount + ' POR USUARIO.\\nTotal posible: $' + (s.bonus.amount * s.audienceCount).toLocaleString('es-AR')
        : '';
    if (!confirm('¿Aprobar y enviar?\\n\\n' + s.audienceCount + ' usuarios recibirán: "' + s.title + '"' + bonusInfo)) return;
    try {
        const resp = await authFetch('/api/admin/notification-rules/suggestions/' + id + '/approve', { method: 'POST' });
        const j = await resp.json();
        if (j.success) {
            let msg = '✅ Push enviado · ' + (j.pushDelivered || 0) + ' entregados, ' + (j.pushFailed || 0) + ' con token inválido';
            if (j.giveawayId) msg += ' · Giveaway creado';
            if (j.sendError) msg = '⚠️ Aprobada pero envío falló: ' + j.sendError;
            showToast(msg, j.sendError ? 'error' : 'success');
            await _autoFetchSuggestions();
            _autoRenderActiveTab();
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function autoRejectSuggestion(id) {
    const reason = prompt('Razón del descarte (opcional):', '');
    if (reason === null) return;
    try {
        const resp = await authFetch('/api/admin/notification-rules/suggestions/' + id + '/reject', {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
        const j = await resp.json();
        if (j.success) {
            showToast('Descartada', 'info');
            await _autoFetchSuggestions();
            _autoRenderActiveTab();
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// ============= TAB: HISTORIAL =============
async function _autoRenderHistoryTab() {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando historial…</div>';
    try {
        const r = await authFetch('/api/admin/notification-rules/suggestions?status=all');
        const j = await r.json();
        const all = (j.suggestions || []).filter(s => s.status !== 'pending');
        if (all.length === 0) {
            c.innerHTML = '<div class="empty-state">Sin historial todavía.</div>';
            return;
        }
        let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<thead><tr style="background:rgba(0,212,255,0.05);"><th style="padding:8px;text-align:left;color:#00d4ff;">Fecha</th><th style="padding:8px;text-align:left;color:#00d4ff;">Regla</th><th style="padding:8px;text-align:left;color:#00d4ff;">Estado</th><th style="padding:8px;text-align:right;color:#00d4ff;">Audiencia</th><th style="padding:8px;text-align:right;color:#00d4ff;">Entregados</th><th style="padding:8px;text-align:left;color:#00d4ff;">Por</th></tr></thead><tbody>';
        for (const s of all.slice(0, 100)) {
            const dt = new Date(s.suggestedAt).toLocaleString('es-AR');
            const statusColor = s.status === 'approved' ? '#25d366' : s.status === 'rejected' ? '#ff5050' : '#888';
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                '<td style="padding:7px;color:#aaa;">' + dt + '</td>' +
                '<td style="padding:7px;color:#fff;">' + escapeHtml(s.ruleCode) + ' — ' + escapeHtml(s.ruleName) + '</td>' +
                '<td style="padding:7px;color:' + statusColor + ';font-weight:700;">' + s.status + '</td>' +
                '<td style="padding:7px;color:#fff;text-align:right;">' + s.audienceCount + '</td>' +
                '<td style="padding:7px;color:#25d366;text-align:right;">' + (s.pushDelivered != null ? s.pushDelivered : '—') + '</td>' +
                '<td style="padding:7px;color:#888;">' + escapeHtml(s.resolvedBy || 'auto') + '</td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div class="empty-state">❌ Error cargando historial</div>';
    }
}

// ============= TAB: CALENDARIO =============
function _autoRenderCalendarTab() {
    // Vista de la semana: para cada día, listar las reglas que disparan ese día.
    const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const dayIdx = [1, 2, 3, 4, 5, 6, 0];
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">';
    for (let i = 0; i < days.length; i++) {
        const dow = dayIdx[i];
        html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">';
        html += '<h4 style="color:#00d4ff;font-size:12px;margin:0 0 8px;text-transform:uppercase;">' + days[i] + '</h4>';
        const dayRules = _autoRulesCache.filter(r => {
            if (!r.enabled || r.triggerType !== 'cron') return false;
            const cs = r.cronSchedule || {};
            if (cs.dayOfWeek != null) return cs.dayOfWeek === dow;
            if (cs.dayOfMonth != null) return false; // no aparecen en el grid semanal
            return true; // todos los días
        }).sort((a, b) => ((a.cronSchedule.hour || 0) - (b.cronSchedule.hour || 0)));
        if (dayRules.length === 0) {
            html += '<div style="color:#666;font-size:11px;font-style:italic;">Sin reglas</div>';
        } else {
            for (const r of dayRules) {
                const cs = r.cronSchedule || {};
                const time = String(cs.hour).padStart(2, '0') + ':' + String(cs.minute || 0).padStart(2, '0');
                html += '<div style="margin-bottom:6px;font-size:11px;line-height:1.4;">' +
                    '<span style="color:#ffd700;font-weight:700;font-family:monospace;">' + time + '</span> ' +
                    '<span style="color:#fff;">' + escapeHtml(r.code) + '</span> ' +
                    '<span style="color:#888;">' + escapeHtml(r.title.slice(0, 22)) + '</span>' +
                '</div>';
            }
        }
        html += '</div>';
    }
    html += '</div>';

    // Reglas mensuales (por dayOfMonth) listadas aparte.
    const monthly = _autoRulesCache.filter(r => r.enabled && r.triggerType === 'cron' && r.cronSchedule && r.cronSchedule.dayOfMonth != null);
    if (monthly.length > 0) {
        html += '<div style="margin-top:18px;background:rgba(155,48,255,0.05);border:1px solid rgba(155,48,255,0.20);border-radius:10px;padding:12px;">';
        html += '<h4 style="color:#c89bff;font-size:13px;margin:0 0 10px;">📅 Reglas mensuales (por día del mes)</h4>';
        for (const r of monthly) {
            const cs = r.cronSchedule || {};
            html += '<div style="margin-bottom:5px;font-size:12px;color:#fff;">' +
                '<strong>Día ' + cs.dayOfMonth + ' a las ' + String(cs.hour).padStart(2, '0') + ':' + String(cs.minute || 0).padStart(2, '0') + '</strong> · ' +
                escapeHtml(r.code) + ' — ' + escapeHtml(r.name) +
            '</div>';
        }
        html += '</div>';
    }

    return html;
}

// Refresh global del badge cada 60s mientras la sesión está abierta.
setInterval(() => {
    if (typeof currentToken !== 'undefined' && currentToken) {
        _autoFetchSuggestions().then(() => _autoUpdatePendingBadge()).catch(() => {});
    }
}, 60 * 1000);

// =====================================================================
// EQUIPOS — stats agregados por equipo (con desglose por línea)
// =====================================================================
let _teamsCache = null;
const _teamsExpanded = new Set(); // equipos cuyo desglose está abierto

async function loadTeams() {
    const list = document.getElementById('teamsList');
    if (list) list.innerHTML = '<div class="empty-state">⏳ Cargando estadísticas…</div>';
    try {
        const r = await authFetch('/api/admin/teams/stats');
        if (!r.ok) {
            if (list) list.innerHTML = '<div class="empty-state">❌ Error cargando equipos</div>';
            return;
        }
        const j = await r.json();
        _teamsCache = j;
        _renderTeamsSummary(j);
        _renderTeamsList(j);
    } catch (e) {
        console.error('loadTeams error:', e);
        if (list) list.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function _renderTeamsSummary(j) {
    const el = document.getElementById('teamsSummary');
    if (!el) return;
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    const totalPending = (j.teams || []).reduce((s, t) => s + (t.pendingPreAssigned || 0), 0);

    let html = '';
    html += _teamsChip('Total usuarios', fmt(j.totalUsers || 0), '#fff', 'En toda la plataforma');
    html += _teamsChip('Con equipo asignado', fmt(j.totalWithTeam || 0), '#25d366', 'Ya están en algún equipo');
    html += _teamsChip('Sin equipo', fmt(j.totalWithoutTeam || 0), '#ff8888', 'Caen al número genérico');
    html += _teamsChip('Pre-asignados (esperando)', fmt(totalPending), '#ffaa44', 'Listados pero todavía no se registraron');
    el.innerHTML = html;
}

function _teamsChip(label, value, color, sub) {
    return '<div style="flex:1;min-width:180px;background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;">' +
        '<div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">' + escapeHtml(label) + '</div>' +
        '<div style="color:' + color + ';font-size:22px;font-weight:800;line-height:1;margin-bottom:4px;">' + escapeHtml(value) + '</div>' +
        '<div style="color:#aaa;font-size:10px;">' + escapeHtml(sub) + '</div>' +
    '</div>';
}

function _renderTeamsList(j) {
    const el = document.getElementById('teamsList');
    if (!el) return;
    const teams = j.teams || [];
    if (teams.length === 0) {
        el.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:#aaa;">Todavía no hay equipos cargados. Andá a "Número principal vigente" → "Asignar línea por listado" para empezar.</div>';
        return;
    }

    let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
    for (const t of teams) {
        const isExpanded = _teamsExpanded.has(t.teamName);
        html += _renderTeamCard(t, isExpanded);
    }
    html += '</div>';
    el.innerHTML = html;
}

function _renderTeamCard(t, isExpanded) {
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    const hasLines = Array.isArray(t.lines) && t.lines.length > 0;
    const arrowSym = isExpanded ? '▼' : '▶';

    let html = '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">';
    // Header del equipo (clickeable si tiene líneas)
    html += '<div onclick="toggleTeamExpand(\'' + escapeHtml(t.teamName).replace(/'/g, "\\'") + '\')" style="padding:14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;' + (hasLines ? '' : 'cursor:default;') + '">';
    html += '<div style="flex:1;min-width:200px;">';
    html += '<div style="color:#ffd700;font-size:16px;font-weight:800;margin-bottom:3px;">' + (hasLines ? arrowSym + ' ' : '') + escapeHtml(t.teamName) + '</div>';
    html += '<div style="color:#888;font-size:11px;">' + (t.lines.length) + ' línea' + (t.lines.length === 1 ? '' : 's') + '</div>';
    html += '</div>';
    // Stats inline
    html += '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;">';
    html += _teamStat('Asignados', fmt(t.totalUsers), '#25d366');
    if (t.pendingPreAssigned > 0) {
        html += _teamStat('Pre-asignados', fmt(t.pendingPreAssigned), '#ffaa44');
    }
    html += _teamStat('Con app+notifs', fmt(t.withChannel) + ' (' + t.channelPct + '%)', '#00d4ff');
    html += _teamStat('Activos 7d', fmt(t.activeThisWeek) + ' (' + t.activePct + '%)', '#9b30ff');
    html += '</div>';
    html += '</div>';

    // Desglose por línea (collapsable)
    if (isExpanded && hasLines) {
        html += '<div style="border-top:1px solid rgba(255,255,255,0.08);padding:12px 14px 14px;background:rgba(0,0,0,0.20);">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<thead><tr style="color:#888;text-align:left;">';
        html += '<th style="padding:6px 8px;font-weight:600;">Línea</th>';
        html += '<th style="padding:6px 8px;font-weight:600;">Teléfono</th>';
        html += '<th style="padding:6px 8px;font-weight:600;text-align:right;">Usuarios</th>';
        html += '<th style="padding:6px 8px;font-weight:600;text-align:right;">Con canal</th>';
        html += '<th style="padding:6px 8px;font-weight:600;text-align:right;">Activos 7d</th>';
        html += '</tr></thead><tbody>';
        for (const ln of t.lines) {
            const channelPct = ln.count > 0 ? Math.round((ln.withChannel / ln.count) * 100) : 0;
            const activePct = ln.count > 0 ? Math.round((ln.activeThisWeek / ln.count) * 100) : 0;
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
            html += '<td style="padding:8px;color:#fff;">' + escapeHtml(ln.fullLabel) + '</td>';
            html += '<td style="padding:8px;color:#ffd700;font-family:monospace;font-size:11px;">' + escapeHtml(ln.linePhone || '—') + '</td>';
            html += '<td style="padding:8px;color:#fff;text-align:right;font-weight:700;">' + fmt(ln.count) + '</td>';
            html += '<td style="padding:8px;color:#00d4ff;text-align:right;">' + fmt(ln.withChannel) + ' <span style="color:#666;font-size:10px;">(' + channelPct + '%)</span></td>';
            html += '<td style="padding:8px;color:#9b30ff;text-align:right;">' + fmt(ln.activeThisWeek) + ' <span style="color:#666;font-size:10px;">(' + activePct + '%)</span></td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
    }

    html += '</div>';
    return html;
}

function _teamStat(label, value, color) {
    return '<div style="text-align:center;min-width:80px;">' +
        '<div style="color:' + color + ';font-size:16px;font-weight:800;line-height:1;">' + value + '</div>' +
        '<div style="color:#888;font-size:10px;margin-top:3px;">' + escapeHtml(label) + '</div>' +
    '</div>';
}

function toggleTeamExpand(teamName) {
    if (_teamsExpanded.has(teamName)) _teamsExpanded.delete(teamName);
    else _teamsExpanded.add(teamName);
    if (_teamsCache) _renderTeamsList(_teamsCache);
}

// =====================================================================
// SLOT IMPORT — uploader inline por equipo en "Número principal vigente"
// =====================================================================
const _slotImportLastFile = {}; // i → File para confirm tras preview

function toggleSlotImport(i) {
    const panel = document.getElementById('slotImport-' + i);
    const btn = document.getElementById('slotImportToggle-' + i);
    if (!panel) return;
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? '' : 'none';
    if (btn) btn.textContent = isHidden ? '✕ Cerrar listado' : '📋 Adjuntar listado de usuarios para esta línea';
}

function _readSlotInputs(i) {
    const slot = document.querySelector(`.user-line-slot[data-slot-index="${i}"]`);
    if (!slot) return null;
    const team = (slot.querySelector('.user-line-team')?.value || '').trim();
    const phone = (slot.querySelector('.user-line-phone')?.value || '').trim();
    const fileInput = document.getElementById('slotImportFile-' + i);
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!team) { showToast('Completá "Nombre del equipo" arriba antes de subir el archivo', 'error'); return null; }
    if (!phone) { showToast('Completá "Número vigente" arriba antes de subir el archivo', 'error'); return null; }
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.length < 7) { showToast('Teléfono inválido', 'error'); return null; }
    if (!file) { showToast('Subí un archivo .xlsx', 'error'); return null; }
    if (file.size > 10 * 1024 * 1024) { showToast('Archivo muy grande (>10MB)', 'error'); return null; }
    return { team, phone: digits, file };
}

async function _sendSlotImport(i, dryRun) {
    const data = _readSlotInputs(i);
    if (!data) return null;
    _slotImportLastFile[i] = data.file;

    const params = new URLSearchParams();
    params.set('teamName', data.team);
    params.set('linePhone', '+' + data.phone);
    params.set('dryRun', dryRun ? 'true' : 'false');

    try {
        const r = await authFetch('/api/admin/user-lines/import-exact?' + params.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: data.file
        });
        const j = await r.json();
        if (!r.ok || !j.success) {
            const msg = (j && j.error) || ('HTTP ' + r.status);
            showToast('Error: ' + msg, 'error');
            return null;
        }
        return j;
    } catch (e) {
        console.error('slot import error', e);
        showToast('Error de conexión', 'error');
        return null;
    }
}

async function slotImportPreview(i) {
    const out = document.getElementById('slotImportResult-' + i);
    if (out) out.innerHTML = '<div style="color:#aaa;font-size:11px;">⏳ Procesando archivo…</div>';
    const j = await _sendSlotImport(i, true);
    if (!j) {
        if (out) out.innerHTML = '';
        const btn = document.getElementById('slotImportConfirm-' + i);
        if (btn) { btn.disabled = true; btn.style.cursor = 'not-allowed'; btn.style.opacity = '0.5'; }
        return;
    }
    if (out) out.innerHTML = _renderSlotImportResultHtml(j, true);
    const btn = document.getElementById('slotImportConfirm-' + i);
    if (btn) { btn.disabled = false; btn.style.cursor = 'pointer'; btn.style.opacity = '1'; }
}

async function slotImportConfirm(i) {
    if (!_slotImportLastFile[i]) {
        showToast('Hacé primero la vista previa', 'error');
        return;
    }
    if (!confirm('¿Confirmás la importación de esta lista?')) return;

    const out = document.getElementById('slotImportResult-' + i);
    if (out) out.innerHTML = '<div style="color:#aaa;font-size:11px;">⏳ Escribiendo en la DB…</div>';

    const j = await _sendSlotImport(i, false);
    if (!j) {
        if (out) out.innerHTML = '';
        return;
    }
    if (out) out.innerHTML = _renderSlotImportResultHtml(j, false);
    showToast('✅ Lista importada', 'success');
    const btn = document.getElementById('slotImportConfirm-' + i);
    if (btn) { btn.disabled = true; btn.style.cursor = 'not-allowed'; btn.style.opacity = '0.5'; }
}

// Versión compacta del render (vive dentro del slot, espacio limitado).
function _renderSlotImportResultHtml(j, isPreview) {
    const s = j.summary || {};
    const matched = s.matched || 0;
    const pending = s.notFound || 0;
    const total = s.uniqueUsernames || 0;
    const reassigned = s.reassignedFromOtherLine || 0;

    let html = '<div style="background:rgba(0,0,0,0.40);border-radius:7px;padding:10px;font-size:11px;line-height:1.5;">';
    html += '<div style="color:#00d4ff;font-weight:700;margin-bottom:8px;">' + (isPreview ? '👁 Vista previa' : '✅ Importación lista') + ' · ' + escapeHtml(j.teamName) + ' (' + escapeHtml(j.linePhone) + ')</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">';
    html += '<div style="background:rgba(37,211,102,0.08);border:1px solid rgba(37,211,102,0.30);border-radius:6px;padding:7px;">';
    html += '<div style="color:#25d366;font-size:10px;font-weight:700;">✅ Ya registrados</div>';
    html += '<div style="color:#fff;font-size:16px;font-weight:800;">' + matched + '</div>';
    html += '<div style="color:#888;font-size:9px;">Asignados ahora</div>';
    html += '</div>';
    html += '<div style="background:rgba(255,170,68,0.08);border:1px solid rgba(255,170,68,0.30);border-radius:6px;padding:7px;">';
    html += '<div style="color:#ffaa44;font-size:10px;font-weight:700;">⏳ Pre-asignados</div>';
    html += '<div style="color:#fff;font-size:16px;font-weight:800;">' + pending + '</div>';
    html += '<div style="color:#888;font-size:9px;">Cuando entren por 1ra vez</div>';
    html += '</div>';
    html += '</div>';
    html += '<div style="color:#888;font-size:10px;margin-top:6px;">Total únicos: ' + total + (reassigned > 0 ? (' · ' + reassigned + ' cambian de línea') : '') + '</div>';
    if (isPreview) {
        html += '<div style="color:#aaa;font-size:10px;margin-top:5px;font-style:italic;">Si está OK, tocá "Confirmar".</div>';
    }
    html += '</div>';
    return html;
}
