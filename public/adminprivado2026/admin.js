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

// Devuelve el valor escapado para inyectar como argumento string en un
// onclick="...(arg)..." con `"`-quotes. Combina JSON.stringify (para JS)
// + escapeHtml (para HTML attr). Si el ID o weekKey trae chars raros,
// queda como dato (no escape al contexto JS).
function escapeJsArg(v) {
    return escapeHtml(JSON.stringify(String(v == null ? '' : v)));
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
        topPlayers: 'topPlayersSection',
        encuesta: 'encuestaSection',
        backupPhones: 'backupPhonesSection',
        winback: 'winbackSection',
        reviews: 'reviewsSection',
        notifs: 'notifsSection',
        notifsHistory: 'notifsHistorySection',
        automations: 'automationsSection',
        automation: 'automationSection',
        refundReminders: 'refundRemindersSection',
        raffles: 'rafflesSection',
        rafflesFree: 'rafflesFreeSection',
        rafflesLightning: 'rafflesLightningSection',
        segments: 'segmentsSection',
        campaigns: 'campaignsSection',
        recovery: 'recoverySection',
        teams: 'teamsSection',
        lineDown: 'lineDownSection',
        activePlayers: 'activePlayersSection',
        help: 'helpSection'
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
    } else if (sectionKey === 'topPlayers') {
        loadTopPlayers();
    } else if (sectionKey === 'encuesta') {
        loadEncuesta();
    } else if (sectionKey === 'backupPhones') {
        loadBackupPhonesGate();
    } else if (sectionKey === 'winback') {
        loadWinback();
    } else if (sectionKey === 'reviews') {
        loadAdminReviews();
    } else if (sectionKey === 'automations') {
        loadAutomations();
    } else if (sectionKey === 'automation') {
        loadAutomationSection();
    } else if (sectionKey === 'refundReminders') {
        loadRefundRemindersSection();
    } else if (sectionKey === 'raffles') {
        loadRafflesAdmin();
    } else if (sectionKey === 'rafflesFree') {
        loadRafflesFreeAdmin();
    } else if (sectionKey === 'rafflesLightning') {
        loadRafflesLightningAdmin();
    } else if (sectionKey === 'segments') {
        loadSegmentsAdmin();
    } else if (sectionKey === 'campaigns') {
        loadCampaignsAdmin();
    } else if (sectionKey === 'recovery') {
        loadRecovery();
    } else if (sectionKey === 'teams') {
        loadTeams();
    } else if (sectionKey === 'lineDown') {
        loadLineDownTeams();
        loadLineDownHistory();
    } else if (sectionKey === 'activePlayers') {
        loadActivePlayers();
    } else if (sectionKey === 'help') {
        loadHelp();
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
    // Hidratar el summary de cada slot (counts + última carga). Se hace
    // después del innerHTML para que los placeholders existan en el DOM.
    setTimeout(() => {
        for (let i = 0; i < items.length; i++) {
            try { refreshSlotListSummary(i); } catch (_) {}
        }
    }, 0);
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
            <!-- Lista cargada y operaciones por línea individual -->
            <div style="margin-top:6px;border-top:1px dashed rgba(0,212,255,0.20);padding-top:10px;">
                <!-- Resumen de lo cargado en esta línea (counts + última carga) -->
                <div id="slotListSummary-${i}" style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.18);border-radius:8px;padding:10px;margin-bottom:8px;font-size:12px;color:#bbb;">
                    <div style="color:#888;font-size:11px;">⏳ Cargando lista de esta línea…</div>
                </div>
                <!-- Botones de acción para esta línea -->
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
                    <button type="button" onclick="slotShowList(${i})" id="slotShowListBtn-${i}" style="flex:1;min-width:100px;padding:8px;font-size:11.5px;font-weight:700;background:rgba(157,78,221,0.10);border:1px solid rgba(157,78,221,0.40);color:#c89bff;border-radius:7px;cursor:pointer;">👁 Ver lista</button>
                    <button type="button" onclick="slotShowHistory(${i})" id="slotShowHistoryBtn-${i}" style="flex:1;min-width:100px;padding:8px;font-size:11.5px;font-weight:700;background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.40);color:#ffd700;border-radius:7px;cursor:pointer;">📅 Historial</button>
                    <button type="button" onclick="slotDownloadCsv(${i})" id="slotDownloadCsvBtn-${i}" style="flex:1;min-width:100px;padding:8px;font-size:11.5px;font-weight:700;background:rgba(37,211,102,0.10);border:1px solid rgba(37,211,102,0.40);color:#25d366;border-radius:7px;cursor:pointer;">📥 CSV</button>
                </div>
                <button type="button" onclick="toggleSlotImport(${i})" id="slotImportToggle-${i}" style="width:100%;background:rgba(0,212,255,0.05);border:1px dashed rgba(0,212,255,0.30);padding:9px;border-radius:7px;color:#00d4ff;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                    📋 Cargar/actualizar listado (.xlsx)
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
    html += '<th>🔁 Reasignado</th>';
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

        // Celda de REASIGNADO: solo aplica si la línea fue auto-asignada
        // por matcheo de prefijo o por default general. Si fue por Drive
        // import, lookup, o admin manual, queda en blanco (es la
        // asignación "original" pensada para ese user).
        let reassignCell = '<span style="color:#444;">—</span>';
        if (u.lineAssignmentSource === 'prefix-fallback') {
            reassignCell = '<div style="line-height:1.3;">'
                + '<span style="background:rgba(0,212,255,0.15);color:#00d4ff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">✓ POR PREFIJO</span>'
                + (u.lineAssignmentNote ? '<small style="display:block;color:#888;margin-top:3px;">' + escapeHtml(u.lineAssignmentNote) + '</small>' : '')
                + '</div>';
        } else if (u.lineAssignmentSource === 'general-default') {
            reassignCell = '<div style="line-height:1.3;">'
                + '<span style="background:rgba(255,170,68,0.15);color:#ffaa44;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">✓ GENERAL</span>'
                + (u.lineAssignmentNote ? '<small style="display:block;color:#888;margin-top:3px;">' + escapeHtml(u.lineAssignmentNote) + '</small>' : '')
                + '</div>';
        } else if (u.lineAssignmentSource === 'lookup') {
            reassignCell = '<span style="color:#666;font-size:11px;" title="Pre-asignado desde import">📋 Pre-asignado</span>';
        }

        html += '<tr>';
        html += '<td>' + escapeHtml(u.username) + '</td>';
        html += '<td>' + lineCell + '</td>';
        html += '<td>' + reassignCell + '</td>';
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
// REPORTE — BONO DE BIENVENIDA $5.000 (legacy: $10.000 / $2.000 en historico)
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

// ============================================================
// Refresh "real" del reporte de bono $5.000
// -------------------------------------------------------------
// Dispara POST /api/admin/reports/welcome-bonus/refresh-charges (itera
// todos los claims, lee los movimientos reales de JUGAYGANA desde
// claimedAt, cuenta cargas excluyendo las acreditaciones de bonos por
// transactionId, y guarda el snapshot por claim). Polea cada 3s para
// mostrar progreso y al terminar recarga la tabla.
// ============================================================
let _welcomeBonusRefreshPoll = null;

function _renderWelcomeBonusRefreshState(s) {
    const el = document.getElementById('welcomeBonusRefreshState');
    const btn = document.getElementById('welcomeBonusRefreshBtn');
    if (!el) return;
    if (s && s.running) {
        const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
        el.innerHTML = '⏳ Leyendo JUGAYGANA: <strong style="color:#ffd700;">' + (s.done || 0) + ' / ' + (s.total || 0) + '</strong> (' + pct + '%)' +
            (s.errors ? ' — <span style="color:#ff8080;">' + s.errors + ' errores</span>' : '');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Refrescando…'; btn.style.opacity = '0.6'; btn.style.cursor = 'wait'; }
    } else if (s && s.finishedAt) {
        const when = new Date(s.finishedAt).toLocaleString('es-AR');
        el.innerHTML = '✅ Último refresh: <strong style="color:#fff;">' + escapeHtml(when) + '</strong> · ' + (s.done || 0) + ' usuarios procesados' +
            (s.errors ? ' (' + s.errors + ' errores)' : '');
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Refrescar cargas'; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    } else {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Refrescar cargas'; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    }
}

async function triggerWelcomeBonusRefresh() {
    const btn = document.getElementById('welcomeBonusRefreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Iniciando…'; btn.style.opacity = '0.6'; }
    try {
        const r = await authFetch('/api/admin/reports/welcome-bonus/refresh-charges', { method: 'POST' });
        const d = await r.json();
        if (d.success === false) {
            showToast(d.message || 'Ya hay un refresh corriendo, sigo el progreso…', 'info');
        } else {
            showToast('Leyendo cargas reales de JUGAYGANA en background', 'success');
        }
        _renderWelcomeBonusRefreshState(d.state || { running: true, done: 0, total: 0 });

        if (_welcomeBonusRefreshPoll) clearInterval(_welcomeBonusRefreshPoll);
        _welcomeBonusRefreshPoll = setInterval(async () => {
            try {
                const pr = await authFetch('/api/admin/reports/welcome-bonus/refresh-charges', { method: 'GET' });
                const pd = await pr.json();
                const state = pd.state || {};
                _renderWelcomeBonusRefreshState(state);
                if (!state.running && state.finishedAt) {
                    clearInterval(_welcomeBonusRefreshPoll);
                    _welcomeBonusRefreshPoll = null;
                    await loadWelcomeBonusReport();
                    showToast('✅ Reporte actualizado con cargas reales', 'success');
                }
            } catch (e) { /* ignorar errores transientes del poll */ }
        }, 3000);
    } catch (e) {
        showToast('Error iniciando refresh', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Refrescar cargas'; btn.style.opacity = '1'; }
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
    } else if (key === 'chargedAfterDesc') {
        // Primero los que cargaron, ordenados por fecha de carga más reciente.
        arr.sort((a, b) => {
            const ac = a.chargedAfterClaim ? 1 : 0;
            const bc = b.chargedAfterClaim ? 1 : 0;
            if (ac !== bc) return bc - ac;
            const ta = a.lastDepositAt ? new Date(a.lastDepositAt).getTime() : 0;
            const tb = b.lastDepositAt ? new Date(b.lastDepositAt).getTime() : 0;
            return tb - ta;
        });
    } else if (key === 'chargedAfterAsc') {
        // Primero los que NO cargaron (los que necesitan re-engagement).
        arr.sort((a, b) => {
            const ac = a.chargedAfterClaim ? 1 : 0;
            const bc = b.chargedAfterClaim ? 1 : 0;
            if (ac !== bc) return ac - bc;
            return tsClaimed(b) - tsClaimed(a);
        });
    } else if (key === 'amountDesc') {
        arr.sort((a, b) => (Number(b.amount)||0) - (Number(a.amount)||0) || tsClaimed(b) - tsClaimed(a));
    } else if (key === 'amountAsc') {
        arr.sort((a, b) => (Number(a.amount)||0) - (Number(b.amount)||0) || tsClaimed(b) - tsClaimed(a));
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
    html += '  <div class="stat-card"><span class="label">💰 Cargaron después</span><span class="value" style="color:#25d366;">' + (t.chargedAfterClaim || 0) + ' <small style="font-size:11px;color:#888;">(' + pct(t.chargedAfterClaim || 0) + '%)</small></span></div>';
    if ((t.chargesNeverChecked || 0) > 0) {
        html += '  <div class="stat-card"><span class="label">⏳ Sin chequear cargas</span><span class="value" style="color:#f59e0b;">' + t.chargesNeverChecked + ' <small style="font-size:11px;color:#888;">(toca "Refrescar")</small></span></div>';
    }
    html += '</div>';

    // Desglose por monto reclamado (legacy $10.000 / $2.000 vs $5.000 actual).
    if (Array.isArray(t.byAmount) && t.byAmount.length > 0) {
        html += '<div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.25);border-radius:10px;padding:12px;margin-bottom:14px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;">';
        html += '  <strong style="color:#d4af37;font-size:12px;">💵 Reclamos por monto:</strong>';
        for (const ba of t.byAmount) {
            const color = ba.amount >= 10000 ? '#ff8800' : (ba.amount >= 2000 ? '#25d366' : '#888');
            const amtPct = total > 0 ? Math.round((ba.count / total) * 100) : 0;
            html += '<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:6px 12px;">';
            html += '  <span style="color:' + color + ';font-weight:800;font-size:13px;">$' + ba.amount.toLocaleString('es-AR') + '</span>';
            html += '  <span style="color:#fff;font-weight:700;">' + ba.count + '</span>';
            html += '  <small style="color:#888;">(' + amtPct + '%)</small>';
            html += '</span>';
        }
        html += '<span style="margin-left:auto;color:#aaa;font-size:11px;">Total acreditado: <strong style="color:#d4af37;">$' + (t.totalAmountGivenARS || 0).toLocaleString('es-AR') + '</strong></span>';
        html += '</div>';
    }

    if (claims.length === 0) {
        html += '<div class="empty-state">Nadie reclamó el bono todavía.</div>';
        container.innerHTML = html;
        return;
    }

    // Toolbar superior: botón de refresh "real". Lee JUGAYGANA, actualiza
    // PlayerStats y vuelve a renderizar la tabla con quiénes cargaron de
    // verdad post-bono. El refresh corre en background; mostramos progreso.
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.20);border-radius:10px;padding:10px 14px;margin:14px 0 0;">';
    html +=   '<div style="flex:1;min-width:200px;">';
    html +=     '<div style="color:#00d4ff;font-size:12px;font-weight:700;margin-bottom:2px;">💰 Carga real post-bono</div>';
    html +=     '<div id="welcomeBonusRefreshState" style="color:#aaa;font-size:11px;">Tocá "Refrescar cargas" para leer los movimientos reales de JUGAYGANA por claim (cuenta cargas post-bono, ignora nuestras acreditaciones).</div>';
    html +=   '</div>';
    html +=   '<button id="welcomeBonusRefreshBtn" onclick="triggerWelcomeBonusRefresh()" style="padding:9px 16px;font-size:13px;font-weight:700;background:linear-gradient(135deg,#00d4ff,#0066cc);color:#fff;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;">🔄 Refrescar cargas</button>';
    html += '</div>';

    // Encabezado de detalle + buscador + selector de orden
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0 10px;">';
    html += '  <h3 style="color:#d4af37;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0;">Detalle por usuario</h3>';
    html += '  <div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '    <select id="welcomeBonusSortSelect" onchange="changeWelcomeBonusSort(this.value)" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:13px;cursor:pointer;">';
    html += '      <option value="appLastSeenDesc"' + (_welcomeBonusSortKey === 'appLastSeenDesc' ? ' selected' : '') + '>↓ Actividad (más reciente)</option>';
    html += '      <option value="appLastSeenAsc"' + (_welcomeBonusSortKey === 'appLastSeenAsc' ? ' selected' : '') + '>↑ Actividad (más antigua)</option>';
    html += '      <option value="claimedDesc"' + (_welcomeBonusSortKey === 'claimedDesc' ? ' selected' : '') + '>↓ Fecha de reclamo</option>';
    html += '      <option value="chargedAfterDesc"' + (_welcomeBonusSortKey === 'chargedAfterDesc' ? ' selected' : '') + '>💰 Cargaron después (sí primero)</option>';
    html += '      <option value="chargedAfterAsc"' + (_welcomeBonusSortKey === 'chargedAfterAsc' ? ' selected' : '') + '>💸 No cargaron (recuperar)</option>';
    html += '      <option value="amountDesc"' + (_welcomeBonusSortKey === 'amountDesc' ? ' selected' : '') + '>💵 Monto reclamado (desc — mayor primero)</option>';
    html += '      <option value="amountAsc"' + (_welcomeBonusSortKey === 'amountAsc' ? ' selected' : '') + '>💵 Monto reclamado (asc — menor primero)</option>';
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
    html += '<th style="text-align:right;">💵 Monto</th>';
    html += '<th>📱 App ahora</th>';
    html += '<th>Última vez en la app</th>';
    html += '<th>🔔 Notifs ahora</th>';
    html += '<th>💰 Cargó después</th>';
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

        // Columna "Cargó después de reclamar el bono".
        // Snapshot por-claim desde JUGAYGANA: cuenta cargas reales (no monto)
        // ocurridas con timestamp > claimedAt, excluyendo las acreditaciones
        // de nuestros bonos. Por qué cargas y no monto: alguien puede haber
        // cargado y retirado todo, dejando $0 — igual queremos saber que
        // jugó después del regalo.
        const chargesCount = Number(c.chargesAfterClaim || 0);
        const chargesAmount = Number(c.chargesAfterClaimAmount || 0);
        let chargedCell;
        if (!c.chargesCheckedAt) {
            // Todavía no se corrió el refresh contra JUGAYGANA para este claim.
            chargedCell =
                '<div style="color:#888;font-weight:700;">— Sin datos</div>' +
                '<small style="color:#666;">Tocá "Refrescar cargas"</small>';
        } else if (chargesCount > 0) {
            const fmtAmount = chargesAmount > 0
                ? '$' + Math.round(chargesAmount).toLocaleString('es-AR')
                : '';
            let extra = '';
            if (c.lastDepositAt) {
                const depDate = new Date(c.lastDepositAt);
                const claimedMs = c.claimedAt ? new Date(c.claimedAt).getTime() : 0;
                const daysFromClaim = claimedMs ? Math.max(0, Math.floor((depDate.getTime() - claimedMs) / 86400000)) : null;
                const ago = daysFromClaim != null
                    ? (daysFromClaim === 0 ? 'mismo día' : (daysFromClaim + 'd después'))
                    : '';
                extra = '<small style="color:#888;">última: ' + escapeHtml(depDate.toLocaleDateString('es-AR')) + (ago ? ' · ' + ago : '') + '</small>';
            }
            chargedCell =
                '<div style="color:#25d366;font-weight:700;">✅ ' + chargesCount + ' carga' + (chargesCount === 1 ? '' : 's') + (fmtAmount ? ' · ' + fmtAmount : '') + '</div>' +
                extra;
        } else {
            chargedCell =
                '<div style="color:#ef4444;font-weight:700;">❌ No cargó</div>' +
                ((c.realChargesCount30d || 0) > 0
                    ? '<small style="color:#888;">' + (c.realChargesCount30d || 0) + ' cargas en 30d (otra ventana)</small>'
                    : '<small style="color:#666;">sin cargas post-bono</small>');
        }

        const statusBadge = c.status === 'pending_credit_failed'
            ? '<span style="background:#7f1d1d;color:#fee;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">PENDIENTE</span>'
            : '<span style="background:rgba(37,211,102,0.18);color:#25d366;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">OK</span>';
        const amount = Number(c.amount || 0);
        const amountColor = amount >= 10000 ? '#ff8800' : (amount >= 2000 ? '#25d366' : '#888');
        const amountCell = '<span style="color:' + amountColor + ';font-weight:800;">$' + amount.toLocaleString('es-AR') + '</span>';

        html += '<tr>';
        html += '<td>' + escapeHtml(c.username) + '</td>';
        html += '<td>' + _formatPlatform(c.platform) + '</td>';
        html += '<td><small>' + escapeHtml(claimed) + '</small></td>';
        html += '<td style="text-align:right;">' + amountCell + '</td>';
        html += '<td>' + appCell + '</td>';
        html += '<td>' + seenCell + '</td>';
        html += '<td>' + notifCell + '</td>';
        html += '<td>' + chargedCell + '</td>';
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
        renderSegmentsMatrix(d.matrix || {}, d.tierTotals || {}, d.activityTotals || {}, d.appBreakdownByCell || {});
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
        const withApp = Number(seg.withApp || 0);
        const noApp = Number(seg.noApp || 0);

        html += '<div style="display:flex;align-items:center;gap:12px;background:rgba(0,0,0,0.35);padding:10px 12px;border-radius:8px;border-left:3px solid #ff7f50;flex-wrap:wrap;">';
        html += '<div style="flex:0 0 auto;background:rgba(255,127,80,0.12);color:#ff7f50;font-size:18px;font-weight:800;padding:8px 12px;border-radius:8px;min-width:64px;text-align:center;">' + (seg.count || 0) + '</div>';
        html += '<div style="flex:1;min-width:200px;">';
        html += '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:2px;">' + escapeHtml(segLabel) + '</div>';
        html += '<div style="color:#aaa;font-size:11px;line-height:1.4;">🎯 <strong style="color:#ffd700;">' + escapeHtml(strategy) + '</strong> · ' + escapeHtml(bonusHint) + ' · ~' + $ + ' potencial</div>';
        // Breakdown: con app (push) vs sin app (whatsapp). Útil para saber
        // dónde mandar push directo y dónde hace falta recontactar humano.
        html += '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;font-size:11px;">';
        html += '<span style="background:rgba(37,211,102,0.10);color:#25d366;padding:3px 8px;border-radius:5px;font-weight:700;">📱 ' + withApp + ' con app</span>';
        html += '<span style="background:rgba(255,170,0,0.10);color:#ffaa00;padding:3px 8px;border-radius:5px;font-weight:700;">💬 ' + noApp + ' sin app (WhatsApp)</span>';
        html += '</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        if (withApp > 0) {
            html += '<button onclick="openRecoveryModal(\'' + seg.tier + '\',\'' + seg.state + '\')" style="padding:8px 12px;background:linear-gradient(135deg,#ff7f50,#ff5050);color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;font-size:12px;white-space:nowrap;">📲 Push (' + withApp + ')</button>';
        }
        if (noApp > 0) {
            html += '<button onclick="openRecoveryWhatsApp(\'' + seg.tier + '\',\'' + seg.state + '\')" style="padding:8px 12px;background:linear-gradient(135deg,#25d366,#128c4f);color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;font-size:12px;white-space:nowrap;" title="Descargar CSV con teléfonos para campaña por WhatsApp">💬 WhatsApp (' + noApp + ')</button>';
        }
        html += '</div>';
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

function renderSegmentsMatrix(matrix, tierTotals, activityTotals, appBreakdown) {
    const el = document.getElementById('statsSegmentsMatrix');
    if (!el) return;
    const breakdown = appBreakdown || {};
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
            const br = breakdown[t + '-' + s] || { withApp: 0, noApp: 0 };
            const isUrgent = (t === 'VIP' || t === 'ORO') && (s === 'EN_RIESGO' || s === 'PERDIDO');
            const showBtn = c > 0 && (s === 'EN_RIESGO' || s === 'PERDIDO' || s === 'INACTIVO');
            html += '<td style="padding:8px;text-align:center;background:' + cellColor[s] + ';border-bottom:1px solid rgba(255,255,255,0.05);' + (isUrgent ? 'border:2px solid #ff5050;' : '') + '">';
            html += '<div style="font-size:18px;font-weight:800;color:#fff;">' + c + '</div>';
            // Breakdown app/no-app debajo del total
            if (c > 0 && (br.withApp > 0 || br.noApp > 0)) {
                html += '<div style="font-size:9.5px;color:#aaa;margin-top:2px;line-height:1.3;">';
                html += '<span style="color:#25d366;">📱 ' + br.withApp + '</span>';
                html += ' · ';
                html += '<span style="color:#ffaa00;">💬 ' + br.noApp + '</span>';
                html += '</div>';
            }
            if (showBtn) {
                html += '<div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:4px;">';
                if (br.withApp > 0) {
                    html += '<button onclick="openRecoveryModal(\'' + t + '\',\'' + s + '\')" title="Mandar push a los que tienen app" style="font-size:9.5px;padding:3px 6px;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.20);color:#fff;border-radius:4px;cursor:pointer;font-weight:600;">📲</button>';
                }
                if (br.noApp > 0) {
                    html += '<button onclick="openRecoveryWhatsApp(\'' + t + '\',\'' + s + '\')" title="Descargar CSV con teléfonos para WhatsApp" style="font-size:9.5px;padding:3px 6px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.40);color:#25d366;border-radius:4px;cursor:pointer;font-weight:600;">💬</button>';
                }
                html += '</div>';
            }
            html += '</td>';
        }
        html += '<td style="padding:8px;text-align:center;color:#ffd700;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.05);">' + (tierTotals[t] || 0) + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<div style="margin-top:10px;color:#888;font-size:11px;">Las celdas con borde rojo (VIP/ORO en riesgo o perdidos) son las más urgentes. <strong style="color:#25d366;">📱</strong> = con app+notifs (push directo) · <strong style="color:#ffaa00;">💬</strong> = sin app (descargar CSV para WhatsApp).</div>';
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

// Descarga el CSV con los users del segmento (tier+state) que NO tienen
// app — para que el equipo arme una campaña de recontacto por WhatsApp.
async function openRecoveryWhatsApp(tier, state) {
    try {
        const r = await authFetch('/api/admin/stats/segments/whatsapp-export?tier=' + encodeURIComponent(tier) + '&state=' + encodeURIComponent(state));
        if (!r.ok) {
            showToast('❌ Error descargando CSV (' + r.status + ')', 'error');
            return;
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recontacto-' + tier + '-' + state + '-' + new Date().toISOString().slice(0,10) + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1500);
        showToast('✅ CSV descargado · pasalo al equipo de WhatsApp', 'success');
    } catch (e) {
        showToast('❌ Error: ' + (e.message || e), 'error');
    }
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
    else if (_autoActiveTab === 'strategy') _strategyRenderTab();
    else if (_autoActiveTab === 'adhoc') _adhocRenderTab();
    else if (_autoActiveTab === 'reminders') _remindersRenderTab();
    else if (_autoActiveTab === 'roi') _strategyRenderROITab();
}

// ============= TAB: REGLAS =============
// Reglas activas: limpio. Las reglas individuales quedan accesibles solo
// si el admin pide "ver todas" — el flow nuevo usa el Calendario semanal
// como fuente de verdad para difusiones.
function _autoRenderRulesTab() {
    let html = '';
    html += '<div style="background:linear-gradient(135deg,rgba(120,80,255,0.08),rgba(0,212,255,0.06));border:1px solid rgba(120,80,255,0.30);border-radius:12px;padding:18px;margin-bottom:14px;">';
    html += '  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
    html += '    <span style="font-size:30px;">📅</span>';
    html += '    <div><div style="color:#b39dff;font-size:14px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Migramos al Calendario semanal</div>';
    html += '    <div style="color:#aaa;font-size:11.5px;margin-top:2px;line-height:1.5;">Las difusiones, bonos y recordatorios ahora se planifican desde la pestaña <strong style="color:#00d4ff;">⏰ Calendario semanal</strong>. Cada strategy queda en pendiente, podés lanzarla cuando quieras y medís el ROI después.</div></div>';
    html += '  </div>';
    html += '  <button onclick="switchAutomationsTab(\'calendar\')" style="margin-top:8px;background:linear-gradient(135deg,#b39dff,#00d4ff);color:#000;border:none;padding:9px 14px;border-radius:8px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;">⏰ Ir al Calendario semanal →</button>';
    html += '</div>';

    if (_autoRulesCache.length > 0) {
        html += '<details style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;">';
        html += '<summary style="cursor:pointer;color:#aaa;font-size:11.5px;font-weight:700;">⚙️ Reglas técnicas legacy (' + _autoRulesCache.length + ') · solo administración avanzada</summary>';
        html += '<div style="margin-top:10px;color:#888;font-size:11px;line-height:1.5;margin-bottom:8px;">Estas reglas siguen corriendo en el cron pero no las uses para planificar — usá el Calendario semanal. Solo abrí esto si necesitás pausar algo concreto.</div>';
        const byCat = {};
        for (const r of _autoRulesCache) {
            if (!byCat[r.category]) byCat[r.category] = [];
            byCat[r.category].push(r);
        }
        for (const cat of Object.keys(byCat)) {
            html += '<div style="margin-bottom:14px;">';
            html += '<h4 style="color:#999;font-size:11px;margin:6px 0;text-transform:uppercase;letter-spacing:1px;">' + (_autoCategoryLabels[cat] || cat) + ' <span style="color:#555;font-weight:400;">' + byCat[cat].length + '</span></h4>';
            html += '<div style="display:flex;flex-direction:column;gap:6px;">';
            for (const r of byCat[cat]) html += _autoRenderRuleCard(r);
            html += '</div></div>';
        }
        html += '</details>';
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
// Cada sugerencia se renderiza como una "card" con:
//   - Header: código + nombre de la regla + edad/expiración + bonus
//   - Inputs EDITABLES de título y cuerpo (textareas)
//   - Botón "💾 Guardar cambios" → PUT /api/admin/notification-rules/suggestions/:id
//   - Toggle "👥 Ver afectados" → muestra/oculta la lista completa de usernames
//   - Botones "✅ Aprobar y enviar" / "❌ Descartar"
//
// La audiencia (audienceUsernames) NO se puede editar: ya quedó fijada al
// momento de crear la suggestion para evitar disparos contra una población
// recalculada. El admin puede ajustar el copy y luego confirmar.
function _autoRenderPendingTab() {
    if (_autoSuggestionsCache.length === 0) {
        return '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">✅ Sin sugerencias pendientes. Cuando una regla dispare, aparecerá acá.</div>';
    }
    let html = '<div style="display:flex;flex-direction:column;gap:14px;">';
    for (const s of _autoSuggestionsCache) {
        const ageMin = Math.floor((Date.now() - new Date(s.suggestedAt).getTime()) / 60000);
        const expHours = Math.max(0, Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 3600000));
        const bonusText = (s.bonus && s.bonus.type !== 'none')
            ? '💸 ' + s.bonus.type + ' $' + s.bonus.amount + ' x ' + s.audienceCount + ' usuarios = $' + (s.bonus.amount * s.audienceCount).toLocaleString('es-AR') + ' total'
            : '📢 Sin bonus, solo push';
        const titleInputId = 'sug-title-' + s.id;
        const bodyInputId = 'sug-body-' + s.id;
        const audWrapId = 'sug-aud-' + s.id;
        const audList = (s.audienceUsernames || []).slice(0, 500);
        const audHtml = audList.length > 0
            ? audList.map(u => '<span style="display:inline-block;background:rgba(0,212,255,0.10);color:#9be8ff;font-size:11px;padding:3px 8px;border-radius:5px;margin:2px;">' + escapeHtml(u) + '</span>').join('')
            : '<span style="color:#888;font-size:11px;">(sin usuarios en la lista)</span>';
        const audMore = (s.audienceUsernames && s.audienceUsernames.length > 500)
            ? '<div style="margin-top:6px;color:#888;font-size:10px;">+ ' + (s.audienceUsernames.length - 500) + ' usuarios más (no mostrados)</div>'
            : '';

        html += '<div style="background:rgba(255,170,68,0.05);border:1px solid rgba(255,170,68,0.30);border-radius:10px;padding:14px;">' +
            // Header
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
                '<div style="flex:1;min-width:240px;">' +
                    '<div style="margin-bottom:5px;">' +
                        '<span style="background:rgba(0,212,255,0.20);color:#00d4ff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;">' + escapeHtml(s.ruleCode) + '</span> ' +
                        '<span style="color:#888;font-size:11px;margin-left:4px;">hace ' + ageMin + ' min · expira en ' + expHours + 'h</span>' +
                    '</div>' +
                    '<div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:3px;">' + escapeHtml(s.ruleName) + '</div>' +
                    '<div style="color:#ffaa44;font-size:11px;font-weight:700;">' + bonusText + '</div>' +
                '</div>' +
            '</div>' +

            // Inputs editables
            '<div style="margin-bottom:10px;">' +
                '<label style="display:block;color:#aaa;font-size:11px;font-weight:700;margin-bottom:4px;">Título</label>' +
                '<input id="' + titleInputId + '" type="text" maxlength="200" value="' + escapeHtml(s.title) + '" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.30);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:13px;" />' +
            '</div>' +
            '<div style="margin-bottom:10px;">' +
                '<label style="display:block;color:#aaa;font-size:11px;font-weight:700;margin-bottom:4px;">Cuerpo</label>' +
                '<textarea id="' + bodyInputId + '" maxlength="1000" rows="3" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.30);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:13px;resize:vertical;">' + escapeHtml(s.body) + '</textarea>' +
            '</div>' +

            // Audiencia toggle + lista colapsada
            '<div style="margin-bottom:10px;">' +
                '<button onclick="autoToggleAudience(\'' + s.id + '\')" style="padding:6px 12px;font-size:11px;font-weight:700;background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:6px;cursor:pointer;">👥 Ver afectados (' + s.audienceCount + ')</button>' +
                '<div id="' + audWrapId + '" style="display:none;margin-top:8px;padding:8px;background:rgba(0,0,0,0.20);border-radius:6px;max-height:200px;overflow-y:auto;">' +
                    audHtml +
                    audMore +
                '</div>' +
            '</div>' +

            // Botonera
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                '<button onclick="autoSaveSuggestionEdits(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);border-radius:7px;cursor:pointer;">💾 Guardar cambios</button>' +
                '<button onclick="autoApproveSuggestion(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;border-radius:7px;cursor:pointer;">✅ Aprobar y enviar</button>' +
                '<button onclick="autoRejectSuggestion(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:rgba(255,80,80,0.15);color:#ff5050;border:1px solid rgba(255,80,80,0.40);border-radius:7px;cursor:pointer;">❌ Descartar</button>' +
            '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
}

// Toggle de visibilidad de la lista de afectados.
function autoToggleAudience(id) {
    const el = document.getElementById('sug-aud-' + id);
    if (!el) return;
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
}

// Guarda título/cuerpo editados. Si los inputs no cambiaron respecto a la
// cache, no llamamos al server.
async function autoSaveSuggestionEdits(id) {
    const s = _autoSuggestionsCache.find(x => x.id === id);
    if (!s) return;
    const tEl = document.getElementById('sug-title-' + id);
    const bEl = document.getElementById('sug-body-' + id);
    if (!tEl || !bEl) return;
    const title = (tEl.value || '').trim();
    const body = (bEl.value || '').trim();
    if (!title || !body) {
        showToast('Título y cuerpo no pueden estar vacíos', 'error');
        return;
    }
    if (title === s.title && body === s.body) {
        showToast('No hay cambios para guardar', 'info');
        return;
    }
    try {
        const resp = await authFetch('/api/admin/notification-rules/suggestions/' + id, {
            method: 'PUT',
            body: JSON.stringify({ title, body })
        });
        const j = await resp.json();
        if (j.success) {
            // Actualizamos la cache local para que el approve mande el texto editado.
            s.title = j.title;
            s.body = j.body;
            showToast('✅ Cambios guardados', 'success');
        } else {
            showToast(j.error || 'Error guardando', 'error');
        }
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
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
// ============================================================
// CALENDARIO SEMANAL — planificacion + lanzamiento + ROI
// ============================================================
const _CAL_STATE = {
    plan: null,
    weekKey: null,
    teams: [],
    historyOpen: false,
    history: []
};

function _autoRenderCalendarTab() {
    // Render placeholder y disparar fetch async (la idea es que el tab
    // sincronico devuelva un loader mientras corre la carga real).
    setTimeout(() => loadCalendarPlan(), 50);
    return '<div class="empty-state">⏳ Cargando calendario semanal…</div>';
}

async function loadCalendarPlan(weekKey) {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    if (!weekKey) weekKey = _CAL_STATE.weekKey || _isoWeekKeyClient(new Date());
    _CAL_STATE.weekKey = weekKey;
    c.innerHTML = '<div class="empty-state">⏳ Cargando calendario semanal…</div>';
    try {
        const [planRes, teamsRes] = await Promise.all([
            authFetch('/api/admin/calendar/week?weekKey=' + encodeURIComponent(weekKey)),
            authFetch('/api/admin/calendar/teams-available')
        ]);
        if (!planRes.ok) {
            const err = await planRes.json().catch(() => ({}));
            c.innerHTML = '<div style="color:#ff8080;padding:20px;">' + (err.error || 'Error') + '</div>';
            return;
        }
        const planJson = await planRes.json();
        const teamsJson = teamsRes.ok ? await teamsRes.json() : { teams: [] };
        _CAL_STATE.plan = planJson.plan;
        _CAL_STATE.teams = teamsJson.teams || [];
        c.innerHTML = _renderCalendarPlan();
    } catch (e) {
        console.error('loadCalendarPlan:', e);
        c.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión</div>';
    }
}

// IMPORTANTE: este calculo debe coincidir con el server (_isoWeekKey en
// server.js), que se basa en la hora ARG (UTC-3, sin DST). Si usaramos la
// fecha local del cliente, en navegadores con TZ != ARG la semana podria
// caer en un Y-Wnn distinto al que el server espera, generando upserts
// duplicados o desincronizacion entre dashboard y calendario.
function _isoWeekKeyClient(date) {
    const argMs = (date ? date.getTime() : Date.now()) - 3 * 3600 * 1000;
    const argDate = new Date(argMs);
    const d = new Date(Date.UTC(argDate.getUTCFullYear(), argDate.getUTCMonth(), argDate.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

const _DAYS_FULL_CLIENT = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

function _renderCalendarPlan() {
    const plan = _CAL_STATE.plan;
    if (!plan) return '<div class="empty-state">Sin datos</div>';
    const sum = plan.summary || {};
    const sentBadge = (s) => ({
        positivo: '<span style="color:#66ff66;">✅ Positivo</span>',
        neutro: '<span style="color:#ffaa66;">⚖️ Neutro</span>',
        negativo: '<span style="color:#ff8080;">⚠️ Negativo</span>',
        sin_datos: '<span style="color:#666;">— sin datos —</span>'
    })[s] || '';

    let html = '';

    // Header con weekKey + summary
    html += '<div style="background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(120,80,255,0.04));border:1px solid rgba(0,212,255,0.30);border-radius:12px;padding:14px;margin-bottom:14px;">';
    html += '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px;">';
    html += '<div><div style="color:#00d4ff;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:800;">📅 Calendario Semanal</div>';
    html += '<div style="color:#fff;font-size:16px;font-weight:900;">' + escapeHtml(plan.weekKey) + ' · ' + new Date(plan.weekStartDate).toLocaleDateString('es-AR', { day:'2-digit', month:'short' }) + ' →</div></div>';
    html += '<div style="display:flex;gap:6px;">';
    html += '<button onclick="_calChangeWeek(-1)" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:6px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;">← Anterior</button>';
    html += '<button onclick="loadCalendarPlan()" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:6px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;">Actual</button>';
    html += '<button onclick="_calChangeWeek(1)" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:6px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;">Siguiente →</button>';
    html += '<button onclick="_calToggleHistory()" style="background:rgba(155,48,255,0.10);color:#c89bff;border:1px solid rgba(155,48,255,0.40);padding:6px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;">📊 Historial</button>';
    html += '<button onclick="_calCleanupNonPinned()" style="background:rgba(255,80,80,0.10);color:#ff8080;border:1px solid rgba(255,80,80,0.40);padding:6px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;" title="Borra todas las difusiones pendientes de esta semana (deja solo las recordatorios fijos y el historial de las ya lanzadas)">🗑 Limpiar viejas</button>';
    html += '</div></div>';

    // KPIs
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Strategies</div><div style="color:#fff;font-size:18px;font-weight:900;">' + (sum.totalStrategies || 0) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Pendientes</div><div style="color:#ffaa66;font-size:18px;font-weight:900;">' + (sum.pendingCount || 0) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Lanzadas</div><div style="color:#66ff66;font-size:18px;font-weight:900;">' + (sum.launchedCount || 0) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Push enviados</div><div style="color:#00d4ff;font-size:18px;font-weight:900;">' + (sum.totalSent || 0).toLocaleString('es-AR') + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Respondieron</div><div style="color:#66ff66;font-size:18px;font-weight:900;">' + (sum.totalResponders || 0).toLocaleString('es-AR') + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">$ depositos</div><div style="color:#d4af37;font-size:16px;font-weight:900;">' + _fmtMoney(sum.totalNewDeposits) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">$ bonos dados</div><div style="color:#ffaa66;font-size:16px;font-weight:900;">' + _fmtMoney(sum.totalBonusGiven) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">ROI</div><div style="color:' + ((sum.aggregateRoi || 0) >= 1 ? '#66ff66' : '#ff8080') + ';font-size:18px;font-weight:900;">' + (sum.aggregateRoi || 0).toFixed(2) + 'x</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);padding:8px 10px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Veredicto</div><div style="font-size:13px;font-weight:900;margin-top:3px;">' + sentBadge(sum.sentiment) + '</div></div>';
    html += '</div>';
    html += '</div>';

    // Historial expandible
    if (_CAL_STATE.historyOpen) {
        html += '<div style="background:rgba(155,48,255,0.04);border:1px solid rgba(155,48,255,0.30);border-radius:10px;padding:12px;margin-bottom:14px;">';
        html += '<h3 style="color:#c89bff;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">📊 Historial — semanas anteriores</h3>';
        if (!_CAL_STATE.history || _CAL_STATE.history.length === 0) {
            html += '<div style="color:#888;text-align:center;padding:14px;font-size:11px;">Cargando historial…</div>';
        } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">';
            for (const h of _CAL_STATE.history) {
                const s = h.summary || {};
                const sentClass = { positivo: '#66ff66', neutro: '#ffaa66', negativo: '#ff8080' }[s.sentiment] || '#888';
                html += '<button onclick="loadCalendarPlan(' + escapeJsArg(h.weekKey) + ')" style="background:rgba(0,0,0,0.40);border:1px solid ' + sentClass + ';border-radius:8px;padding:10px;text-align:left;cursor:pointer;color:#fff;">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><strong>' + escapeHtml(h.weekKey) + '</strong><span style="color:' + sentClass + ';font-size:10px;font-weight:800;text-transform:uppercase;">' + (s.sentiment || 'sin datos') + '</span></div>';
                html += '<div style="color:#aaa;font-size:11px;line-height:1.5;">' + (s.launchedCount || 0) + ' lanzadas · ' + (s.totalSent || 0) + ' envíos · ROI ' + (s.aggregateRoi || 0).toFixed(2) + 'x</div>';
                html += '<div style="color:#888;font-size:10px;margin-top:3px;">' + _fmtMoney(s.totalNewDeposits) + ' generados · ' + _fmtMoney(s.totalBonusGiven) + ' bonos</div>';
                html += '</button>';
            }
            html += '</div>';
        }
        html += '</div>';
    }

    // Tip de uso
    html += '<div style="background:rgba(255,170,68,0.05);border:1px dashed rgba(255,170,68,0.30);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:11.5px;color:#ddd;line-height:1.5;">';
    html += '💡 <strong style="color:#ffaa44;">Cómo usar:</strong> tocá <strong>"+ Agregar"</strong> en cualquier día para crear una difusión. Definí público objetivo, equipos, bono (50-100%) y mensaje. Queda en <strong>pendiente</strong>. Cuando estés listo, tocá <strong>🚀 Lanzar</strong> y se manda el push. Después, "Refrescar rendimiento" mide ROI.';
    html += '</div>';

    // Days grid
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">';
    for (const day of (plan.days || [])) {
        html += _renderCalendarDay(day);
    }
    html += '</div>';

    return html;
}

function _renderCalendarDay(day) {
    const strategies = (day.strategies || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    let html = '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<h4 style="color:#00d4ff;font-size:13px;margin:0;text-transform:uppercase;letter-spacing:1px;font-weight:800;">' + escapeHtml(day.label || '') + '</h4>';
    html += '<button onclick="_calOpenStratModal(' + day.dayIndex + ', null)" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:4px 9px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;">+ Agregar</button>';
    html += '</div>';

    // Quick-action: 3 botones para mandar recordatorio de bono no reclamado.
    // Click -> confirma -> dispara push a todos los que no reclamaron AHORA
    // (el periodo se calcula server-side: dia/semana/mes corriente). Sirven
    // para zafar "olvidos" de la gente sin tener que armar una difusion full.
    html += '<div style="background:rgba(212,175,55,0.05);border:1px dashed rgba(212,175,55,0.30);border-radius:8px;padding:7px 8px;">';
    html += '<div style="color:#ffd700;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px;">⚡ Recordatorios rápidos · "no reclamaste tu bono"</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">';
    html += '<button onclick="_calBonusReminder(\'daily\')"   style="background:rgba(255,170,102,0.12);color:#ffaa66;border:1px solid rgba(255,170,102,0.40);padding:6px 4px;border-radius:5px;font-size:10.5px;font-weight:800;cursor:pointer;letter-spacing:0.3px;" title="Push a los que no reclamaron el bono diario de HOY">📅 Diario</button>';
    html += '<button onclick="_calBonusReminder(\'weekly\')"  style="background:rgba(0,212,255,0.12);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:6px 4px;border-radius:5px;font-size:10.5px;font-weight:800;cursor:pointer;letter-spacing:0.3px;" title="Push a los que no reclamaron el bono semanal de esta semana">📆 Semanal</button>';
    html += '<button onclick="_calBonusReminder(\'monthly\')" style="background:rgba(155,48,255,0.12);color:#c89bff;border:1px solid rgba(155,48,255,0.40);padding:6px 4px;border-radius:5px;font-size:10.5px;font-weight:800;cursor:pointer;letter-spacing:0.3px;" title="Push a los que no reclamaron el bono mensual de este mes">🗓 Mensual</button>';
    html += '</div></div>';

    if (strategies.length === 0) {
        html += '<div style="color:#666;text-align:center;padding:12px;font-size:11px;font-style:italic;">Sin difusiones planificadas</div>';
    } else {
        for (const s of strategies) html += _renderStrategyCard(s);
    }
    html += '</div>';
    return html;
}

// Borra todas las strategies pendientes/canceladas no-pinned de la semana
// activa. Deja en pie las pinned (refund recordatorios fijos), las ya
// lanzadas (historial) y las en curso. Util para limpiar planes viejos
// y arrancar fresco.
async function _calCleanupNonPinned() {
    if (!confirm('⚠️ Limpiar TODAS las difusiones viejas de esta semana?\n\nSe borran las pendientes y canceladas. Quedan en pie:\n  • Las recordatorios fijos (pinned)\n  • Las ya lanzadas (historial)\n  • Las en curso\n\n¿Confirmás?')) return;
    if (_calCleanupNonPinned._busy) return;
    _calCleanupNonPinned._busy = true;
    try {
        const wk = _CAL_STATE.weekKey || _isoWeekKeyClient(new Date());
        const r = await authFetch('/api/admin/calendar/week/' + encodeURIComponent(wk) + '/strategies/non-pinned', {
            method: 'DELETE'
        });
        const d = await r.json();
        if (!r.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        showToast('🗑 ' + (d.removed || 0) + ' difusiones eliminadas', 'success');
        await loadCalendarPlan(wk);
    } catch (e) {
        alert('Error de conexión');
    } finally {
        _calCleanupNonPinned._busy = false;
    }
}

// Lanza un push de recordatorio de bono no reclamado. Pide confirmacion
// porque manda push real (no preview). El backend cuenta cuantos eran
// elegibles y devuelve el resultado.
async function _calBonusReminder(refundType) {
    const labels = { daily: 'diario (de HOY)', weekly: 'semanal (de esta semana)', monthly: 'mensual (de este mes)' };
    const label = labels[refundType] || refundType;
    if (!confirm('¿Mandar push a TODOS los que no reclamaron el bono ' + label + '?\n\nEl mensaje es preset: "no reclamaste tu bono, reclamalo!".\nQueda registrado en el calendario semanal.')) return;
    if (_calBonusReminder._busy) return;
    _calBonusReminder._busy = true;
    try {
        const r = await authFetch('/api/admin/calendar/bonus-reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: refundType })
        });
        const d = await r.json();
        if (!r.ok) {
            alert('❌ ' + (d.error || 'Error'));
            return;
        }
        if ((d.eligible || 0) === 0) {
            alert('ℹ️ No hay nadie elegible ahora — todos ya reclamaron o no tienen la app instalada.');
            return;
        }
        alert('🚀 Recordatorio enviado\n\nElegibles: ' + d.eligible + '\nEnviadas: ' + d.sent + '\nFallidas: ' + (d.failed || 0));
        await loadCalendarPlan();
    } catch (e) {
        alert('Error de conexión');
    } finally {
        _calBonusReminder._busy = false;
    }
}

function _renderStrategyCard(s) {
    const statusInfo = {
        pendiente: { color: '#ffaa66', bg: 'rgba(255,170,102,0.10)', label: '⏳ Pendiente' },
        lanzando: { color: '#00d4ff', bg: 'rgba(0,212,255,0.10)', label: '⚡ Lanzando…' },
        lanzado: { color: '#66ff66', bg: 'rgba(102,255,102,0.10)', label: '✅ Lanzada' },
        completado: { color: '#c89bff', bg: 'rgba(155,48,255,0.10)', label: '📊 Completada' },
        cancelado: { color: '#888', bg: 'rgba(255,255,255,0.05)', label: '✖ Cancelada' }
    }[s.status] || { color: '#aaa', bg: 'rgba(255,255,255,0.05)', label: s.status };

    const typeIcon = { push: '📲', refund: '💰', bonus: '🎁' }[s.type] || '📲';
    const pinBadge = s.isPinned ? '<span style="background:rgba(212,175,55,0.20);color:#ffd700;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:0.5px;margin-left:4px;">FIJO</span>' : '';

    let html = '<div style="background:' + statusInfo.bg + ';border:1px solid ' + statusInfo.color + ';border-radius:8px;padding:8px;font-size:11px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:4px;">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="color:#fff;font-weight:800;font-size:12px;line-height:1.3;">' + typeIcon + ' ' + escapeHtml(s.title || '(sin título)') + pinBadge + '</div>';
    html += '<div style="color:' + statusInfo.color + ';font-size:10px;font-weight:800;margin-top:2px;">' + statusInfo.label + '</div>';
    html += '</div></div>';

    html += '<div style="color:#aaa;font-size:10.5px;line-height:1.5;margin-bottom:6px;">';
    html += '🎯 ' + (!s.targetSegment || s.targetSegment === 'all' ? 'Todos' : String(s.targetSegment).toUpperCase());
    if (s.targetTier) html += ' · ' + s.targetTier;
    if (s.targetTeams && s.targetTeams.length > 0) html += ' · ' + s.targetTeams.length + ' equipo' + (s.targetTeams.length === 1 ? '' : 's');
    if (s.bonusPercent > 0) html += ' · 🎁 ' + s.bonusPercent + '%';
    if (s.bonusFlatARS > 0) html += ' · 🎁 ' + _fmtMoney(s.bonusFlatARS);
    if (s.hasAppOnly) html += ' · solo con app';
    html += '</div>';

    if (s.status === 'lanzado' || s.status === 'completado') {
        const p = s.performance || {};
        const roi = p.roi || 0;
        const roiColor = roi >= 1.5 ? '#66ff66' : (roi >= 0.8 ? '#ffaa66' : '#ff8080');
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:6px 8px;margin-bottom:6px;font-size:10px;line-height:1.6;">';
        html += '<div style="color:#aaa;">📤 Enviadas: <strong style="color:#fff;">' + (s.sentCount || 0).toLocaleString('es-AR') + '</strong> · Respuesta: <strong style="color:' + roiColor + ';">' + ((p.responseRate || 0) * 100).toFixed(1) + '%</strong></div>';
        html += '<div style="color:#aaa;">💵 ' + _fmtMoney(p.newDepositsAmountARS) + ' generados · 🎁 ' + _fmtMoney(p.bonusGivenARS) + ' bono</div>';
        html += '<div style="color:' + roiColor + ';font-weight:800;">ROI ' + roi.toFixed(2) + 'x · ' + (p.daysObserved || 0) + 'd observados</div>';
        html += '</div>';
    }

    // Linea de tipos para refund: chips con cada tipo activo (daily/weekly/monthly)
    if (s.type === 'refund' && s.refundTypes && s.refundTypes.length > 0) {
        const labels = { daily: '📅 Diario', weekly: '📆 Semanal', monthly: '🗓 Mensual' };
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">';
        for (const t of s.refundTypes) {
            html += '<span style="background:rgba(212,175,55,0.10);color:#ffd700;border:1px solid rgba(212,175,55,0.30);padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;">' + (labels[t] || t) + '</span>';
        }
        html += '</div>';
    }

    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
    if (s.status === 'pendiente') {
        html += '<button onclick="_calLaunchStrategy(' + escapeJsArg(s.id) + ')" style="flex:1;background:linear-gradient(135deg,#ff5050,#ff8080);color:#fff;border:none;padding:6px;border-radius:5px;font-weight:900;font-size:10.5px;cursor:pointer;letter-spacing:0.5px;">🚀 Lanzar</button>';
        html += '<button onclick="_calPreviewAudience(' + escapeJsArg(s.id) + ')" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:6px 8px;border-radius:5px;font-weight:700;font-size:10px;cursor:pointer;" title="Ver destinatarios">👥</button>';
        html += '<button onclick="_calOpenStratModal(' + s.dayIndex + ', ' + escapeJsArg(s.id) + ')" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:6px 8px;border-radius:5px;font-weight:700;font-size:10px;cursor:pointer;">✏</button>';
        if (!s.isPinned) {
            html += '<button onclick="_calDeleteStrategy(' + escapeJsArg(s.id) + ')" style="background:rgba(255,80,80,0.10);color:#ff5050;border:1px solid rgba(255,80,80,0.30);padding:6px 8px;border-radius:5px;font-weight:700;font-size:10px;cursor:pointer;">✖</button>';
        }
    } else if (s.status === 'lanzado' || s.status === 'completado') {
        html += '<button onclick="_calRefreshPerf(' + escapeJsArg(s.id) + ')" style="flex:1;background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:6px;border-radius:5px;font-weight:700;font-size:10.5px;cursor:pointer;">🔄 Refrescar rendimiento</button>';
        html += '<button onclick="_calViewDetail(' + escapeJsArg(s.id) + ')" style="background:rgba(155,48,255,0.10);color:#c89bff;border:1px solid rgba(155,48,255,0.40);padding:6px 8px;border-radius:5px;font-weight:700;font-size:10px;cursor:pointer;">Ver</button>';
    }
    html += '</div>';

    html += '</div>';
    return html;
}

function _calChangeWeek(delta) {
    const wk = _CAL_STATE.weekKey;
    if (!wk) return;
    const m = /^(\d{4})-W(\d{2})$/.exec(wk);
    if (!m) return;
    let year = parseInt(m[1], 10);
    let week = parseInt(m[2], 10) + delta;
    if (week < 1) { week = 52; year--; }
    if (week > 53) { week = 1; year++; }
    loadCalendarPlan(year + '-W' + String(week).padStart(2, '0'));
}

async function _calToggleHistory() {
    _CAL_STATE.historyOpen = !_CAL_STATE.historyOpen;
    if (_CAL_STATE.historyOpen && _CAL_STATE.history.length === 0) {
        try {
            const r = await authFetch('/api/admin/calendar/history?limit=24');
            const j = await r.json();
            _CAL_STATE.history = j.plans || [];
        } catch (e) { _CAL_STATE.history = []; }
    }
    document.getElementById('automationsContent').innerHTML = _renderCalendarPlan();
}

function _calOpenStratModal(dayIndex, editingId) {
    const editing = editingId ? _calFindStrategy(editingId) : null;
    let modal = document.getElementById('calStratModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'calStratModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:center;justify-content:center;padding:14px;overflow-y:auto;';
    const teamsOpts = _CAL_STATE.teams.map(t => '<option value="' + escapeHtml(t) + '"' + (editing && (editing.targetTeams || []).includes(t) ? ' selected' : '') + '>' + escapeHtml(t) + '</option>').join('');
    const segOpts = ['all','caliente','en_riesgo','perdido','inactivo','activo'].map(s => '<option value="' + s + '"' + (editing && editing.targetSegment === s ? ' selected' : (s === 'all' && !editing ? ' selected' : '')) + '>' + s.toUpperCase() + '</option>').join('');
    const tierOpts = ['','VIP','ORO','PLATA','BRONCE','NUEVO'].map(t => '<option value="' + t + '"' + (editing && editing.targetTier === t ? ' selected' : '') + '>' + (t || '— todos —') + '</option>').join('');
    const typeOpts = ['push','bonus','refund'].map(t => '<option value="' + t + '"' + (editing && editing.type === t ? ' selected' : '') + '>' + t + '</option>').join('');

    modal.innerHTML =
        '<div style="background:#1a0033;border:2px solid #00d4ff;border-radius:14px;max-width:560px;width:100%;padding:18px 16px;">' +
        '<h3 style="color:#00d4ff;margin:0 0 6px;">' + (editing ? '✏ Editar' : '+ Nueva') + ' difusión · ' + _DAYS_FULL_CLIENT[dayIndex] + '</h3>' +
        '<div style="color:#aaa;font-size:11px;margin-bottom:10px;">Queda en <strong>pendiente</strong> hasta que toques 🚀 Lanzar.</div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
        '<div><label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Tipo</label><select id="cal_type" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px;border-radius:5px;margin-top:3px;">' + typeOpts + '</select></div>' +
        '<div><label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Bono %</label><input id="cal_bonusPct" type="number" min="0" max="100" step="5" value="' + (editing ? (editing.bonusPercent || 0) : 50) + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px;border-radius:5px;margin-top:3px;"><div style="color:#666;font-size:10px;margin-top:2px;">Mínimo 50% — máximo 100%</div></div>' +
        '</div>' +

        '<label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Título</label>' +
        '<input id="cal_title" type="text" maxlength="80" placeholder="Ej: 🎁 Bono del 50% para vos" value="' + (editing ? escapeHtml(editing.title || '') : '') + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:8px 10px;border-radius:6px;margin:3px 0 8px;box-sizing:border-box;">' +

        '<label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Mensaje</label>' +
        '<textarea id="cal_body" maxlength="240" placeholder="Cargá hoy y te duplicamos lo que pongas. Hasta las 23:59." style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:8px 10px;border-radius:6px;margin:3px 0 10px;box-sizing:border-box;min-height:60px;resize:vertical;">' + (editing ? escapeHtml(editing.body || '') : '') + '</textarea>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
        '<div><label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Segmento</label><select id="cal_segment" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px;border-radius:5px;margin-top:3px;">' + segOpts + '</select></div>' +
        '<div><label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Tier</label><select id="cal_tier" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px;border-radius:5px;margin-top:3px;">' + tierOpts + '</select></div>' +
        '</div>' +

        '<label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Equipos (vacío = todos)</label>' +
        '<select id="cal_teams" multiple size="4" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px;border-radius:5px;margin:3px 0 8px;">' + teamsOpts + '</select>' +

        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><input id="cal_hasApp" type="checkbox" ' + (!editing || editing.hasAppOnly ? 'checked' : '') + '><label for="cal_hasApp" style="color:#aaa;font-size:11px;">Solo enviar a usuarios con app instalada (recomendado)</label></div>' +

        // refundTypes solo visible si type=refund (lo togglea el handler abajo)
        '<div id="cal_refundTypesBox" style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:6px;padding:8px;margin-bottom:12px;display:' + ((editing && editing.type === 'refund') ? 'block' : 'none') + ';">' +
        '  <div style="color:#ffd700;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px;">Tipos de reembolso a incluir</div>' +
        '  <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#ddd;">' +
        '    <label><input id="cal_rt_daily" type="checkbox" ' + ((!editing || (editing.refundTypes || ['daily','weekly','monthly']).includes('daily')) ? 'checked' : '') + '> 📅 Diario</label>' +
        '    <label><input id="cal_rt_weekly" type="checkbox" ' + ((!editing || (editing.refundTypes || ['daily','weekly','monthly']).includes('weekly')) ? 'checked' : '') + '> 📆 Semanal</label>' +
        '    <label><input id="cal_rt_monthly" type="checkbox" ' + ((!editing || (editing.refundTypes || ['daily','weekly','monthly']).includes('monthly')) ? 'checked' : '') + '> 🗓 Mensual</label>' +
        '  </div>' +
        '  <div style="color:#888;font-size:10px;margin-top:5px;line-height:1.5;">Audiencia automática: union de usuarios con cada tipo pendiente HOY (con cargas y sin reclamar todavía).</div>' +
        '</div>' +

        '<div style="display:flex;gap:8px;">' +
        '<button onclick="document.getElementById(\'calStratModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
        '<button onclick="_calSaveStrategy(' + dayIndex + ', ' + (editingId ? escapeJsArg(editingId) : 'null') + ')" style="flex:2;background:linear-gradient(135deg,#00d4ff,#0088ff);color:#000;border:none;padding:10px;border-radius:6px;font-weight:900;font-size:12px;cursor:pointer;">' + (editing ? 'Guardar cambios' : 'Crear y guardar') + '</button>' +
        '</div>' +
        '</div>';
    document.body.appendChild(modal);
    // Toggle refundTypes box cuando cambia el type
    const typeSel = document.getElementById('cal_type');
    if (typeSel) {
        typeSel.addEventListener('change', () => {
            const box = document.getElementById('cal_refundTypesBox');
            if (box) box.style.display = (typeSel.value === 'refund') ? 'block' : 'none';
        });
    }
}

function _calFindStrategy(id) {
    const plan = _CAL_STATE.plan;
    if (!plan) return null;
    for (const d of plan.days) for (const s of (d.strategies || [])) if (s.id === id) return s;
    return null;
}

async function _calSaveStrategy(dayIndex, editingId) {
    const get = (id) => document.getElementById(id);
    const refundTypes = [];
    if (get('cal_rt_daily')?.checked) refundTypes.push('daily');
    if (get('cal_rt_weekly')?.checked) refundTypes.push('weekly');
    if (get('cal_rt_monthly')?.checked) refundTypes.push('monthly');
    const body = {
        type: get('cal_type').value,
        title: get('cal_title').value.trim(),
        body: get('cal_body').value.trim(),
        bonusPercent: parseInt(get('cal_bonusPct').value, 10) || 0,
        targetSegment: get('cal_segment').value,
        targetTier: get('cal_tier').value || null,
        targetTeams: Array.from(get('cal_teams').selectedOptions).map(o => o.value),
        hasAppOnly: get('cal_hasApp').checked,
        refundTypes,
        dayIndex
    };
    if (body.type === 'refund' && refundTypes.length === 0) {
        alert('Para refund necesitás al menos 1 tipo (diario / semanal / mensual)');
        return;
    }
    if (!body.title || !body.body) { alert('Falta título o mensaje'); return; }
    if (body.bonusPercent > 0 && body.bonusPercent < 50) { alert('El bono mínimo es 50%'); return; }
    if (body.bonusPercent > 100) { alert('El bono máximo es 100%'); return; }
    if (_calSaveStrategy._busy) return;
    _calSaveStrategy._busy = true;
    const wk = _CAL_STATE.weekKey;
    try {
        const url = editingId
            ? '/api/admin/calendar/strategy/' + encodeURIComponent(wk) + '/' + encodeURIComponent(editingId)
            : '/api/admin/calendar/week/' + encodeURIComponent(wk) + '/strategy';
        const method = editingId ? 'PUT' : 'POST';
        const r = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json();
        if (!r.ok) { alert('Error: ' + (d.error || 'no se pudo guardar')); return; }
        document.getElementById('calStratModal')?.remove();
        await loadCalendarPlan(wk);
    } catch (e) { alert('Error de conexión'); }
    finally { _calSaveStrategy._busy = false; }
}

async function _calDeleteStrategy(id) {
    if (!confirm('¿Eliminar esta difusión pendiente?')) return;
    const wk = _CAL_STATE.weekKey;
    try {
        const r = await authFetch('/api/admin/calendar/strategy/' + encodeURIComponent(wk) + '/' + encodeURIComponent(id), { method: 'DELETE' });
        const d = await r.json();
        if (!r.ok) { alert('Error: ' + (d.error || 'no se pudo borrar')); return; }
        await loadCalendarPlan(wk);
    } catch (e) { alert('Error de conexión'); }
}

async function _calLaunchStrategy(id) {
    const s = _calFindStrategy(id);
    if (!s) return;
    if (_calLaunchStrategy._busy) return; // Anti-double-click: la operacion lanza un push masivo y NO debe duplicarse
    const body = s.body || '';
    const title = s.title || '(sin título)';
    const msg = '¿LANZAR ahora?\n\n' +
        'Título: ' + title + '\n' +
        'Mensaje: ' + body.slice(0, 100) + (body.length > 100 ? '…' : '') + '\n\n' +
        'Segmento: ' + String(s.targetSegment || 'all').toUpperCase() +
        (s.targetTier ? ' · ' + s.targetTier : '') +
        (s.targetTeams && s.targetTeams.length ? ' · ' + s.targetTeams.length + ' equipos' : '') +
        (s.bonusPercent > 0 ? '\nBono: ' + s.bonusPercent + '%' : '') +
        '\nSolo con app: ' + (s.hasAppOnly ? 'Sí' : 'No');
    if (!confirm(msg)) return;
    _calLaunchStrategy._busy = true;
    const wk = _CAL_STATE.weekKey;
    try {
        const r = await authFetch('/api/admin/calendar/strategy/' + encodeURIComponent(wk) + '/' + encodeURIComponent(id) + '/launch', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) { alert('Error: ' + (d.error || 'no se pudo lanzar')); return; }
        alert('🚀 Lanzada\n\nElegibles: ' + d.eligible + '\nEnviadas: ' + d.sent + '\nFallidas: ' + (d.failed || 0) + '\n\n📊 En unas horas tocá "Refrescar rendimiento" para ver el ROI.');
        await loadCalendarPlan(wk);
    } catch (e) { alert('Error de conexión'); }
    finally { _calLaunchStrategy._busy = false; }
}

async function _calRefreshPerf(id) {
    const wk = _CAL_STATE.weekKey;
    try {
        const r = await authFetch('/api/admin/calendar/strategy/' + encodeURIComponent(wk) + '/' + encodeURIComponent(id) + '/refresh-performance', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) { alert('Error: ' + (d.error || 'no se pudo')); return; }
        await loadCalendarPlan(wk);
    } catch (e) { alert('Error de conexión'); }
}

// ============================================================
// QUICK LAUNCH (presets de Lanzar ahora)
// ============================================================
function _quickLaunchPresetOpen(cfgJson, label) {
    let cfg;
    try { cfg = (typeof cfgJson === 'string') ? JSON.parse(cfgJson) : cfgJson; } catch (_) { cfg = cfgJson; }
    if (!cfg) return;
    let modal = document.getElementById('quickLaunchModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'quickLaunchModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:center;justify-content:center;padding:14px;overflow-y:auto;';
    const tierChecks = ['VIP', 'ORO', 'PLATA', 'BRONCE', 'NUEVO'].map(t =>
        '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#ddd;"><input type="checkbox" id="ql_t_' + t + '"' + ((cfg.tiers || []).includes(t) ? ' checked' : '') + '> ' + t + '</label>'
    ).join(' ');

    modal.innerHTML =
        '<div style="background:#1a0033;border:2px solid #ffaa44;border-radius:14px;max-width:560px;width:100%;padding:18px 16px;">' +
        '<h3 style="color:#ffaa44;margin:0 0 4px;font-size:16px;">⚡ ' + escapeHtml(label) + '</h3>' +
        '<div style="color:#aaa;font-size:11px;margin-bottom:12px;">Editá lo que quieras y tocá <strong>Lanzar ahora</strong>. Queda registrado en el calendario semanal con su rendimiento.</div>' +

        '<label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Título</label>' +
        '<input id="ql_title" type="text" maxlength="80" value="' + escapeHtml(cfg.title || '') + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:8px 10px;border-radius:6px;margin:3px 0 8px;box-sizing:border-box;">' +

        '<label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Mensaje</label>' +
        '<textarea id="ql_body" maxlength="240" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:8px 10px;border-radius:6px;margin:3px 0 10px;box-sizing:border-box;min-height:65px;resize:vertical;">' + escapeHtml(cfg.body || '') + '</textarea>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
        '<div><label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Bono %</label><input id="ql_bonus" type="number" min="0" max="100" step="5" value="' + (cfg.bonusPercent || 0) + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px;border-radius:5px;margin-top:3px;"><div style="color:#666;font-size:10px;margin-top:2px;">0% = sin bono · mín 50% si hay</div></div>' +
        '<div><label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Segmento</label>' +
        '<select id="ql_segment" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px;border-radius:5px;margin-top:3px;">' +
        ['all','caliente','en_riesgo','perdido','inactivo','activo'].map(s => '<option value="' + s + '"' + (cfg.targetSegment === s ? ' selected' : '') + '>' + s.toUpperCase() + '</option>').join('') +
        '</select></div>' +
        '</div>' +

        '<label style="color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Tiers (vacío = todos)</label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;margin:5px 0 12px;padding:8px;background:rgba(0,0,0,0.30);border-radius:6px;">' + tierChecks + '</div>' +

        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;"><input id="ql_hasApp" type="checkbox" ' + (cfg.hasAppOnly !== false ? 'checked' : '') + '><label for="ql_hasApp" style="color:#aaa;font-size:11px;">Solo a usuarios con app instalada</label></div>' +

        '<div style="display:flex;gap:8px;">' +
        '<button onclick="document.getElementById(\'quickLaunchModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
        '<button onclick="_quickLaunchExecute()" style="flex:2;background:linear-gradient(135deg,#ff5050,#ff8888);color:#fff;border:none;padding:10px;border-radius:6px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;">🚀 LANZAR AHORA</button>' +
        '</div></div>';
    document.body.appendChild(modal);
}

async function _quickLaunchExecute() {
    const get = (id) => document.getElementById(id);
    const tiers = ['VIP', 'ORO', 'PLATA', 'BRONCE', 'NUEVO'].filter(t => get('ql_t_' + t)?.checked);
    const body = {
        title: get('ql_title').value.trim(),
        body: get('ql_body').value.trim(),
        bonusPercent: parseInt(get('ql_bonus').value, 10) || 0,
        type: 'bonus',
        targetSegment: get('ql_segment').value,
        tiers,
        targetTeams: [],
        hasAppOnly: get('ql_hasApp').checked
    };
    if (!body.title || !body.body) { alert('Falta título o mensaje'); return; }
    if (body.bonusPercent > 0 && body.bonusPercent < 50) { alert('El bono mínimo es 50%'); return; }
    if (body.bonusPercent > 100) { alert('El bono máximo es 100%'); return; }
    if (!confirm('¿Lanzar AHORA?\n\nSegmento: ' + String(body.targetSegment || 'all').toUpperCase() + (tiers.length ? ' · Tiers: ' + tiers.join('+') : ' · todos los tiers') + '\nBono: ' + (body.bonusPercent || 'sin bono') + (body.bonusPercent ? '%' : ''))) return;
    if (_quickLaunchExecute._busy) return;
    _quickLaunchExecute._busy = true;

    try {
        const r = await authFetch('/api/admin/calendar/quick-launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok) { alert('Error: ' + (d.error || 'no se pudo lanzar')); return; }
        alert('🚀 Lanzado\n\nElegibles: ' + d.eligible + '\nEnviadas: ' + d.sent + '\nFallidas: ' + (d.failed || 0) + '\n\n📊 Quedó registrado en el calendario semanal — entrá ahí y tocá "Refrescar rendimiento" en unas horas para ver el ROI.');
        document.getElementById('quickLaunchModal')?.remove();
    } catch (e) {
        alert('Error de conexión');
    }
    finally { _quickLaunchExecute._busy = false; }
}

async function _calPreviewAudience(id) {
    const wk = _CAL_STATE.weekKey;
    const s = _calFindStrategy(id);
    if (!s) return;
    let modal = document.getElementById('calPreviewModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'calPreviewModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.innerHTML = '<div style="background:#1a0033;border:2px solid #00d4ff;border-radius:14px;max-width:680px;width:100%;margin:8px auto;padding:18px 16px;"><h3 style="color:#00d4ff;margin:0 0 6px;font-size:16px;">👥 Destinatarios — ' + escapeHtml(s.title) + '</h3><div id="calPreviewBody" style="color:#aaa;text-align:center;padding:30px;">⏳ Calculando audiencia…</div><div style="display:flex;gap:8px;margin-top:12px;"><button onclick="document.getElementById(\'calPreviewModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Cerrar</button></div></div>';
    document.body.appendChild(modal);

    try {
        const r = await authFetch('/api/admin/calendar/strategy/' + encodeURIComponent(wk) + '/' + encodeURIComponent(id) + '/preview?limit=300');
        const d = await r.json();
        if (!r.ok) {
            document.getElementById('calPreviewBody').innerHTML = '<div style="color:#ff8080;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }

        let html = '';
        // Resumen
        html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:10px;margin-bottom:10px;">';
        html += '<div style="font-size:13px;color:#fff;font-weight:800;">Total a recibir: <span style="color:#00d4ff;font-size:20px;">' + d.total + '</span> usuarios</div>';

        // Si es refund, mostrar desglose por tipo
        if (d.type === 'refund' && d.breakdown && d.breakdown.byType) {
            html += '<div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;">';
            const labels = { daily: '📅 Diario', weekly: '📆 Semanal', monthly: '🗓 Mensual' };
            for (const t of Object.keys(d.breakdown.byType)) {
                const b = d.breakdown.byType[t];
                if (b.error) {
                    html += '<div style="background:rgba(255,80,80,0.10);border-radius:6px;padding:8px;font-size:11px;"><strong>' + (labels[t] || t) + '</strong><br><span style="color:#ff8080;">Error: ' + escapeHtml(b.error) + '</span></div>';
                } else {
                    html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:8px;font-size:11px;line-height:1.5;">';
                    html += '<div style="color:#ffd700;font-weight:800;">' + (labels[t] || t) + '</div>';
                    html += '<div style="color:#aaa;">Elegibles: <strong style="color:#fff;">' + (b.eligible || 0) + '</strong></div>';
                    html += '<div style="color:#aaa;">Sin app: ' + (b.withoutChannel || 0) + '</div>';
                    html += '<div style="color:#aaa;">Ya reclamaron: ' + (b.alreadyClaimed || 0) + '</div>';
                    html += '<div style="color:#66ff66;font-weight:700;">Quedan: ' + (b.finalAudience || 0) + '</div>';
                    html += '<div style="color:#666;font-size:9px;margin-top:3px;">period: ' + (b.periodKey || '—') + '</div>';
                    html += '</div>';
                }
            }
            html += '</div>';
        }
        html += '</div>';

        // Lista de usuarios
        const sample = d.sample || [];
        if (sample.length === 0) {
            html += '<div style="text-align:center;padding:20px;color:#888;">No hay destinatarios con los filtros actuales.</div>';
        } else {
            html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;overflow:hidden;max-height:50vh;overflow-y:auto;">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
            html += '<thead style="position:sticky;top:0;background:#2d0052;"><tr style="color:#00d4ff;text-align:left;">';
            html += '<th style="padding:7px 9px;font-weight:800;">Usuario</th>';
            if (d.type === 'refund') {
                html += '<th style="padding:7px 9px;font-weight:800;">Tipos pendientes</th>';
                html += '<th style="padding:7px 9px;font-weight:800;text-align:right;">$ a reclamar</th>';
            } else {
                html += '<th style="padding:7px 9px;font-weight:800;">Segmento</th>';
                html += '<th style="padding:7px 9px;font-weight:800;">Tier</th>';
                html += '<th style="padding:7px 9px;font-weight:800;text-align:right;">Días sin carga</th>';
            }
            html += '<th style="padding:7px 9px;font-weight:800;">Equipo</th>';
            html += '</tr></thead><tbody>';
            const tlabels = { daily: '📅', weekly: '📆', monthly: '🗓' };
            for (const u of sample) {
                html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);">';
                html += '<td style="padding:6px 9px;color:#fff;font-weight:600;">' + escapeHtml(u.username) + '</td>';
                if (d.type === 'refund') {
                    html += '<td style="padding:6px 9px;color:#ddd;">' + ((u.types || []).map(t => tlabels[t] || t).join(' ')) + '</td>';
                    html += '<td style="padding:6px 9px;color:#d4af37;text-align:right;font-weight:800;">' + _fmtMoney(u.potentialAmount) + '</td>';
                } else {
                    html += '<td style="padding:6px 9px;color:#aaa;">' + escapeHtml(u.segment || '—') + '</td>';
                    html += '<td style="padding:6px 9px;color:#aaa;">' + escapeHtml(u.tier || '—') + '</td>';
                    html += '<td style="padding:6px 9px;color:#aaa;text-align:right;">' + (u.daysSinceLastDeposit == null ? '—' : u.daysSinceLastDeposit + 'd') + '</td>';
                }
                html += '<td style="padding:6px 9px;color:#aaa;font-size:10px;">' + (u.lineTeamName ? escapeHtml(u.lineTeamName) : '—') + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table></div>';
            if (d.truncated) {
                html += '<div style="color:#666;font-size:10px;text-align:center;margin-top:6px;">Mostrando primeros ' + sample.length + ' de ' + d.total + '. Al lanzar van todos.</div>';
            }
        }

        document.getElementById('calPreviewBody').innerHTML = html;
    } catch (e) {
        const body = document.getElementById('calPreviewBody');
        if (body) body.innerHTML = '<div style="color:#ff8080;">Error de conexión</div>';
    }
}

function _calViewDetail(id) {
    const s = _calFindStrategy(id);
    if (!s) return;
    const p = s.performance || {};
    const lines = [
        '📊 ' + s.title,
        '',
        'Estado: ' + s.status,
        'Lanzada: ' + (s.launchedAt ? new Date(s.launchedAt).toLocaleString('es-AR') : '—'),
        'Lanzada por: ' + (s.launchedBy || '—'),
        '',
        '— SEGMENTACION —',
        'Segmento: ' + (s.targetSegment || 'all'),
        'Tier: ' + (s.targetTier || '—'),
        'Equipos: ' + ((s.targetTeams && s.targetTeams.length) ? s.targetTeams.join(', ') : '— todos —'),
        'Solo con app: ' + (s.hasAppOnly ? 'sí' : 'no'),
        'Bono: ' + (s.bonusPercent ? s.bonusPercent + '%' : (s.bonusFlatARS ? '$' + s.bonusFlatARS.toLocaleString('es-AR') : '—')),
        '',
        '— ENVIO —',
        'Targets: ' + (s.targetUsernames || []).length,
        'Enviadas: ' + (s.sentCount || 0),
        'Entregadas: ' + (s.deliveredCount || 0),
        'Fallidas: ' + (s.failedCount || 0),
        '',
        '— RENDIMIENTO POSTERIOR —',
        'Días observados: ' + (p.daysObserved || 0),
        'Respondieron: ' + (p.respondersCount || 0) + ' (' + (((p.responseRate || 0) * 100).toFixed(1)) + '%)',
        'Cargas generadas: ' + (p.newDepositsCount || 0) + ' · $' + (p.newDepositsAmountARS || 0).toLocaleString('es-AR'),
        'Bonos entregados: $' + (p.bonusGivenARS || 0).toLocaleString('es-AR') + ' (' + (p.bonusClaimedCount || 0) + ')',
        'ROI: ' + (p.roi || 0).toFixed(2) + 'x',
        'Veredicto: ' + (p.sentiment || 'sin datos').toUpperCase(),
        '',
        s.notes ? '📝 ' + s.notes : ''
    ].filter(Boolean).join('\n');
    alert(lines);
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
    // Refrescar el summary del slot para reflejar la nueva lista cargada.
    try { refreshSlotListSummary(i); } catch (_) {}
}

// Lee teamName + linePhone de un slot (para llamar al endpoint by-line).
function _readSlotIdentity(i) {
    const slot = document.querySelector(`.user-line-slot[data-slot-index="${i}"]`);
    if (!slot) return null;
    const team = (slot.querySelector('.user-line-team')?.value || '').trim();
    const phone = (slot.querySelector('.user-line-phone')?.value || '').trim();
    if (!team) return null;
    const digits = phone.replace(/[^\d]/g, '');
    return { team, phoneDigits: digits, linePhone: digits ? '+' + digits : '' };
}

// Hidrata el resumen "📋 Lista cargada: N usuarios · última carga..." debajo
// de cada slot. Se llama al cargar la sección y después de cada import.
async function refreshSlotListSummary(i) {
    const box = document.getElementById('slotListSummary-' + i);
    if (!box) return;
    const id = _readSlotIdentity(i);
    if (!id || !id.team) {
        box.innerHTML = '<div style="color:#888;font-size:11px;">Completá el equipo y el número arriba para ver la lista cargada.</div>';
        return;
    }
    box.innerHTML = '<div style="color:#888;font-size:11px;">⏳ Cargando…</div>';
    try {
        const params = new URLSearchParams();
        params.set('teamName', id.team);
        if (id.linePhone) params.set('linePhone', id.linePhone);
        params.set('limit', '1');
        const r = await authFetch('/api/admin/user-lines/lookup-by-line?' + params.toString());
        if (!r.ok) {
            box.innerHTML = '<div style="color:#ff8080;font-size:11px;">Error ' + r.status + ' cargando lista</div>';
            return;
        }
        const j = await r.json();
        const total = j.totalCount || 0;
        const reg = j.registeredCount || 0;
        const pend = j.pendingCount || 0;
        const xlsxCount = j.xlsxCount || 0;
        const autoCount = j.autoCount || 0;
        const last = j.lastImportAt ? new Date(j.lastImportAt) : null;
        const lastStr = last ? last.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const lastBy = j.lastImportBy ? ' · por <strong style="color:#fff;">' + escapeHtml(j.lastImportBy) + '</strong>' : '';
        let html = '';
        if (total === 0) {
            html += '<div style="color:#aaa;font-size:11px;">Esta línea todavía no tiene usuarios. Pueden venir desde xlsx (subí abajo) o asignarse automáticamente cuando un user con el prefijo se registre.</div>';
        } else {
            html += '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline;">';
            html += '  <span style="color:#00d4ff;font-weight:800;font-size:14px;">📋 ' + total + ' usuarios en esta línea</span>';
            if (xlsxCount > 0) {
                html += '  <span style="color:#888;font-size:10.5px;">Última carga xlsx: <strong style="color:#fff;">' + escapeHtml(lastStr) + '</strong>' + lastBy + '</span>';
            }
            html += '</div>';
            html += '<div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;font-size:11px;">';
            html += '  <span style="background:rgba(37,211,102,0.10);color:#25d366;padding:3px 8px;border-radius:5px;font-weight:700;">✅ ' + reg + ' registrados</span>';
            if (pend > 0) {
                html += '  <span style="background:rgba(255,170,68,0.10);color:#ffaa44;padding:3px 8px;border-radius:5px;font-weight:700;">⏳ ' + pend + ' pre-asignados</span>';
            }
            if (xlsxCount > 0) {
                html += '  <span style="background:rgba(0,212,255,0.10);color:#00d4ff;padding:3px 8px;border-radius:5px;font-weight:700;">📋 ' + xlsxCount + ' por xlsx</span>';
            }
            if (autoCount > 0) {
                html += '  <span style="background:rgba(157,78,221,0.10);color:#c89bff;padding:3px 8px;border-radius:5px;font-weight:700;">⚙️ ' + autoCount + ' auto (prefijo)</span>';
            }
            html += '</div>';
        }
        box.innerHTML = html;
    } catch (e) {
        box.innerHTML = '<div style="color:#ff8080;font-size:11px;">Error: ' + escapeHtml(e.message || '') + '</div>';
    }
}

// Llamada por el botón 👁 Ver lista cargada — abre modal con detalle.
async function slotShowList(i) {
    const id = _readSlotIdentity(i);
    if (!id || !id.team) {
        showToast('Completá el equipo y el número arriba primero', 'error');
        return;
    }
    let m = document.getElementById('slotListModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'slotListModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:10005;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div id="slotListBody" style="background:#0f1024;border:1px solid #00d4ff;border-radius:12px;padding:18px;max-width:760px;width:100%;max-height:92vh;overflow-y:auto;color:#fff;font-family:system-ui;"></div>';
        m.onclick = (e) => { if (e.target === m) m.remove(); };
        document.body.appendChild(m);
    }
    const body = document.getElementById('slotListBody');
    body.innerHTML = '<div style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando lista…</div>';
    try {
        const params = new URLSearchParams();
        params.set('teamName', id.team);
        if (id.linePhone) params.set('linePhone', id.linePhone);
        const r = await authFetch('/api/admin/user-lines/lookup-by-line?' + params.toString());
        if (!r.ok) {
            body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error ' + r.status + '</div>';
            return;
        }
        const j = await r.json();
        body.innerHTML = _renderSlotListModalHtml(j, i);
    } catch (e) {
        body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function closeSlotListModal() {
    const m = document.getElementById('slotListModal');
    if (m) m.remove();
}

function _renderSlotListModalHtml(j, slotIndex) {
    const items = j.items || [];
    const total = j.totalCount || 0;
    const reg = j.registeredCount || 0;
    const pend = j.pendingCount || 0;
    const last = j.lastImportAt ? new Date(j.lastImportAt).toLocaleString('es-AR') : '—';

    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.10);padding-bottom:10px;margin-bottom:12px;">';
    html += '  <h3 style="margin:0;color:#00d4ff;font-size:17px;">📋 ' + escapeHtml(j.teamName || '') + (j.linePhone ? ' · ' + escapeHtml(j.linePhone) : '') + '</h3>';
    html += '  <button type="button" onclick="closeSlotListModal()" style="background:rgba(255,128,128,0.15);color:#ff8080;border:1px solid rgba(255,128,128,0.45);padding:5px 10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">✕ Cerrar</button>';
    html += '</div>';

    // KPIs
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;">';
    html += '  <div style="background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.40);border-radius:8px;padding:10px;">';
    html += '    <div style="color:#00d4ff;font-size:10px;letter-spacing:1px;font-weight:700;">TOTAL</div>';
    html += '    <div style="color:#fff;font-size:22px;font-weight:900;">' + total + '</div>';
    html += '  </div>';
    html += '  <div style="background:rgba(37,211,102,0.08);border:1px solid rgba(37,211,102,0.40);border-radius:8px;padding:10px;">';
    html += '    <div style="color:#25d366;font-size:10px;letter-spacing:1px;font-weight:700;">REGISTRADOS</div>';
    html += '    <div style="color:#fff;font-size:22px;font-weight:900;">' + reg + '</div>';
    html += '  </div>';
    html += '  <div style="background:rgba(255,170,68,0.08);border:1px solid rgba(255,170,68,0.40);border-radius:8px;padding:10px;">';
    html += '    <div style="color:#ffaa44;font-size:10px;letter-spacing:1px;font-weight:700;">PRE-ASIGNADOS</div>';
    html += '    <div style="color:#fff;font-size:22px;font-weight:900;">' + pend + '</div>';
    html += '  </div>';
    html += '</div>';

    html += '<div style="color:#aaa;font-size:11px;margin-bottom:10px;">Última carga: <strong style="color:#fff;">' + escapeHtml(last) + '</strong>' + (j.lastImportBy ? ' · por <strong style="color:#fff;">' + escapeHtml(j.lastImportBy) + '</strong>' : '') + '</div>';

    if (items.length === 0) {
        html += '<div style="text-align:center;color:#aaa;padding:20px;">Sin usuarios cargados.</div>';
    } else {
        html += '<div style="overflow-x:auto;max-height:50vh;overflow-y:auto;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
        html += '  <thead><tr style="background:rgba(255,255,255,0.04);position:sticky;top:0;">';
        html += '    <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Usuario</th>';
        html += '    <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Estado</th>';
        html += '    <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">App</th>';
        html += '    <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Origen</th>';
        html += '    <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Cargado</th>';
        html += '  </tr></thead><tbody>';
        const sourceLabel = (s) => {
            if (!s) return '—';
            if (s === 'xlsx-pending') return '<span style="color:#00d4ff;">📋 xlsx (pendiente)</span>';
            if (s === 'xlsx-registered') return '<span style="color:#00d4ff;">📋 xlsx</span>';
            if (s.startsWith('user-')) return '<span style="color:#c89bff;">⚙️ ' + escapeHtml(s.replace('user-','')) + '</span>';
            return '<span style="color:#888;">' + escapeHtml(s) + '</span>';
        };
        for (const it of items) {
            const dt = it.importedAt ? new Date(it.importedAt).toLocaleDateString('es-AR') : '—';
            html += '<tr>';
            html += '  <td style="padding:5px 10px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.04);">' + escapeHtml(it.usernameOriginal || it.usernameNorm) + '</td>';
            html += '  <td style="padding:5px 10px;border-bottom:1px solid rgba(255,255,255,0.04);">' + (it.registered ? '<span style="color:#25d366;font-weight:700;">✅ Registrado</span>' : '<span style="color:#ffaa44;font-weight:700;">⏳ Pre-asignado</span>') + '</td>';
            html += '  <td style="padding:5px 10px;border-bottom:1px solid rgba(255,255,255,0.04);">' + (it.hasApp ? '<span style="color:#25d366;">📱 Sí</span>' : '<span style="color:#888;">—</span>') + '</td>';
            html += '  <td style="padding:5px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:10.5px;">' + sourceLabel(it.source) + '</td>';
            html += '  <td style="padding:5px 10px;color:#888;font-size:10.5px;border-bottom:1px solid rgba(255,255,255,0.04);">' + escapeHtml(dt) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    html += '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">';
    html += '  <button type="button" onclick="slotDownloadCsv(' + slotIndex + ')" style="background:linear-gradient(135deg,#25d366,#128c4f);color:#fff;border:none;padding:9px 14px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">📥 Descargar CSV</button>';
    html += '  <button type="button" onclick="closeSlotListModal()" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 14px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Cerrar</button>';
    html += '</div>';

    return html;
}

// Modal con el historial de cargas .xlsx para esta línea. Cada upload
// queda como una "sesión" separada (todas las filas del mismo bulk
// comparten importedAt). El admin ve cuándo cargó cada archivo, cuántos
// usuarios trajo y puede descargar el CSV de esa carga puntual.
async function slotShowHistory(i) {
    const id = _readSlotIdentity(i);
    if (!id || !id.team) {
        showToast('Completá el equipo y el número arriba primero', 'error');
        return;
    }
    let m = document.getElementById('slotHistoryModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'slotHistoryModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:10006;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div id="slotHistoryBody" style="background:#0f1024;border:1px solid #ffd700;border-radius:12px;padding:18px;max-width:760px;width:100%;max-height:92vh;overflow-y:auto;color:#fff;font-family:system-ui;"></div>';
        m.onclick = (e) => { if (e.target === m) m.remove(); };
        document.body.appendChild(m);
    }
    const body = document.getElementById('slotHistoryBody');
    body.innerHTML = '<div style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando historial…</div>';
    try {
        const params = new URLSearchParams();
        params.set('teamName', id.team);
        if (id.linePhone) params.set('linePhone', id.linePhone);
        const r = await authFetch('/api/admin/user-lines/import-history?' + params.toString());
        if (!r.ok) {
            body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error ' + r.status + '</div>';
            return;
        }
        const j = await r.json();
        body.innerHTML = _renderSlotHistoryHtml(j, id);
    } catch (e) {
        body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function closeSlotHistoryModal() {
    const m = document.getElementById('slotHistoryModal');
    if (m) m.remove();
}

function _renderSlotHistoryHtml(j, id) {
    const sessions = j.sessions || [];
    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.10);padding-bottom:10px;margin-bottom:12px;">';
    html += '  <h3 style="margin:0;color:#ffd700;font-size:17px;">📅 Historial de cargas · ' + escapeHtml(j.teamName || '') + (j.linePhone ? ' · ' + escapeHtml(j.linePhone) : '') + '</h3>';
    html += '  <button type="button" onclick="closeSlotHistoryModal()" style="background:rgba(255,128,128,0.15);color:#ff8080;border:1px solid rgba(255,128,128,0.45);padding:5px 10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">✕ Cerrar</button>';
    html += '</div>';

    html += '<div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:10px;margin-bottom:12px;">';
    html += '  <div style="color:#ffd700;font-weight:800;font-size:13px;">' + (j.totalSessions || 0) + ' archivos cargados · ' + (j.totalUsers || 0) + ' usuarios totales</div>';
    html += '  <div style="color:#aaa;font-size:11px;margin-top:3px;">Cada fila es UN archivo .xlsx que cargaste (agrupado por timestamp). Tocá CSV para descargar SOLO los users de esa carga puntual.</div>';
    html += '</div>';

    if (sessions.length === 0) {
        html += '<div style="text-align:center;color:#aaa;padding:30px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.10);border-radius:10px;">Esta línea todavía no tiene cargas .xlsx registradas.</div>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        for (const s of sessions) {
            const dt = s.importedAt ? new Date(s.importedAt) : null;
            const dtStr = dt ? dt.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const isoForUrl = dt ? dt.toISOString() : '';
            const sample = (s.sampleUsernames || []).slice(0, 5).join(', ') + ((s.sampleUsernames || []).length > 5 ? ', …' : '');
            html += '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
            html += '  <div style="background:rgba(212,175,55,0.15);color:#ffd700;font-weight:800;font-size:18px;padding:8px 14px;border-radius:8px;min-width:70px;text-align:center;">' + (s.count || 0) + '</div>';
            html += '  <div style="flex:1;min-width:180px;">';
            html += '    <div style="color:#fff;font-weight:700;font-size:13px;">📅 ' + escapeHtml(dtStr) + '</div>';
            html += '    <div style="color:#aaa;font-size:11px;margin-top:2px;">' + (s.importedBy ? 'por <strong style="color:#fff;">' + escapeHtml(s.importedBy) + '</strong> · ' : '') + 'usuarios: ' + escapeHtml(sample || '—') + '</div>';
            html += '  </div>';
            html += '  <button type="button" onclick="slotDownloadHistorySession(' + JSON.stringify(j.teamName).replace(/"/g, '&quot;') + ',' + JSON.stringify(j.linePhone || '').replace(/"/g, '&quot;') + ',' + JSON.stringify(isoForUrl).replace(/"/g, '&quot;') + ')" style="padding:7px 12px;background:linear-gradient(135deg,#25d366,#128c4f);color:#fff;border:none;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;">📥 CSV de esta carga</button>';
            html += '</div>';
        }
        html += '</div>';
    }

    html += '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">';
    html += '  <button type="button" onclick="closeSlotHistoryModal()" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 14px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Cerrar</button>';
    html += '</div>';

    return html;
}

// Descarga el CSV de UNA sesión histórica de carga (filtrada por importedAt).
async function slotDownloadHistorySession(teamName, linePhone, importedAtIso) {
    if (!teamName || !importedAtIso) return;
    try {
        const params = new URLSearchParams();
        params.set('teamName', teamName);
        if (linePhone) params.set('linePhone', linePhone);
        params.set('importedAt', importedAtIso);
        const r = await authFetch('/api/admin/user-lines/import-history.csv?' + params.toString());
        if (!r.ok) {
            showToast('Error descargando CSV (' + r.status + ')', 'error');
            return;
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateTag = importedAtIso.slice(0, 19).replace(/[:.]/g, '-');
        a.download = 'carga-' + teamName.replace(/[^a-z0-9_-]/gi, '_') + '-' + dateTag + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1500);
        showToast('✅ CSV de la carga descargado', 'success');
    } catch (e) {
        showToast('Error: ' + (e.message || e), 'error');
    }
}

// Descarga el CSV de la línea de este slot.
async function slotDownloadCsv(i) {
    const id = _readSlotIdentity(i);
    if (!id || !id.team) {
        showToast('Completá el equipo y el número arriba primero', 'error');
        return;
    }
    try {
        const params = new URLSearchParams();
        params.set('teamName', id.team);
        if (id.linePhone) params.set('linePhone', id.linePhone);
        const r = await authFetch('/api/admin/user-lines/lookup-by-line.csv?' + params.toString());
        if (!r.ok) {
            showToast('Error descargando CSV (' + r.status + ')', 'error');
            return;
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'linea-' + id.team.replace(/[^a-z0-9_-]/gi, '_') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1500);
        showToast('✅ CSV descargado', 'success');
    } catch (e) {
        showToast('Error: ' + (e.message || e), 'error');
    }
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

// ============================================
// CAÍDA DE LÍNEA — broadcast + reemplazo de número
// ============================================
let _lineDownTeamsCache = null;
let _lineDownPreviewTimer = null;

async function loadLineDownTeams() {
    const sel = document.getElementById('lineDownTeamSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Cargando…</option>';
    try {
        const r = await authFetch('/api/admin/teams/stats');
        if (!r.ok) {
            sel.innerHTML = '<option value="">❌ Error cargando equipos</option>';
            return;
        }
        const j = await r.json();
        _lineDownTeamsCache = j;
        const teams = Array.isArray(j.teams) ? j.teams : [];
        // Construir options:
        //  - 1 opción por TEAM (modo prefix se aplica desde el dropdown de modo)
        //  - 1 opción por sub-LÍNEA (con · y telefono al lado)
        let opts = '<option value="">— Elegí equipo o línea —</option>';
        const sortedTeams = teams.slice().sort((a, b) => (b.totalUsers || 0) - (a.totalUsers || 0));
        for (const t of sortedTeams) {
            opts += '<optgroup label="' + escapeHtml(t.teamName) + ' (' + (t.totalUsers || 0) + ' users)">';
            opts += '<option value="' + escapeHtml(t.teamName) + '" data-mode="exact">' + escapeHtml(t.teamName) + ' · TODO el equipo</option>';
            const lines = Array.isArray(t.lines) ? t.lines : [];
            for (const l of lines) {
                const lbl = (l.fullLabel || '').trim();
                if (!lbl || lbl === t.teamName) continue;
                const phone = l.linePhone ? ' (' + l.linePhone + ')' : '';
                opts += '<option value="' + escapeHtml(lbl) + '" data-mode="exact">' + escapeHtml(lbl) + ' — ' + (l.count || 0) + ' users' + escapeHtml(phone) + '</option>';
            }
            opts += '</optgroup>';
        }
        sel.innerHTML = opts;
    } catch (e) {
        console.error('loadLineDownTeams error:', e);
        sel.innerHTML = '<option value="">❌ Error de conexión</option>';
    }
}

function onLineDownTeamChange() {
    // Debounce el preview para no spamear en cambios rápidos.
    if (_lineDownPreviewTimer) clearTimeout(_lineDownPreviewTimer);
    _lineDownPreviewTimer = setTimeout(loadLineDownPreview, 200);
}

async function loadLineDownPreview() {
    const sel = document.getElementById('lineDownTeamSelect');
    const modeSel = document.getElementById('lineDownTeamMode');
    const preview = document.getElementById('lineDownPreview');
    const previewContent = document.getElementById('lineDownPreviewContent');
    const oldPhoneInput = document.getElementById('lineDownOldPhone');
    if (!sel || !modeSel || !preview || !previewContent || !oldPhoneInput) return;

    const teamName = sel.value;
    if (!teamName) {
        preview.style.display = 'none';
        oldPhoneInput.value = '';
        return;
    }
    const mode = modeSel.value || 'exact';

    preview.style.display = 'block';
    previewContent.innerHTML = '⏳ Calculando…';
    oldPhoneInput.value = '';

    try {
        const url = '/api/admin/line-down/preview?teamName=' + encodeURIComponent(teamName) + '&teamMode=' + encodeURIComponent(mode);
        const r = await authFetch(url);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            previewContent.innerHTML = '❌ ' + escapeHtml(err.error || 'Error');
            return;
        }
        const j = await r.json();
        const slots = Array.isArray(j.matchingSlots) ? j.matchingSlots : [];
        const phones = [...new Set(slots.map(s => s.phone).filter(Boolean))];
        if (phones.length > 0) oldPhoneInput.value = phones[0];

        let html = '';
        html += '<span style="color:#fff;font-weight:700;">' + (j.affected || 0) + '</span> usuarios afectados';
        html += ' · <span style="color:#25d366;">' + (j.withChannel || 0) + '</span> con app+notifs';
        if (j.lookupPending) html += ' · <span style="color:#ffaa44;">' + j.lookupPending + '</span> pre-asignados';
        if (slots.length > 0) {
            html += '<br><span style="color:#888;font-size:11px;">Slots de "Números vigentes" afectados: ' + slots.map(s => escapeHtml(s.teamName) + ' (' + escapeHtml(s.phone) + ')').join(', ') + '</span>';
        } else {
            html += '<br><span style="color:#ffaa44;font-size:11px;">⚠ No hay slot configurado en "Números vigentes" para este equipo. Solo se actualizarán User + UserLineLookup.</span>';
        }
        previewContent.innerHTML = html;
    } catch (e) {
        previewContent.innerHTML = '❌ Error de conexión';
    }
}

function toggleLineDownPromoFields() {
    const cb = document.getElementById('lineDownPromoEnabled');
    const fields = document.getElementById('lineDownPromoFields');
    if (!cb || !fields) return;
    fields.style.display = cb.checked ? 'block' : 'none';
}

async function submitLineDown() {
    const sel = document.getElementById('lineDownTeamSelect');
    const modeSel = document.getElementById('lineDownTeamMode');
    const newPhoneEl = document.getElementById('lineDownNewPhone');
    const titleEl = document.getElementById('lineDownTitle');
    const messageEl = document.getElementById('lineDownMessage');
    const promoEnabledEl = document.getElementById('lineDownPromoEnabled');
    const bonusPctEl = document.getElementById('lineDownBonusPct');
    const durationDaysEl = document.getElementById('lineDownDurationDays');
    const promoMessageEl = document.getElementById('lineDownPromoMessage');
    const promoCodeEl = document.getElementById('lineDownPromoCode');
    const submitBtn = document.getElementById('lineDownSubmitBtn');

    const teamName = (sel.value || '').trim();
    if (!teamName) { showToast('Elegí un equipo o línea', 'error'); return; }
    const teamMode = modeSel.value || 'exact';
    const newPhone = (newPhoneEl.value || '').trim();
    if (!newPhone) { showToast('Falta el nuevo número', 'error'); return; }
    const message = (messageEl.value || '').trim();
    if (!message) { showToast('Falta el mensaje del push', 'error'); return; }
    const title = (titleEl.value || '').trim();

    const promoBody = promoEnabledEl.checked ? {
        enabled: true,
        bonusPct: Number(bonusPctEl.value),
        durationDays: Number(durationDaysEl.value),
        promoMessage: (promoMessageEl.value || '').trim(),
        promoCode: (promoCodeEl.value || '').trim()
    } : { enabled: false };

    // Confirmación: una vez disparado, el push sale y el número cambia.
    const confirmMsg = '¿Confirmás difundir caída de "' + teamName + '"?\n\n' +
        '• El número de los usuarios afectados se actualizará a: ' + newPhone + '\n' +
        '• Se enviará push con el mensaje configurado\n' +
        (promoBody.enabled ? ('• Promo activa: ' + promoBody.bonusPct + '% por ' + promoBody.durationDays + ' día(s)\n') : '');
    if (!window.confirm(confirmMsg)) return;

    submitBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '⏳ Enviando…';

    try {
        const r = await authFetch('/api/admin/line-down', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teamName,
                teamMode,
                newPhone,
                title,
                message,
                promo: promoBody
            })
        });
        const j = await r.json();
        if (!r.ok) {
            showToast(j.error || 'Error al difundir', 'error');
            return;
        }
        const summary = '✅ ' + j.audienceCount + ' afectados · ' +
            j.pushDelivered + ' entregados · ' +
            j.usersUpdated + ' users actualizados · ' +
            j.slotsUpdated + ' slot(s)';
        showToast(summary, 'success');

        // Reset del formulario.
        newPhoneEl.value = '';
        titleEl.value = '';
        messageEl.value = '';
        promoEnabledEl.checked = false;
        toggleLineDownPromoFields();
        loadLineDownPreview();
        loadLineDownHistory();
    } catch (e) {
        console.error('submitLineDown error:', e);
        showToast('Error de conexión', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// ============================================
// 🎯 ESTRATEGIA SEMANAL (tab dentro de Automatizaciones)
// ============================================
let _strategyConfigCache = null;
let _strategyBudgetCache = null;
let _strategyReportsCache = [];

async function _strategyRenderTab() {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando estrategia…</div>';
    try {
        const [cfgR, budR, repR] = await Promise.all([
            authFetch('/api/admin/strategy/config'),
            authFetch('/api/admin/strategy/budget-status'),
            authFetch('/api/admin/strategy/reports?limit=4')
        ]);
        if (!cfgR.ok || !budR.ok) {
            c.innerHTML = '<div class="empty-state">❌ Error cargando estrategia</div>';
            return;
        }
        _strategyConfigCache = (await cfgR.json()).config;
        _strategyBudgetCache = await budR.json();
        const repJ = repR.ok ? await repR.json() : { reports: [] };
        _strategyReportsCache = repJ.reports || [];
        c.innerHTML = _strategyBuildHtml();
    } catch (e) {
        c.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function _strategyBuildHtml() {
    const cfg = _strategyConfigCache;
    const bud = _strategyBudgetCache;
    if (!cfg) return '<div class="empty-state">Sin config</div>';

    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    const isPaused = (cfg.pausedUntil && new Date(cfg.pausedUntil) > new Date()) || cfg.emergencyStop;
    const stateColor = !cfg.enabled ? '#888' : (isPaused ? '#ff5050' : '#25d366');
    const stateLabel = !cfg.enabled ? 'DESACTIVADA' : (cfg.emergencyStop ? '⛔ PARO DE EMERGENCIA' : (cfg.pausedUntil && new Date(cfg.pausedUntil) > new Date() ? ('PAUSADA HASTA ' + new Date(cfg.pausedUntil).toLocaleString('es-AR', {dateStyle:'short',timeStyle:'short'})) : 'ACTIVA'));

    const wkPctBar = bud ? `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin-top:6px;"><div style="width:${Math.min(100,bud.pctUsed)}%;height:100%;background:${bud.pctUsed > 90 ? '#ff5050' : (bud.pctUsed > 60 ? '#ffaa44' : '#25d366')};"></div></div>` : '';

    let html = '';

    // Banner de estado + budget.
    html += '<div style="background:rgba(255,200,80,0.04);border:1px solid rgba(255,200,80,0.30);border-radius:12px;padding:14px;margin-bottom:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:start;gap:14px;flex-wrap:wrap;">';
    html += '<div>';
    html += '<div style="color:' + stateColor + ';font-weight:800;font-size:13px;">● ' + stateLabel + '</div>';
    html += '<div style="color:#aaa;font-size:11px;margin-top:4px;">Lunes ' + String(cfg.netwinGift.hour).padStart(2,'0') + ':' + String(cfg.netwinGift.minute).padStart(2,'0') + ' regalo netwin · Jueves ' + String(cfg.tierBonus.hour).padStart(2,'0') + ':' + String(cfg.tierBonus.minute).padStart(2,'0') + ' bono % · Miércoles ' + String(cfg.weeklyReport.hour).padStart(2,'0') + ':' + String(cfg.weeklyReport.minute).padStart(2,'0') + ' reporte ROI</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    if (isPaused) {
        html += '<button onclick="strategyResume()" style="padding:8px 14px;background:linear-gradient(135deg,#25d366,#0a7a3a);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">▶ Reanudar</button>';
    } else {
        html += '<button onclick="strategyPause(24)" style="padding:8px 14px;background:rgba(255,170,68,0.15);color:#ffaa44;border:1px solid rgba(255,170,68,0.40);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">⏸ Pausar 24h</button>';
        html += '<button onclick="strategyPause(168)" style="padding:8px 14px;background:rgba(255,170,68,0.15);color:#ffaa44;border:1px solid rgba(255,170,68,0.40);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">⏸ Pausar 1 sem</button>';
        html += '<button onclick="strategyEmergencyStop()" style="padding:8px 14px;background:linear-gradient(135deg,#ff5050,#cc0000);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">⛔ PARAR TODO</button>';
    }
    html += '</div>';
    html += '</div>';
    if (bud) {
        html += '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;">';
        html += '<div><div style="color:#888;font-size:10px;font-weight:700;">SEMANA</div><div style="color:#fff;font-weight:800;font-size:16px;">' + bud.weekKey + '</div></div>';
        html += '<div><div style="color:#888;font-size:10px;font-weight:700;">GASTADO</div><div style="color:#ffd700;font-weight:800;font-size:16px;">$' + fmt(bud.spentARS) + '</div></div>';
        html += '<div><div style="color:#888;font-size:10px;font-weight:700;">TOPE</div><div style="color:#fff;font-weight:800;font-size:16px;">$' + fmt(bud.capARS) + '</div></div>';
        html += '<div><div style="color:#888;font-size:10px;font-weight:700;">DISPONIBLE</div><div style="color:#25d366;font-weight:800;font-size:16px;">$' + fmt(bud.remainingARS) + '</div></div>';
        html += '</div>' + wkPctBar;
    }
    // Banner de audiencia base elegible (regla hard: solo app+notifs).
    if (bud && bud.eligibleUsersCount !== undefined) {
        html += '<div style="margin-top:14px;padding:10px 12px;background:rgba(37,211,102,0.06);border:1px solid rgba(37,211,102,0.30);border-radius:8px;font-size:12px;color:#bbb;line-height:1.6;">';
        html += '<strong style="color:#25d366;">📲 Audiencia base elegible: ' + fmt(bud.eligibleUsersCount) + ' usuarios</strong> con app instalada + notificaciones aceptadas (' + bud.eligiblePct + '% de los ' + fmt(bud.totalRealUsers) + ' totales). ';
        html += '<span style="color:#888;">Los ' + fmt(bud.excludedNoChannel) + ' restantes NO entran a la estrategia automática (son target del análisis externo "Clientes activos").</span>';
        html += '</div>';
    }
    html += '</div>';

    // Último reporte (si hay).
    if (_strategyReportsCache.length > 0) {
        const last = _strategyReportsCache[0];
        html += '<div style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.30);border-radius:12px;padding:14px;margin-bottom:14px;">';
        html += '<div style="color:#00d4ff;font-weight:800;font-size:13px;margin-bottom:6px;">📊 Último reporte: ' + last.weekKey + '</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;font-size:12px;">';
        html += '<div><div style="color:#888;font-size:10px;">Gastado</div><div style="color:#fff;font-weight:700;">$' + fmt(last.totalSpentARS) + '</div></div>';
        html += '<div><div style="color:#888;font-size:10px;">Δ Venta atribuible</div><div style="color:' + (last.totalDeltaSalesARS >= 0 ? '#25d366' : '#ff5050') + ';font-weight:700;">' + (last.totalDeltaSalesARS >= 0 ? '+' : '') + '$' + fmt(last.totalDeltaSalesARS) + '</div></div>';
        html += '<div><div style="color:#888;font-size:10px;">ROI</div><div style="color:' + ((last.totalROI || 0) >= 0 ? '#25d366' : '#ff5050') + ';font-weight:700;">' + ((last.totalROI || 0) >= 0 ? '+' : '') + ((last.totalROI || 0) * 100).toFixed(0) + '%</div></div>';
        html += '<div><div style="color:#888;font-size:10px;">Campañas</div><div style="color:#fff;font-weight:700;">' + (last.campaigns || []).length + '</div></div>';
        html += '</div>';
        if ((last.recommendations || []).length > 0) {
            html += '<div style="margin-top:10px;padding:8px 10px;background:rgba(0,0,0,0.30);border-radius:6px;font-size:11px;color:#bbb;line-height:1.6;">';
            html += '<div style="color:#fff;font-weight:700;margin-bottom:4px;">💡 Recomendaciones para esta semana:</div>';
            for (const r of last.recommendations) html += '<div>• ' + escapeHtml(r) + '</div>';
            html += '</div>';
        }
        html += '</div>';
    }

    // === Form: parámetros editables ===
    html += '<form id="strategyForm" onsubmit="strategySaveConfig(event)">';

    html += '<h3 style="color:#fff;font-size:14px;margin:18px 0 10px;">⚙️ Parámetros globales</h3>';
    html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:14px;display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;">';
    html += _strategyField('Estrategia activa', '<input type="checkbox" name="enabled" ' + (cfg.enabled ? 'checked' : '') + ' style="width:18px;height:18px;">');
    html += _strategyField('Tope semanal de regalos (ARS)', '<input type="number" name="weeklyBudgetCapARS" value="' + cfg.weeklyBudgetCapARS + '" min="0" max="50000000" required>', 'Si la audiencia computada supera este número, la campaña no se manda y se loguea para revisión.');
    html += _strategyField('Cap notifs por usuario / semana', '<input type="number" name="capPerUserPerWeek" value="' + cfg.capPerUserPerWeek + '" min="0" max="7" required>', 'Por defecto 2: lunes + jueves.');
    html += _strategyField('Cooldown entre notifs (horas)', '<input type="number" name="cooldownHours" value="' + cfg.cooldownHours + '" min="0" max="168" required>');
    html += '</div>';

    // === Campaña 1: Netwin Gift ===
    html += '<h3 style="color:#fff;font-size:14px;margin:18px 0 10px;">🎁 Lunes — Regalo de plata a perdedores semana previa</h3>';
    html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:14px;">';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:12px;">';
    html += _strategyField('Activa', '<input type="checkbox" name="ng_enabled" ' + (cfg.netwinGift.enabled ? 'checked' : '') + ' style="width:18px;height:18px;">');
    html += _strategyField('Día semana', _strategyDaySelect('ng_dayOfWeek', cfg.netwinGift.dayOfWeek));
    html += _strategyField('Hora (ART)', '<input type="number" name="ng_hour" value="' + cfg.netwinGift.hour + '" min="0" max="23" style="width:80px;">');
    html += _strategyField('Min', '<input type="number" name="ng_minute" value="' + cfg.netwinGift.minute + '" min="0" max="59" style="width:80px;">');
    html += _strategyField('Escalar a humano si pérdida >', '<input type="number" name="ng_escalateAboveARS" value="' + cfg.netwinGift.escalateAboveARS + '" min="0">', 'Pérdidas mayores no se autoejecutan.');
    html += _strategyField('Duración del regalo (min)', '<input type="number" name="ng_durationMinutes" value="' + cfg.netwinGift.durationMinutes + '" min="60">', 'Default 2880 = 48h.');
    html += '</div>';
    html += '<div style="color:#888;font-size:11px;margin-bottom:6px;">Tiers de pérdida → monto a regalar:</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;">';
    html += '<thead><tr style="background:rgba(255,255,255,0.05);"><th style="text-align:left;padding:6px;color:#aaa;">Pérdida desde</th><th style="text-align:left;padding:6px;color:#aaa;">Hasta</th><th style="text-align:left;padding:6px;color:#aaa;">Regalar (ARS)</th><th></th></tr></thead><tbody id="ngTiersBody">';
    for (let i = 0; i < cfg.netwinGift.tiers.length; i++) {
        const t = cfg.netwinGift.tiers[i];
        html += '<tr>';
        html += '<td style="padding:5px;"><input type="number" data-ng-tier="' + i + '" data-key="minLoss" value="' + t.minLoss + '" min="0" style="width:120px;"></td>';
        html += '<td style="padding:5px;"><input type="number" data-ng-tier="' + i + '" data-key="maxLoss" value="' + t.maxLoss + '" min="0" style="width:120px;"></td>';
        html += '<td style="padding:5px;"><input type="number" data-ng-tier="' + i + '" data-key="giftAmount" value="' + t.giftAmount + '" min="0" style="width:120px;"></td>';
        html += '<td style="padding:5px;"><button type="button" onclick="strategyRemoveNgTier(' + i + ')" style="background:rgba(255,80,80,0.15);color:#ff5050;border:1px solid rgba(255,80,80,0.40);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;">×</button></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<button type="button" onclick="strategyAddNgTier()" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:5px;padding:6px 12px;cursor:pointer;font-size:11px;">+ Agregar tier</button>';

    html += '<div style="margin-top:12px;">';
    html += _strategyField('Título push', '<input type="text" name="ng_title" value="' + escapeHtml(cfg.netwinGift.title) + '" maxlength="100" style="width:100%;">');
    html += _strategyField('Cuerpo push (soporta {{username}}, {{amount}})', '<textarea name="ng_body" maxlength="500" rows="2" style="width:100%;">' + escapeHtml(cfg.netwinGift.body) + '</textarea>');
    html += '</div>';

    // Botones de preview / run-now para netwin.
    html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button type="button" onclick="strategyPreview(\'netwin\')" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:6px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:700;">👁 Preview audiencia</button>';
    html += '<button type="button" onclick="strategyRunNow(\'netwin\')" style="background:rgba(255,80,80,0.10);color:#ff5050;border:1px solid rgba(255,80,80,0.40);border-radius:6px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:700;">⚡ Ejecutar AHORA (test)</button>';
    html += '</div>';
    html += '</div>';

    // === Campaña 2: Tier Bonus ===
    html += '<h3 style="color:#fff;font-size:14px;margin:18px 0 10px;">⚡ Jueves — Bono % carga por tier</h3>';
    html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:14px;">';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:12px;">';
    html += _strategyField('Activa', '<input type="checkbox" name="tb_enabled" ' + (cfg.tierBonus.enabled ? 'checked' : '') + ' style="width:18px;height:18px;">');
    html += _strategyField('Día semana', _strategyDaySelect('tb_dayOfWeek', cfg.tierBonus.dayOfWeek));
    html += _strategyField('Hora (ART)', '<input type="number" name="tb_hour" value="' + cfg.tierBonus.hour + '" min="0" max="23" style="width:80px;">');
    html += _strategyField('Min', '<input type="number" name="tb_minute" value="' + cfg.tierBonus.minute + '" min="0" max="59" style="width:80px;">');
    html += _strategyField('Ventana de reembolsos (días)', '<input type="number" name="tb_refundsLookbackDays" value="' + cfg.tierBonus.refundsLookbackDays + '" min="1" max="365">', 'Cuántos días atrás se suman reembolsos para tierización.');
    html += _strategyField('Duración del bono (horas)', '<input type="number" name="tb_promoDurationHours" value="' + cfg.tierBonus.promoDurationHours + '" min="1" max="168">');
    html += '</div>';
    html += '<div style="color:#888;font-size:11px;margin-bottom:6px;">Tiers (orden: el primero que matchee gana — ordenar de mejor a peor):</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;">';
    html += '<thead><tr style="background:rgba(255,255,255,0.05);"><th style="text-align:left;padding:6px;color:#aaa;">Code</th><th style="text-align:left;padding:6px;color:#aaa;">Label</th><th style="text-align:left;padding:6px;color:#aaa;">Min %ile</th><th style="text-align:left;padding:6px;color:#aaa;">Min reemb. ARS</th><th style="text-align:left;padding:6px;color:#aaa;">Bono %</th><th></th></tr></thead><tbody id="tbTiersBody">';
    for (let i = 0; i < cfg.tierBonus.tiers.length; i++) {
        const t = cfg.tierBonus.tiers[i];
        html += '<tr>';
        html += '<td style="padding:5px;"><input type="text" data-tb-tier="' + i + '" data-key="code" value="' + escapeHtml(t.code) + '" maxlength="20" style="width:80px;"></td>';
        html += '<td style="padding:5px;"><input type="text" data-tb-tier="' + i + '" data-key="label" value="' + escapeHtml(t.label) + '" maxlength="40" style="width:140px;"></td>';
        html += '<td style="padding:5px;"><input type="number" data-tb-tier="' + i + '" data-key="minPercentile" value="' + t.minPercentile + '" min="0" max="100" style="width:80px;"></td>';
        html += '<td style="padding:5px;"><input type="number" data-tb-tier="' + i + '" data-key="minRefundsARS" value="' + t.minRefundsARS + '" min="0" style="width:120px;"></td>';
        html += '<td style="padding:5px;"><input type="number" data-tb-tier="' + i + '" data-key="bonusPct" value="' + t.bonusPct + '" min="0" max="500" style="width:80px;"></td>';
        html += '<td style="padding:5px;"><button type="button" onclick="strategyRemoveTbTier(' + i + ')" style="background:rgba(255,80,80,0.15);color:#ff5050;border:1px solid rgba(255,80,80,0.40);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;">×</button></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<button type="button" onclick="strategyAddTbTier()" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:5px;padding:6px 12px;cursor:pointer;font-size:11px;">+ Agregar tier</button>';

    html += '<div style="margin-top:12px;">';
    html += _strategyField('Título push (soporta {{tier}}, {{bonusPct}})', '<input type="text" name="tb_title" value="' + escapeHtml(cfg.tierBonus.title) + '" maxlength="100" style="width:100%;">');
    html += _strategyField('Cuerpo push (soporta {{username}}, {{tier}}, {{bonusPct}}, {{validHours}})', '<textarea name="tb_body" maxlength="500" rows="2" style="width:100%;">' + escapeHtml(cfg.tierBonus.body) + '</textarea>');
    html += '</div>';

    html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button type="button" onclick="strategyPreview(\'tier\')" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:6px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:700;">👁 Preview audiencia</button>';
    html += '<button type="button" onclick="strategyRunNow(\'tier\')" style="background:rgba(255,80,80,0.10);color:#ff5050;border:1px solid rgba(255,80,80,0.40);border-radius:6px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:700;">⚡ Ejecutar AHORA (test)</button>';
    html += '</div>';
    html += '</div>';

    // === Reporte miércoles ===
    html += '<h3 style="color:#fff;font-size:14px;margin:18px 0 10px;">📊 Miércoles — Reporte ROI semanal</h3>';
    html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:14px;">';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;">';
    html += _strategyField('Activo', '<input type="checkbox" name="rep_enabled" ' + (cfg.weeklyReport.enabled ? 'checked' : '') + ' style="width:18px;height:18px;">');
    html += _strategyField('Día semana', _strategyDaySelect('rep_dayOfWeek', cfg.weeklyReport.dayOfWeek));
    html += _strategyField('Hora (ART)', '<input type="number" name="rep_hour" value="' + cfg.weeklyReport.hour + '" min="0" max="23" style="width:80px;">');
    html += _strategyField('Min', '<input type="number" name="rep_minute" value="' + cfg.weeklyReport.minute + '" min="0" max="59" style="width:80px;">');
    html += '</div>';
    html += '<button type="button" onclick="strategyRunNow(\'report\')" style="margin-top:10px;background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:6px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:700;">⚡ Generar reporte AHORA</button>';
    html += '</div>';

    html += '<div style="margin-top:18px;display:flex;gap:8px;">';
    html += '<button type="submit" style="flex:1;padding:12px;background:linear-gradient(135deg,#ffc850,#cc8800);color:#000;border:none;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;">💾 Guardar configuración</button>';
    html += '<button type="button" onclick="_strategyRenderTab()" style="padding:12px 20px;background:rgba(255,255,255,0.06);color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-size:13px;cursor:pointer;">↻</button>';
    html += '</div>';

    html += '</form>';

    // Reportes históricos.
    if (_strategyReportsCache.length > 1) {
        html += '<h3 style="color:#fff;font-size:14px;margin:24px 0 10px;">📚 Historial de reportes</h3>';
        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        for (let i = 1; i < _strategyReportsCache.length; i++) {
            const r = _strategyReportsCache[i];
            const roiColor = (r.totalROI || 0) >= 0 ? '#25d366' : '#ff5050';
            html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">';
            html += '<div><div style="color:#fff;font-weight:700;">' + r.weekKey + '</div><div style="color:#888;font-size:11px;">' + (r.campaigns || []).length + ' campañas · ' + (r.recommendations || []).length + ' recos</div></div>';
            html += '<div style="display:flex;gap:14px;font-size:12px;">';
            html += '<div><span style="color:#888;">Gastado:</span> <strong>$' + fmt(r.totalSpentARS) + '</strong></div>';
            html += '<div><span style="color:#888;">Δ:</span> <strong style="color:' + ((r.totalDeltaSalesARS||0) >= 0 ? '#25d366' : '#ff5050') + ';">' + ((r.totalDeltaSalesARS||0) >= 0 ? '+' : '') + '$' + fmt(r.totalDeltaSalesARS) + '</strong></div>';
            html += '<div><span style="color:#888;">ROI:</span> <strong style="color:' + roiColor + ';">' + ((r.totalROI||0) >= 0 ? '+' : '') + ((r.totalROI||0)*100).toFixed(0) + '%</strong></div>';
            html += '</div>';
            html += '</div>';
        }
        html += '</div>';
    }

    return html;
}

function _strategyField(label, controlHtml, hint) {
    return '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">' + escapeHtml(label) + '</label>' + controlHtml + (hint ? '<div style="color:#666;font-size:10px;margin-top:3px;">' + escapeHtml(hint) + '</div>' : '') + '</div>';
}

function _strategyDaySelect(name, current) {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    let opts = '';
    for (let i = 0; i < 7; i++) {
        opts += '<option value="' + i + '"' + (i === current ? ' selected' : '') + '>' + days[i] + '</option>';
    }
    return '<select name="' + name + '">' + opts + '</select>';
}

function strategyAddNgTier() {
    if (!_strategyConfigCache) return;
    _strategyConfigCache.netwinGift.tiers.push({ minLoss: 0, maxLoss: 0, giftAmount: 0 });
    _strategyRenderTab();
}
function strategyRemoveNgTier(idx) {
    if (!_strategyConfigCache) return;
    _strategyConfigCache.netwinGift.tiers.splice(idx, 1);
    _strategyRenderTab();
}
function strategyAddTbTier() {
    if (!_strategyConfigCache) return;
    _strategyConfigCache.tierBonus.tiers.push({ code: 'nuevo', label: 'Nuevo', minPercentile: 0, minRefundsARS: 0, bonusPct: 10 });
    _strategyRenderTab();
}
function strategyRemoveTbTier(idx) {
    if (!_strategyConfigCache) return;
    _strategyConfigCache.tierBonus.tiers.splice(idx, 1);
    _strategyRenderTab();
}

async function strategySaveConfig(e) {
    e.preventDefault();
    const f = e.target;
    // Recolectar tiers desde los inputs.
    const ngTiers = [];
    document.querySelectorAll('#ngTiersBody tr').forEach((tr, i) => {
        const inputs = tr.querySelectorAll('input[data-ng-tier]');
        const t = {};
        inputs.forEach(inp => { t[inp.getAttribute('data-key')] = Number(inp.value); });
        if (t.giftAmount > 0) ngTiers.push(t);
    });
    const tbTiers = [];
    document.querySelectorAll('#tbTiersBody tr').forEach((tr, i) => {
        const inputs = tr.querySelectorAll('input[data-tb-tier]');
        const t = {};
        inputs.forEach(inp => {
            const k = inp.getAttribute('data-key');
            t[k] = (k === 'code' || k === 'label') ? inp.value.trim() : Number(inp.value);
        });
        if (t.code) tbTiers.push(t);
    });
    const body = {
        enabled: f.enabled.checked,
        weeklyBudgetCapARS: Number(f.weeklyBudgetCapARS.value),
        capPerUserPerWeek: Number(f.capPerUserPerWeek.value),
        cooldownHours: Number(f.cooldownHours.value),
        netwinGift: {
            enabled: f.ng_enabled.checked,
            dayOfWeek: Number(f.ng_dayOfWeek.value),
            hour: Number(f.ng_hour.value),
            minute: Number(f.ng_minute.value),
            escalateAboveARS: Number(f.ng_escalateAboveARS.value),
            durationMinutes: Number(f.ng_durationMinutes.value),
            title: f.ng_title.value,
            body: f.ng_body.value,
            tiers: ngTiers
        },
        tierBonus: {
            enabled: f.tb_enabled.checked,
            dayOfWeek: Number(f.tb_dayOfWeek.value),
            hour: Number(f.tb_hour.value),
            minute: Number(f.tb_minute.value),
            refundsLookbackDays: Number(f.tb_refundsLookbackDays.value),
            promoDurationHours: Number(f.tb_promoDurationHours.value),
            title: f.tb_title.value,
            body: f.tb_body.value,
            tiers: tbTiers
        },
        weeklyReport: {
            enabled: f.rep_enabled.checked,
            dayOfWeek: Number(f.rep_dayOfWeek.value),
            hour: Number(f.rep_hour.value),
            minute: Number(f.rep_minute.value)
        }
    };
    try {
        const r = await authFetch('/api/admin/strategy/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        showToast('✅ Configuración guardada', 'success');
        _strategyRenderTab();
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

async function strategyPause(hours) {
    if (!confirm('¿Pausar la estrategia por ' + hours + 'h?\n\nNo se mandarán pushes automáticos hasta que la reanudes o pase el tiempo.')) return;
    try {
        const r = await authFetch('/api/admin/strategy/pause', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours })
        });
        if (!r.ok) { const j = await r.json(); showToast(j.error || 'Error', 'error'); return; }
        showToast('⏸ Estrategia pausada por ' + hours + 'h', 'success');
        _strategyRenderTab();
    } catch (e) { showToast('Error', 'error'); }
}

async function strategyEmergencyStop() {
    if (!confirm('⛔ PARO DE EMERGENCIA\n\nEsto frena TODO de inmediato. No se ejecuta ninguna automatización hasta que reanudes manualmente.\n\n¿Confirmás?')) return;
    try {
        const r = await authFetch('/api/admin/strategy/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (!r.ok) { const j = await r.json(); showToast(j.error || 'Error', 'error'); return; }
        showToast('⛔ Estrategia FRENADA', 'success');
        _strategyRenderTab();
    } catch (e) { showToast('Error', 'error'); }
}

async function strategyResume() {
    try {
        const r = await authFetch('/api/admin/strategy/resume', { method: 'POST' });
        if (!r.ok) { const j = await r.json(); showToast(j.error || 'Error', 'error'); return; }
        showToast('▶ Estrategia reanudada', 'success');
        _strategyRenderTab();
    } catch (e) { showToast('Error', 'error'); }
}

async function strategyPreview(campaign) {
    showToast('⏳ Calculando audiencia (puede tardar — 1 lookup por user)…', 'info');
    try {
        const r = await authFetch('/api/admin/strategy/preview?campaign=' + campaign);
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        const p = j.preview || {};
        let msg = '👁 PREVIEW: ' + campaign.toUpperCase() + '\n\n';
        msg += 'Audiencia bruta: ' + (p.audienceSize || 0) + '\n';
        msg += 'Bloqueados (cap/cooldown): ' + (p.blockedCount || 0) + '\n';
        msg += 'Targets reales: ' + (p.targetCount || 0) + '\n';
        if (p.totalCost != null) msg += 'Costo estimado: $' + Number(p.totalCost).toLocaleString('es-AR') + '\n';
        if (p.escalatedCount) msg += '⚠ Escalados a humano: ' + p.escalatedCount + '\n';
        if (p.byTier) msg += '\nPor tier: ' + JSON.stringify(p.byTier);
        if (p.breakdown) msg += '\nBreakdown: ' + JSON.stringify(p.breakdown);
        if (p.skipped) msg += '\n\n⚠ SKIPPED: ' + p.skipped;
        alert(msg);
    } catch (e) { showToast('Error', 'error'); }
}

async function strategyRunNow(campaign) {
    const labels = { netwin: 'regalo netwin (LUNES)', tier: 'bono % carga (JUEVES)', report: 'reporte ROI' };
    if (!confirm('⚡ Ejecutar AHORA: ' + labels[campaign] + '\n\nEsto va a mandar pushes y crear giveaways de verdad. ¿Seguro?')) return;
    showToast('⏳ Ejecutando…', 'info');
    try {
        const r = await authFetch('/api/admin/strategy/run-now', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        showToast('✅ ' + JSON.stringify(j.result), 'success');
        _strategyRenderTab();
    } catch (e) { showToast('Error', 'error'); }
}

// ============================================
// 📈 ROI POR DIFUSIÓN (tab)
// ============================================
let _strategyROIItemsCache = [];
let _strategyROIExpanded = new Set();
let _strategyROIDetailsCache = new Map(); // historyId → details JSON

async function _strategyRenderROITab() {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando ROI…</div>';
    try {
        const r = await authFetch('/api/admin/strategy/roi?limit=50');
        if (!r.ok) { c.innerHTML = '<div class="empty-state">❌ Error</div>'; return; }
        const j = await r.json();
        _strategyROIItemsCache = j.items || [];
        _strategyROIRenderTable();
    } catch (e) {
        c.innerHTML = '<div class="empty-state">❌ Error</div>';
    }
}

function _strategyROIRenderTable() {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    const items = _strategyROIItemsCache;
    if (items.length === 0) {
        c.innerHTML = '<div class="empty-state" style="font-size:13px;color:#888;line-height:1.6;">No hay difusiones de estrategia todavía.<br><br>Cuando se disparen el lunes/jueves, vas a verlas acá con sus métricas de ROI.<br>El cálculo se completa 48h después del envío (el tracker corre cada 30 min).</div>';
        return;
    }
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '<div style="margin-bottom:12px;color:#aaa;font-size:11px;">' + items.length + ' difusiones · Tocá una fila para ver el detalle por usuario (qué se le iba a dar y cómo respondió). ROI 48h post-envío vs grupo control.</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr style="background:rgba(255,255,255,0.05);">';
    html += '<th style="text-align:left;padding:8px;color:#aaa;width:24px;"></th>';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">Cuándo</th>';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">Tipo</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">Audiencia</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">Entregados</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">Reclamaron</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">Carga 48h pre</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">Carga 48h post</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">Δ vs control</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">ROI</th>';
    html += '</tr></thead><tbody>';
    for (const it of items) {
        const when = it.sentAt ? new Date(it.sentAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const tracked = !!it.roiTrackedAt;
        const tgtPre = Number(it.chargesBefore48hARS) || 0;
        const tgtPost = Number(it.chargesAfter48hARS) || 0;
        const ctlPre = Number(it.controlChargesBefore48hARS) || 0;
        const ctlPost = Number(it.controlChargesAfter48hARS) || 0;
        const tgtSize = Number(it.audienceCount) || 1;
        const ctlSize = Number(it.controlGroupCount) || 1;
        const tgtDelta = (tgtPost - tgtPre) / tgtSize;
        const ctlDelta = ctlSize > 0 ? (ctlPost - ctlPre) / ctlSize : 0;
        const deltaPerUser = tgtDelta - ctlDelta;
        const totalDelta = deltaPerUser * tgtSize;
        const dColor = totalDelta >= 0 ? '#25d366' : '#ff5050';
        const expanded = _strategyROIExpanded.has(it.id);
        html += '<tr onclick="_strategyROIToggle(\'' + it.id + '\')" style="border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;background:' + (expanded ? 'rgba(255,200,80,0.04)' : 'transparent') + ';">';
        html += '<td style="padding:8px;color:#888;">' + (expanded ? '▼' : '▶') + '</td>';
        html += '<td style="padding:8px;color:#aaa;">' + escapeHtml(when) + '</td>';
        html += '<td style="padding:8px;"><span style="color:' + (it.strategyType === 'netwin-gift' ? '#ffd700' : '#00d4ff') + ';font-weight:700;">' + (it.strategyType === 'netwin-gift' ? '🎁 Netwin' : '⚡ Tier %') + '</span></td>';
        html += '<td style="padding:8px;text-align:right;color:#fff;">' + fmt(it.audienceCount) + '</td>';
        html += '<td style="padding:8px;text-align:right;color:#25d366;">' + fmt(it.successCount) + '</td>';
        html += '<td style="padding:8px;text-align:right;color:#ffd700;font-weight:700;">' + fmt(it.giveawayClaims || 0) + '</td>';
        if (tracked) {
            html += '<td style="padding:8px;text-align:right;color:#aaa;">$' + fmt(tgtPre) + '</td>';
            html += '<td style="padding:8px;text-align:right;color:#fff;font-weight:700;">$' + fmt(tgtPost) + '</td>';
            html += '<td style="padding:8px;text-align:right;color:' + dColor + ';font-weight:700;">' + (totalDelta >= 0 ? '+' : '') + '$' + fmt(totalDelta) + '</td>';
            html += '<td style="padding:8px;text-align:right;color:' + dColor + ';font-weight:700;">' + (totalDelta >= 0 ? '↑' : '↓') + '</td>';
        } else {
            const ageHours = it.sentAt ? Math.floor((Date.now() - new Date(it.sentAt).getTime()) / 3600000) : 0;
            const left = Math.max(0, 48 - ageHours);
            html += '<td colspan="4" style="padding:8px;text-align:center;color:#888;font-style:italic;">⏳ Tracking en ' + left + 'h…</td>';
        }
        html += '</tr>';
        if (expanded) {
            html += '<tr><td colspan="10" style="padding:0;background:rgba(0,0,0,0.30);"><div id="strategyDetail_' + it.id + '" style="padding:14px;">⏳ Cargando detalle…</div></td></tr>';
        }
    }
    html += '</tbody></table>';
    c.innerHTML = html;

    // Cargar detalles de los expandidos.
    for (const id of _strategyROIExpanded) {
        _strategyROILoadDetails(id);
    }
}

function _strategyROIToggle(historyId) {
    if (_strategyROIExpanded.has(historyId)) _strategyROIExpanded.delete(historyId);
    else _strategyROIExpanded.add(historyId);
    _strategyROIRenderTable();
}

async function _strategyROILoadDetails(historyId) {
    const el = document.getElementById('strategyDetail_' + historyId);
    if (!el) return;
    try {
        const r = await authFetch('/api/admin/strategy/roi/' + encodeURIComponent(historyId) + '/details');
        if (!r.ok) { el.innerHTML = '<div style="color:#ff5050;">❌ Error cargando detalle</div>'; return; }
        const j = await r.json();
        _strategyROIDetailsCache.set(historyId, j);
        el.innerHTML = _strategyROIRenderDetails(j);
    } catch (e) {
        el.innerHTML = '<div style="color:#ff5050;">❌ Error de conexión</div>';
    }
}

function _strategyROIRenderDetails(j) {
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    const h = j.history;
    const s = j.summary;
    const details = j.details || [];
    const alerts = j.alerts || [];
    let html = '';

    // Banner alerts.
    if (alerts.length > 0) {
        html += '<div style="background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.40);border-radius:8px;padding:10px 12px;margin-bottom:12px;">';
        html += '<div style="color:#ff5050;font-weight:800;font-size:12px;margin-bottom:6px;">⚠ ALERTAS DETECTADAS</div>';
        for (const a of alerts) html += '<div style="color:#ffaa88;font-size:12px;line-height:1.5;">' + escapeHtml(a) + '</div>';
        html += '</div>';
    }

    // Métricas de la difusión.
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;margin-bottom:14px;">';
    html += _strategyMetric('AUDIENCIA', fmt(s.totalUsers), '#fff', null);
    html += _strategyMetric('ENTREGADOS', fmt(h.successCount), '#25d366', s.deliveryRate != null ? Math.round(s.deliveryRate * 100) + '% del audience' : null);
    html += _strategyMetric('RECLAMARON', fmt(s.claimed), '#ffd700', s.claimRate != null ? Math.round(s.claimRate * 100) + '% claim rate' : null);
    html += _strategyMetric('NO RECLAMARON', fmt(s.notClaimed), '#888', null);
    if (h.roiTrackedAt) {
        html += _strategyMetric('PLATA REGALADA', '$' + fmt(s.totalGiftedARS), '#ffd700', null);
        html += _strategyMetric('Δ VENTA', (s.attributableDeltaTotal >= 0 ? '+' : '') + '$' + fmt(Math.round(s.attributableDeltaTotal)), s.attributableDeltaTotal >= 0 ? '#25d366' : '#ff5050', 'vs grupo control');
        if (s.roi != null) {
            html += _strategyMetric('ROI', (s.roi >= 0 ? '+' : '') + Math.round(s.roi * 100) + '%', s.roi >= 0 ? '#25d366' : '#ff5050', null);
        }
    }
    html += '</div>';

    // Clasificación per-user (si ya se computó).
    if (h.classificationCounts && h.classificationCounts.classifiedAt) {
        const cc = h.classificationCounts;
        html += '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;margin-bottom:12px;">';
        html += '<div style="color:#fff;font-weight:700;font-size:12px;margin-bottom:8px;">🎯 Cómo respondió cada usuario</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;">';
        html += _strategyMetric('🟢 CONVERSORES', fmt(cc.converter), '#25d366', 'Reclamaron y cargaron más');
        html += _strategyMetric('🟡 PASIVOS', fmt(cc.passive), '#ffaa44', 'Reclamaron pero no cargaron más');
        html += _strategyMetric('🔴 SIN RESPUESTA', fmt(cc.no_response), '#ff8888', 'No reclamaron el push');
        html += _strategyMetric('🚨 REGRESIVOS', fmt(cc.regressive), '#ff5050', 'Cargaron MENOS post-push');
        html += '</div>';
        html += '<div style="color:#666;font-size:10px;margin-top:6px;">Análisis hecho ' + new Date(cc.classifiedAt).toLocaleString('es-AR') + '</div>';
        html += '</div>';
    } else if (h.roiTrackedAt) {
        html += '<div style="background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">';
        html += '<div style="color:#00d4ff;font-size:12px;line-height:1.5;">¿Querés ver cómo respondió cada usuario individualmente? Hace 1 llamada a JUGAYGANA por user (~' + s.totalUsers + ' requests, ~30 seg).</div>';
        html += '<button onclick="strategyRecomputePerUser(\'' + h.id + '\')" style="padding:7px 14px;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">🔍 Calcular per-user</button>';
        html += '</div>';
    }

    // Tabla per-user.
    html += '<div style="color:#fff;font-weight:700;font-size:12px;margin-bottom:6px;">📋 Detalle por usuario (' + details.length + ')</div>';
    if (details.length === 0) {
        html += '<div style="color:#888;font-size:11px;font-style:italic;">No hay detalle por usuario para esta difusión (es de antes de que esto se registrara).</div>';
        return html;
    }
    html += '<div style="max-height:400px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:6px;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<thead style="position:sticky;top:0;background:rgba(20,20,25,0.98);z-index:1;"><tr>';
    html += '<th style="text-align:left;padding:6px 8px;color:#aaa;">Usuario</th>';
    if (h.strategyType === 'netwin-gift') {
        html += '<th style="text-align:right;padding:6px 8px;color:#aaa;">Pérdida semana</th>';
        html += '<th style="text-align:right;padding:6px 8px;color:#aaa;">Regalo</th>';
        html += '<th style="text-align:left;padding:6px 8px;color:#aaa;">Tier</th>';
    } else {
        html += '<th style="text-align:left;padding:6px 8px;color:#aaa;">Tier</th>';
        html += '<th style="text-align:right;padding:6px 8px;color:#aaa;">Bono %</th>';
        html += '<th style="text-align:right;padding:6px 8px;color:#aaa;">Reembolsos 30d</th>';
    }
    html += '<th style="text-align:center;padding:6px 8px;color:#aaa;">Reclamó</th>';
    html += '<th style="text-align:right;padding:6px 8px;color:#aaa;">Carga pre</th>';
    html += '<th style="text-align:right;padding:6px 8px;color:#aaa;">Carga post</th>';
    html += '<th style="text-align:center;padding:6px 8px;color:#aaa;" title="Cuántas cargas distintas hizo en las 48h post-push">🔥 # cargas</th>';
    html += '<th style="text-align:left;padding:6px 8px;color:#aaa;" title="Hora del primer depósito post-push y monto">⏱ 1ra carga post</th>';
    html += '<th style="text-align:right;padding:6px 8px;color:#aaa;" title="Plata cargada DESPUÉS de reclamar el regalo (atribuible al regalo)">💎 Cargó post-regalo</th>';
    html += '<th style="text-align:left;padding:6px 8px;color:#aaa;">Estado</th>';
    html += '</tr></thead><tbody>';
    // Sort: claimed primero (por categoría), después por monto descendente.
    const sorted = details.slice().sort((a, b) => {
        const order = { converter: 0, passive: 1, regressive: 2, no_response: 3 };
        const oa = order[a.classification] != null ? order[a.classification] : 4;
        const ob = order[b.classification] != null ? order[b.classification] : 4;
        if (oa !== ob) return oa - ob;
        return (b.giftAmount || b.bonusPct || 0) - (a.giftAmount || a.bonusPct || 0);
    });
    for (const d of sorted) {
        const claimedCell = d.claimed
            ? '<span style="color:#25d366;font-weight:700;">✓ Sí</span>'
            : '<span style="color:#888;">—</span>';
        let stateCell = '<span style="color:#666;">—</span>';
        if (d.classification === 'converter') stateCell = '<span style="background:rgba(37,211,102,0.15);color:#25d366;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">🟢 Convirtió</span>';
        else if (d.classification === 'passive') stateCell = '<span style="background:rgba(255,170,68,0.15);color:#ffaa44;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">🟡 Pasivo</span>';
        else if (d.classification === 'no_response') stateCell = '<span style="background:rgba(136,136,136,0.15);color:#888;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">🔴 Ignoró</span>';
        else if (d.classification === 'regressive') stateCell = '<span style="background:rgba(255,80,80,0.15);color:#ff5050;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">🚨 Regresivo</span>';
        const preCell = d.chargedBefore48hARS != null ? '$' + fmt(d.chargedBefore48hARS) : '<span style="color:#666;">—</span>';
        const postCell = d.chargedAfter48hARS != null ? '$' + fmt(d.chargedAfter48hARS) : '<span style="color:#666;">—</span>';
        // # de cargas post-push: badge color según count
        let countCell = '<span style="color:#666;">—</span>';
        if (d.depositCountAfter != null) {
            const n = d.depositCountAfter || 0;
            const c = n === 0 ? '#666' : (n === 1 ? '#ffaa44' : (n < 4 ? '#25d366' : '#00ff88'));
            countCell = '<span style="color:' + c + ';font-weight:700;">' + n + '</span>';
        }
        // Primera carga post-push: hora + monto
        let firstCell = '<span style="color:#666;">—</span>';
        if (d.firstDepositAfterAt) {
            const dt = new Date(d.firstDepositAfterAt);
            const sentAtMs = h.sentAt ? new Date(h.sentAt).getTime() : null;
            let delay = '';
            if (sentAtMs) {
                const diffMin = Math.floor((dt.getTime() - sentAtMs) / 60000);
                if (diffMin < 60) delay = ' (' + diffMin + 'min)';
                else if (diffMin < 1440) delay = ' (' + Math.floor(diffMin / 60) + 'h ' + (diffMin % 60) + 'm)';
                else delay = ' (' + Math.floor(diffMin / 1440) + 'd)';
            }
            const amt = d.firstDepositAfterAmountARS ? '$' + fmt(d.firstDepositAfterAmountARS) : '';
            firstCell = '<span style="color:#fff;font-size:10px;">' + dt.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + '</span><br><span style="color:#aaa;font-size:10px;">' + amt + delay + '</span>';
        }
        // Cargó post-regalo (post-claim)
        let postClaimCell;
        if (!d.claimed) {
            postClaimCell = '<span style="color:#666;font-size:10px;">no reclamó</span>';
        } else if (d.chargedAfterClaimARS == null) {
            postClaimCell = '<span style="color:#666;">—</span>';
        } else if (d.chargedAfterClaimARS > 0) {
            postClaimCell = '<span style="color:#25d366;font-weight:700;">$' + fmt(d.chargedAfterClaimARS) + '</span>'
                + (d.depositCountAfterClaim ? '<br><span style="color:#aaa;font-size:10px;">' + d.depositCountAfterClaim + ' cargas</span>' : '');
        } else {
            postClaimCell = '<span style="color:#ff8888;font-size:10px;">$0 — no recargó</span>';
        }
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:6px 8px;color:#fff;font-weight:600;">' + escapeHtml(d.username) + '</td>';
        if (h.strategyType === 'netwin-gift') {
            html += '<td style="padding:6px 8px;text-align:right;color:#ff8888;">$' + fmt(Math.round(d.lossARS || 0)) + '</td>';
            html += '<td style="padding:6px 8px;text-align:right;color:#ffd700;font-weight:700;">$' + fmt(d.giftAmount) + '</td>';
            html += '<td style="padding:6px 8px;color:#aaa;">' + escapeHtml(d.tierLabel || '') + '</td>';
        } else {
            html += '<td style="padding:6px 8px;color:#00d4ff;font-weight:700;">' + escapeHtml(d.tier || '') + '</td>';
            html += '<td style="padding:6px 8px;text-align:right;color:#ffd700;">+' + (d.bonusPct || 0) + '%</td>';
            html += '<td style="padding:6px 8px;text-align:right;color:#aaa;">$' + fmt(Math.round(d.refundsARS || 0)) + '</td>';
        }
        html += '<td style="padding:6px 8px;text-align:center;">' + claimedCell + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#aaa;">' + preCell + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#fff;">' + postCell + '</td>';
        html += '<td style="padding:6px 8px;text-align:center;">' + countCell + '</td>';
        html += '<td style="padding:6px 8px;">' + firstCell + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;">' + postClaimCell + '</td>';
        html += '<td style="padding:6px 8px;">' + stateCell + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '</div>';
    return html;
}

function _strategyMetric(label, value, color, sub) {
    return '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px 10px;">'
        + '<div style="color:#888;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">' + escapeHtml(label) + '</div>'
        + '<div style="color:' + color + ';font-size:16px;font-weight:800;margin-top:3px;">' + value + '</div>'
        + (sub ? '<div style="color:#666;font-size:9px;margin-top:2px;">' + escapeHtml(sub) + '</div>' : '')
        + '</div>';
}

async function strategyRecomputePerUser(historyId) {
    if (!confirm('¿Calcular respuesta per-user con JUGAYGANA?\n\nEsto hace ~1 request por usuario al API externo. Puede tardar ~30 segundos. Refresá la difusión cuando termine para ver la clasificación.')) return;
    try {
        const r = await authFetch('/api/admin/strategy/roi/' + encodeURIComponent(historyId) + '/recompute-perf', { method: 'POST' });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        showToast('🔍 Cálculo iniciado en background — refrescá en ~30s', 'success');
        // Auto-refresh tras 35 seg.
        setTimeout(() => {
            _strategyROILoadDetails(historyId);
        }, 35000);
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

async function loadLineDownHistory() {
    const el = document.getElementById('lineDownHistory');
    if (!el) return;
    el.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';
    try {
        const r = await authFetch('/api/admin/line-down/history?limit=50');
        if (!r.ok) { el.innerHTML = '<div class="empty-state">❌ Error</div>'; return; }
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        if (items.length === 0) {
            el.innerHTML = '<div class="empty-state" style="color:#888;font-size:12px;">No hay difusiones registradas todavía.</div>';
            return;
        }
        let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
        for (const it of items) {
            const when = it.sentAt ? new Date(it.sentAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const team = escapeHtml(it.lineDownTeam || it.audiencePrefix || '—');
            const oldP = escapeHtml(it.lineDownOldPhone || '—');
            const newP = escapeHtml(it.lineDownNewPhone || '—');
            const audience = it.audienceCount || it.totalUsers || 0;
            const delivered = it.successCount || 0;
            const promoLine = it.promoMessage
                ? '<div style="color:#00d4ff;font-size:11px;margin-top:4px;">🎁 Promo: ' + escapeHtml(it.promoCode || '') + ' — ' + escapeHtml(it.promoMessage) + '</div>'
                : '';
            html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,80,80,0.25);border-radius:8px;padding:10px 12px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap;">';
            html += '<div style="flex:1;min-width:0;">';
            html += '<div style="color:#ff5050;font-weight:700;font-size:13px;">🚨 ' + team + '</div>';
            html += '<div style="color:#bbb;font-size:11px;margin-top:2px;">' + escapeHtml(it.title || '') + '</div>';
            html += '<div style="color:#888;font-size:11px;margin-top:2px;">' + escapeHtml(it.body || '') + '</div>';
            html += '<div style="color:#aaa;font-size:11px;margin-top:4px;">📞 <span style="text-decoration:line-through;color:#888;">' + oldP + '</span> → <span style="color:#ffd700;">' + newP + '</span></div>';
            html += promoLine;
            html += '</div>';
            html += '<div style="text-align:right;font-size:11px;color:#888;flex-shrink:0;">';
            html += '<div>' + escapeHtml(when) + '</div>';
            html += '<div style="margin-top:3px;color:#fff;"><span style="color:#25d366;font-weight:700;">' + delivered + '</span> / ' + audience + '</div>';
            html += '</div>';
            html += '</div>';
            html += '</div>';
        }
        html += '</div>';
        el.innerHTML = html;
    } catch (e) {
        console.error('loadLineDownHistory error:', e);
        el.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

// ============================================
// 🎯 CLIENTES ACTIVOS SIN APP
// ============================================
let _apCache = null;
let _apExpandedTeams = new Set();

function _apQueryString() {
    const wd = document.getElementById('apWindowDays').value;
    const mc = document.getElementById('apMinDepositCount').value;
    const mars = document.getElementById('apMinDepositARS').value;
    const exc = document.getElementById('apExcludeWithApp').value;
    const segEl = document.getElementById('apSegment');
    const seg = segEl ? segEl.value : 'all';
    // recoveredLookbackDays: usamos la misma ventana que el filtro (si la
    // ventana es 7d, recuperados de los últimos 7d; si es 30d, idem).
    return 'windowDays=' + wd + '&minDepositCount=' + mc + '&minDepositARS=' + mars + '&excludeWithApp=' + exc + '&segment=' + seg + '&recoveredLookbackDays=' + Math.max(1, parseInt(wd) || 7) + '&groupByTeam=true';
}

const _AP_SEGMENT_META = {
    hot:   { emoji: '🔥', label: 'Calientes',  range: '0-30 d',    color: '#ff5050', tip: 'Cargaron hace poco — son los más fáciles de retener' },
    warm:  { emoji: '😴', label: 'Tibios',     range: '30-90 d',   color: '#ffaa44', tip: 'Empezaron a despegarse — bonus de recuperación' },
    cool:  { emoji: '🥶', label: 'Fríos',      range: '90-180 d',  color: '#00d4ff', tip: 'Semi-perdidos — campaña de re-activación con regalo fuerte' },
    cold:  { emoji: '❄️', label: 'Congelados', range: '180+ d',    color: '#888888', tip: 'Perdidos hace tiempo — último intento, igual mandales' },
    never: { emoji: '👻', label: 'Nunca cargaron', range: 'sin depósitos', color: '#a050ff', tip: 'Se registraron pero NUNCA depositaron — welcome bonus + WhatsApp' }
};

// 🎯 Panorama: muestra distribución por segmento (cards clickeables que
// cambian el filtro). Siempre visible arriba para que el admin SEPA
// cuántos calientes/tibios/fríos/congelados/nunca tiene total.
function _apRenderPanorama(j) {
    const el = document.getElementById('apPanorama');
    if (!el) return;
    const counts = (document.getElementById('apExcludeWithApp').value === 'true')
        ? (j.segmentCountsWithoutApp || j.segmentCounts || {})
        : (j.segmentCounts || {});
    const total = (counts.hot || 0) + (counts.warm || 0) + (counts.cool || 0) + (counts.cold || 0) + (counts.never || 0);
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    const currentSeg = (document.getElementById('apSegment') || {}).value || 'all';
    const onlyNoApp = document.getElementById('apExcludeWithApp').value === 'true';

    let html = '<div style="background:linear-gradient(135deg,rgba(0,212,255,0.05),rgba(160,80,255,0.05));border:1px solid rgba(0,212,255,0.20);border-radius:12px;padding:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">';
    html += '<div><div style="color:#fff;font-weight:800;font-size:14px;">📊 Panorama por segmento ' + (onlyNoApp ? '(SIN app+notifs)' : '(todos)') + '</div>';
    html += '<div style="color:#aaa;font-size:11px;margin-top:2px;">Tocá un segmento para filtrar la lista de abajo. Total ' + (onlyNoApp ? 'sin app' : 'usuarios') + ': <strong style="color:#fff;">' + fmt(total) + '</strong></div></div>';
    html += '<div style="color:#666;font-size:10px;text-align:right;">Ventana: ' + (j.windowDays || 0) + ' días</div>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;">';

    const segs = ['hot', 'warm', 'cool', 'cold', 'never'];
    for (const s of segs) {
        const meta = _AP_SEGMENT_META[s];
        const count = counts[s] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isActive = currentSeg === s;
        const border = isActive ? meta.color : 'rgba(255,255,255,0.10)';
        const bg = isActive ? `rgba(${parseInt(meta.color.slice(1,3),16)},${parseInt(meta.color.slice(3,5),16)},${parseInt(meta.color.slice(5,7),16)},0.12)` : 'rgba(0,0,0,0.30)';
        html += '<div onclick="apSelectSegment(\'' + s + '\')" title="' + escapeHtml(meta.tip) + '" style="cursor:pointer;background:' + bg + ';border:1px solid ' + border + ';border-radius:10px;padding:10px 12px;transition:all 0.15s;">';
        html += '<div style="font-size:18px;line-height:1;">' + meta.emoji + '</div>';
        html += '<div style="color:' + meta.color + ';font-weight:800;font-size:20px;margin-top:6px;">' + fmt(count) + '</div>';
        html += '<div style="color:#fff;font-size:11px;font-weight:700;margin-top:2px;">' + meta.label + '</div>';
        html += '<div style="color:#888;font-size:10px;">' + meta.range + ' · ' + pct + '%</div>';
        html += '</div>';
    }
    // "Todos" card
    const allActive = currentSeg === 'all';
    const allBorder = allActive ? '#00d4ff' : 'rgba(255,255,255,0.10)';
    const allBg = allActive ? 'rgba(0,212,255,0.12)' : 'rgba(0,0,0,0.30)';
    html += '<div onclick="apSelectSegment(\'all\')" style="cursor:pointer;background:' + allBg + ';border:1px solid ' + allBorder + ';border-radius:10px;padding:10px 12px;transition:all 0.15s;">';
    html += '<div style="font-size:18px;line-height:1;">🌐</div>';
    html += '<div style="color:#00d4ff;font-weight:800;font-size:20px;margin-top:6px;">' + fmt(total) + '</div>';
    html += '<div style="color:#fff;font-size:11px;font-weight:700;margin-top:2px;">Todos</div>';
    html += '<div style="color:#888;font-size:10px;">sin filtrar segmento</div>';
    html += '</div>';

    html += '</div>'; // grid
    html += '</div>'; // wrapper
    el.innerHTML = html;
}

function apSelectSegment(seg) {
    const sel = document.getElementById('apSegment');
    if (!sel) return;
    sel.value = seg;
    loadActivePlayers();
}

async function loadActivePlayers() {
    const list = document.getElementById('apTeamsList');
    const summary = document.getElementById('apSummary');
    if (!list) return;
    list.innerHTML = '<div class="empty-state">⏳ Calculando…</div>';
    if (summary) summary.innerHTML = '';
    try {
        const [liveR, evoR, snapsR] = await Promise.all([
            authFetch('/api/admin/active-players?' + _apQueryString()),
            authFetch('/api/admin/active-players/evolution?days=30'),
            authFetch('/api/admin/active-players/snapshots?kind=manual&limit=20')
        ]);
        if (!liveR.ok) {
            list.innerHTML = '<div class="empty-state">❌ Error</div>';
            return;
        }
        const j = await liveR.json();
        _apCache = j;
        _apRenderPanorama(j);
        _apRenderSummary(j);
        _apRenderRecovered(j);
        _apRenderTeams(j);
        if (evoR.ok) {
            const ev = await evoR.json();
            _apRenderEvolution(ev);
        }
        if (snapsR.ok) {
            const sn = await snapsR.json();
            _apRenderSnapshotsList(sn.items || []);
        }
    } catch (e) {
        list.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function _apRenderEvolution(ev) {
    const el = document.getElementById('apEvolution');
    if (!el) return;
    const items = ev.items || [];
    if (items.length === 0) {
        el.innerHTML = '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;color:#888;font-size:12px;text-align:center;">📊 Evolución diaria — todavía no hay snapshots. Se toman automáticamente cada día a las 03:00 ART. Vuelven a aparecer acá mañana.</div>';
        return;
    }
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    const w = 600, h = 90, pad = 8;
    const xs = items.length;
    const maxV = Math.max(...items.map(i => i.totalWithoutApp || 0), 10);
    const stepX = (w - 2 * pad) / Math.max(1, xs - 1);
    let pathTotal = '', pathWithout = '', pathWith = '';
    items.forEach((it, idx) => {
        const x = pad + idx * stepX;
        const yT = h - pad - ((it.totalActiveAll || 0) / maxV) * (h - 2 * pad);
        const yW = h - pad - ((it.totalWithoutApp || 0) / maxV) * (h - 2 * pad);
        const yA = h - pad - ((it.totalWithApp || 0) / maxV) * (h - 2 * pad);
        pathTotal += (idx === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + yT.toFixed(1) + ' ';
        pathWithout += (idx === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + yW.toFixed(1) + ' ';
        pathWith += (idx === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + yA.toFixed(1) + ' ';
    });
    const last = items[items.length - 1];
    const first = items[0];
    const trend = last.totalWithoutApp - first.totalWithoutApp;
    const trendColor = trend > 0 ? '#ff5050' : (trend < 0 ? '#25d366' : '#aaa');
    const trendArrow = trend > 0 ? '↑' : (trend < 0 ? '↓' : '→');
    let html = '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:10px;margin-bottom:8px;">';
    html += '<div><div style="color:#fff;font-weight:700;font-size:13px;">📊 Evolución últimos ' + items.length + ' días</div>';
    html += '<div style="color:#aaa;font-size:11px;">Snapshot automático todos los días a las 03:00 ART · <a href="javascript:void(0)" onclick="apRefreshToday()" style="color:#00d4ff;text-decoration:none;">🔄 Actualizar punto de hoy</a></div></div>';
    html += '<div style="text-align:right;">';
    html += '<div style="color:#888;font-size:10px;font-weight:700;">Sin app: ' + fmt(first.totalWithoutApp) + ' → ' + fmt(last.totalWithoutApp) + '</div>';
    html += '<div style="color:' + trendColor + ';font-weight:800;font-size:14px;">' + trendArrow + ' ' + Math.abs(trend) + '</div>';
    html += '</div>';
    html += '</div>';
    html += '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto;display:block;">';
    html += '<path d="' + pathTotal + '" fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="1.5"/>';
    html += '<path d="' + pathWithout + '" fill="none" stroke="#ff8888" stroke-width="2"/>';
    html += '<path d="' + pathWith + '" fill="none" stroke="#25d366" stroke-width="2"/>';
    html += '</svg>';
    html += '<div style="display:flex;gap:14px;font-size:11px;color:#aaa;margin-top:6px;flex-wrap:wrap;">';
    html += '<span><span style="display:inline-block;width:10px;height:2px;background:rgba(255,255,255,0.30);vertical-align:middle;margin-right:4px;"></span>Total activos</span>';
    html += '<span><span style="display:inline-block;width:10px;height:2px;background:#ff8888;vertical-align:middle;margin-right:4px;"></span>SIN app+notifs (target)</span>';
    html += '<span><span style="display:inline-block;width:10px;height:2px;background:#25d366;vertical-align:middle;margin-right:4px;"></span>CON app+notifs (fidelizados)</span>';
    html += '</div>';
    html += '</div>';
    el.innerHTML = html;
}

function _apRenderSnapshotsList(items) {
    const el = document.getElementById('apSnapshotsList');
    if (!el) return;
    if (items.length === 0) {
        el.innerHTML = '<div style="color:#666;font-size:11px;font-style:italic;">No hay reportes manuales generados todavía. Apretá "🛠 Generar reporte ahora" para crear el primero.</div>';
        return;
    }
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '<div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;">';
    for (const s of items) {
        const when = s.generatedAt ? new Date(s.generatedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const statusColor = { ready: '#25d366', queued: '#ffaa44', running: '#00d4ff', error: '#ff5050' }[s.status] || '#888';
        const statusLabel = { ready: '✓ LISTO', queued: '⏳ EN COLA', running: '⚙ GENERANDO', error: '❌ ERROR' }[s.status] || s.status;
        html += '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;font-size:11px;">';
        html += '<div>';
        html += '<span style="color:' + statusColor + ';font-weight:700;">' + statusLabel + '</span>';
        html += ' <span style="color:#aaa;">· ' + escapeHtml(when) + ' · por ' + escapeHtml(s.generatedBy || '—') + '</span>';
        if (s.status === 'ready') html += ' <span style="color:#fff;">· ' + fmt(s.matchedUsers) + ' contactos</span>';
        if (s.params) html += ' <span style="color:#666;">· ventana ' + s.params.windowDays + 'd, mín ' + s.params.minDepositCount + ' cargas</span>';
        html += '</div>';
        if (s.status === 'ready') {
            html += '<button onclick="apDownloadSnapshot(\'' + s.id + '\')" style="padding:5px 10px;background:rgba(37,211,102,0.10);color:#25d366;border:1px solid rgba(37,211,102,0.30);border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;">📥 Descargar CSV</button>';
        } else if (s.status === 'error') {
            html += '<span style="color:#ff5050;font-size:10px;">' + escapeHtml(s.errorMessage || 'error desconocido') + '</span>';
        } else {
            html += '<span style="color:#aaa;font-size:10px;font-style:italic;">…esperá unos segundos y refrescá</span>';
        }
        html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
}

async function apGenerateSnapshot() {
    const btn = document.getElementById('apGenerateBtn');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Encolando…';
    try {
        const wd = parseInt(document.getElementById('apWindowDays').value);
        const mc = parseInt(document.getElementById('apMinDepositCount').value);
        const mars = parseInt(document.getElementById('apMinDepositARS').value);
        const exc = document.getElementById('apExcludeWithApp').value === 'true';
        const segEl = document.getElementById('apSegment');
        const seg = segEl ? segEl.value : 'all';
        const r = await authFetch('/api/admin/active-players/snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ windowDays: wd, minDepositCount: mc, minDepositARS: mars, excludeWithApp: exc, segment: seg })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        showToast('🛠 Reporte encolado · ID: ' + j.id.slice(0, 8) + '… (se genera en segundos)', 'success');
        // Pollear cada 2s hasta que termine, o dejar que el user refresque.
        _apPollSnapshot(j.id);
    } catch (e) {
        showToast('Error de conexión', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

async function _apPollSnapshot(id, attempts) {
    attempts = attempts || 0;
    if (attempts > 30) return; // 60s max
    try {
        const r = await authFetch('/api/admin/active-players/snapshot/' + encodeURIComponent(id));
        if (r.ok) {
            const j = await r.json();
            const s = j.snapshot;
            if (s.status === 'ready') {
                showToast('✅ Reporte listo (' + (s.matchedUsers || 0) + ' contactos) — bajá el CSV', 'success');
                // Refrescar la lista de snapshots.
                const listR = await authFetch('/api/admin/active-players/snapshots?kind=manual&limit=20');
                if (listR.ok) {
                    const sn = await listR.json();
                    _apRenderSnapshotsList(sn.items || []);
                }
                return;
            }
            if (s.status === 'error') {
                showToast('❌ Error generando reporte: ' + (s.errorMessage || ''), 'error');
                return;
            }
        }
    } catch (_) {}
    setTimeout(() => _apPollSnapshot(id, attempts + 1), 2000);
}

// ============================================
// 🔁 REASIGNAR HUÉRFANOS (botón en sección Equipos)
// ============================================
async function reassignOrphansPreview() {
    showToast('⏳ Calculando preview…', 'info');
    try {
        const r = await authFetch('/api/admin/user-lines/reassign-orphans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun: true })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        const s = j.summary || {};
        const sample = j.sampleAssignments || [];
        let msg = '🔁 PREVIEW: REASIGNAR HUÉRFANOS\n\n';
        msg += 'Total usuarios sin línea: ' + s.total + '\n';
        msg += '  ✅ Match por prefijo: ' + s.matchedPrefix + '\n';
        msg += '  🟡 Caen al GENERAL: ' + s.fellToDefault + '\n';
        msg += '  ⚠ Sin resolución (no hay default): ' + s.noResolution + '\n\n';
        if (s.byTeam) {
            msg += 'Por equipo destino:\n';
            for (const [team, count] of Object.entries(s.byTeam)) {
                msg += '  ' + team + ': ' + count + '\n';
            }
        }
        if (sample.length > 0) {
            msg += '\nEjemplos (primeros ' + sample.length + '):\n';
            for (const a of sample.slice(0, 10)) {
                msg += '  ' + a.username + ' → ' + (a.note || '') + '\n';
            }
        }
        msg += '\n¿Aplicar los cambios? Esto modifica ' + (s.matchedPrefix + s.fellToDefault) + ' usuarios.';
        if (confirm(msg)) {
            reassignOrphansExecute();
        }
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

async function reassignOrphansExecute() {
    showToast('⏳ Aplicando reasignaciones…', 'info');
    try {
        const r = await authFetch('/api/admin/user-lines/reassign-orphans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun: false })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        showToast('✅ ' + (j.applied || 0) + ' usuarios reasignados', 'success');
        loadTeams();
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

async function apRefreshToday() {
    try {
        showToast('🔄 Recalculando snapshot de hoy…', 'info');
        const r = await authFetch('/api/admin/active-players/refresh-today', { method: 'POST' });
        if (!r.ok) { showToast('Error', 'error'); return; }
        showToast('✅ Punto de hoy actualizado', 'success');
        loadActivePlayers();
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

async function apDownloadSnapshot(id) {
    try {
        const token = (typeof currentToken !== 'undefined' && currentToken) ? currentToken : localStorage.getItem('adminToken');
        const r = await fetch('/api/admin/active-players/snapshot/' + encodeURIComponent(id) + '/csv', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!r.ok) { showToast('Error descargando', 'error'); return; }
        const blob = await r.blob();
        const cd = r.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="([^"]+)"/);
        const fname = m ? m[1] : ('snapshot-' + id.slice(0, 8) + '.csv');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('📥 ' + fname + ' descargado', 'success');
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

function _apRenderSummary(j) {
    const el = document.getElementById('apSummary');
    if (!el) return;
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;margin-bottom:12px;">';
    html += _apChip('Activos totales', fmt(j.totalActiveAll || 0), '#fff', 'En la ventana de ' + j.windowDays + ' días');
    html += _apChip('SIN app+notifs', fmt(j.totalWithoutApp || 0), '#ff8888', 'Tu target principal');
    html += _apChip('Con app+notifs', fmt(j.totalWithApp || 0), '#25d366', 'Ya están fidelizados');
    html += _apChip('Mostrando', fmt(j.matchedUsers || 0), '#00d4ff', 'Después de filtros');
    html += '</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button onclick="apExportCsv()" style="padding:8px 16px;background:linear-gradient(135deg,#25d366,#0a7a3a);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">📥 Descargar CSV (' + fmt(j.matchedUsers || 0) + ' contactos)</button>';
    html += '<button onclick="apExpandAll()" style="padding:8px 14px;background:rgba(255,255,255,0.06);color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-size:12px;cursor:pointer;">⤵ Expandir todo</button>';
    html += '<button onclick="apCollapseAll()" style="padding:8px 14px;background:rgba(255,255,255,0.06);color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-size:12px;cursor:pointer;">⤴ Contraer todo</button>';
    html += '<div style="margin-left:auto;color:#666;font-size:11px;align-self:center;">Calculado en ' + (j.computedInMs || 0) + ' ms · ' + (j.teams || []).length + ' equipos</div>';
    html += '</div>';
    el.innerHTML = html;
}

function _apChip(label, value, color, sub) {
    return '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;">' +
        '<div style="color:#888;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">' + escapeHtml(label) + '</div>' +
        '<div style="color:' + color + ';font-size:22px;font-weight:800;margin-top:4px;">' + value + '</div>' +
        (sub ? '<div style="color:#888;font-size:10px;margin-top:2px;">' + escapeHtml(sub) + '</div>' : '') +
        '</div>';
}

// 🎉 Lista de clientes RECUPERADOS: pasaron de "sin app" a "con app+notif".
// Se computa con appFirstInstalledAt > now - lookbackDays (default 7).
function _apRenderRecovered(j) {
    const el = document.getElementById('apRecovered');
    if (!el) return;
    const recovered = j.recoveredRecently || [];
    const lookback = j.recoveredLookbackDays || 7;
    if (recovered.length === 0) {
        el.innerHTML = '<div style="background:rgba(0,212,255,0.04);border:1px dashed rgba(0,212,255,0.30);border-radius:10px;padding:12px;color:#888;font-size:12px;text-align:center;">' +
            '🎉 Recuperados últimos ' + lookback + ' días: <strong style="color:#aaa;">0</strong> · Cuando un cliente sin app la instala con notifs, aparece acá.' +
            '</div>';
        return;
    }
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '<div style="background:rgba(37,211,102,0.06);border:1px solid rgba(37,211,102,0.40);border-radius:10px;padding:12px 14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:10px;margin-bottom:8px;">';
    html += '  <div><strong style="color:#25d366;font-size:14px;">🎉 ' + recovered.length + ' clientes RECUPERADOS</strong> <span style="color:#aaa;font-size:11px;">— últimos ' + lookback + ' días instalaron app + activaron notifs</span></div>';
    html += '  <button onclick="apToggleRecoveredList()" style="background:rgba(37,211,102,0.20);color:#25d366;border:1px solid rgba(37,211,102,0.50);border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;font-weight:700;" id="apRecoveredToggleBtn">▾ Ver lista</button>';
    html += '</div>';
    html += '<div id="apRecoveredList" style="display:none;max-height:340px;overflow-y:auto;background:rgba(0,0,0,0.30);border-radius:8px;margin-top:6px;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<thead><tr style="background:rgba(37,211,102,0.10);color:#25d366;">';
    html += '<th style="text-align:left;padding:8px;">Username</th>';
    html += '<th style="text-align:left;padding:8px;">Equipo</th>';
    html += '<th style="text-align:left;padding:8px;">Línea</th>';
    html += '<th style="text-align:right;padding:8px;">Cargas (' + j.windowDays + 'd)</th>';
    html += '<th style="text-align:left;padding:8px;">Instaló app</th>';
    html += '</tr></thead><tbody>';
    for (const r of recovered) {
        const installed = r.appFirstInstalledAt ? new Date(r.appFirstInstalledAt) : null;
        const installedStr = installed
            ? installed.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '—';
        const hoursAgo = installed ? Math.round((Date.now() - installed.getTime()) / 3600000) : null;
        const ago = hoursAgo == null ? '' : (hoursAgo < 24 ? `hace ${hoursAgo}h` : `hace ${Math.floor(hoursAgo/24)}d`);
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '  <td style="padding:8px;color:#fff;font-weight:700;">' + escapeHtml(r.username) + '</td>';
        html += '  <td style="padding:8px;color:#ddd;">' + escapeHtml(r.lineTeamName || '—') + '</td>';
        html += '  <td style="padding:8px;color:#aaa;font-family:monospace;font-size:10px;">' + escapeHtml(r.linePhone || '—') + '</td>';
        html += '  <td style="padding:8px;text-align:right;color:#25d366;">$' + fmt(r.totalDepositsARS) + ' <small style="color:#666;">(' + (r.depositCount||0) + ')</small></td>';
        html += '  <td style="padding:8px;color:#fff;">' + installedStr + ' <small style="color:#666;">' + ago + '</small></td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '</div>';
    html += '</div>';
    el.innerHTML = html;
}

function apToggleRecoveredList() {
    const list = document.getElementById('apRecoveredList');
    const btn = document.getElementById('apRecoveredToggleBtn');
    if (!list) return;
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.textContent = isHidden ? '▴ Ocultar lista' : '▾ Ver lista';
}

function _apRenderTeams(j) {
    const list = document.getElementById('apTeamsList');
    if (!list) return;
    const teams = j.teams || [];
    if (teams.length === 0) {
        list.innerHTML = '<div class="empty-state" style="font-size:13px;color:#888;line-height:1.6;">No hay clientes activos con esos filtros.<br>Probá ampliar la ventana o reducir el mínimo de depósitos.</div>';
        return;
    }
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
    for (const t of teams) {
        const tn = t.teamName;
        const expanded = _apExpandedTeams.has(tn);
        const safeId = 'apTeam_' + tn.replace(/\W/g, '_');
        html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;">';
        html += '<div onclick="apToggleTeam(\'' + tn.replace(/'/g, "\\'") + '\')" style="padding:12px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:rgba(255,255,255,0.02);">';
        html += '<div>';
        html += '<div style="color:#fff;font-weight:700;font-size:14px;">' + (expanded ? '▼' : '▶') + ' ' + escapeHtml(tn) + ' <span style="color:#888;font-size:11px;font-weight:400;">· ' + t.count + ' jugadores</span></div>';
        html += '<div style="color:#aaa;font-size:11px;margin-top:3px;">Cargas en ventana: <strong style="color:#ffd700;">$' + fmt(Math.round(t.totalDepositsARS)) + '</strong> · ' + fmt(t.totalDepositCount) + ' transacciones</div>';
        html += '</div>';
        html += '<button onclick="event.stopPropagation();apExportCsv(\'' + tn.replace(/'/g, "\\'") + '\')" style="padding:6px 12px;background:rgba(37,211,102,0.10);color:#25d366;border:1px solid rgba(37,211,102,0.30);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">📥 CSV equipo</button>';
        html += '</div>';
        if (expanded) {
            html += '<div id="' + safeId + '" style="padding:0 14px 12px;">';
            html += _apRenderUsersTable(t.users);
            html += '</div>';
        }
        html += '</div>';
    }
    html += '</div>';
    list.innerHTML = html;
}

function _apRenderUsersTable(users) {
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">';
    html += '<thead><tr style="background:rgba(255,255,255,0.05);">';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">Usuario</th>';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">📞 Línea</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">Cargas (ARS)</th>';
    html += '<th style="text-align:right;padding:8px;color:#aaa;">#</th>';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">Última actividad</th>';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">Segmento</th>';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">App</th>';
    html += '<th style="text-align:left;padding:8px;color:#aaa;">Welcome</th>';
    html += '</tr></thead><tbody>';
    for (const u of users) {
        const phoneText = u.linePhone || '—';
        const phoneLink = u.linePhone ? `<a href="https://wa.me/${u.linePhone.replace(/[^\d]/g, '')}" target="_blank" rel="noopener" style="color:#25d366;text-decoration:none;">${escapeHtml(phoneText)}</a>` : '—';
        const lastAct = u.lastActivityDate
            ? new Date(u.lastActivityDate).toLocaleDateString('es-AR', {day:'2-digit',month:'short'}) + (u.daysSinceLastActivity != null ? ' <span style="color:#666;font-size:10px;">(' + u.daysSinceLastActivity + 'd)</span>' : '')
            : '<span style="color:#666;">— sin cargas —</span>';
        const meta = _AP_SEGMENT_META[u.segment] || _AP_SEGMENT_META.never;
        const segBadge = '<span style="background:rgba(' + parseInt(meta.color.slice(1,3),16) + ',' + parseInt(meta.color.slice(3,5),16) + ',' + parseInt(meta.color.slice(5,7),16) + ',0.15);color:' + meta.color + ';padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">' + meta.emoji + ' ' + meta.label.toUpperCase() + '</span>';
        const appBadge = u.hasChannel
            ? '<span style="background:rgba(37,211,102,0.15);color:#25d366;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">✓ APP+NOTIFS</span>'
            : (u.hasApp ? '<span style="background:rgba(255,170,68,0.15);color:#ffaa44;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">SOLO APP</span>'
                       : '<span style="background:rgba(255,80,80,0.15);color:#ff5050;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">✗ SIN APP</span>');
        const welcomeBadge = u.welcomeBonusClaimed
            ? '<span style="color:#888;font-size:11px;">✓ Reclamó</span>'
            : '<span style="color:#ffd700;font-weight:700;font-size:11px;">$5.000 disponibles</span>';
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:7px;color:#fff;font-weight:600;">' + escapeHtml(u.username) + '</td>';
        html += '<td style="padding:7px;">' + phoneLink + '</td>';
        html += '<td style="padding:7px;text-align:right;color:' + (u.totalDepositsARS > 0 ? '#ffd700' : '#666') + ';font-weight:700;">$' + fmt(Math.round(u.totalDepositsARS)) + '</td>';
        html += '<td style="padding:7px;text-align:right;color:#aaa;">' + u.depositCount + '</td>';
        html += '<td style="padding:7px;color:#aaa;">' + lastAct + '</td>';
        html += '<td style="padding:7px;">' + segBadge + '</td>';
        html += '<td style="padding:7px;">' + appBadge + '</td>';
        html += '<td style="padding:7px;">' + welcomeBadge + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function apToggleTeam(teamName) {
    if (_apExpandedTeams.has(teamName)) _apExpandedTeams.delete(teamName);
    else _apExpandedTeams.add(teamName);
    if (_apCache) _apRenderTeams(_apCache);
}

function apExpandAll() {
    if (!_apCache) return;
    for (const t of (_apCache.teams || [])) _apExpandedTeams.add(t.teamName);
    _apRenderTeams(_apCache);
}

function apCollapseAll() {
    _apExpandedTeams.clear();
    if (_apCache) _apRenderTeams(_apCache);
}

async function apExportCsv(teamName) {
    let qs = _apQueryString().replace('&groupByTeam=true', '');
    if (teamName) qs += '&team=' + encodeURIComponent(teamName);
    // Fetch con auth y disparar download.
    try {
        showToast('⏳ Generando CSV…', 'info');
        const token = (typeof currentToken !== 'undefined' && currentToken) ? currentToken : localStorage.getItem('adminToken');
        const r = await fetch('/api/admin/active-players/export?' + qs, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!r.ok) { showToast('Error generando CSV', 'error'); return; }
        const blob = await r.blob();
        const cd = r.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="([^"]+)"/);
        const fname = m ? m[1] : 'clientes-activos.csv';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ ' + fname + ' descargado', 'success');
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

// ============================================
// ❓ AYUDA Y GUÍA
// ============================================
function loadHelp() {
    const el = document.getElementById('helpContent');
    if (!el) return;
    if (el._loaded) return; // render una sola vez
    el._loaded = true;

    const blocks = _helpBlocks();
    let html = '';
    for (const b of blocks) {
        html += '<details id="' + b.anchor + '" style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:0;overflow:hidden;">';
        html += '<summary style="cursor:pointer;padding:14px 16px;font-weight:700;color:#fff;font-size:14px;list-style:none;display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.02);">';
        html += '<span>' + b.icon + ' ' + b.title + '</span>';
        html += '<span style="color:#888;font-size:12px;font-weight:400;">tocá para abrir/cerrar ▾</span>';
        html += '</summary>';
        html += '<div style="padding:14px 18px;color:#bbb;font-size:13px;line-height:1.7;">' + b.body + '</div>';
        html += '</details>';
    }
    el.innerHTML = html;

    // Auto-abrir si vienen con anchor en URL.
    if (location.hash && location.hash.length > 1) {
        const id = location.hash.slice(1);
        const tgt = document.getElementById(id);
        if (tgt && tgt.tagName === 'DETAILS') {
            tgt.open = true;
            setTimeout(() => tgt.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
    }
}

function _helpBlocks() {
    return [
        {
            anchor: 'help-overview',
            icon: '🌟',
            title: 'Cómo funciona el panel (vista general)',
            body: [
                '<p>Este panel administra <strong>JUGAYGANA</strong> + la app de notificaciones. Cada parte tiene un objetivo:</p>',
                '<ul>',
                '<li><strong>Reportes (diarios / semanales / mensuales)</strong>: ves <em>reembolsos</em> e <em>ingresos</em> por equipo/línea para liquidar comisiones y medir rendimiento.</li>',
                '<li><strong>Equipos</strong>: cada línea de WhatsApp pertenece a un equipo. Acá ves cargas/retiros/comisiones por equipo y reasignás líneas si hace falta.</li>',
                '<li><strong>Notificaciones push</strong>: mandás aviso a la app (con o sin promo de WhatsApp / regalo de plata).</li>',
                '<li><strong>Automatizaciones</strong>: el motor decide solo (cada lunes y jueves) a quién y cuánto regalarle.</li>',
                '<li><strong>Caída de línea</strong>: difundís cambio de número cuando una línea se cae.</li>',
                '<li><strong>Clientes activos sin app</strong>: lista para fidelizar por WhatsApp a los que <em>todavía no tienen la app</em>.</li>',
                '</ul>',
                '<p style="background:rgba(255,200,80,0.06);border-left:3px solid #ffc850;padding:10px 12px;margin-top:10px;border-radius:6px;"><strong style="color:#ffc850;">Regla de oro:</strong> los <em>topes</em> (cap de notificaciones, presupuesto semanal, cooldown) están para evitar quemar la base. No los toques sin tener claro qué cambia.</p>'
            ].join('')
        },
        {
            anchor: 'help-numero',
            icon: '📞',
            title: 'Número principal vigente — cómo cambiar el número que ven los jugadores',
            body: [
                '<p>El <strong>Número principal vigente</strong> es el WhatsApp que ven todos los jugadores en la app/landing. Es el contacto general — no el de su línea asignada.</p>',
                '<p><strong>Cómo cambiarlo:</strong></p>',
                '<ol>',
                '<li>Andá a <strong>📞 Número principal vigente</strong> en el menú izquierdo.</li>',
                '<li>Vas a ver el número actual con un botón <strong>"Cambiar número"</strong>.</li>',
                '<li>Ingresá el nuevo número en formato internacional sin el "+": ej. <code>5491156234567</code>.</li>',
                '<li>Apretá <strong>Guardar</strong>. El cambio es inmediato — la próxima vez que un jugador abra la app verá el nuevo número.</li>',
                '</ol>',
                '<p style="color:#ffc850;"><strong>OJO:</strong> esto NO actualiza las líneas individuales por equipo. Cada equipo tiene su propio número (ver sección Equipos).</p>',
                '<p>Si lo que se cayó es la línea de <em>un equipo específico</em>, no toques el principal — usá <strong>🚨 Caída de línea</strong>.</p>'
            ].join('')
        },
        {
            anchor: 'help-equipamiento',
            icon: '📊',
            title: 'Equipos y contactos por línea — cómo se cargan',
            body: [
                '<p>Cada equipo (Oro, Plata, Bronce, etc.) tiene <strong>una o más líneas de WhatsApp</strong>. Cada usuario está asignado a una línea según el prefijo de su username (ej: usernames que arrancan con <code>oro_</code> caen al equipo Oro).</p>',
                '<p><strong>Para cargar/cambiar el listado de líneas:</strong></p>',
                '<ol>',
                '<li>Andá a <strong>📊 Equipos</strong>.</li>',
                '<li>Cada fila es un equipo. Apretá el botón <strong>"📞 Líneas"</strong> al lado del equipo.</li>',
                '<li>Vas a ver las líneas actuales con su número, prefijo, y cantidad de usuarios.</li>',
                '<li>Para <strong>agregar línea</strong>: completá <em>nombre interno, número WhatsApp y prefijo</em> (ej: <code>oro_</code>, <code>vip_</code>). Apretá Agregar.</li>',
                '<li>Para <strong>cambiar número</strong>: tocá el lápiz al lado del número. Confirmá.</li>',
                '<li>Para <strong>borrar línea</strong>: el botón rojo. <em>Los usuarios asignados a esa línea pasan a "huérfanos"</em> — usá Reasignar Huérfanos para volver a darles línea.</li>',
                '</ol>',
                '<h4 style="color:#fff;margin-top:14px;">Columnas de la tabla de equipos:</h4>',
                '<ul>',
                '<li><strong>Equipo</strong>: nombre del grupo (Oro, Plata, etc.)</li>',
                '<li><strong>Líneas</strong>: cantidad de números WhatsApp activos para ese equipo.</li>',
                '<li><strong>Usuarios</strong>: cuántos jugadores están asignados.</li>',
                '<li><strong>SIN línea</strong>: huérfanos (ver Reasignar huérfanos).</li>',
                '<li><strong>REASIGNADO</strong>: usuarios que estaban huérfanos y la reasignación les puso una línea por prefijo o por default.</li>',
                '<li><strong>Cargas/Retiros (ARS)</strong>: suma de plata movida en la ventana actual.</li>',
                '<li><strong>Cargas netas</strong>: cargas − retiros (lo que efectivamente quedó dentro).</li>',
                '<li><strong>Comisión</strong>: porcentaje liquidable para el equipo, según contrato.</li>',
                '</ul>'
            ].join('')
        },
        {
            anchor: 'help-stats',
            icon: '📈',
            title: 'Estadísticas — Reportes (Diario / Semanal / Mensual) e Ingresos',
            body: [
                '<p>Tres reportes que miden lo mismo (cargas, retiros, comisiones) en distinta ventana de tiempo:</p>',
                '<ul>',
                '<li><strong>Reporte diario</strong>: lo del día (corte 00:00-23:59 ART).</li>',
                '<li><strong>Reporte semanal</strong>: 7 días corridos.</li>',
                '<li><strong>Reporte mensual</strong>: el mes calendario.</li>',
                '</ul>',
                '<p>Filtros disponibles: <em>rango de fechas, equipo, línea</em>. El reporte se actualiza al cambiar cualquier filtro.</p>',
                '<h4 style="color:#fff;margin-top:14px;">Columnas del reporte:</h4>',
                '<ul>',
                '<li><strong>Equipo / Línea</strong>: agrupación.</li>',
                '<li><strong>Cargas (ARS)</strong>: total depositado por los usuarios.</li>',
                '<li><strong>Retiros (ARS)</strong>: total retirado.</li>',
                '<li><strong>Cargas netas</strong>: <code>cargas − retiros</code>. Es lo que efectivamente queda en la plataforma.</li>',
                '<li><strong>Reembolsos liquidables</strong>: lo que la línea le devuelve al jugador (porcentaje de las pérdidas, según pacto).</li>',
                '<li><strong>Comisión equipo</strong>: la parte que cobra el equipo.</li>',
                '</ul>',
                '<h4 style="color:#fff;margin-top:14px;">Sección Ingresos:</h4>',
                '<p>Es el resumen general: <em>cuánto entró menos cuánto salió, cuánto le toca a cada equipo, cuánto queda neto para la casa</em>. Sirve como dashboard de cierre.</p>',
                '<h4 style="color:#fff;margin-top:14px;">Top engagement:</h4>',
                '<p>Lista los <em>usuarios más activos</em> (más cargas, más logins, más sesiones). Sirve para identificar VIPs y darles trato preferencial.</p>'
            ].join('')
        },
        {
            anchor: 'help-notifs',
            icon: '🔔',
            title: 'Notificaciones push — cómo enviar avisos a la app',
            body: [
                '<p>Mandás push a los celulares de los jugadores que tienen la app instalada y notificaciones activadas.</p>',
                '<p><strong>Tipos de notificación:</strong></p>',
                '<ul>',
                '<li><strong>Plain (sin promo)</strong>: solo el mensaje. Útil para avisos generales.</li>',
                '<li><strong>WhatsApp Promo</strong>: el push además activa un cartel <em>"Reclamá por WhatsApp"</em> en la app. El usuario lo toca y arranca un chat con la línea con un código que vos decidiste.</li>',
                '<li><strong>Money giveaway (regalo de plata)</strong>: el push activa un botón <em>"Reclamá $X"</em> en la app. El usuario tap → se le acredita en JUGAYGANA. Tope total + tope por persona.</li>',
                '</ul>',
                '<p><strong>Audiencia:</strong></p>',
                '<ul>',
                '<li><strong>Todos</strong>: todos los users con app+notifs.</li>',
                '<li><strong>Por prefijo</strong>: solo los que arrancan con cierto prefijo (ej: <code>oro_</code>).</li>',
                '<li><strong>Solo a un user</strong>: para tests o casos puntuales.</li>',
                '</ul>',
                '<p><strong>Programar para más tarde:</strong> elegís fecha/hora y se manda solo a esa hora. Pendientes se ven en la lista de "Programadas".</p>',
                '<p><strong>Historial de notificaciones</strong>: todo lo enviado queda guardado con stats (cuántos llegaron, cuántos clickearon, cuántos reclamaron el regalo).</p>',
                '<p style="background:rgba(255,80,80,0.06);border-left:3px solid #ff5050;padding:10px 12px;margin-top:10px;border-radius:6px;"><strong style="color:#ff5050;">CUIDADO:</strong> mandar push masivos quema la base. La regla del motor automático es <strong>máximo 2 notifs por user por semana</strong> — si mandás manualmente más, los users desinstalan o desactivan notifs.</p>'
            ].join('')
        },
        {
            anchor: 'help-automations',
            icon: '🤖',
            title: 'Automatizaciones — cómo configurar la estrategia semanal',
            body: [
                '<p>El motor automático manda <strong>2 campañas a la semana</strong>:</p>',
                '<ul>',
                '<li><strong>Lunes (Netwin Gift)</strong>: regalo de plata a usuarios que <em>perdieron la semana pasada</em>. El monto se calcula por tier según pérdida.</li>',
                '<li><strong>Jueves (Tier Bonus)</strong>: bonus reclamable por WhatsApp para usuarios <em>fidelizados con muchos reembolsos acumulados</em> en el último período (Oro/Plata/Bronce).</li>',
                '<li><strong>Miércoles (Reporte ROI)</strong>: NO es push — es un informe interno que mide si las campañas anteriores funcionaron (cargas pre vs post).</li>',
                '</ul>',
                '<h4 style="color:#fff;margin-top:14px;">Configuración:</h4>',
                '<p>En <strong>🤖 Automatizaciones</strong> tenés:</p>',
                '<ul>',
                '<li><strong>Pausar / despausar</strong>: por X horas (max 30 días). Útil si vas de viaje o querés freezar la campaña.</li>',
                '<li><strong>Presupuesto semanal</strong>: monto máximo total que el motor puede regalar/comprometer en la semana (default $500.000).</li>',
                '<li><strong>Cap por user</strong>: cuántos pushes recibe como máximo cada user por semana (default 2). El motor respeta este tope <em>incluso si manualmente mandaste más</em>.</li>',
                '<li><strong>Cooldown</strong>: horas mínimas entre dos pushes al mismo user.</li>',
                '<li><strong>Ejecutar ahora</strong>: dispara la campaña del día (lunes/jueves) sin esperar el cron. Útil para tests.</li>',
                '</ul>',
                '<h4 style="color:#fff;margin-top:14px;">Tiers para Netwin Gift (ejemplo):</h4>',
                '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-top:6px;">',
                '<tr style="background:rgba(255,255,255,0.05);"><th style="text-align:left;padding:6px;color:#aaa;">Pérdida semanal</th><th style="text-align:right;padding:6px;color:#aaa;">Regalo</th></tr>',
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:6px;color:#fff;">$500.000+</td><td style="padding:6px;text-align:right;color:#ffd700;">$15.000</td></tr>',
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:6px;color:#fff;">$200k–500k</td><td style="padding:6px;text-align:right;color:#ffd700;">$10.000</td></tr>',
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:6px;color:#fff;">$100k–200k</td><td style="padding:6px;text-align:right;color:#ffd700;">$5.000</td></tr>',
                '<tr><td style="padding:6px;color:#fff;">$50k–100k</td><td style="padding:6px;text-align:right;color:#ffd700;">$2.500</td></tr>',
                '</table>',
                '<p style="margin-top:10px;">Los montos exactos los ajustás desde el config del motor.</p>',
                '<h4 style="color:#fff;margin-top:14px;">ROI por difusión:</h4>',
                '<p>Cada campaña queda con <em>plan detallado per-user</em> (qué se le iba a dar y por qué) + clasificación post-campaña en 4 grupos:</p>',
                '<ul>',
                '<li><strong>Converter</strong>: reclamó el regalo y cargó MÁS post-push.</li>',
                '<li><strong>Passive</strong>: reclamó el regalo pero NO cargó después.</li>',
                '<li><strong>No response</strong>: ni reclamó ni cargó.</li>',
                '<li><strong>Regressive</strong>: cargó MENOS después que antes.</li>',
                '</ul>',
                '<p>Mirá esto cada semana — te dice si la campaña valió la plata.</p>'
            ].join('')
        },
        {
            anchor: 'help-active',
            icon: '🎯',
            title: 'Clientes activos sin app — segmentos y campañas WhatsApp',
            body: [
                '<p>Lista de jugadores que <strong>NO tienen la app instalada</strong> (o no aceptaron notificaciones). Tu target para fidelizar por WhatsApp.</p>',
                '<h4 style="color:#fff;margin-top:14px;">Segmentos por recency (días desde última carga):</h4>',
                '<ul>',
                '<li>🔥 <strong>Calientes</strong> (0-30 días): cargaron hace nada, son los más fáciles. Mandales WhatsApp inmediato con el welcome bonus.</li>',
                '<li>😴 <strong>Tibios</strong> (30-90 días): empezaron a despegarse. Bonus de recuperación + WhatsApp personalizado.</li>',
                '<li>🥶 <strong>Fríos</strong> (90-180 días): semi-perdidos. Necesitan un regalo más fuerte para volver.</li>',
                '<li>❄️ <strong>Congelados</strong> (180+ días): perdidos hace tiempo. Último intento — campaña masiva con bonus alto.</li>',
                '<li>👻 <strong>Nunca cargaron</strong>: se registraron pero no depositaron. Welcome bonus de $5.000 + WhatsApp es la clave (lo cobran cuando alcancen 5 cargas en 30 días).</li>',
                '</ul>',
                '<h4 style="color:#fff;margin-top:14px;">Cómo usar:</h4>',
                '<ol>',
                '<li>Apretá un segmento del <em>panorama</em> arriba (o usá el selector "Segmento").</li>',
                '<li>La lista por equipo se filtra y mostrá solo ese segmento.</li>',
                '<li>Apretá <strong>📥 Descargar CSV</strong> para bajar la lista completa con username, número, equipo, monto cargado y días de inactividad.</li>',
                '<li>Pasá el CSV al equipo de WhatsApp para que arranque la campaña.</li>',
                '</ol>',
                '<h4 style="color:#fff;margin-top:14px;">Filtros adicionales:</h4>',
                '<ul>',
                '<li><strong>Ventana lookup</strong>: hasta cuántos días miramos atrás. Para "fríos" / "congelados" subí a 365 o 730 días.</li>',
                '<li><strong>Mín. depósitos</strong>: poné 0 si querés incluir users que se registraron pero no depositaron (segmento "nunca").</li>',
                '<li><strong>Mín. ARS</strong>: filtrá por tamaño — útil para targetear solo a los que cargaron mucho.</li>',
                '<li><strong>Mostrar</strong>: "Solo SIN app+notifs" (default) vs "Todos".</li>',
                '</ul>',
                '<h4 style="color:#fff;margin-top:14px;">Reportes guardados:</h4>',
                '<p>Apretá <strong>"🛠 Generar reporte ahora"</strong> para crear una <em>foto fija</em> con los filtros actuales. Quedá guardada en la lista de reportes manuales para que cualquiera del equipo la baje sin tener que recalcular.</p>'
            ].join('')
        },
        {
            anchor: 'help-linedown',
            icon: '🚨',
            title: 'Caída de línea — qué hacer cuando un número se cae',
            body: [
                '<p>Cuando WhatsApp baña una línea (la banean por X razón), tenés que avisarle a los jugadores afectados <em>inmediatamente</em> el nuevo número.</p>',
                '<p><strong>Cómo funciona:</strong></p>',
                '<ol>',
                '<li>Andá a <strong>🚨 Caída de línea</strong>.</li>',
                '<li>Elegí el equipo afectado.</li>',
                '<li>Ingresá el nuevo número.</li>',
                '<li>(Opcional) Activá un bonus de regalo de plata como compensación.</li>',
                '<li>Apretá <strong>"Difundir cambio de número"</strong>.</li>',
                '</ol>',
                '<p><strong>Qué hace internamente:</strong></p>',
                '<ul>',
                '<li>Le manda push a TODOS los users del equipo con el aviso del cambio.</li>',
                '<li>Actualiza el <code>linePhone</code> de cada user.</li>',
                '<li>Guarda el evento en el historial con el número viejo + nuevo + cuántos affected.</li>',
                '<li>Si activaste bonus, crea un MoneyGiveaway con audienceWhitelist = users del equipo.</li>',
                '</ul>',
                '<p style="background:rgba(255,80,80,0.06);border-left:3px solid #ff5050;padding:10px 12px;margin-top:10px;border-radius:6px;"><strong style="color:#ff5050;">OJO:</strong> esto NO cambia el número del listado de líneas en Equipos — ese lo cambiás aparte si querés que el cambio sea permanente. La caída es un aviso de emergencia.</p>'
            ].join('')
        },
        {
            anchor: 'help-welcome',
            icon: '🎁',
            title: 'Welcome bonus — cómo se reclama y cómo seguir el reporte',
            body: [
                '<p>Todo usuario tiene <strong>$5.000 de welcome bonus</strong> esperándolo (one-time). Para reclamarlo necesita:</p>',
                '<ol>',
                '<li>Bajar la app.</li>',
                '<li>Loguearse (con su user de JUGAYGANA).</li>',
                '<li>Aceptar notificaciones push.</li>',
                '<li>Tener al menos <strong>5 cargas en los últimos 30 días</strong> (anti-fraude para usuarios nuevos sin actividad real).</li>',
                '<li>Apretar el botón "Reclamar" — la plata se le acredita directo en JUGAYGANA.</li>',
                '</ol>',
                '<p><strong>El reporte de Welcome Bonus</strong> te muestra:</p>',
                '<ul>',
                '<li><strong>Total reclamado</strong>: cuántos lo activaron.</li>',
                '<li><strong>Por equipo</strong>: distribución de reclamos por línea.</li>',
                '<li><strong>Conversión</strong>: cuántos cargaron plata DESPUÉS de reclamar el bonus (señal de que vale la pena).</li>',
                '</ul>',
                '<p>Si la conversión es baja, hay que ajustar: o subir el monto, o cambiar el copy del aviso, o targetear mejor.</p>'
            ].join('')
        },
        {
            anchor: 'help-refunds',
            icon: '💸',
            title: 'Reembolsos — qué son y cómo se calculan',
            body: [
                '<p>Cada equipo tiene un pacto de <strong>devolverle un porcentaje de las pérdidas</strong> al jugador (típico 10-25%). Eso se llama "reembolso" y se paga semanal o mensual.</p>',
                '<p><strong>Cómo se calcula:</strong></p>',
                '<ol>',
                '<li>Sumamos cargas del jugador en la ventana.</li>',
                '<li>Restamos retiros del jugador en esa ventana.</li>',
                '<li>Si <code>cargas − retiros &gt; 0</code>, el jugador <em>perdió plata</em>. La línea le debe el % pactado de esa diferencia.</li>',
                '<li>Si retiró más de lo que cargó, <em>no hay reembolso</em>.</li>',
                '</ol>',
                '<p>El reporte muestra el <strong>total a reembolsar</strong> por equipo y por línea. La línea liquida en mano vía WhatsApp con el jugador — el panel solo te da el monto.</p>'
            ].join('')
        },
        {
            anchor: 'help-orphans',
            icon: '🔁',
            title: 'Reasignar huérfanos — qué son y cómo asignarles línea',
            body: [
                '<p>"Huérfano" = un user que NO tiene línea asignada (<code>lineTeamName=null</code>). Pasa cuando:</p>',
                '<ul>',
                '<li>Borraste una línea sin reasignar.</li>',
                '<li>El user se registró antes de que armaras los equipos.</li>',
                '<li>Su prefijo no coincide con ninguna línea actual.</li>',
                '</ul>',
                '<p><strong>Cómo reasignar:</strong></p>',
                '<ol>',
                '<li>En <strong>📊 Equipos</strong> apretá <strong>"🔁 Reasignar huérfanos"</strong>.</li>',
                '<li>Te muestra <em>preview</em>: cuántos van a hacer match por prefijo, cuántos caen al equipo default ("GENERAL"), cuántos no resuelven.</li>',
                '<li>Si te parece bien, confirmá. Quedan asignados con <code>lineAssignmentSource=auto-prefix</code> o <code>auto-default</code>.</li>',
                '</ol>',
                '<p><strong>Algoritmo:</strong></p>',
                '<ol>',
                '<li>Para cada user huérfano, mira si su <em>username arranca con un prefijo</em> de alguna línea (ej: <code>oro_juan</code> → línea con prefix <code>oro_</code>).</li>',
                '<li>Si match → le asigna esa línea.</li>',
                '<li>Si NO match → cae al equipo default (si hay uno). Si no hay default, queda sin resolver.</li>',
                '</ol>'
            ].join('')
        },
        {
            anchor: 'help-encuesta-estrategia',
            icon: '📋',
            title: 'Encuesta — estrategia mensual, ventana horaria y calendario completo',
            body: [
                '<p>La sección <strong>📋 Encuesta</strong> tiene <em>4 pestañas</em>: <strong>Estrategia</strong>, <strong>Gente que se une</strong>, <strong>ROI / Reacciones</strong>, <strong>Historial semanal</strong>. La pestaña principal es <strong>Estrategia</strong>: ahí configurás qué notifs salen, a quién y cuándo.</p>',

                '<h4 style="color:#fff;margin-top:16px;">1) Cómo funciona el modal de la encuesta</h4>',
                '<p>Cuando un user entra a la PWA por primera vez (después de instalarla), le aparece un modal preguntando qué tipo de notifs quiere recibir. Las opciones son:</p>',
                '<ul>',
                '<li>🟢 <strong>SUAVE</strong>: 2 bonos · 5 invitaciones a jugar · 2 regalos al mes.</li>',
                '<li>🟡 <strong>NORMAL</strong>: 4 bonos · 5 invitaciones · 2 regalos.</li>',
                '<li>🔴 <strong>ACTIVO</strong>: 6 bonos · 10 invitaciones · 3 regalos.</li>',
                '<li>🔔 <strong>SOLO REEMB</strong>: solo si hay reembolso disponible (no recibe nada extra).</li>',
                '</ul>',

                '<h4 style="color:#fff;margin-top:16px;">2) Editor de estrategia (lo que vos completás)</h4>',
                '<p>En la pestaña <strong>Estrategia</strong> editás:</p>',
                '<ul>',
                '<li><strong>Cantidades por tier</strong>: cuántos <em>bonos / juegos / regalos</em> al mes recibe cada tier. Tocá <strong>"🔄 Cargar valores recomendados"</strong> y te llena con defaults sensatos.</li>',
                '<li><strong>Tipo de bono</strong>: free-form (ej. "50% en cargas + 1× 100% al mes").</li>',
                '<li><strong>Plata total a regalar/mes</strong>: pozo que se reparte según tier (VIP 50% · STD 35% · Casual 15%).</li>',
                '<li><strong>Tope técnico de regalos</strong>: hard cap. La distribución no puede excederlo.</li>',
                '<li><strong>📅 Ventana horaria de envío</strong> (cuadro verde): hora de inicio y fin (default <strong>18:00 a 21:00</strong>). Cada notif sale a una hora <em>random</em> dentro de esta ventana — los users no reciben todos al mismo tiempo.</li>',
                '</ul>',

                '<h4 style="color:#fff;margin-top:16px;">3) Botones del editor</h4>',
                '<ul>',
                '<li>🔄 <strong>Cargar valores recomendados</strong>: rellena con defaults (incluye 18-21hs). NO guarda, hay que apretar Guardar.</li>',
                '<li>👁️ <strong>VER PREVIA</strong>: abre un modal con simulación NO persistida — ves cuánto le tocaría a cada tier con la config actual sin afectar nada.</li>',
                '<li>💾 <strong>GUARDAR estrategia</strong>: persiste cambios pero no activa todavía. Mientras esté inactiva, los crons no respetan la config.</li>',
                '<li>✅ <strong>ACTIVAR estrategia</strong> (verde): persiste + dispara la programación masiva del mes (ver punto 4).</li>',
                '<li>📅 <strong>Ver calendario de envíos</strong>: abre el modal con la foto del calendario actual (ver punto 5).</li>',
                '</ul>',

                '<h4 style="color:#fff;margin-top:16px;">4) Qué pasa cuando apretás ACTIVAR</h4>',
                '<p>Esto es lo importante. Al activar:</p>',
                '<ol>',
                '<li>Se <strong>cancelan</strong> todos los pushes pendientes de la estrategia anterior (idempotente: re-activar no duplica).</li>',
                '<li>Para <strong>cada user</strong> con tier <em>suave/normal/activo</em> y FCM token registrado:',
                '<ul>',
                '<li>Se le programan <strong>N pushes de bonos</strong> (según cantidad del tier) en N días distintos del resto del mes.</li>',
                '<li>Se le programan <strong>N pushes de juegos</strong> en otros N días.</li>',
                '<li>Se le programan <strong>N pushes de regalos</strong> en otros N días.</li>',
                '<li>Cada uno cae a una hora <strong>random</strong> dentro de la ventana 18-21.</li>',
                '</ul></li>',
                '<li>Los push los dispara un worker en background cada 60s — vos no tenés que estar prendido.</li>',
                '</ol>',
                '<p style="background:rgba(102,255,102,0.06);border-left:3px solid #66ff66;padding:10px 12px;margin-top:10px;border-radius:6px;"><strong style="color:#66ff66;">Inscripción automática:</strong> los users que respondan la encuesta DESPUÉS de activar se inscriben solos en el plan que les corresponde (le programamos su mes individual). No hace falta tocar nada cuando se suma gente.</p>',

                '<h4 style="color:#fff;margin-top:16px;">5) Modal "📅 Calendario de envíos"</h4>',
                '<p>Aparece automáticamente cuando activás, y también desde el botón <em>"📅 Ver calendario de envíos"</em>. Muestra:</p>',
                '<ul>',
                '<li>Header con tarjetas grandes: <strong>total programado</strong>, <strong>users incluidos</strong>, <strong>días con envíos</strong>.</li>',
                '<li><strong>Ventana horaria</strong> configurada.</li>',
                '<li><strong>Por categoría</strong>: cuántos 🎁 bonos, 🎰 juegos, 💎 regalos en total.</li>',
                '<li><strong>Por tier</strong>: cuántas notifs van a 🟢/🟡/🔴/🔔.</li>',
                '<li><strong>Distribución por día</strong>: mini gráfico de barras día a día del mes.</li>',
                '<li><strong>Tabla detallada</strong> (hasta 200): hora exacta, usuario, tier, categoría, título.</li>',
                '</ul>',

                '<h4 style="color:#fff;margin-top:16px;">6) 🗓️ Cronograma semanal (NUEVO)</h4>',
                '<p>Debajo del editor de estrategia hay una tarjeta azul <strong>"🗓️ Cronograma — próximos 7 días"</strong>. Es la <em>foto día por día</em> de cómo avanza la semana:</p>',
                '<ul>',
                '<li><strong>Selector de rango</strong>: 7 / 14 / 30 días.</li>',
                '<li><strong>Resumen</strong>: total pushes pendientes en el rango + users distintos.</li>',
                '<li><strong>Tabla</strong> con una fila por día:',
                '<ul>',
                '<li><em>Día</em>: nombre + fecha (el día actual está resaltado en dorado con ⭐).</li>',
                '<li><em>Pushes</em>: cuántas notifs salen ese día.</li>',
                '<li><em>Users</em>: cuántas personas distintas reciben.</li>',
                '<li><em>Público (por tier)</em>: 🟢 N · 🟡 N · 🔴 N — quién recibe cada día.</li>',
                '<li><em>Categorías</em>: 🎁 bonos · 🎰 juegos · 💎 regalos — qué tipo de mensaje.</li>',
                '<li><em>Horario</em>: primera hora → última hora del día.</li>',
                '</ul></li>',
                '</ul>',
                '<p>Sirve para que de un vistazo veas <strong>cómo avanza la estrategia esta semana</strong> sin entrar al modal grande del calendario.</p>',

                '<h4 style="color:#fff;margin-top:16px;">7) Test fire (cuadro rojo)</h4>',
                '<p>Caja roja "🧪 Test fire": ingresás un username y le mandamos 5 pushes de prueba (cada 1 minuto). Útil para QA — confirmá que el user tiene app instalada y notifs activadas antes de testear.</p>',

                '<h4 style="color:#fff;margin-top:16px;">8) Pestaña Gente que se une</h4>',
                '<p>Lista cronológica de quién respondió la encuesta y qué eligió. Filtros por tier + opciones de regalar bono individual.</p>',

                '<h4 style="color:#fff;margin-top:16px;">9) Pestaña ROI / Reacciones</h4>',
                '<p>Muestra de los últimos 30 días, agrupado por tier: cuántos pushes salieron, cuántos llegaron, cuántos clickearon. Te dice si vale la pena la estrategia.</p>',

                '<h4 style="color:#fff;margin-top:16px;">10) Pestaña Historial semanal</h4>',
                '<p>KPI por semana ISO: respondentes nuevos, pushes enviados, plata distribuida. Histórico para detectar tendencias mes a mes.</p>',

                '<p style="background:rgba(255,200,80,0.06);border-left:3px solid #ffc850;padding:10px 12px;margin-top:14px;border-radius:6px;"><strong style="color:#ffc850;">Importante:</strong> si modificás la estrategia y la <strong>re-activás</strong>, se cancelan los pushes pendientes y se regenera todo desde cero. Si <strong>desactivás</strong>, se cancelan también — no quedan colgados pushes viejos.</p>'
            ].join('')
        },
        {
            anchor: 'help-backup-phones',
            icon: '📞',
            title: 'Números de respaldo — base de datos privada con clave',
            body: [
                '<p>Los users pueden dejar un número de teléfono <strong>opcional</strong> desde la home (tarjeta azul "📞 Tu línea (opcional)" al pie del feed). Sirve para tener una <em>vía paralela</em> si la página falla y queremos avisarles directo.</p>',

                '<h4 style="color:#fff;margin-top:14px;">Cómo lo ven los users (en la home)</h4>',
                '<ul>',
                '<li>Tarjeta visible al pie de la home, debajo de "💬 OPINIONES DE LA GENTE".</li>',
                '<li>Texto: "Si tenemos un problema con la página, te avisamos directo. <em>Importante pero no obligatorio</em>".</li>',
                '<li>Input + botón <strong>Guardar</strong>. Una vez guardado, <em>el botón cambia a "Actualizar"</em> y muestra "✓ Tenés guardado este número" — pueden modificarlo cuando quieran.</li>',
                '<li><strong>NO se exige</strong>: si no quieren dar el número, no pasa nada. La tarjeta queda visible para que la usen cuando se les ocurra.</li>',
                '</ul>',

                '<h4 style="color:#fff;margin-top:14px;">Cómo accedés vos al listado (admin)</h4>',
                '<ol>',
                '<li>En el menú izquierdo del admin → <strong>📞 Números de respaldo</strong> (debajo de "Encuesta").</li>',
                '<li>Te aparece una pantalla bloqueada que pide <strong>PIN 1818</strong> para entrar.</li>',
                '<li>Una vez desbloqueado: tabla con <strong>Equipo / Usuario / Teléfono / Fecha</strong>.</li>',
                '<li>Botón verde <strong>"⬇️ Descargar CSV"</strong> arriba a la derecha — baja un Excel con esas 4 columnas + fecha de carga.</li>',
                '<li>Botón <strong>🔄</strong> al lado del título para refrescar.</li>',
                '</ol>',

                '<h4 style="color:#fff;margin-top:14px;">CSV que se descarga</h4>',
                '<p>Nombre del archivo: <code>numeros-respaldo-YYYY-MM-DD.csv</code>. Columnas:</p>',
                '<ul>',
                '<li><strong>Equipo</strong>: el equipo del user (de la asignación de línea).</li>',
                '<li><strong>Usuario</strong>: el username de JUGAYGANA.</li>',
                '<li><strong>Telefono</strong>: el número que dejó (sin formato, solo dígitos).</li>',
                '<li><strong>Fecha</strong>: cuándo lo cargó (ISO 8601).</li>',
                '</ul>',
                '<p>Encoding UTF-8 con BOM (lo abre Excel sin romper acentos).</p>',

                '<p style="background:rgba(255,80,80,0.06);border-left:3px solid #ff5050;padding:10px 12px;margin-top:14px;border-radius:6px;"><strong style="color:#ff5050;">Sobre el PIN 1818:</strong> el PIN es <em>solo del lado cliente</em>, así que cualquier admin con consola puede saltarlo. El endpoint detrás ya está protegido por <code>authMiddleware + adminMiddleware</code>, o sea, hace falta sesión admin para acceder. El PIN es un freno extra contra clicks accidentales, no una cerradura real. Si querés bloqueo de verdad, hay que hacer 2FA (ver opción de seguridad pendiente).</p>'
            ].join('')
        },
        {
            anchor: 'help-opiniones',
            icon: '💬',
            title: 'Opiniones de la gente — feed con texto y solo estrellas',
            body: [
                '<p>En la home, debajo del CTA verde de sorteos, hay <strong>2 bloques de opiniones</strong>:</p>',
                '<ol>',
                '<li><strong>Card del form</strong>: el user vota 1-5 estrellas + escribe (max 100 chars) + opcionalmente deja un teléfono privado para que lo contacten si tiene un problema.</li>',
                '<li><strong>Feed al pie</strong>: lista pública de las opiniones de los demás (con username enmascarado al 80%). Se muestra <em>arriba el promedio</em> + porcentajes BUENO/REGULAR/MALO + lista detallada.</li>',
                '</ol>',

                '<h4 style="color:#fff;margin-top:14px;">Default del comentario (matchea las estrellas)</h4>',
                '<p>Si el user toca <strong>3 estrellas</strong>, el textarea se autocompleta con "<em>3 estrellas</em>". Toca 4 → "<em>4 estrellas</em>". Etc.</p>',
                '<p>Apenas el user hace click en el textarea para escribir, el default se borra y arranca con sus propias palabras. Si se va sin tocar, queda como "<em>{N} estrellas</em>" en el feed (en blanco, no en dorado).</p>',

                '<h4 style="color:#fff;margin-top:14px;">Promedio con media estrella</h4>',
                '<p>Antes <strong>4.5 mostraba 4 estrellas</strong> (truncado). Ahora muestra <strong>4 estrellas + media</strong> (gradient mitad dorada / mitad gris). Reglas:</p>',
                '<ul>',
                '<li>≥ 0.75 fracción → redondea para arriba (4.8 = 5 estrellas).</li>',
                '<li>0.25 a 0.75 fracción → media estrella (4.5 = 4 + ½).</li>',
                '<li>&lt; 0.25 fracción → no hay media (4.1 = 4).</li>',
                '</ul>',

                '<h4 style="color:#fff;margin-top:14px;">Feed separado en 2 bloques (NUEVO)</h4>',
                '<p>El feed ahora <strong>prioriza los comentarios con texto real</strong>:</p>',
                '<ol>',
                '<li><strong>Arriba</strong>: opiniones que dejaron un texto propio (no es default "N estrellas"). Cards normales en 3 columnas.</li>',
                '<li><strong>Divisor dorado</strong>: "⭐ Solo estrellas (N)" con el conteo.</li>',
                '<li><strong>Abajo</strong>: opiniones que solo dejaron puntaje sin escribir. Cards mini compactas en grid (auto-fill 140px) — ocupan poco espacio para no estorbar al scroll.</li>',
                '</ol>',
                '<p>Si querés esconder los "solo estrellas" del público (que el feed muestre solo los que escribieron), avisame.</p>',

                '<h4 style="color:#fff;margin-top:14px;">Click expande el comentario</h4>',
                '<p>Cada card del feed se puede tocar y se expande mostrando el comentario completo (en mobile, donde no hay hover, esto es clave porque los textos quedan cortados con elipsis). Tocás de nuevo y vuelve al estado chico.</p>',

                '<h4 style="color:#fff;margin-top:14px;">Donde lo mirás vos (admin)</h4>',
                '<p>Sección <strong>⭐ Reseñas</strong> en el admin: ves todas las opiniones con texto completo, estrellas, fecha, username (sin mask). Sirve para detectar quejas, mejoras, y posibles regalos a clientes que tienen una mala experiencia.</p>'
            ].join('')
        },
        {
            anchor: 'help-glossary',
            icon: '📚',
            title: 'Glosario de términos',
            body: [
                '<dl style="display:grid;grid-template-columns:1fr 2fr;gap:6px 14px;font-size:12px;">',
                '<dt style="color:#00d4ff;font-weight:700;">JUGAYGANA</dt><dd>Plataforma de juego donde se mueve la plata real. Este panel se conecta a su API.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">FCM</dt><dd>Firebase Cloud Messaging — el servicio que entrega los push a los celulares.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">app+notifs</dt><dd>User que tiene la app instalada Y aceptó notificaciones. Solo a estos les podés mandar push.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">netwin</dt><dd>Pérdida del jugador = cargas − retiros. Si es positivo, perdió plata (lo que la casa ganó).</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">cap semanal</dt><dd>Tope de cuántos pushes recibe un user en una semana (default 2).</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">cooldown</dt><dd>Mínimo de horas entre dos pushes al mismo user.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">audienceWhitelist</dt><dd>Lista cerrada de usernames habilitados para reclamar un giveaway.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">tier</dt><dd>Categoría del jugador (Oro/Plata/Bronce) según volumen de cargas y reembolsos.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">recency</dt><dd>Cuánto hace que el jugador hizo su última actividad. Define el segmento (hot/warm/cool/cold).</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">ROI</dt><dd>Return On Investment. Mide si la plata regalada generó más cargas en respuesta.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">control group</dt><dd>Users que cumplían criterio pero NO recibieron (por cap o cooldown). Sirve para comparar y aislar el efecto real de la campaña.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">prefix</dt><dd>Las primeras letras del username que indican a qué línea/equipo pertenece (ej: <code>oro_</code>).</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">huérfano</dt><dd>User sin línea asignada.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">strategySource</dt><dd>Origen de un giveaway: <code>auto-strategy</code> (motor semanal), <code>auto-rule</code> (regla aprobada), <code>manual</code> (admin desde panel).</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">ventana horaria</dt><dd>Rango de horas dentro del cual se distribuyen las notifs de la estrategia (default 18:00 a 21:00). Cada user recibe a una hora <em>random</em> dentro de esa ventana.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">scheduledFor</dt><dd>Timestamp futuro de un push programado. Un worker en background los dispara cada 60s cuando llega su hora.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">backup phone</dt><dd>Número de respaldo opcional que el user deja en la home. Sirve para tener una vía paralela si la página falla.</dd>',
                '<dt style="color:#00d4ff;font-weight:700;">categorías</dt><dd>Tipos de push de la estrategia: 🎁 <strong>bonos</strong> (ofertas de carga), 🎰 <strong>juegos</strong> (invitación a jugar), 💎 <strong>regalos</strong> (plata directa).</dd>',
                '</dl>'
            ].join('')
        }
    ];
}

// ============================================
// 🚀 LANZADOR AD-HOC (tab "Lanzar ahora")
// ============================================
let _adhocPlanCache = null; // último plan analizado en esta sesión
let _adhocExpandedTargets = false;
let _adhocExpandedNoApp = false;

function _adhocDateInputDefault(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
}

function _adhocDatetimeInputDefault(hoursFromNow) {
    const d = new Date(Date.now() + hoursFromNow * 3600 * 1000);
    // formato yyyy-MM-ddTHH:mm en hora local
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function _adhocRenderTab() {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '';

    html += '<div style="background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.30);border-radius:10px;padding:14px;margin-bottom:14px;">';
    html += '<div style="color:#ff8888;font-weight:800;font-size:14px;">🚀 Lanzar estrategia ahora</div>';
    html += '<div style="color:#bbb;font-size:12px;margin-top:6px;line-height:1.6;">';
    html += 'Elegí <strong>fechas para analizar</strong> cómo jugó cada cliente, <strong>tope de presupuesto</strong>, y el <strong>foco</strong>. ';
    html += 'Te armo el plan per-user (qué se le da a quién y por qué). Si te gusta, lo confirmás y se lanza al toque.';
    html += '<br><span style="color:#ffc850;">Respeta cap semanal (' + (typeof _strategyConfigCache !== "undefined" && _strategyConfigCache ? _strategyConfigCache.capPerUserPerWeek : 2) + ') + cooldown — los que ya recibieron 2 pushes esta semana NO se les manda.</span>';
    html += '</div>';
    html += '</div>';

    // ============ PRESETS RAPIDOS ============
    html += '<div style="background:linear-gradient(135deg,rgba(255,170,68,0.08),rgba(255,80,80,0.06));border:1px solid rgba(255,170,68,0.40);border-radius:12px;padding:14px;margin-bottom:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
    html += '<div><div style="color:#ffaa44;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:1px;">⚡ Presets rápidos · 1 click</div>';
    html += '<div style="color:#aaa;font-size:11px;margin-top:2px;">Sin análisis previo — directo al destinatario. Editable antes de lanzar.</div></div>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;">';
    const presets = [
        {
            id: 'p_50_perdedores_chicos',
            label: '🎁 50% bono · perdedores chicos',
            sub: 'BRONCE + PLATA · PERDIDO',
            color: '#ffaa66',
            cfg: {
                title: '🎁 50% extra para vos',
                body: 'Cargá HOY y te duplicamos un 50% de lo que pongas. Volvé a jugar, esta vez ganás. Hasta las 23:59.',
                bonusPercent: 50, type: 'bonus',
                targetSegment: 'perdido', tiers: ['BRONCE', 'PLATA'], hasAppOnly: true
            }
        },
        {
            id: 'p_100_inactivos',
            label: '🚀 100% bono · inactivos top',
            sub: 'ORO + VIP · INACTIVO',
            color: '#ff5050',
            cfg: {
                title: '🔥 Te duplicamos lo que cargues',
                body: 'Hace tiempo no te vemos. Volvé hoy y te ponemos el doble. 100% extra sobre lo que cargues. Ahora.',
                bonusPercent: 100, type: 'bonus',
                targetSegment: 'inactivo', tiers: ['ORO', 'VIP'], hasAppOnly: true
            }
        },
        {
            id: 'p_75_riesgo',
            label: '⚠️ 75% bono · en riesgo',
            sub: 'Todos los tiers · EN RIESGO',
            color: '#ffd700',
            cfg: {
                title: '⏳ No te alejes — bono del 75%',
                body: 'Te tenemos un regalo. Cargá hoy y te ponemos un 75% extra. Quedan horas, aprovechalo.',
                bonusPercent: 75, type: 'bonus',
                targetSegment: 'en_riesgo', tiers: [], hasAppOnly: true
            }
        },
        {
            id: 'p_calientes_gracias',
            label: '👑 Mensaje VIP a calientes',
            sub: 'Sin bono · agradecimiento',
            color: '#66ff66',
            cfg: {
                title: '👑 Sos VIP — gracias por estar',
                body: 'Sos uno de los que mantienen esto andando. Te tenemos preparada una sorpresa esta semana, atento al chat.',
                bonusPercent: 0, type: 'push',
                targetSegment: 'caliente', tiers: [], hasAppOnly: true
            }
        }
    ];
    for (const p of presets) {
        html += '<button onclick="_quickLaunchPresetOpen(' + escapeJsArg(JSON.stringify(p.cfg)) + ', ' + escapeJsArg(p.label) + ')" style="background:rgba(0,0,0,0.40);border:1px solid ' + p.color + ';border-radius:8px;padding:10px;text-align:left;color:#fff;cursor:pointer;display:flex;flex-direction:column;gap:3px;">';
        html += '<span style="color:' + p.color + ';font-weight:800;font-size:12px;">' + p.label + '</span>';
        html += '<span style="color:#aaa;font-size:10.5px;">' + p.sub + '</span>';
        html += '</button>';
    }
    html += '</div></div>';

    // ============ FORM DE ANÁLISIS ============
    html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:16px;margin-bottom:14px;">';
    html += '<div style="color:#fff;font-weight:700;font-size:13px;margin-bottom:12px;">🎯 Paso 1 · Configurar análisis</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:12px;">';
    html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px;">Desde (analizar juego)</label>';
    html += '<input type="date" id="adhocFrom" value="' + _adhocDateInputDefault(7) + '" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;color-scheme:dark;"></div>';
    html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px;">Hasta</label>';
    html += '<input type="date" id="adhocTo" value="' + _adhocDateInputDefault(0) + '" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;color-scheme:dark;"></div>';
    html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px;">Tope total ARS</label>';
    html += '<input type="number" id="adhocBudget" value="200000" min="1000" step="10000" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;"></div>';
    html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px;">Foco</label>';
    html += '<select id="adhocFocus" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;">';
    html += '<option value="lift_today" selected>📈 Levantar la venta del día (perdedores recientes)</option>';
    html += '<option value="reactivate_dormant">💤 Re-activar dormidos</option>';
    html += '<option value="mix">🌐 Mix (todos los perfiles)</option>';
    html += '</select></div>';
    html += '</div>';
    html += '<button id="adhocAnalyzeBtn" onclick="adhocAnalyze()" style="padding:10px 18px;background:linear-gradient(135deg,#ffc850,#cc8800);color:#000;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">🔍 Analizar</button>';
    html += '</div>';

    // ============ RESULTADO DEL ANÁLISIS ============
    html += '<div id="adhocPlanContainer"></div>';

    c.innerHTML = html;
    if (_adhocPlanCache) _adhocRenderPlan(_adhocPlanCache);
}

async function adhocAnalyze() {
    const btn = document.getElementById('adhocAnalyzeBtn');
    const fromEl = document.getElementById('adhocFrom');
    const toEl = document.getElementById('adhocTo');
    const budEl = document.getElementById('adhocBudget');
    const focusEl = document.getElementById('adhocFocus');
    if (!btn || !fromEl || !toEl || !budEl || !focusEl) return;

    const analysisFrom = new Date(fromEl.value + 'T00:00:00').toISOString();
    const analysisTo = new Date(toEl.value + 'T23:59:59').toISOString();
    const maxBudgetARS = parseInt(budEl.value) || 200000;
    const focus = focusEl.value;

    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '⏳ Analizando…';
    document.getElementById('adhocPlanContainer').innerHTML = '<div class="empty-state">⏳ Calculando plan…</div>';

    try {
        const r = await authFetch('/api/admin/strategy/adhoc/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysisFrom, analysisTo, maxBudgetARS, focus })
        });
        const j = await r.json();
        if (!r.ok) {
            showToast(j.error || 'Error', 'error');
            document.getElementById('adhocPlanContainer').innerHTML = '<div class="empty-state">❌ ' + escapeHtml(j.error || 'Error') + '</div>';
            return;
        }
        _adhocPlanCache = { ...j.plan, planId: j.planId };
        _adhocRenderPlan(_adhocPlanCache);
        showToast('✅ Plan listo · ' + j.plan.targetCount + ' usuarios · $' + Number(j.plan.totalCostARS).toLocaleString('es-AR'), 'success');
    } catch (e) {
        showToast('Error de conexión', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

function _adhocRenderPlan(plan) {
    const el = document.getElementById('adhocPlanContainer');
    if (!el) return;
    const fmt = n => Number(n || 0).toLocaleString('es-AR');

    let html = '';

    // ============ RESUMEN ============
    html += '<div style="background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.25);border-radius:12px;padding:16px;margin-bottom:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:10px;margin-bottom:12px;">';
    html += '<div><div style="color:#00d4ff;font-weight:800;font-size:14px;">📋 Plan listo</div>';
    html += '<div style="color:#888;font-size:11px;">El plan vive 60 min en memoria. Si tarda más, hay que re-analizar.</div></div>';
    html += '<div style="color:#888;font-size:10px;text-align:right;">Plan ID: ' + escapeHtml(plan.planId.slice(0, 8)) + '…</div>';
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;">';
    html += _adhocChip('Universo elegible', fmt(plan.candidatesAppNotifs), '#fff', 'Users con app+notifs');
    html += _adhocChip('Aplicaron filtro', fmt(plan.statsCount), '#aaa', 'Tuvieron actividad en el rango');
    html += _adhocChip('Audiencia total', fmt(plan.audienceCount), '#00d4ff', 'Hacen match con paquete');
    html += _adhocChip('Con app+notifs', fmt(plan.audienceWithChannelCount || 0), '#25d366', 'Pueden recibir push');
    html += _adhocChip('SIN app+notifs', fmt(plan.audienceNoChannelCount || 0), '#ff8888', 'Target WhatsApp manual');
    html += _adhocChip('Bloqueados', fmt(plan.blockedCount), '#ffaa44', 'Cap o cooldown');
    html += _adhocChip('Cortados por tope', fmt(plan.droppedByBudget), '#888', 'No entraron en budget');
    html += _adhocChip('Reciben push', fmt(plan.targetCount), '#25d366', 'TARGET final');
    html += _adhocChip('Costo total', '$' + fmt(plan.totalCostARS), '#ffd700', 'De $' + fmt(plan.maxBudgetARS) + ' tope');
    html += '</div>';
    html += '</div>';

    // ============ BREAKDOWN POR PAQUETE ============
    if (plan.breakdown && plan.breakdown.length > 0) {
        html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:14px;margin-bottom:14px;">';
        html += '<div style="color:#fff;font-weight:700;font-size:13px;margin-bottom:10px;">🎯 Distribución por paquete</div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<thead><tr style="background:rgba(255,255,255,0.05);"><th style="text-align:left;padding:8px;color:#aaa;">Paquete</th><th style="text-align:left;padding:8px;color:#aaa;">Tipo</th><th style="text-align:right;padding:8px;color:#aaa;">Users</th><th style="text-align:right;padding:8px;color:#aaa;">Costo total ARS</th><th style="text-align:right;padding:8px;color:#aaa;">Bono % avg</th></tr></thead><tbody>';
        for (const b of plan.breakdown) {
            const kindBadge = b.kind === 'money'
                ? '<span style="background:rgba(255,215,0,0.15);color:#ffd700;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">💰 PLATA</span>'
                : '<span style="background:rgba(37,211,102,0.15);color:#25d366;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">📱 BONO % WA</span>';
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
            html += '<td style="padding:7px;color:#fff;">' + escapeHtml(b.label) + '</td>';
            html += '<td style="padding:7px;">' + kindBadge + '</td>';
            html += '<td style="padding:7px;text-align:right;color:#fff;font-weight:700;">' + fmt(b.count) + '</td>';
            html += '<td style="padding:7px;text-align:right;color:#ffd700;">$' + fmt(b.totalGiftARS) + '</td>';
            html += '<td style="padding:7px;text-align:right;color:#25d366;">' + (b.avgBonusPct || 0) + '%</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        html += '</div>';
    }

    // ============ DETALLE PER-USER (collapsible) ============
    if (plan.targets && plan.targets.length > 0) {
        html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:14px;margin-bottom:14px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">';
        html += '<div style="color:#fff;font-weight:700;font-size:13px;">👥 Detalle per-user · CON app (' + fmt(plan.targets.length) + ')</div>';
        html += '<button onclick="adhocToggleDetail()" style="padding:5px 12px;background:rgba(255,255,255,0.06);color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:11px;cursor:pointer;">' + (_adhocExpandedTargets ? '⤴ Ocultar' : '⤵ Mostrar') + '</button>';
        html += '</div>';
        if (_adhocExpandedTargets) {
            html += '<div style="max-height:400px;overflow-y:auto;">';
            html += _adhocRenderUserTable(plan.targets, true);
            html += '</div>';
        }
        html += '</div>';
    }

    // ============ DETALLE SIN APP (target WhatsApp manual) ============
    if (plan.noAppTargets && plan.noAppTargets.length > 0) {
        html += '<div style="background:rgba(255,170,68,0.06);border:1px solid rgba(255,170,68,0.30);border-radius:12px;padding:14px;margin-bottom:14px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">';
        html += '<div><div style="color:#ffaa44;font-weight:700;font-size:13px;">📱 SIN app+notifs · target WhatsApp manual (' + fmt(plan.noAppTargets.length) + ')</div>';
        html += '<div style="color:#888;font-size:11px;margin-top:2px;">Hicieron match con un paquete pero no podemos pushear. Pasalos por WhatsApp con la línea asignada.</div></div>';
        html += '<div style="display:flex;gap:6px;">';
        html += '<button onclick="adhocToggleNoApp()" style="padding:5px 12px;background:rgba(255,255,255,0.06);color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:11px;cursor:pointer;">' + (_adhocExpandedNoApp ? '⤴ Ocultar' : '⤵ Mostrar') + '</button>';
        html += '<button onclick="adhocDownloadNoAppCSV()" style="padding:5px 12px;background:rgba(37,211,102,0.15);color:#25d366;border:1px solid rgba(37,211,102,0.30);border-radius:6px;font-size:11px;cursor:pointer;">📥 CSV</button>';
        html += '</div>';
        html += '</div>';
        // Mini-breakdown por paquete
        if (plan.noAppBreakdown && plan.noAppBreakdown.length > 0) {
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;font-size:11px;">';
            for (const b of plan.noAppBreakdown) {
                html += '<span style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.10);padding:4px 8px;border-radius:6px;color:#aaa;">' + escapeHtml(b.label) + ': <strong style="color:#fff;">' + fmt(b.count) + '</strong></span>';
            }
            html += '</div>';
        }
        if (_adhocExpandedNoApp) {
            html += '<div style="max-height:400px;overflow-y:auto;">';
            html += _adhocRenderUserTable(plan.noAppTargets, false);
            html += '</div>';
        }
        html += '</div>';
    }

    // ============ FORM DE LAUNCH ============
    if (plan.targets && plan.targets.length > 0) {
        // ¿Hay users en el bucket promo % carga? Si sí, mostrar el override.
        const hasPromoTier = (plan.targets || []).some(t => t.kind === 'whatsapp_promo' && (t.bonusPct || 0) > 0);
        const promoCount = (plan.targets || []).filter(t => t.kind === 'whatsapp_promo' && (t.bonusPct || 0) > 0).length;

        html += '<div style="background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.30);border-radius:12px;padding:16px;">';
        html += '<div style="color:#ff8888;font-weight:800;font-size:14px;margin-bottom:10px;">🚀 Paso 2 · Confirmar y lanzar</div>';

        // Válido hasta + presets
        html += '<div style="margin-bottom:12px;">';
        html += '<label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px;">⏰ Válido hasta (giveaway expira a esta hora)</label>';
        html += '<input type="datetime-local" id="adhocValidUntil" value="' + _adhocDatetimeInputDefault(6) + '" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;color-scheme:dark;margin-bottom:6px;">';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<span style="color:#888;font-size:10px;align-self:center;">Presets:</span>';
        for (const preset of [
            { label: '+3h',  hours: 3 },
            { label: '+6h',  hours: 6 },
            { label: '+12h', hours: 12 },
            { label: '+24h', hours: 24 },
            { label: '+48h', hours: 48 },
            { label: '+72h', hours: 72 }
        ]) {
            html += '<button onclick="adhocSetValidUntilPreset(' + preset.hours + ')" style="padding:4px 10px;background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.25);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">' + preset.label + '</button>';
        }
        html += '</div>';
        html += '</div>';

        // Override de bonos % (solo si hay users en small_loser)
        if (hasPromoTier) {
            html += '<details style="background:rgba(37,211,102,0.04);border:1px solid rgba(37,211,102,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px;">';
            html += '<summary style="cursor:pointer;color:#25d366;font-weight:700;font-size:12px;">📱 Personalizar bonos % carga (' + fmt(promoCount) + ' usuarios) — tocá para abrir</summary>';
            html += '<div style="margin-top:10px;color:#aaa;font-size:11px;">Por defecto el sistema asigna 15% / 20% / 25% según pérdida. Acá podés bumpear a lo que quieras (1-100%).</div>';
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;margin-top:10px;">';
            html += '<div><label style="display:block;color:#aaa;font-size:10px;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Pérdida $10k–$20k</label>';
            html += '<input type="number" id="adhocBonusLow" min="1" max="100" value="15" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;"></div>';
            html += '<div><label style="display:block;color:#aaa;font-size:10px;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Pérdida $20k–$30k</label>';
            html += '<input type="number" id="adhocBonusMid" min="1" max="100" value="20" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;"></div>';
            html += '<div><label style="display:block;color:#aaa;font-size:10px;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Pérdida $30k–$50k</label>';
            html += '<input type="number" id="adhocBonusHigh" min="1" max="100" value="25" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;"></div>';
            html += '</div>';
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">';
            html += '<span style="color:#888;font-size:10px;align-self:center;">Atajos:</span>';
            for (const preset of [
                { label: 'Default 15/20/25', l: 15, m: 20, h: 25 },
                { label: 'Boost 20/25/30',   l: 20, m: 25, h: 30 },
                { label: 'Hot 25/30/35',     l: 25, m: 30, h: 35 },
                { label: 'Plano 30%',        l: 30, m: 30, h: 30 }
            ]) {
                html += '<button onclick="adhocSetBonusPreset(' + preset.l + ',' + preset.m + ',' + preset.h + ')" style="padding:4px 10px;background:rgba(37,211,102,0.10);color:#25d366;border:1px solid rgba(37,211,102,0.25);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">' + escapeHtml(preset.label) + '</button>';
            }
            html += '</div>';
            html += '</details>';
        }

        // Título / cuerpo del push
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:12px;">';
        html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px;">Título push</label>';
        html += '<input type="text" id="adhocTitle" value="🎁 Tenés un regalo esperándote" maxlength="200" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;"></div>';
        html += '</div>';
        html += '<div style="margin-bottom:12px;"><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px;">Cuerpo</label>';
        html += '<textarea id="adhocBody" maxlength="500" rows="2" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;resize:vertical;">Abrí la app y reclamalo antes de que se termine.</textarea></div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
        html += '<button id="adhocLaunchBtn" onclick="adhocLaunch()" style="padding:11px 22px;background:linear-gradient(135deg,#ff5050,#cc2222);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">⚡ CONFIRMAR Y LANZAR · ' + fmt(plan.targetCount) + ' pushes · $' + fmt(plan.totalCostARS) + '</button>';
        html += '<button onclick="adhocCancelPlan()" style="padding:11px 16px;background:rgba(255,255,255,0.06);color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-size:12px;cursor:pointer;">Descartar plan</button>';
        html += '</div>';
        html += '</div>';
    } else {
        html += '<div class="empty-state" style="font-size:13px;color:#888;line-height:1.6;padding:30px;">No hay usuarios para targetear con esos criterios.<br>Probá ampliar el rango de fechas, subir el budget, o cambiar el foco.</div>';
    }

    el.innerHTML = html;
}

function _adhocChip(label, value, color, sub) {
    return '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;">' +
        '<div style="color:#888;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">' + escapeHtml(label) + '</div>' +
        '<div style="color:' + color + ';font-size:18px;font-weight:800;margin-top:3px;">' + value + '</div>' +
        (sub ? '<div style="color:#888;font-size:10px;margin-top:1px;">' + escapeHtml(sub) + '</div>' : '') +
        '</div>';
}

function adhocToggleDetail() {
    _adhocExpandedTargets = !_adhocExpandedTargets;
    if (_adhocPlanCache) _adhocRenderPlan(_adhocPlanCache);
}

function adhocToggleNoApp() {
    _adhocExpandedNoApp = !_adhocExpandedNoApp;
    if (_adhocPlanCache) _adhocRenderPlan(_adhocPlanCache);
}

function _adhocRenderUserTable(rows, hasChannelGroup) {
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<thead><tr style="background:rgba(255,255,255,0.05);position:sticky;top:0;">';
    html += '<th style="text-align:left;padding:6px;color:#aaa;">Usuario</th>';
    html += '<th style="text-align:left;padding:6px;color:#aaa;">Paquete</th>';
    html += '<th style="text-align:right;padding:6px;color:#aaa;">Netwin</th>';
    html += '<th style="text-align:right;padding:6px;color:#aaa;">Días</th>';
    html += '<th style="text-align:left;padding:6px;color:#aaa;">App</th>';
    if (!hasChannelGroup) {
        html += '<th style="text-align:left;padding:6px;color:#aaa;">📞 Línea</th>';
    }
    html += '<th style="text-align:right;padding:6px;color:#aaa;">Regalo</th>';
    html += '<th style="text-align:right;padding:6px;color:#aaa;">Bono %</th>';
    html += '</tr></thead><tbody>';
    for (const t of rows) {
        const appBadge = t.hasChannel
            ? '<span style="background:rgba(37,211,102,0.15);color:#25d366;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;">✓ APP+NOTIFS</span>'
            : (t.hasApp
                ? '<span style="background:rgba(255,170,68,0.15);color:#ffaa44;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;">SOLO APP</span>'
                : '<span style="background:rgba(255,80,80,0.15);color:#ff5050;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;">✗ SIN APP</span>');
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:5px;color:#fff;">' + escapeHtml(t.username) + '</td>';
        html += '<td style="padding:5px;color:#aaa;font-size:10px;">' + escapeHtml(t.packageLabel || t.package) + '</td>';
        html += '<td style="padding:5px;text-align:right;color:' + (t.netwinARS > 0 ? '#ff8888' : '#25d366') + ';">$' + fmt(t.netwinARS) + '</td>';
        html += '<td style="padding:5px;text-align:right;color:#888;">' + (t.daysSinceLastDeposit != null ? t.daysSinceLastDeposit + 'd' : '—') + '</td>';
        html += '<td style="padding:5px;">' + appBadge + '</td>';
        if (!hasChannelGroup) {
            const phoneText = t.linePhone || '—';
            const phoneLink = t.linePhone
                ? '<a href="https://wa.me/' + t.linePhone.replace(/[^\d]/g, '') + '" target="_blank" rel="noopener" style="color:#25d366;text-decoration:none;font-size:10px;">' + escapeHtml(phoneText) + '</a>'
                : '<span style="color:#666;font-size:10px;">— sin línea —</span>';
            html += '<td style="padding:5px;">' + phoneLink + '</td>';
        }
        html += '<td style="padding:5px;text-align:right;color:#ffd700;">' + (t.giftAmount ? '$' + fmt(t.giftAmount) : '—') + '</td>';
        html += '<td style="padding:5px;text-align:right;color:#25d366;">' + (t.bonusPct ? t.bonusPct + '%' : '—') + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function adhocDownloadNoAppCSV() {
    if (!_adhocPlanCache || !_adhocPlanCache.noAppTargets || _adhocPlanCache.noAppTargets.length === 0) {
        showToast('No hay usuarios sin app para descargar', 'warning');
        return;
    }
    const escapeCsv = (s) => {
        const v = String(s == null ? '' : s);
        if (v.includes(',') || v.includes('"') || v.includes('\n')) return '"' + v.replace(/"/g, '""') + '"';
        return v;
    };
    const lines = [];
    lines.push(['username','equipo','linea_telefono','paquete','netwin_ars','dias_sin_cargar','regalo_sugerido_ars','bono_pct_sugerido'].join(','));
    for (const t of _adhocPlanCache.noAppTargets) {
        lines.push([
            escapeCsv(t.username),
            escapeCsv(t.lineTeamName || ''),
            escapeCsv(t.linePhone || ''),
            escapeCsv(t.packageLabel || t.package || ''),
            Math.round(t.netwinARS || 0),
            t.daysSinceLastDeposit != null ? t.daysSinceLastDeposit : '',
            t.giftAmount || 0,
            t.bonusPct || 0
        ].join(','));
    }
    const csv = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adhoc-sin-app-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📥 CSV descargado · ' + _adhocPlanCache.noAppTargets.length + ' contactos', 'success');
}

function adhocCancelPlan() {
    if (!confirm('¿Descartar el plan? Vas a tener que re-analizar.')) return;
    _adhocPlanCache = null;
    _adhocRenderTab();
}

function adhocSetValidUntilPreset(hours) {
    const el = document.getElementById('adhocValidUntil');
    if (!el) return;
    el.value = _adhocDatetimeInputDefault(hours);
    showToast('⏰ Válido hasta +' + hours + 'h', 'info');
}

function adhocSetBonusPreset(low, mid, high) {
    const lo = document.getElementById('adhocBonusLow');
    const mi = document.getElementById('adhocBonusMid');
    const hi = document.getElementById('adhocBonusHigh');
    if (lo) lo.value = low;
    if (mi) mi.value = mid;
    if (hi) hi.value = high;
}

async function adhocLaunch() {
    if (!_adhocPlanCache || !_adhocPlanCache.planId) {
        showToast('No hay plan en memoria — re-analizá', 'error');
        return;
    }
    const validUntilEl = document.getElementById('adhocValidUntil');
    const titleEl = document.getElementById('adhocTitle');
    const bodyEl = document.getElementById('adhocBody');
    const validUntil = new Date(validUntilEl.value).toISOString();
    const title = titleEl.value.trim();
    const body = bodyEl.value.trim();

    // Override de bonos % opcional. Si los inputs existen y son válidos los mando.
    const lowEl = document.getElementById('adhocBonusLow');
    const midEl = document.getElementById('adhocBonusMid');
    const highEl = document.getElementById('adhocBonusHigh');
    let bonusPctOverride = null;
    if (lowEl && midEl && highEl) {
        const lo = parseInt(lowEl.value);
        const mi = parseInt(midEl.value);
        const hi = parseInt(highEl.value);
        // Solo mando override si hay AL MENOS uno distinto del default 15/20/25.
        if (lo !== 15 || mi !== 20 || hi !== 25) {
            bonusPctOverride = { low: lo, mid: mi, high: hi };
        }
    }

    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    let confirmMsg = '⚡ LANZAR ESTRATEGIA AHORA\n\n' +
        '· ' + _adhocPlanCache.targetCount + ' usuarios reciben push\n' +
        '· Costo total: $' + fmt(_adhocPlanCache.totalCostARS) + '\n' +
        '· Válido hasta: ' + new Date(validUntil).toLocaleString('es-AR') + '\n';
    if (bonusPctOverride) {
        confirmMsg += '· Bono override: ' + bonusPctOverride.low + '/' + bonusPctOverride.mid + '/' + bonusPctOverride.high + '%\n';
    }
    confirmMsg += '\nEsto manda push REAL y crea giveaways. ¿Confirmás?';
    if (!confirm(confirmMsg)) return;

    const btn = document.getElementById('adhocLaunchBtn');
    btn.disabled = true;
    btn.innerHTML = '⏳ Lanzando…';
    showToast('⏳ Ejecutando…', 'info');

    try {
        const r = await authFetch('/api/admin/strategy/adhoc/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planId: _adhocPlanCache.planId,
                validUntil, title, body,
                bonusPctOverride
            })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); btn.disabled = false; return; }
        if (j.result && j.result.error) {
            showToast('❌ ' + j.result.error, 'error');
            btn.disabled = false;
            return;
        }
        if (j.result && j.result.skipped) {
            showToast('⚠ Skip: ' + j.result.skipped, 'warning');
            btn.disabled = false;
            return;
        }
        showToast('✅ Lanzada · ' + (j.result.sentCount || 0) + ' pushes enviados · $' + fmt(j.result.totalCostARS), 'success');
        _adhocPlanCache = null;
        _adhocRenderTab();
    } catch (e) {
        showToast('Error de conexión', 'error');
        btn.disabled = false;
    }
}

// ============================================
// 📅 RECORDATORIOS DE REEMBOLSO (tab "Recordatorios reembolso")
// ============================================
let _remindersConfigCache = null;

async function _remindersRenderTab() {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando…</div>';
    try {
        const r = await authFetch('/api/admin/refund-reminders/config');
        if (!r.ok) { c.innerHTML = '<div class="empty-state">❌ Error</div>'; return; }
        const j = await r.json();
        _remindersConfigCache = j.config || null;
        // También necesitamos lista de equipos para el selector.
        const teamsR = await authFetch('/api/admin/teams/stats').catch(() => null);
        let teams = [];
        if (teamsR && teamsR.ok) {
            const tj = await teamsR.json();
            teams = (tj.teams || []).map(t => t.teamName).filter(Boolean);
        }
        _remindersDoRender(_remindersConfigCache, teams);
    } catch (e) {
        c.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function _remindersDoRender(cfg, teams) {
    const c = document.getElementById('automationsContent');
    if (!c) return;
    const labels = {
        daily:   { emoji: '📆', name: 'Reembolso diario',   desc: 'Push diario a quienes tienen el reembolso de AYER sin reclamar' },
        weekly:  { emoji: '📅', name: 'Reembolso semanal',  desc: 'Push diario a quienes tienen reembolso de la SEMANA PASADA sin reclamar' },
        monthly: { emoji: '🏆', name: 'Reembolso mensual',  desc: 'Push diario a quienes tienen reembolso del MES PASADO sin reclamar' }
    };

    let html = '';
    html += '<div style="background:rgba(37,211,102,0.06);border:1px solid rgba(37,211,102,0.30);border-radius:10px;padding:14px;margin-bottom:14px;">';
    html += '<div style="color:#25d366;font-weight:800;font-size:14px;">📅 Recordatorios de reembolso</div>';
    html += '<div style="color:#bbb;font-size:12px;margin-top:6px;line-height:1.6;">';
    html += 'Habilitá los 3 tipos por separado. Cada uno se manda <strong>UNA VEZ POR DÍA</strong> a la hora que elijas, ';
    html += 'a los users que tienen ese reembolso para reclamar y todavía no lo reclamaron. ';
    html += 'Filtro de equipo opcional. Respeta cap semanal — los que ya recibieron 2 pushes esta semana NO reciben.';
    html += '</div></div>';

    for (const type of ['daily', 'weekly', 'monthly']) {
        const sub = (cfg && cfg[type]) || {};
        const meta = labels[type];
        html += _remindersRenderCard(type, meta, sub, teams);
    }

    c.innerHTML = html;
}

function _remindersRenderCard(type, meta, sub, teams) {
    const fmt = n => Number(n || 0).toLocaleString('es-AR');
    const enabled = !!sub.enabled;
    const hour = sub.hourART != null ? sub.hourART : 20;
    const minute = sub.minuteART != null ? sub.minuteART : 0;
    const teamFilter = sub.teamFilter || '';
    const lastFired = sub.lastFiredAt ? new Date(sub.lastFiredAt).toLocaleString('es-AR') : '— nunca —';
    const totalFires = sub.totalFiresAllTime || 0;

    const borderColor = enabled ? 'rgba(37,211,102,0.35)' : 'rgba(255,255,255,0.10)';
    const bgColor = enabled ? 'rgba(37,211,102,0.04)' : 'rgba(0,0,0,0.30)';

    let html = '<div style="background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:12px;padding:14px;margin-bottom:12px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:10px;margin-bottom:12px;">';
    html += '<div><div style="color:#fff;font-weight:800;font-size:14px;">' + meta.emoji + ' ' + escapeHtml(meta.name) + '</div>';
    html += '<div style="color:#aaa;font-size:11px;margin-top:3px;">' + escapeHtml(meta.desc) + '</div>';
    html += '<div style="color:#666;font-size:10px;margin-top:6px;">Último envío: ' + escapeHtml(lastFired) + ' · Total: ' + fmt(totalFires) + '</div></div>';
    // Toggle
    html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">';
    html += '<span style="color:' + (enabled ? '#25d366' : '#888') + ';font-weight:700;font-size:11px;">' + (enabled ? 'ACTIVA' : 'PAUSADA') + '</span>';
    html += '<input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="reminderToggleEnabled(\'' + type + '\', this.checked)" style="width:18px;height:18px;cursor:pointer;">';
    html += '</label>';
    html += '</div>';

    // Form
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;margin-bottom:10px;">';
    html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:4px;">Hora ART</label>';
    html += '<input type="number" id="rem_' + type + '_hour" min="0" max="23" value="' + hour + '" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;"></div>';
    html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:4px;">Minuto</label>';
    html += '<input type="number" id="rem_' + type + '_minute" min="0" max="59" value="' + minute + '" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;"></div>';
    html += '<div><label style="display:block;color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:4px;">Equipo (filtro)</label>';
    html += '<select id="rem_' + type + '_team" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;">';
    html += '<option value="">🌐 Todos los equipos</option>';
    for (const t of teams) {
        html += '<option value="' + escapeHtml(t) + '"' + (teamFilter === t ? ' selected' : '') + '>' + escapeHtml(t) + '</option>';
    }
    html += '</select></div>';
    html += '</div>';

    // Custom title/body (opcional, collapsible)
    html += '<details style="margin-bottom:10px;">';
    html += '<summary style="cursor:pointer;color:#aaa;font-size:11px;">✏ Personalizar mensaje (opcional)</summary>';
    html += '<div style="margin-top:8px;display:grid;gap:8px;">';
    html += '<div><label style="display:block;color:#aaa;font-size:10px;text-transform:uppercase;font-weight:700;margin-bottom:3px;">Título</label>';
    html += '<input type="text" id="rem_' + type + '_title" maxlength="200" placeholder="(default)" value="' + escapeHtml(sub.customTitle || '') + '" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:12px;"></div>';
    html += '<div><label style="display:block;color:#aaa;font-size:10px;text-transform:uppercase;font-weight:700;margin-bottom:3px;">Cuerpo</label>';
    html += '<textarea id="rem_' + type + '_body" maxlength="500" rows="2" placeholder="(default)" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:12px;resize:vertical;">' + escapeHtml(sub.customBody || '') + '</textarea></div>';
    html += '</div>';
    html += '</details>';

    // Botones
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button onclick="reminderSaveConfig(\'' + type + '\')" style="padding:8px 14px;background:linear-gradient(135deg,#25d366,#0a7a3a);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">💾 Guardar</button>';
    html += '<button onclick="reminderPreview(\'' + type + '\')" style="padding:8px 14px;background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">👁 Preview audiencia</button>';
    html += '<button onclick="reminderRunNow(\'' + type + '\')" style="padding:8px 14px;background:rgba(255,200,80,0.15);color:#ffc850;border:1px solid rgba(255,200,80,0.40);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">⚡ Disparar ahora (test)</button>';
    html += '</div>';

    // Preview/result placeholder
    html += '<div id="rem_' + type + '_result" style="margin-top:10px;"></div>';

    html += '</div>';
    return html;
}

async function reminderToggleEnabled(type, enabled) {
    try {
        const r = await authFetch('/api/admin/refund-reminders/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [type]: { enabled: !!enabled } })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        _remindersConfigCache = j.config;
        showToast('✅ ' + type + ' ' + (enabled ? 'activado' : 'pausado'), 'success');
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function reminderSaveConfig(type) {
    const hour = parseInt(document.getElementById('rem_' + type + '_hour').value);
    const minute = parseInt(document.getElementById('rem_' + type + '_minute').value);
    const teamFilter = document.getElementById('rem_' + type + '_team').value || null;
    const customTitle = (document.getElementById('rem_' + type + '_title').value || '').trim() || null;
    const customBody = (document.getElementById('rem_' + type + '_body').value || '').trim() || null;
    try {
        const r = await authFetch('/api/admin/refund-reminders/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [type]: { hourART: hour, minuteART: minute, teamFilter, customTitle, customBody } })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        _remindersConfigCache = j.config;
        showToast('✅ Config ' + type + ' guardada · ' + String(hour).padStart(2,'0') + ':' + String(minute).padStart(2,'0') + ' ART', 'success');
        _remindersRenderTab();
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function reminderPreview(type) {
    const teamFilter = document.getElementById('rem_' + type + '_team').value || null;
    const resultEl = document.getElementById('rem_' + type + '_result');
    resultEl.innerHTML = '<div style="color:#888;font-size:11px;">⏳ Calculando…</div>';
    try {
        const r = await authFetch('/api/admin/refund-reminders/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, teamFilter })
        });
        const j = await r.json();
        if (!r.ok) { resultEl.innerHTML = '<div style="color:#ff5050;font-size:11px;">❌ ' + escapeHtml(j.error || 'Error') + '</div>'; return; }
        const fmt = n => Number(n || 0).toLocaleString('es-AR');
        const t = j.totals || {};
        const win = j.window;
        let html = '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(0,212,255,0.20);border-radius:8px;padding:10px;font-size:11px;color:#bbb;">';
        html += '<div style="color:#00d4ff;font-weight:700;font-size:12px;margin-bottom:6px;">👁 Preview · período ' + escapeHtml(j.periodKey || '') + '</div>';
        if (win) html += '<div style="color:#888;font-size:10px;margin-bottom:6px;">Ventana: ' + new Date(win.start).toLocaleDateString('es-AR') + ' a ' + new Date(win.end).toLocaleDateString('es-AR') + '</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:8px;">';
        html += '<div>Elegibles: <strong style="color:#fff;">' + fmt(t.eligible) + '</strong></div>';
        html += '<div>Sin canal: <strong style="color:#ff8888;">' + fmt(t.withoutChannel) + '</strong></div>';
        html += '<div>Ya reclamaron: <strong style="color:#888;">' + fmt(t.alreadyClaimed) + '</strong></div>';
        html += '<div>👥 <strong style="color:#25d366;font-size:14px;">' + fmt(t.finalAudience) + '</strong> reciben push</div>';
        html += '</div>';
        if (j.sample && j.sample.length > 0) {
            html += '<details><summary style="cursor:pointer;color:#aaa;font-size:11px;">Ver detalle (' + j.sampleSize + ' primeros)</summary>';
            html += '<table style="width:100%;font-size:10px;margin-top:6px;border-collapse:collapse;">';
            html += '<tr style="background:rgba(255,255,255,0.05);"><th style="text-align:left;padding:4px;">User</th><th style="text-align:left;padding:4px;">Equipo</th><th style="text-align:right;padding:4px;">Pérdida</th><th style="text-align:right;padding:4px;">Reembolso</th></tr>';
            for (const u of j.sample) {
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
                html += '<td style="padding:3px;color:#fff;">' + escapeHtml(u.username) + '</td>';
                html += '<td style="padding:3px;color:#aaa;">' + escapeHtml(u.lineTeamName || '—') + '</td>';
                html += '<td style="padding:3px;text-align:right;color:#ff8888;">$' + fmt(u.netLoss) + '</td>';
                html += '<td style="padding:3px;text-align:right;color:#ffd700;">$' + fmt(u.potentialAmount) + '</td>';
                html += '</tr>';
            }
            html += '</table></details>';
        }
        html += '<div style="color:#666;font-size:10px;margin-top:6px;">Calculado en ' + (j.computedInMs || 0) + 'ms</div>';
        html += '</div>';
        resultEl.innerHTML = html;
    } catch (e) {
        resultEl.innerHTML = '<div style="color:#ff5050;font-size:11px;">Error de conexión</div>';
    }
}

async function reminderRunNow(type) {
    const teamFilter = document.getElementById('rem_' + type + '_team').value || null;
    const customTitle = (document.getElementById('rem_' + type + '_title').value || '').trim() || null;
    const customBody = (document.getElementById('rem_' + type + '_body').value || '').trim() || null;
    if (!confirm('⚡ DISPARAR RECORDATORIO ' + type.toUpperCase() + ' AHORA\n\nEsto manda push REAL a los users que tienen ese reembolso sin reclamar' + (teamFilter ? ' (filtrado a equipo "' + teamFilter + '")' : ' (todos los equipos)') + '.\n\n¿Confirmás?')) return;
    showToast('⏳ Disparando…', 'info');
    try {
        const r = await authFetch('/api/admin/refund-reminders/run-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, teamFilter, customTitle, customBody })
        });
        const j = await r.json();
        if (!r.ok) { showToast(j.error || 'Error', 'error'); return; }
        const result = j.result || {};
        if (result.skipped) { showToast('⚠ Skip: ' + result.skipped, 'warning'); return; }
        if (result.error) { showToast('❌ ' + result.error, 'error'); return; }
        showToast('✅ Disparado · ' + (result.sentCount || 0) + ' pushes enviados', 'success');
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// ============================================================
// SECCIÓN: RECUPERACIÓN DE INACTIVOS
// ----------------------------------------------------------------
// Tres sub-tabs:
//   - panorama:  stats de actividad de la base con app instalada
//   - strategies: reglas con category='recovery' + creación de nuevas
//   - pending:    suggestions pendientes filtradas por category='recovery'
// La UI reusa el endpoint PUT /api/admin/notification-rules/suggestions/:id
// para edición de copy y los endpoints /approve y /reject existentes.
// ============================================================

let _recoveryActiveTab = 'panorama';
let _recoveryPanoramaCache = null;
let _recoveryStrategiesCache = [];
let _recoveryPendingCache = [];

async function loadRecovery() {
    _recoveryActiveTab = 'panorama';
    _recoveryUpdateTabButtons();
    await _recoveryRenderActiveTab();
}

function switchRecoveryTab(tab) {
    _recoveryActiveTab = tab;
    _recoveryUpdateTabButtons();
    _recoveryRenderActiveTab();
}

function _recoveryUpdateTabButtons() {
    document.querySelectorAll('.recovery-tab-btn').forEach((btn) => {
        const isActive = btn.getAttribute('data-tab') === _recoveryActiveTab;
        btn.classList.toggle('active', isActive);
        btn.style.background = isActive ? 'rgba(0,212,255,0.10)' : 'transparent';
        btn.style.border = isActive ? '1px solid rgba(0,212,255,0.30)' : '1px solid transparent';
        btn.style.color = isActive ? '#00d4ff' : '#aaa';
    });
}

async function _recoveryRenderActiveTab() {
    const c = document.getElementById('recoveryContent');
    if (!c) return;
    if (_recoveryActiveTab === 'panorama') {
        await _recoveryRenderPanorama(c);
    } else if (_recoveryActiveTab === 'strategies') {
        await _recoveryRenderStrategies(c);
    } else if (_recoveryActiveTab === 'pending') {
        await _recoveryRenderPending(c);
    }
}

// ----------- TAB: PANORAMA -----------
async function _recoveryRenderPanorama(c) {
    c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">⏳ Calculando panorama…</div>';
    try {
        const r = await authFetch('/api/admin/recovery/panorama');
        const j = await r.json();
        if (!j.success) { c.innerHTML = '<div class="empty-state">❌ ' + escapeHtml(j.error || 'Error') + '</div>'; return; }
        _recoveryPanoramaCache = j;

        const total = j.totalInstalled || 0;
        const buckets = j.buckets || [];

        // Bloque header con total.
        let html = '<div style="background:linear-gradient(135deg,rgba(0,212,255,0.10),rgba(0,102,204,0.10));border:1px solid rgba(0,212,255,0.30);border-radius:12px;padding:18px;margin-bottom:14px;">' +
            '<div style="color:#00d4ff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">📱 Total con app instalada</div>' +
            '<div style="color:#fff;font-size:32px;font-weight:800;">' + total.toLocaleString('es-AR') + '</div>' +
            '<div style="color:#aaa;font-size:11px;margin-top:4px;">Calculado el ' + new Date(j.generatedAt).toLocaleString('es-AR') + '</div>' +
        '</div>';

        // Buckets de actividad como cards.
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">';
        for (const b of buckets) {
            const pct = total > 0 ? Math.round((b.count / total) * 1000) / 10 : 0;
            html += '<div style="background:rgba(255,255,255,0.03);border:1px solid ' + b.color + '40;border-left:4px solid ' + b.color + ';border-radius:10px;padding:14px;">' +
                '<div style="color:' + b.color + ';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">' + escapeHtml(b.label) + '</div>' +
                '<div style="color:#fff;font-size:24px;font-weight:800;">' + b.count.toLocaleString('es-AR') + '</div>' +
                '<div style="color:#aaa;font-size:11px;margin-top:2px;">' + pct + '% del total</div>' +
            '</div>';
        }
        html += '</div>';

        // Gente que se acaba de "perder" — los 10 más recientes que dejaron de entrar.
        const dropped = j.recentlyDropped || [];
        if (dropped.length > 0) {
            html += '<div style="background:rgba(255,80,80,0.05);border:1px solid rgba(255,80,80,0.20);border-radius:10px;padding:14px;margin-bottom:14px;">' +
                '<div style="color:#ff5050;font-size:12px;font-weight:700;margin-bottom:8px;">⚠️ Top 10 que dejaron de entrar (24h - 7 días)</div>' +
                '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
                '<thead><tr style="background:rgba(0,0,0,0.20);"><th style="padding:6px 8px;text-align:left;color:#ff5050;">Usuario</th><th style="padding:6px 8px;text-align:left;color:#ff5050;">Última vez</th><th style="padding:6px 8px;text-align:right;color:#ff5050;">Hace</th></tr></thead><tbody>';
            for (const u of dropped) {
                const last = u.lastLogin ? new Date(u.lastLogin) : null;
                const hoursAgo = last ? Math.floor((Date.now() - last.getTime()) / 3600000) : 0;
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                    '<td style="padding:6px 8px;color:#fff;">' + escapeHtml(u.username || '') + '</td>' +
                    '<td style="padding:6px 8px;color:#aaa;">' + (last ? last.toLocaleString('es-AR') : '—') + '</td>' +
                    '<td style="padding:6px 8px;color:#ffaa44;text-align:right;font-weight:700;">' + hoursAgo + 'h</td>' +
                '</tr>';
            }
            html += '</tbody></table></div>';
        }

        if (j.neverLoggedIn > 0) {
            html += '<div style="background:rgba(255,170,68,0.05);border:1px solid rgba(255,170,68,0.20);border-radius:10px;padding:12px;color:#ffaa44;font-size:12px;">' +
                '🟠 <b>' + j.neverLoggedIn + '</b> usuarios instalaron la app pero nunca abrieron sesión (sin <code>lastLogin</code>).' +
            '</div>';
        }

        // Pista a la siguiente pestaña.
        html += '<div style="margin-top:16px;text-align:center;color:#888;font-size:11px;">' +
            'Pasá a la pestaña <b style="color:#00d4ff;">🚀 Estrategias</b> para revisar las reglas activas y editar el copy.' +
        '</div>';

        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

// ----------- TAB: ESTRATEGIAS -----------
async function _recoveryRenderStrategies(c) {
    c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando estrategias…</div>';
    try {
        const r = await authFetch('/api/admin/recovery/strategies');
        const j = await r.json();
        if (!j.success) { c.innerHTML = '<div class="empty-state">❌ ' + escapeHtml(j.error || 'Error') + '</div>'; return; }
        _recoveryStrategiesCache = j.strategies || [];

        // Header con botón "+ Nueva".
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
            '<div style="color:#aaa;font-size:12px;">Cada estrategia se dispara automáticamente en su horario y crea una sugerencia pendiente.</div>' +
            '<button onclick="openRecoveryNewModal()" style="padding:8px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#00d4ff,#0066cc);color:#fff;border:none;border-radius:7px;cursor:pointer;">➕ Nueva estrategia</button>' +
        '</div>';

        if (_recoveryStrategiesCache.length === 0) {
            html += '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">Sin estrategias todavía. Tocá "Nueva estrategia" para crear la primera.</div>';
            c.innerHTML = html;
            return;
        }

        html += '<div style="display:flex;flex-direction:column;gap:12px;">';
        for (const s of _recoveryStrategiesCache) {
            const cron = s.cronSchedule || {};
            const cronLabel = (cron.hour != null) ? (String(cron.hour).padStart(2, '0') + ':' + String(cron.minute || 0).padStart(2, '0') + ' ART') : '—';
            const window = (s.audienceConfig && s.audienceConfig.minHoursAgo != null)
                ? (s.audienceConfig.minHoursAgo + 'h - ' + (s.audienceConfig.maxHoursAgo || '∞') + 'h')
                : '—';
            const lastFired = s.lastFiredAt ? new Date(s.lastFiredAt).toLocaleString('es-AR') : 'Nunca';
            const enabledBadge = s.enabled
                ? '<span style="background:rgba(37,211,102,0.20);color:#25d366;font-size:10px;font-weight:800;padding:2px 8px;border-radius:6px;">ACTIVA</span>'
                : '<span style="background:rgba(136,136,136,0.20);color:#888;font-size:10px;font-weight:800;padding:2px 8px;border-radius:6px;">PAUSADA</span>';

            const titleId = 'strat-title-' + s.id;
            const bodyId = 'strat-body-' + s.id;

            html += '<div style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.25);border-radius:10px;padding:14px;">' +
                // Header
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
                    '<div>' +
                        '<div style="margin-bottom:4px;">' +
                            '<span style="background:rgba(0,212,255,0.20);color:#00d4ff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;margin-right:6px;">' + escapeHtml(s.code) + '</span>' +
                            enabledBadge +
                        '</div>' +
                        '<div style="color:#fff;font-size:14px;font-weight:700;margin-bottom:2px;">' + escapeHtml(s.name) + '</div>' +
                        (s.description ? '<div style="color:#888;font-size:11px;">' + escapeHtml(s.description) + '</div>' : '') +
                    '</div>' +
                    '<div style="text-align:right;">' +
                        '<div style="color:#00d4ff;font-size:18px;font-weight:800;">' + s.audienceCount + '</div>' +
                        '<div style="color:#aaa;font-size:10px;font-weight:700;text-transform:uppercase;">matchearían ahora</div>' +
                    '</div>' +
                '</div>' +

                // Meta info
                '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;color:#aaa;">' +
                    '<div>⏰ Dispara: <b style="color:#fff;">' + cronLabel + '</b></div>' +
                    '<div>🎯 Ventana: <b style="color:#fff;">' + window + ' sin entrar</b></div>' +
                    '<div>📜 Último disparo: <b style="color:#fff;">' + lastFired + '</b></div>' +
                    '<div>🔁 Disparos totales: <b style="color:#fff;">' + (s.totalFiresLifetime || 0) + '</b></div>' +
                '</div>' +

                // Inputs editables
                '<div style="margin-bottom:8px;">' +
                    '<label style="display:block;color:#aaa;font-size:11px;font-weight:700;margin-bottom:3px;">Título</label>' +
                    '<input id="' + titleId + '" type="text" maxlength="200" value="' + escapeHtml(s.title) + '" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.30);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:13px;" />' +
                '</div>' +
                '<div style="margin-bottom:10px;">' +
                    '<label style="display:block;color:#aaa;font-size:11px;font-weight:700;margin-bottom:3px;">Cuerpo</label>' +
                    '<textarea id="' + bodyId + '" maxlength="1000" rows="2" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.30);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:13px;resize:vertical;">' + escapeHtml(s.body) + '</textarea>' +
                '</div>' +

                // Sample audiencia
                ((s.audienceSample && s.audienceSample.length > 0)
                    ? '<div style="margin-bottom:10px;color:#aaa;font-size:11px;">Muestra: <span style="color:#9be8ff;">' + s.audienceSample.map(escapeHtml).join(', ') + (s.audienceCount > s.audienceSample.length ? ' …' : '') + '</span></div>'
                    : '<div style="margin-bottom:10px;color:#888;font-size:11px;font-style:italic;">Audiencia vacía ahora mismo (nadie matchea la ventana).</div>'
                ) +

                // Botonera
                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                    '<button onclick="recoverySaveStrategy(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);border-radius:7px;cursor:pointer;">💾 Guardar copy</button>' +
                    '<button onclick="recoveryToggleStrategy(\'' + s.id + '\', ' + (!s.enabled) + ')" style="padding:8px 14px;font-size:12px;font-weight:700;background:' + (s.enabled ? 'rgba(255,170,68,0.15)' : 'rgba(37,211,102,0.15)') + ';color:' + (s.enabled ? '#ffaa44' : '#25d366') + ';border:1px solid ' + (s.enabled ? 'rgba(255,170,68,0.40)' : 'rgba(37,211,102,0.40)') + ';border-radius:7px;cursor:pointer;">' + (s.enabled ? '⏸️ Pausar' : '▶️ Activar') + '</button>' +
                    '<button onclick="recoveryTestFire(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:rgba(255,255,255,0.05);color:#aaa;border:1px solid rgba(255,255,255,0.15);border-radius:7px;cursor:pointer;">🧪 Test (sin enviar)</button>' +
                '</div>' +
            '</div>';
        }
        html += '</div>';
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

async function recoverySaveStrategy(id) {
    const s = _recoveryStrategiesCache.find(x => x.id === id);
    if (!s) return;
    const tEl = document.getElementById('strat-title-' + id);
    const bEl = document.getElementById('strat-body-' + id);
    if (!tEl || !bEl) return;
    const title = (tEl.value || '').trim();
    const body = (bEl.value || '').trim();
    if (!title || !body) { showToast('Título y cuerpo no pueden estar vacíos', 'error'); return; }
    try {
        const resp = await authFetch('/api/admin/notification-rules/' + id, {
            method: 'PATCH',
            body: JSON.stringify({ title, body })
        });
        const j = await resp.json();
        if (j.success) {
            s.title = title;
            s.body = body;
            showToast('✅ Copy guardado', 'success');
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function recoveryToggleStrategy(id, newEnabled) {
    try {
        const resp = await authFetch('/api/admin/notification-rules/' + id, {
            method: 'PATCH',
            body: JSON.stringify({ enabled: newEnabled })
        });
        const j = await resp.json();
        if (j.success) {
            showToast(newEnabled ? '▶️ Estrategia activada' : '⏸️ Estrategia pausada', 'success');
            await _recoveryRenderStrategies(document.getElementById('recoveryContent'));
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function recoveryTestFire(id) {
    try {
        const resp = await authFetch('/api/admin/notification-rules/' + id + '/test-fire', { method: 'POST' });
        const j = await resp.json();
        if (j.success) {
            const sample = (j.audienceSample || []).slice(0, 5).join(', ');
            alert('🧪 Dry run\nRegla: ' + j.ruleCode + '\nAudiencia resuelta: ' + j.audienceCount + ' usuarios\n\nMuestra: ' + (sample || '(vacío)') + '\n\nNo se envió nada.');
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// Modal de creación.
function openRecoveryNewModal() {
    document.getElementById('recoveryNewName').value = '';
    document.getElementById('recoveryNewMin').value = '120';
    document.getElementById('recoveryNewMax').value = '168';
    document.getElementById('recoveryNewHour').value = '18';
    document.getElementById('recoveryNewTitle').value = '';
    document.getElementById('recoveryNewBody').value = '';
    document.getElementById('recoveryNewModal').style.display = 'flex';
}

function closeRecoveryNewModal() {
    document.getElementById('recoveryNewModal').style.display = 'none';
}

async function submitRecoveryNew() {
    const payload = {
        name: document.getElementById('recoveryNewName').value.trim(),
        minHoursAgo: Number(document.getElementById('recoveryNewMin').value),
        maxHoursAgo: Number(document.getElementById('recoveryNewMax').value),
        hour: Number(document.getElementById('recoveryNewHour').value),
        title: document.getElementById('recoveryNewTitle').value.trim(),
        body: document.getElementById('recoveryNewBody').value.trim()
    };
    if (!payload.title || !payload.body) { showToast('Título y cuerpo requeridos', 'error'); return; }
    try {
        const resp = await authFetch('/api/admin/recovery/strategies', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const j = await resp.json();
        if (j.success) {
            showToast('✅ Estrategia creada', 'success');
            closeRecoveryNewModal();
            await _recoveryRenderStrategies(document.getElementById('recoveryContent'));
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// ----------- TAB: PENDIENTES (filtra suggestions de category='recovery') -----------
async function _recoveryRenderPending(c) {
    c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando pendientes…</div>';
    try {
        const r = await authFetch('/api/admin/notification-rules/suggestions?status=pending');
        const j = await r.json();
        const all = j.suggestions || [];
        _recoveryPendingCache = all.filter(s => s.ruleCategory === 'recovery');

        // Badge de cantidad en el sub-tab.
        const badge = document.getElementById('recoveryPendingBadge');
        if (badge) {
            if (_recoveryPendingCache.length > 0) {
                badge.textContent = String(_recoveryPendingCache.length);
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }

        if (_recoveryPendingCache.length === 0) {
            c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">✅ Sin sugerencias de recuperación pendientes. Cuando una estrategia dispare, va a aparecer acá.</div>';
            return;
        }

        // Reusamos la cache global de suggestions (que el approve/reject existentes
        // consultan con find()), para que los handlers compartidos funcionen.
        _autoSuggestionsCache = _recoveryPendingCache;

        let html = '<div style="display:flex;flex-direction:column;gap:14px;">';
        for (const s of _recoveryPendingCache) {
            const ageMin = Math.floor((Date.now() - new Date(s.suggestedAt).getTime()) / 60000);
            const expHours = Math.max(0, Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 3600000));
            const titleId = 'rsug-title-' + s.id;
            const bodyId = 'rsug-body-' + s.id;
            const audWrapId = 'rsug-aud-' + s.id;
            const audList = (s.audienceUsernames || []).slice(0, 500);
            const audHtml = audList.length > 0
                ? audList.map(u => '<span style="display:inline-block;background:rgba(0,212,255,0.10);color:#9be8ff;font-size:11px;padding:3px 8px;border-radius:5px;margin:2px;">' + escapeHtml(u) + '</span>').join('')
                : '<span style="color:#888;font-size:11px;">(lista vacía)</span>';
            const audMore = (s.audienceUsernames && s.audienceUsernames.length > 500)
                ? '<div style="margin-top:6px;color:#888;font-size:10px;">+ ' + (s.audienceUsernames.length - 500) + ' usuarios más (no mostrados)</div>'
                : '';

            html += '<div style="background:rgba(255,170,68,0.05);border:1px solid rgba(255,170,68,0.30);border-radius:10px;padding:14px;">' +
                '<div style="margin-bottom:10px;">' +
                    '<span style="background:rgba(0,212,255,0.20);color:#00d4ff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;">' + escapeHtml(s.ruleCode) + '</span> ' +
                    '<span style="color:#888;font-size:11px;margin-left:4px;">hace ' + ageMin + ' min · expira en ' + expHours + 'h</span>' +
                    '<div style="color:#fff;font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(s.ruleName) + '</div>' +
                '</div>' +

                '<div style="margin-bottom:10px;">' +
                    '<label style="display:block;color:#aaa;font-size:11px;font-weight:700;margin-bottom:4px;">Título</label>' +
                    '<input id="' + titleId + '" type="text" maxlength="200" value="' + escapeHtml(s.title) + '" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.30);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:13px;" />' +
                '</div>' +
                '<div style="margin-bottom:10px;">' +
                    '<label style="display:block;color:#aaa;font-size:11px;font-weight:700;margin-bottom:4px;">Cuerpo</label>' +
                    '<textarea id="' + bodyId + '" maxlength="1000" rows="3" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.30);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:13px;resize:vertical;">' + escapeHtml(s.body) + '</textarea>' +
                '</div>' +

                '<div style="margin-bottom:10px;">' +
                    '<button onclick="recoveryToggleAudience(\'' + s.id + '\')" style="padding:6px 12px;font-size:11px;font-weight:700;background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.30);border-radius:6px;cursor:pointer;">👥 Ver afectados (' + s.audienceCount + ')</button>' +
                    '<div id="' + audWrapId + '" style="display:none;margin-top:8px;padding:8px;background:rgba(0,0,0,0.20);border-radius:6px;max-height:200px;overflow-y:auto;">' +
                        audHtml + audMore +
                    '</div>' +
                '</div>' +

                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                    '<button onclick="recoverySavePending(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);border-radius:7px;cursor:pointer;">💾 Guardar cambios</button>' +
                    '<button onclick="autoApproveSuggestion(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;border-radius:7px;cursor:pointer;">✅ Aprobar y enviar</button>' +
                    '<button onclick="autoRejectSuggestion(\'' + s.id + '\')" style="padding:8px 14px;font-size:12px;font-weight:700;background:rgba(255,80,80,0.15);color:#ff5050;border:1px solid rgba(255,80,80,0.40);border-radius:7px;cursor:pointer;">❌ Descartar</button>' +
                '</div>' +
            '</div>';
        }
        html += '</div>';
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div class="empty-state">❌ Error de conexión</div>';
    }
}

function recoveryToggleAudience(id) {
    const el = document.getElementById('rsug-aud-' + id);
    if (!el) return;
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
}

async function recoverySavePending(id) {
    const s = _recoveryPendingCache.find(x => x.id === id);
    if (!s) return;
    const tEl = document.getElementById('rsug-title-' + id);
    const bEl = document.getElementById('rsug-body-' + id);
    if (!tEl || !bEl) return;
    const title = (tEl.value || '').trim();
    const body = (bEl.value || '').trim();
    if (!title || !body) { showToast('Título y cuerpo no pueden estar vacíos', 'error'); return; }
    if (title === s.title && body === s.body) { showToast('No hay cambios para guardar', 'info'); return; }
    try {
        const resp = await authFetch('/api/admin/notification-rules/suggestions/' + id, {
            method: 'PUT',
            body: JSON.stringify({ title, body })
        });
        const j = await resp.json();
        if (j.success) {
            s.title = j.title;
            s.body = j.body;
            // Mantener sincronizada la cache compartida que usa autoApproveSuggestion.
            const shared = _autoSuggestionsCache.find(x => x.id === id);
            if (shared) { shared.title = j.title; shared.body = j.body; }
            showToast('✅ Cambios guardados', 'success');
        } else {
            showToast(j.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// =====================================================================
// SECCIÓN ✨ AUTOMATIZACIÓN
// =====================================================================
// Estrategia smart con mix 70/30 (engagement-only vs bonos), preview
// editable, lanzamiento con confirmación, historial con veredicto, y
// admin de copies de engagement.

let _automationActiveTab = 'plan';
let _automationCurrentPlan = null;
let _automationCurrentPlanId = null;
let _automationEdits = {};
let _automationPreset = 'weekly';

function loadAutomationSection() {
    _automationActiveTab = 'plan';
    _automationCurrentPlan = null;
    _automationCurrentPlanId = null;
    _automationEdits = {};
    _renderAutomationTab();
}

function switchAutomationTab(tab) {
    _automationActiveTab = tab;
    document.querySelectorAll('#automationSection .auto2-tab-btn').forEach(b => {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle('active', isActive);
        if (isActive) {
            b.style.background = 'rgba(120,80,255,0.15)';
            b.style.borderColor = 'rgba(120,80,255,0.40)';
            b.style.color = '#b39dff';
        } else {
            b.style.background = 'rgba(0,0,0,0.30)';
            b.style.borderColor = 'rgba(255,255,255,0.10)';
            b.style.color = '#aaa';
        }
    });
    _renderAutomationTab();
}

function _renderAutomationTab() {
    if (_automationActiveTab === 'plan')    return _renderAutomationPlanTab();
    if (_automationActiveTab === 'history') return _renderAutomationHistoryTab();
    if (_automationActiveTab === 'copies')  return _renderAutomationCopiesTab();
}

function _renderAutomationPlanTab() {
    const c = document.getElementById('automationContent');
    if (!c) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const fromDefault = new Date(Date.now() - 7*86400000).toISOString().slice(0, 10);

    let html = '';
    // Modo test: dispara todas las notifs a un user para chequear que llegan.
    html += '<div style="background:rgba(255,200,80,0.06);border:1px solid rgba(255,200,80,0.25);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">';
    html += '  <div><strong style="color:#ffc850;font-size:12px;">🧪 Modo test</strong> <small style="color:#888;">— mandate todas las notifs del pool + samples de bono a un usuario de prueba para verificar que llegan</small></div>';
    html += '  <button onclick="testFireAutomation()" style="padding:8px 16px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#ffc850,#ff9933);color:#000;border:none;border-radius:8px;cursor:pointer;">🧪 Probar a un usuario</button>';
    html += '</div>';

    html += '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">';
    html += '  <strong style="color:#b39dff;font-size:13px;">📅 Rango de análisis:</strong>';
    html += '  <button onclick="setAutomationPreset(\'daily\')" id="autoPresetDaily" class="auto2-preset" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:12px;cursor:pointer;font-weight:700;">Hoy</button>';
    html += '  <button onclick="setAutomationPreset(\'weekly\')" id="autoPresetWeekly" class="auto2-preset" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(120,80,255,0.40);background:rgba(120,80,255,0.20);color:#b39dff;font-size:12px;cursor:pointer;font-weight:700;">Últimos 7 días</button>';
    html += '  <button onclick="setAutomationPreset(\'monthly\')" id="autoPresetMonthly" class="auto2-preset" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:12px;cursor:pointer;font-weight:700;">Mes actual</button>';
    html += '  <span style="color:#666;">o</span>';
    html += '  <input type="date" id="autoDateFrom" value="' + fromDefault + '" onchange="_automationPreset=\'custom\'" style="padding:7px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;">';
    html += '  <span style="color:#666;">→</span>';
    html += '  <input type="date" id="autoDateTo" value="' + todayStr + '" onchange="_automationPreset=\'custom\'" style="padding:7px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;">';
    html += '  <button onclick="analyzeAutomation()" id="autoAnalyzeBtn" style="margin-left:auto;padding:9px 18px;font-size:13px;font-weight:800;background:linear-gradient(135deg,#7850ff,#00d4ff);color:#fff;border:none;border-radius:8px;cursor:pointer;">📊 Analizar panel</button>';
    html += '</div>';

    html += '<div id="automationPlanContent">';
    if (_automationCurrentPlan) {
        html += _renderAutomationPlanPreview(_automationCurrentPlan);
    } else {
        html += '<div style="text-align:center;padding:40px;color:#888;">';
        html += '  <div style="font-size:42px;margin-bottom:10px;opacity:0.4;">📊</div>';
        html += '  <p style="margin:0;font-size:14px;">Elegí un rango y tocá <strong>Analizar panel</strong> para ver la estrategia propuesta.</p>';
        html += '</div>';
    }
    html += '</div>';
    c.innerHTML = html;
}

function setAutomationPreset(preset) {
    _automationPreset = preset;
    ['Daily', 'Weekly', 'Monthly'].forEach(p => {
        const btn = document.getElementById('autoPreset' + p);
        if (!btn) return;
        const isActive = preset === p.toLowerCase();
        btn.style.background = isActive ? 'rgba(120,80,255,0.20)' : 'rgba(0,0,0,0.45)';
        btn.style.borderColor = isActive ? 'rgba(120,80,255,0.40)' : 'rgba(255,255,255,0.15)';
        btn.style.color = isActive ? '#b39dff' : '#fff';
    });
}

async function analyzeAutomation() {
    const btn = document.getElementById('autoAnalyzeBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Analizando…'; }
    const fromStr = (document.getElementById('autoDateFrom') || {}).value;
    const toStr = (document.getElementById('autoDateTo') || {}).value;
    let body;
    if (_automationPreset && _automationPreset !== 'custom') {
        body = { preset: _automationPreset };
    } else {
        body = {
            preset: 'custom',
            analysisFrom: new Date(fromStr + 'T00:00:00Z').toISOString(),
            analysisTo:   new Date(toStr   + 'T23:59:59Z').toISOString()
        };
    }
    try {
        const r = await authFetch('/api/admin/automation/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || !d.success) { showToast(d.error || 'Error analizando', 'error'); return; }
        _automationCurrentPlan = d.plan;
        _automationCurrentPlanId = d.planId;
        _automationEdits = {};
        const target = document.getElementById('automationPlanContent');
        if (target) target.innerHTML = _renderAutomationPlanPreview(d.plan);
    } catch (e) { showToast('Error de conexión', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '📊 Analizar panel'; } }
}

function _renderAutomationPlanPreview(plan) {
    let html = '';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;">';
    html += _autoStatCard('🎯 Targets', plan.totalTargets || 0, '#b39dff');
    html += _autoStatCard('📲 Pushes total', (plan.totalTargets || 0) * 2, '#00d4ff');
    html += _autoStatCard('💌 Solo engagement', plan.totalEngagement || 0, '#25d366');
    html += _autoStatCard('🎁 Con bono', plan.totalBonus || 0, '#ffc850');
    html += _autoStatCard('💰 Costo estimado', '$' + (plan.totalCostARS || 0).toLocaleString('es-AR'), '#ff8800');
    html += _autoStatCard('⏸ Cap 2/semana', plan.skippedCooldown || 0, '#888');
    html += '</div>';
    html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.20);border-radius:8px;padding:10px 12px;margin-bottom:14px;color:#bbb;font-size:11px;line-height:1.5;">';
    html += '✨ <strong>Estrategia semanal:</strong> cada user recibe <strong>2 notifs</strong> en la semana — la 1ra al confirmar, la 2da programada a <strong>' + Math.round((plan.secondPushDelayHours||96)/24) + ' días</strong>. Los copies son distintos (rotación anti-fatiga vs últimas 4 semanas) y promocionan reembolsos + regalos diarios.';
    html += '</div>';
    if (!plan.totalTargets) {
        html += '<div style="background:rgba(255,150,50,0.10);border:1px solid rgba(255,150,50,0.30);border-radius:10px;padding:14px;color:#ffb060;font-size:13px;">⚠️ No hay targets en este rango. Ampliá la ventana o esperá que pase el cooldown.</div>';
        return html;
    }
    html += '<table class="report-table" style="margin-bottom:14px;"><thead><tr>';
    html += '<th>Segmento</th><th style="text-align:center;">Total</th><th style="text-align:center;">💌 Engagement</th><th style="text-align:center;">🎁 Con bono</th><th>Oferta sugerida</th><th>Editar</th><th style="text-align:right;">Costo</th>';
    html += '</tr></thead><tbody>';
    for (const seg of (plan.breakdown || [])) {
        const ratio = Math.round((seg.bonusRatio || 0) * 100);
        html += '<tr>';
        html += '<td><div style="font-weight:700;">' + escapeHtml(seg.label) + '</div><div style="font-size:10px;color:#888;">' + escapeHtml(seg.description || '') + '</div></td>';
        html += '<td style="text-align:center;font-weight:700;">' + seg.count + '</td>';
        html += '<td style="text-align:center;color:#25d366;">' + seg.engagementCount + '</td>';
        html += '<td style="text-align:center;color:#ffc850;">' + seg.bonusCount + ' <small style="color:#666;">(' + ratio + '%)</small></td>';
        let offerCell = '', editCell = '';
        if (seg.bonusKind === 'money' && seg.bonusCount > 0) {
            offerCell = '<span style="color:#ffc850;">💵 Regalo de plata · prom $' + (seg.avgGiftAmount || 0).toLocaleString('es-AR') + '</span>';
            editCell = '<input type="number" min="0" step="500" placeholder="Override $" oninput="onAutomationEdit(\'' + seg.segment + '\',\'giftAmount\',this.value)" style="width:90px;padding:5px;border-radius:6px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:12px;">';
        } else if (seg.bonusKind === 'whatsapp_promo' && seg.bonusCount > 0) {
            offerCell = '<span style="color:#00d4ff;">🎰 Bono % carga · prom ' + (seg.avgBonusPct || 0) + '%</span>';
            editCell = '<input type="number" min="1" max="100" step="5" placeholder="Override %" oninput="onAutomationEdit(\'' + seg.segment + '\',\'bonusPct\',this.value)" style="width:80px;padding:5px;border-radius:6px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:12px;">';
        } else {
            offerCell = '<small style="color:#666;">— solo engagement —</small>';
            editCell = '<small style="color:#666;">N/A</small>';
        }
        html += '<td>' + offerCell + '</td><td>' + editCell + '</td>';
        html += '<td style="text-align:right;font-weight:700;">$' + (seg.costARS || 0).toLocaleString('es-AR') + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    html += '<details style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px;margin-bottom:14px;">';
    html += '  <summary style="cursor:pointer;color:#b39dff;font-weight:700;font-size:12px;">👀 Ver lista exacta de a quién le va a llegar y qué push recibe (' + plan.totalTargets + ' usuarios × 2 = ' + ((plan.totalTargets||0)*2) + ' pushes)</summary>';
    html += '  <div style="max-height:420px;overflow-y:auto;margin-top:10px;">';
    html += '  <table class="report-table" style="font-size:11px;"><thead><tr><th>Usuario</th><th>Segmento</th><th>Tipo</th><th>Push 1 (ahora)</th><th>Push 2 (a ' + Math.round((plan.secondPushDelayHours||96)/24) + 'd)</th></tr></thead><tbody>';
    for (const t of (plan.targets || [])) {
        let push1Detail;
        if (t.kind === 'money')               push1Detail = '💵 $' + (t.giftAmount||0).toLocaleString('es-AR');
        else if (t.kind === 'whatsapp_promo') push1Detail = '🎰 ' + (t.bonusPct||0) + '% carga';
        else                                  push1Detail = '<span style="color:#888;">' + escapeHtml(t.copyTitle || 'engagement') + '</span>';
        const push2Detail = '<span style="color:#888;">' + escapeHtml(t.copyTitle2 || '—') + '</span>';
        const kindBadge = t.kind === 'engagement'
            ? '<span style="color:#25d366;font-weight:700;">💌 2× Engagement</span>'
            : (t.kind === 'money' ? '<span style="color:#ffc850;font-weight:700;">💵+💌</span>' : '<span style="color:#00d4ff;font-weight:700;">🎰+💌</span>');
        html += '<tr><td>' + escapeHtml(t.username) + '</td><td><small>' + escapeHtml(t.segmentLabel || t.segment) + '</small></td><td>' + kindBadge + '</td><td>' + push1Detail + '</td><td>' + push2Detail + '</td></tr>';
    }
    html += '  </tbody></table></div></details>';
    html += '<div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;">';
    html += '  <small style="color:#888;">Push 1 sale al confirmar. Push 2 se programa a ' + Math.round((plan.secondPushDelayHours||96)/24) + ' días. Las ofertas vencen en 48h.</small>';
    html += '  <button onclick="launchAutomation()" id="autoLaunchBtn" style="padding:11px 22px;font-size:14px;font-weight:800;background:linear-gradient(135deg,#25d366,#0a8055);color:#fff;border:none;border-radius:8px;cursor:pointer;box-shadow:0 4px 14px rgba(37,211,102,0.40);">✅ Confirmar y lanzar</button>';
    html += '</div>';
    return html;
}

function _autoStatCard(label, value, color) {
    return '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;text-align:center;">' +
           '<div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">' + label + '</div>' +
           '<div style="color:' + color + ';font-size:20px;font-weight:800;">' + value + '</div>' +
           '</div>';
}

function onAutomationEdit(segmentCode, field, val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) {
        if (_automationEdits[segmentCode]) delete _automationEdits[segmentCode][field];
        return;
    }
    if (!_automationEdits[segmentCode]) _automationEdits[segmentCode] = {};
    _automationEdits[segmentCode][field] = n;
}

async function launchAutomation() {
    if (!_automationCurrentPlanId) { showToast('No hay plan cargado, analizá primero.', 'error'); return; }
    const total = (_automationCurrentPlan && _automationCurrentPlan.totalTargets) || 0;
    const cost = (_automationCurrentPlan && _automationCurrentPlan.totalCostARS) || 0;
    const days = Math.round(((_automationCurrentPlan && _automationCurrentPlan.secondPushDelayHours) || 96) / 24);
    const ok = confirm('Vas a lanzar la campaña a ' + total + ' usuarios = ' + (total*2) + ' pushes (1 ahora + 1 a ' + days + ' días). Costo estimado: $' + cost.toLocaleString('es-AR') + '. ¿Confirmás?');
    if (!ok) return;
    const btn = document.getElementById('autoLaunchBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Lanzando…'; }
    try {
        const r = await authFetch('/api/admin/automation/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planId: _automationCurrentPlanId,
                edits: _automationEdits,
                validUntil: new Date(Date.now() + 48*3600*1000).toISOString()
            })
        });
        const d = await r.json();
        if (!r.ok || !d.success) { showToast(d.error || 'Error lanzando', 'error'); return; }
        const res = d.result || {};
        showToast('✅ Lanzado: ' + (res.sentCount||0) + ' pushes ahora + ' + (res.scheduledCount||0) + ' programados a 4d (' + (res.engagementCount||0) + ' eng, ' + (res.bonusCount||0) + ' bono)', 'success');
        _automationCurrentPlan = null;
        _automationCurrentPlanId = null;
        _automationEdits = {};
        switchAutomationTab('history');
    } catch (e) { showToast('Error de conexión', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar y lanzar'; } }
}

async function _renderAutomationHistoryTab() {
    const c = document.getElementById('automationContent');
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">⏳ Cargando historial…</div>';
    try {
        const r = await authFetch('/api/admin/automation/history?limit=50');
        const d = await r.json();
        if (!r.ok || !d.success) { c.innerHTML = '<div style="color:#ff8080;">' + escapeHtml(d.error || 'Error') + '</div>'; return; }
        const launches = d.launches || [];
        if (launches.length === 0) {
            c.innerHTML = '<div style="text-align:center;padding:40px;color:#888;"><div style="font-size:42px;opacity:0.4;">📊</div><p>Todavía no lanzaste ninguna campaña. Andá a <strong>Analizar y lanzar</strong>.</p></div>';
            return;
        }
        let html = '<table class="report-table"><thead><tr>';
        html += '<th>Lanzado</th><th>Por</th><th>Rango</th><th style="text-align:center;">Targets</th><th style="text-align:center;">💌</th><th style="text-align:center;">🎁</th><th style="text-align:right;">Costo</th><th style="text-align:right;">Cargas post</th><th>Veredicto</th><th style="text-align:center;">Acción</th>';
        html += '</tr></thead><tbody>';
        for (const l of launches) {
            const verdictBadge = _autoVerdictBadge(l.verdict);
            const range = (l.preset && l.preset !== 'custom') ? l.preset : (
                new Date(l.analysisFrom).toLocaleDateString('es-AR') + '–' + new Date(l.analysisTo).toLocaleDateString('es-AR')
            );
            html += '<tr>';
            html += '<td><small>' + new Date(l.launchedAt).toLocaleString('es-AR') + '</small></td>';
            html += '<td><small>' + escapeHtml(l.launchedBy || '—') + '</small></td>';
            html += '<td><small>' + escapeHtml(range) + '</small></td>';
            html += '<td style="text-align:center;font-weight:700;">' + (l.totalTargets || 0) + '</td>';
            html += '<td style="text-align:center;color:#25d366;">' + (l.engagementCount || 0) + '</td>';
            html += '<td style="text-align:center;color:#ffc850;">' + (l.bonusCount || 0) + '</td>';
            html += '<td style="text-align:right;font-weight:700;">$' + (l.totalCostARS || 0).toLocaleString('es-AR') + '</td>';
            html += '<td style="text-align:right;color:#25d366;">';
            if ((l.outcomeChargesAfterCount || 0) > 0) {
                html += (l.outcomeChargesAfterCount) + ' · $' + (l.outcomeChargesAfterARS || 0).toLocaleString('es-AR');
            } else {
                html += '<small style="color:#666;">—</small>';
            }
            html += '</td><td>' + verdictBadge + '</td>';
            html += '<td style="text-align:center;"><button onclick="evaluateAutomationLaunch(\'' + l.id + '\')" style="padding:5px 10px;background:rgba(120,80,255,0.20);color:#b39dff;border:1px solid rgba(120,80,255,0.40);border-radius:6px;font-size:11px;cursor:pointer;font-weight:700;">📈 Analizar</button></td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        html += '<p style="color:#888;font-size:11px;margin-top:10px;">📈 <strong>Analizar</strong> calcula veredicto + breakdown por segmento y por copy con datos actuales (DailyPlayerStats). Lo podés correr desde 24h post-launch en adelante.</p>';
        html += '<div id="automationDetailContainer" style="margin-top:18px;"></div>';
        c.innerHTML = html;
    } catch (e) { c.innerHTML = '<div style="color:#ff8080;">Error de conexión</div>'; }
}

async function evaluateAutomationLaunch(launchId) {
    const container = document.getElementById('automationDetailContainer');
    if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">⏳ Calculando análisis…</div>';
    try {
        const r = await authFetch('/api/admin/automation/launch/' + launchId + '/evaluate', { method: 'POST' });
        const d = await r.json();
        if (!r.ok || !d.success) { showToast(d.error || 'Error evaluando', 'error'); if (container) container.innerHTML = ''; return; }
        if (container) container.innerHTML = _renderAutomationDetail(launchId, d);
        showToast('✅ Análisis listo: ' + d.verdict.toUpperCase(), 'success');
        // Refrescar la tabla para ver el nuevo veredicto.
        setTimeout(() => _renderAutomationHistoryTab(), 800);
    } catch (e) { showToast('Error de conexión', 'error'); }
}

function _renderAutomationDetail(launchId, d) {
    const s = d.summary || {};
    let html = '';
    html += '<div style="background:linear-gradient(135deg,rgba(120,80,255,0.10),rgba(0,212,255,0.06));border:1px solid rgba(120,120,255,0.30);border-radius:12px;padding:16px;">';
    html += '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">';
    html += '    <h3 style="margin:0;color:#b39dff;font-size:14px;">📈 Análisis del launch <small style="color:#888;font-weight:400;">(' + (s.evaluatedHoursAfterLaunch || 0) + 'h post-launch)</small></h3>';
    html += '    ' + _autoVerdictBadge(d.verdict);
    html += '  </div>';

    // Stat cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;">';
    html += _autoStatCard('🎯 Targets', s.totalTargets || 0, '#b39dff');
    html += _autoStatCard('✅ Cargaron post', (s.chargesAfterCount || 0) + ' (' + (s.conversionPct || 0) + '%)', '#25d366');
    html += _autoStatCard('💵 Cargas $', '$' + (s.chargesAfterARS || 0).toLocaleString('es-AR'), '#00d4ff');
    html += _autoStatCard('💸 Costo', '$' + (s.totalCostARS || 0).toLocaleString('es-AR'), '#ff8800');
    html += _autoStatCard('📊 ROI ratio', s.roiRatio != null ? s.roiRatio + 'x' : '—', s.roiRatio >= 3 ? '#25d366' : (s.roiRatio >= 1 ? '#ffc850' : '#ff5050'));
    html += '</div>';

    // Per-segment
    if (d.bySegment && d.bySegment.length > 0) {
        html += '<h4 style="color:#b39dff;font-size:12px;margin:16px 0 8px;">Por segmento</h4>';
        html += '<table class="report-table" style="font-size:12px;"><thead><tr><th>Segmento</th><th style="text-align:center;">Targets</th><th style="text-align:center;">Cargaron</th><th style="text-align:center;">Conv %</th><th style="text-align:right;">$ Cargado</th><th style="text-align:right;">Costo</th><th style="text-align:right;">ROI</th></tr></thead><tbody>';
        for (const seg of d.bySegment) {
            const roiColor = seg.roiRatio == null ? '#888' : (seg.roiRatio >= 3 ? '#25d366' : (seg.roiRatio >= 1 ? '#ffc850' : '#ff5050'));
            html += '<tr>';
            html += '<td>' + escapeHtml(seg.segment) + '</td>';
            html += '<td style="text-align:center;">' + seg.count + '</td>';
            html += '<td style="text-align:center;color:#25d366;">' + seg.charged + '</td>';
            html += '<td style="text-align:center;font-weight:700;">' + seg.conversionPct + '%</td>';
            html += '<td style="text-align:right;">$' + (seg.ars || 0).toLocaleString('es-AR') + '</td>';
            html += '<td style="text-align:right;">$' + (seg.cost || 0).toLocaleString('es-AR') + '</td>';
            html += '<td style="text-align:right;color:' + roiColor + ';font-weight:700;">' + (seg.roiRatio != null ? seg.roiRatio + 'x' : '—') + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
    }

    // Per-copy
    if (d.byCopy && d.byCopy.length > 0) {
        html += '<h4 style="color:#b39dff;font-size:12px;margin:16px 0 8px;">Por copy (cuál convirtió mejor)</h4>';
        html += '<table class="report-table" style="font-size:12px;"><thead><tr><th>Copy</th><th style="text-align:center;">Targets</th><th style="text-align:center;">Cargaron</th><th style="text-align:center;">Conv %</th><th style="text-align:right;">$ Cargado</th></tr></thead><tbody>';
        for (const cp of d.byCopy) {
            html += '<tr>';
            html += '<td><small>' + escapeHtml(cp.copyTitle) + '</small></td>';
            html += '<td style="text-align:center;">' + cp.count + '</td>';
            html += '<td style="text-align:center;color:#25d366;">' + cp.charged + '</td>';
            html += '<td style="text-align:center;font-weight:700;">' + cp.conversionPct + '%</td>';
            html += '<td style="text-align:right;">$' + (cp.ars || 0).toLocaleString('es-AR') + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
    }
    html += '<p style="color:#888;font-size:11px;margin-top:10px;">📊 <strong>ROI ratio</strong> = $ cargado / costo. <strong>🟢 ≥3x rentable</strong> · 🟡 1-3x regular · 🔴 &lt;1x mala. Para campañas sin costo (todo engagement) se evalua por % de conversión: 🟢 ≥20% · 🟡 ≥5% · 🔴 &lt;5%.</p>';
    html += '</div>';
    return html;
}

function _autoVerdictBadge(v) {
    if (v === 'good')    return '<span style="background:rgba(37,211,102,0.18);color:#25d366;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:800;">🟢 Rentable</span>';
    if (v === 'regular') return '<span style="background:rgba(255,200,80,0.18);color:#ffc850;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:800;">🟡 Regular</span>';
    if (v === 'bad')     return '<span style="background:rgba(255,80,80,0.18);color:#ff5050;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:800;">🔴 Mala</span>';
    return '<span style="background:rgba(255,255,255,0.05);color:#888;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:700;">⏳ Pendiente</span>';
}

const _automationCopyEdits = {};

async function _renderAutomationCopiesTab() {
    const c = document.getElementById('automationContent');
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">⏳ Cargando copies…</div>';
    try {
        const r = await authFetch('/api/admin/automation/copies');
        const d = await r.json();
        if (!r.ok || !d.success) { c.innerHTML = '<div style="color:#ff8080;">' + escapeHtml(d.error || 'Error') + '</div>'; return; }
        const copies = d.copies || [];
        let html = '';
        html += '<div style="background:rgba(120,80,255,0.06);border:1px solid rgba(120,80,255,0.20);border-radius:10px;padding:12px;margin-bottom:14px;color:#bbb;font-size:12px;line-height:1.6;">';
        html += 'Estos textos rotan entre los users del 70% engagement-only de cada lanzamiento. La asignación es determinista por user, ponderada por <strong>peso</strong>.';
        html += '</div>';
        html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;margin-bottom:14px;">';
        html += '  <strong style="color:#b39dff;font-size:12px;">➕ Agregar copy</strong>';
        html += '  <div style="display:grid;grid-template-columns:1fr 2fr 80px;gap:8px;margin-top:8px;">';
        html += '    <input id="newCopyTitle" placeholder="Título" style="padding:7px;border-radius:6px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:12px;">';
        html += '    <input id="newCopyBody" placeholder="Cuerpo del mensaje" style="padding:7px;border-radius:6px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:12px;">';
        html += '    <button onclick="addAutomationCopy()" style="padding:7px;background:linear-gradient(135deg,#7850ff,#00d4ff);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;">Agregar</button>';
        html += '  </div></div>';
        html += '<table class="report-table"><thead><tr><th>Título</th><th>Cuerpo</th><th style="text-align:center;">Peso</th><th style="text-align:center;">Usos</th><th style="text-align:center;">Activo</th><th style="text-align:center;">Acción</th></tr></thead><tbody>';
        for (const cp of copies) {
            html += '<tr>';
            html += '<td><input value="' + escapeHtml(cp.title) + '" data-id="' + cp.id + '" data-field="title" oninput="onCopyEdit(this)" style="width:100%;padding:5px;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:5px;color:#fff;font-size:12px;"></td>';
            html += '<td><input value="' + escapeHtml(cp.body) + '" data-id="' + cp.id + '" data-field="body" oninput="onCopyEdit(this)" style="width:100%;padding:5px;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:5px;color:#fff;font-size:12px;"></td>';
            html += '<td style="text-align:center;"><input type="number" step="0.5" min="0.1" max="10" value="' + (cp.weight||1) + '" data-id="' + cp.id + '" data-field="weight" oninput="onCopyEdit(this)" style="width:55px;padding:5px;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:5px;color:#fff;font-size:12px;text-align:center;"></td>';
            html += '<td style="text-align:center;color:#888;">' + (cp.usageCount||0) + '</td>';
            html += '<td style="text-align:center;"><input type="checkbox" ' + (cp.enabled !== false ? 'checked' : '') + ' data-id="' + cp.id + '" onchange="onCopyToggle(this)" style="width:18px;height:18px;cursor:pointer;"></td>';
            html += '<td style="text-align:center;"><button onclick="saveAutomationCopy(\'' + cp.id + '\')" style="padding:4px 10px;background:rgba(37,211,102,0.20);color:#25d366;border:1px solid rgba(37,211,102,0.40);border-radius:5px;font-size:11px;cursor:pointer;font-weight:700;">💾</button> <button onclick="deleteAutomationCopy(\'' + cp.id + '\')" style="padding:4px 8px;background:rgba(255,80,80,0.15);color:#ff5050;border:1px solid rgba(255,80,80,0.30);border-radius:5px;font-size:11px;cursor:pointer;">🗑</button></td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        c.innerHTML = html;
    } catch (e) { c.innerHTML = '<div style="color:#ff8080;">Error de conexión</div>'; }
}

function onCopyEdit(input) {
    const id = input.dataset.id, field = input.dataset.field;
    if (!_automationCopyEdits[id]) _automationCopyEdits[id] = {};
    _automationCopyEdits[id][field] = field === 'weight' ? Number(input.value) : input.value;
}

async function onCopyToggle(input) {
    const id = input.dataset.id;
    const enabled = input.checked;
    try {
        const r = await authFetch('/api/admin/automation/copies/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const d = await r.json();
        if (!r.ok) showToast(d.error || 'Error', 'error');
        else showToast(enabled ? 'Activado' : 'Desactivado', 'success');
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function saveAutomationCopy(id) {
    const edits = _automationCopyEdits[id];
    if (!edits) { showToast('No hay cambios', 'info'); return; }
    try {
        const r = await authFetch('/api/admin/automation/copies/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(edits)
        });
        const d = await r.json();
        if (!r.ok) { showToast(d.error || 'Error', 'error'); return; }
        delete _automationCopyEdits[id];
        showToast('✅ Guardado', 'success');
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function addAutomationCopy() {
    const title = (document.getElementById('newCopyTitle') || {}).value || '';
    const body  = (document.getElementById('newCopyBody')  || {}).value || '';
    if (!title.trim() || !body.trim()) { showToast('Completá título y cuerpo', 'error'); return; }
    try {
        const r = await authFetch('/api/admin/automation/copies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body })
        });
        const d = await r.json();
        if (!r.ok) { showToast(d.error || 'Error', 'error'); return; }
        showToast('✅ Copy agregado', 'success');
        _renderAutomationCopiesTab();
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function deleteAutomationCopy(id) {
    if (!confirm('¿Eliminar este copy del pool?')) return;
    try {
        const r = await authFetch('/api/admin/automation/copies/' + id, { method: 'DELETE' });
        const d = await r.json();
        if (!r.ok) { showToast(d.error || 'Error', 'error'); return; }
        showToast('Eliminado', 'success');
        _renderAutomationCopiesTab();
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// =====================================================================
// SECCIÓN 📅 REEMBOLSOS PENDIENTES
// =====================================================================
// Lista live de users que perdieron plata en el periodo y todavia no
// reclamaron su reembolso. Se va vaciando a medida que reclaman (refresh).
// Permite mandar push a todos los pendientes en un click (run-now).

let _refundRemindersActiveTab = 'daily';
let _refundRemindersData = { daily: null, weekly: null, monthly: null };
let _refundRemindersPrevCount = { daily: null, weekly: null, monthly: null };

function loadRefundRemindersSection() {
    _refundRemindersActiveTab = 'daily';
    _refundRemindersData = { daily: null, weekly: null, monthly: null };
    refreshRefundReminders();
}

function switchRefundReminderTab(type) {
    _refundRemindersActiveTab = type;
    document.querySelectorAll('#refundRemindersSection .rem-tab-btn').forEach(b => {
        const isActive = b.dataset.type === type;
        if (isActive) {
            b.style.background = 'rgba(37,211,102,0.15)';
            b.style.borderColor = 'rgba(37,211,102,0.40)';
            b.style.color = '#25d366';
        } else {
            b.style.background = 'rgba(0,0,0,0.30)';
            b.style.borderColor = 'rgba(255,255,255,0.10)';
            b.style.color = '#aaa';
        }
    });
    refreshRefundReminders();
}

async function refreshRefundReminders() {
    const type = _refundRemindersActiveTab;
    const container = document.getElementById('refundRemindersContent');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">⏳ Buscando reembolsos pendientes…</div>';
    try {
        const r = await authFetch('/api/admin/refund-reminders/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });
        const d = await r.json();
        if (!r.ok) { container.innerHTML = '<div style="color:#ff8080;padding:20px;">' + escapeHtml(d.error || 'Error') + '</div>'; return; }

        // Detectar si se vacio desde la ultima refresh: cuantos reclamaron mientras tanto.
        const prev = _refundRemindersPrevCount[type];
        const now = (d.totals && d.totals.finalAudience) || 0;
        const justClaimed = (prev !== null && prev > now) ? (prev - now) : 0;
        _refundRemindersPrevCount[type] = now;
        _refundRemindersData[type] = d;

        container.innerHTML = _renderRefundRemindersTab(type, d, justClaimed);
    } catch (e) {
        container.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión</div>';
    }
}

function _renderRefundRemindersTab(type, data, justClaimed) {
    const totals = data.totals || {};
    const perUser = data.perUser || [];
    const periodKey = data.periodKey || '';

    let html = '';

    // Stat cards.
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">';
    html += _autoStatCard('🎯 Pendientes ahora', totals.finalAudience || 0, '#25d366');
    html += _autoStatCard('👥 Elegibles totales', totals.eligible || 0, '#b39dff');
    html += _autoStatCard('✅ Ya reclamaron', totals.alreadyClaimed || 0, '#888');
    html += _autoStatCard('⛔ Sin app/notifs', totals.withoutChannel || 0, '#ff8800');
    if (justClaimed > 0) {
        html += _autoStatCard('🆕 Reclamaron desde el último refresh', justClaimed, '#ffc850');
    }
    html += '</div>';

    // Toolbar: refresh + send.
    const btnLabel = type === 'daily' ? '💰 Reembolso diario' : (type === 'weekly' ? '📅 Reembolso semanal' : '🏆 Reembolso mensual');
    html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;">';
    html += '  <strong style="color:#25d366;font-size:12px;">📋 ' + btnLabel + '</strong>';
    if (periodKey) html += '  <small style="color:#666;">período <code style="background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px;">' + escapeHtml(periodKey) + '</code></small>';
    html += '  <button onclick="refreshRefundReminders()" style="margin-left:auto;padding:7px 14px;background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">🔄 Actualizar</button>';
    if (perUser.length > 0) {
        html += '  <button onclick="sendRefundReminderPush(\'' + type + '\')" id="sendRefundReminderBtn" style="padding:8px 16px;background:linear-gradient(135deg,#25d366,#0a8055);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;">📲 Mandar push a los ' + perUser.length + ' pendientes</button>';
    }
    html += '</div>';

    if (perUser.length === 0) {
        html += '<div style="text-align:center;padding:40px;color:#888;">';
        html += '  <div style="font-size:42px;opacity:0.4;margin-bottom:10px;">✅</div>';
        html += '  <p style="margin:0;font-size:13px;">No hay reembolsos pendientes para este período. ' + (totals.alreadyClaimed > 0 ? 'Todos los elegibles ya reclamaron.' : 'Nadie tuvo pérdida en el período.') + '</p>';
        html += '</div>';
        return html;
    }

    // Total a pagar si todos reclaman.
    const totalPotential = perUser.reduce((s, u) => s + (u.potentialAmount || 0), 0);
    html += '<p style="color:#aaa;font-size:12px;margin:0 0 10px;">💵 Total potencial si todos reclaman: <strong style="color:#25d366;">$' + totalPotential.toLocaleString('es-AR') + '</strong></p>';

    // Search + table.
    html += '<input type="text" id="refundRemindersSearch" placeholder="🔍 Buscar usuario…" oninput="filterRefundRemindersTable()" style="width:100%;max-width:300px;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.45);color:#fff;font-size:13px;margin-bottom:10px;">';
    html += '<div id="refundRemindersTableContainer">' + _renderRefundRemindersTable(perUser) + '</div>';
    return html;
}

function _renderRefundRemindersTable(perUser) {
    if (!perUser || perUser.length === 0) {
        return '<div style="color:#888;padding:14px;text-align:center;">Sin resultados.</div>';
    }
    let html = '<table class="report-table"><thead><tr>';
    html += '<th>Usuario</th><th>Equipo</th><th style="text-align:right;">💸 Pérdida neta</th><th style="text-align:right;">💰 Reembolso potencial</th>';
    html += '</tr></thead><tbody>';
    for (const u of perUser) {
        html += '<tr>';
        html += '<td>' + escapeHtml(u.username) + '</td>';
        html += '<td><small>' + escapeHtml(u.lineTeamName || '—') + '</small></td>';
        html += '<td style="text-align:right;">$' + (u.netLoss || 0).toLocaleString('es-AR') + '</td>';
        html += '<td style="text-align:right;color:#25d366;font-weight:700;">$' + (u.potentialAmount || 0).toLocaleString('es-AR') + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function filterRefundRemindersTable() {
    const type = _refundRemindersActiveTab;
    const data = _refundRemindersData[type];
    if (!data) return;
    const q = (document.getElementById('refundRemindersSearch') || {}).value || '';
    const ql = q.toLowerCase().trim();
    const filtered = ql
        ? (data.perUser || []).filter(u => (u.username || '').toLowerCase().includes(ql))
        : (data.perUser || []);
    const tc = document.getElementById('refundRemindersTableContainer');
    if (tc) tc.innerHTML = _renderRefundRemindersTable(filtered);
}

async function sendRefundReminderPush(type) {
    const data = _refundRemindersData[type];
    const count = data && data.perUser ? data.perUser.length : 0;
    if (count === 0) { showToast('No hay pendientes a notificar', 'info'); return; }
    const ok = confirm('Vas a mandar push a ' + count + ' usuarios con reembolso ' + type + ' pendiente. ¿Confirmás?');
    if (!ok) return;
    const btn = document.getElementById('sendRefundReminderBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
    try {
        const r = await authFetch('/api/admin/refund-reminders/run-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });
        const d = await r.json();
        if (!r.ok) { showToast(d.error || 'Error', 'error'); return; }
        const sent = (d.result && (d.result.sentCount || d.result.sent)) || (d.sent || count);
        showToast('✅ Push enviado a ' + sent + ' users', 'success');
        // Refrescar lista para ver el estado.
        setTimeout(() => refreshRefundReminders(), 1500);
    } catch (e) { showToast('Error de conexión', 'error'); }
    finally { if (btn) { btn.disabled = false; } }
}

// =====================================================================
// SECCIÓN 🎁 SORTEOS PAGADOS (admin)
// =====================================================================
// 4 niveles de premio paralelos (👑$2M, 💎$1M, 💰$500k, 🎯$100k). Compra
// con saldo JUGAYGANA, autospawn al llenarse, sorteo todos los lunes en
// la Loteria Nocturna. El admin tiene:
//
//   • KPIs de la semana actual (recaudación, cupos, personas, neto)
//   • Cards de los 4 sorteos activos con botón Sortear/Cancelar
//   • Top compradores de la semana
//   • Historial semana a semana con detalle expansible
//   • Botones de mantenimiento: Limpiar drawn, Force seed
// =====================================================================

let _rafflesAdminCache = null;       // dashboard data
let _rafflesHistoryCache = null;     // history weeks
let _rafflesHistoryDetailCache = {}; // por weekKey -> detalle
let _rafflesSpendCache = null;       // cierre diario (paid only)
let _rafflesSpendDays = 30;          // rango por defecto

async function loadRafflesAdmin() {
    _renderAudienceBox('paid', 'rafflesPaidAudienceBox');
    return _loadRafflesGeneric('paid', 'rafflesAdminContent');
}

async function loadRafflesFreeAdmin() {
    _renderAudienceBox('free', 'rafflesFreeAudienceBox');
    return _loadRafflesGeneric('free', 'rafflesFreeAdminContent');
}

// Lee la audiencia configurada para el kind (paid|free) y la pinta arriba
// de la seccion. Boton "Editar" abre un modal con 3 modos + lista de equipos.
async function _renderAudienceBox(kind, containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '<div style="padding:10px;color:#888;font-size:11px;">⏳ Leyendo audiencia configurada…</div>';
    try {
        const r = await authFetch('/api/admin/raffles/audience-config?kind=' + encodeURIComponent(kind));
        const d = await r.json();
        if (!r.ok) {
            c.innerHTML = '<div style="color:#ff8080;padding:10px;">❌ ' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        const mode = d.mode || 'all';
        const teams = d.teams || [];
        let label, color;
        if (mode === 'all') {
            label = '👥 Audiencia: <strong>todos los equipos</strong>';
            color = '#888';
        } else if (mode === 'except') {
            label = '🚫 <strong>Excluyendo:</strong> ' + teams.map(escapeHtml).join(', ');
            color = '#ff8080';
        } else {
            label = '🎯 <strong>Solo:</strong> ' + teams.map(escapeHtml).join(', ');
            color = '#66ff66';
        }
        c.innerHTML =
            '<div style="background:rgba(255,255,255,0.04);border:1px dashed ' + color + '60;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
                '<div style="color:' + color + ';font-size:12px;line-height:1.4;">' + label + '<div style="color:#888;font-size:10.5px;margin-top:3px;">Aplica a TODOS los sorteos ' + (kind === 'free' ? 'gratis' : 'pagos') + ' (actuales y futuros).</div></div>' +
                '<button type="button" onclick="openAudienceConfigModal(\'' + kind + '\')" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid #00d4ff;padding:7px 12px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;">⚙️ Editar audiencia</button>' +
            '</div>';
    } catch (e) {
        c.innerHTML = '<div style="color:#ff8080;padding:10px;">Error de conexión leyendo audiencia.</div>';
    }
}

// Modal para editar audiencia. 3 modos: todos / excepto / solo. Lista los
// equipos disponibles desde /api/admin/calendar/teams-available.
async function openAudienceConfigModal(kind) {
    let modal = document.getElementById('audienceConfigModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'audienceConfigModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML =
        '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #00d4ff;border-radius:14px;max-width:520px;width:100%;margin:8px auto;padding:18px 16px;box-shadow:0 0 30px rgba(0,212,255,0.30);">' +
            '<h3 style="color:#00d4ff;margin:0 0 4px;font-size:18px;">⚙️ Audiencia · sorteos ' + (kind === 'free' ? 'gratis' : 'pagos') + '</h3>' +
            '<div style="color:#cce4ff;font-size:11.5px;margin-bottom:14px;line-height:1.5;">Define a quiénes les llega esta familia de sorteos. El cambio aplica <strong>de inmediato</strong> a todas las instancias activas y a las próximas que se creen.</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#ddd;margin-bottom:10px;">' +
                '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:rgba(255,255,255,0.04);padding:8px 10px;border-radius:6px;"><input type="radio" name="audCfgMode" value="all" checked onchange="_audCfgUpdateBox()"> A todos los equipos</label>' +
                '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:rgba(255,255,255,0.04);padding:8px 10px;border-radius:6px;"><input type="radio" name="audCfgMode" value="except" onchange="_audCfgUpdateBox()"> A todos <strong style="color:#ff8080;">excepto</strong> los elegidos</label>' +
                '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:rgba(255,255,255,0.04);padding:8px 10px;border-radius:6px;"><input type="radio" name="audCfgMode" value="only" onchange="_audCfgUpdateBox()"> <strong style="color:#66ff66;">Solo</strong> a los equipos elegidos</label>' +
            '</div>' +
            '<div id="audCfgTeamsBox" style="display:none;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px;margin-bottom:14px;max-height:220px;overflow-y:auto;">' +
                '<div style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Equipos</div>' +
                '<div id="audCfgTeamsList" style="display:flex;flex-wrap:wrap;gap:6px;color:#aaa;font-size:11px;">⏳ Cargando…</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
                '<button onclick="document.getElementById(\'audienceConfigModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
                '<button onclick="audienceConfigSave(\'' + kind + '\')" style="flex:2;background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;letter-spacing:1px;">💾 GUARDAR</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(modal);

    // Cargar configuracion actual y prefilear
    try {
        const r = await authFetch('/api/admin/raffles/audience-config?kind=' + encodeURIComponent(kind));
        const d = await r.json();
        if (r.ok) {
            const radio = document.querySelector('input[name="audCfgMode"][value="' + d.mode + '"]');
            if (radio) radio.checked = true;
            await _audCfgUpdateBox();
            // Prefill checkboxes
            if (d.teams && d.teams.length) {
                const set = new Set(d.teams.map(t => String(t).toLowerCase()));
                document.querySelectorAll('.audCfgTeamChk').forEach(c => {
                    if (set.has(String(c.value).toLowerCase())) c.checked = true;
                });
            }
        }
    } catch (_) { /* ignore */ }
}

async function _audCfgUpdateBox() {
    const radios = document.querySelectorAll('input[name="audCfgMode"]');
    let mode = 'all';
    for (const r of radios) { if (r.checked) { mode = r.value; break; } }
    const box = document.getElementById('audCfgTeamsBox');
    if (box) box.style.display = (mode === 'except' || mode === 'only') ? 'block' : 'none';
    if (mode === 'all') return;
    const list = document.getElementById('audCfgTeamsList');
    if (!list || list.dataset.loaded === '1') return;
    try {
        const r = await authFetch('/api/admin/calendar/teams-available');
        const d = await r.json();
        const teams = (d && d.teams) || [];
        if (teams.length === 0) {
            list.innerHTML = '<span style="color:#888;">No hay equipos configurados.</span>';
            list.dataset.loaded = '1';
            return;
        }
        let h = '';
        for (const t of teams) {
            h += '<label style="display:inline-flex;align-items:center;gap:4px;color:#ddd;cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(0,212,255,0.20);border-radius:6px;padding:5px 10px;">' +
                '<input type="checkbox" class="audCfgTeamChk" value="' + escapeHtml(t) + '"> ' + escapeHtml(t) +
            '</label>';
        }
        list.innerHTML = h;
        list.dataset.loaded = '1';
    } catch (_) {
        list.innerHTML = '<span style="color:#888;">No se pudieron cargar equipos.</span>';
    }
}

async function audienceConfigSave(kind) {
    if (audienceConfigSave._busy) return;
    let mode = 'all';
    const radios = document.querySelectorAll('input[name="audCfgMode"]');
    for (const r of radios) { if (r.checked) { mode = r.value; break; } }
    const teams = (mode === 'all')
        ? []
        : Array.from(document.querySelectorAll('.audCfgTeamChk:checked')).map(c => c.value);
    if (mode !== 'all' && teams.length === 0) {
        alert('Elegí al menos 1 equipo o pasá el modo a "A todos".');
        return;
    }
    audienceConfigSave._busy = true;
    try {
        const r = await authFetch('/api/admin/raffles/audience-config?kind=' + encodeURIComponent(kind), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, teams })
        });
        const d = await r.json();
        if (!r.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        showToast('💾 Audiencia guardada (' + (d.activeUpdated || 0) + ' instancias activas actualizadas)', 'success');
        document.getElementById('audienceConfigModal')?.remove();
        // Repintamos el banner correspondiente
        if (kind === 'free') {
            _renderAudienceBox('free', 'rafflesFreeAudienceBox');
            loadRafflesFreeAdmin();
        } else {
            _renderAudienceBox('paid', 'rafflesPaidAudienceBox');
            loadRafflesAdmin();
        }
    } catch (e) {
        alert('Error de conexión');
    }
    finally { audienceConfigSave._busy = false; }
}

async function loadRafflesLightningAdmin() {
    return _loadRafflesGeneric('relampago', 'rafflesLightningAdminContent');
}

// ============================================
// SEGMENTOS — listas de usernames (CSV file o URL Sheets) para analizar
// conversion contra cargas reales de JUGAYGANA. Usado para top jugadores,
// recuperacion, sin WP, con app, bonus 5k/10k/2k, participantes de un
// relampago, etc.
// ============================================

async function loadSegmentsAdmin() {
    const c = document.getElementById('segmentsAdminContent');
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">⏳ Cargando…</div>';
    try {
        const r = await authFetch('/api/admin/segments');
        const d = await r.json();
        if (!r.ok) {
            c.innerHTML = '<div style="color:#ff8080;padding:18px;">❌ ' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        const list = d.segments || [];
        if (list.length === 0) {
            c.innerHTML = '<div style="text-align:center;padding:40px;color:#888;background:rgba(255,255,255,0.03);border-radius:10px;">No hay segmentos creados todavía.<br><br>Tocá <strong style="color:#66ff66;">"➕ Nuevo segmento"</strong> arriba para empezar (top jugadores, recuperación, bonus 5k, etc.).</div>';
            return;
        }
        let html = '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<thead style="background:#001a40;"><tr style="color:#00d4ff;text-align:left;">';
        html += '<th style="padding:9px 10px;font-weight:800;">Segmento</th>';
        html += '<th style="padding:9px 10px;font-weight:800;text-align:center;">Usuarios</th>';
        html += '<th style="padding:9px 10px;font-weight:800;text-align:center;">Subidas</th>';
        html += '<th style="padding:9px 10px;font-weight:800;">Última actualización</th>';
        html += '<th style="padding:9px 10px;font-weight:800;">Acciones</th>';
        html += '</tr></thead><tbody>';
        for (const s of list) {
            const last = s.lastUploadAt ? new Date(s.lastUploadAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
            const sourceTag = s.lastUploadSource === 'sheets-url' ? '🔗 Sheets'
                : (s.lastUploadSource === 'lightning' ? '⚡ Relámpago'
                : (s.lastUploadSource === 'file' ? '📄 Archivo' : ''));
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);">';
            const masterBadge = s.isMaster ? ' <span style="background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;font-size:9.5px;font-weight:900;padding:1px 6px;border-radius:4px;letter-spacing:1px;">🌟 MASTER</span>' : '';
            html += '<td style="padding:9px 10px;color:#fff;font-weight:700;">' + escapeHtml(s.name) + masterBadge + '<div style="color:#888;font-size:10px;font-weight:400;">' + escapeHtml(s.slug) + (s.description ? ' · ' + escapeHtml(s.description) : '') + '</div></td>';
            html += '<td style="padding:9px 10px;text-align:center;color:#00d4ff;font-weight:800;">' + (s.userCount || 0) + '</td>';
            html += '<td style="padding:9px 10px;text-align:center;color:#aaa;">' + (s.uploadsCount || 0) + '</td>';
            html += '<td style="padding:9px 10px;color:#ddd;font-size:11px;">' + last + (sourceTag ? ' <span style="color:#888;">· ' + sourceTag + '</span>' : '') + '</td>';
            html += '<td style="padding:9px 10px;display:flex;gap:5px;flex-wrap:wrap;">';
            html += '<button type="button" onclick="viewSegment(' + escapeJsArg(s.slug) + ')" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:5px 9px;border-radius:5px;font-weight:700;font-size:11px;cursor:pointer;">📋 Detalle</button>';
            html += '<button type="button" onclick="uploadSegmentModal(' + escapeJsArg(s.slug) + ')" style="background:rgba(102,255,102,0.10);color:#66ff66;border:1px solid rgba(102,255,102,0.40);padding:5px 9px;border-radius:5px;font-weight:700;font-size:11px;cursor:pointer;">⬆️ Subir</button>';
            const masterBtnLabel = s.isMaster ? '🌟 Master' : '☆ Master';
            const masterBtnTitle = s.isMaster ? 'Este segmento es el archivo Maestro (usado por análisis cross-section). Tocá para desmarcarlo.' : 'Marcar como archivo Maestro (lo usan otras secciones para analizar).';
            const masterBtnStyle = s.isMaster
                ? 'background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;'
                : 'background:rgba(255,215,0,0.06);color:#ffd700;border:1px solid rgba(255,215,0,0.40);';
            html += '<button type="button" title="' + escapeHtml(masterBtnTitle) + '" onclick="toggleMasterSegment(' + escapeJsArg(s.slug) + ',' + (s.isMaster ? 'false' : 'true') + ')" style="' + masterBtnStyle + 'padding:5px 9px;border-radius:5px;font-weight:700;font-size:11px;cursor:pointer;">' + masterBtnLabel + '</button>';
            html += '<button type="button" onclick="deleteSegment(' + escapeJsArg(s.slug) + ')" style="background:rgba(255,107,107,0.10);color:#ff8080;border:1px solid rgba(255,107,107,0.40);padding:5px 9px;border-radius:5px;font-weight:700;font-size:11px;cursor:pointer;">🗑️</button>';
            html += '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div style="color:#ff8080;padding:18px;">Error de conexión</div>';
    }
}

function newSegmentModal() {
    let modal = document.getElementById('newSegmentModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'newSegmentModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:30000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #66ff66;border-radius:14px;max-width:480px;width:100%;margin:8px auto;padding:18px 16px;">' +
        '<h3 style="color:#66ff66;margin:0 0 8px;font-size:16px;">➕ Nuevo segmento</h3>' +
        '<div style="color:#aaa;font-size:11px;margin-bottom:14px;line-height:1.5;">Creá un segmento vacío. Después le subís el CSV o URL de Sheets.</div>' +
        '<label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Nombre</label>' +
        '<input id="segNewName" type="text" maxlength="120" placeholder="Ej: Top jugadores · semana 18" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 10px;border-radius:6px;font-size:13px;margin:4px 0 10px;box-sizing:border-box;">' +
        '<label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Tipo (opcional)</label>' +
        '<select id="segNewKind" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 10px;border-radius:6px;font-size:13px;margin:4px 0 10px;box-sizing:border-box;">' +
            '<option value="custom">Custom</option>' +
            '<option value="top">🏆 Top jugadores</option>' +
            '<option value="recovery">🔁 Recuperación</option>' +
            '<option value="wp">📞 Sin WP</option>' +
            '<option value="app">📱 Con app</option>' +
            '<option value="bonus">🎁 Bonus</option>' +
            '<option value="lightning">⚡ Relámpago</option>' +
        '</select>' +
        '<label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Descripción (opcional)</label>' +
        '<textarea id="segNewDesc" maxlength="500" placeholder="Notas internas — para qué creaste este segmento" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 10px;border-radius:6px;font-size:13px;margin:4px 0 14px;box-sizing:border-box;min-height:60px;resize:vertical;"></textarea>' +
        '<div style="display:flex;gap:8px;">' +
            '<button onclick="document.getElementById(\'newSegmentModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
            '<button onclick="newSegmentSubmit()" style="flex:2;background:linear-gradient(135deg,#66ff66,#4dabff);color:#000;border:none;padding:10px;border-radius:7px;font-weight:900;font-size:13px;cursor:pointer;letter-spacing:0.5px;">➕ CREAR</button>' +
        '</div>' +
    '</div>';
    document.body.appendChild(modal);
    setTimeout(() => { try { document.getElementById('segNewName').focus(); } catch (_) {} }, 80);
}

async function newSegmentSubmit() {
    if (newSegmentSubmit._busy) return;
    const name = (document.getElementById('segNewName')?.value || '').trim();
    const kind = (document.getElementById('segNewKind')?.value || 'custom');
    const description = (document.getElementById('segNewDesc')?.value || '').trim();
    if (!name) { alert('Falta nombre'); return; }
    newSegmentSubmit._busy = true;
    try {
        const r = await authFetch('/api/admin/segments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, kind, description })
        });
        const d = await r.json();
        if (!r.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        document.getElementById('newSegmentModal')?.remove();
        showToast('✅ Segmento creado: ' + d.segment.name, 'success');
        loadSegmentsAdmin();
        // Abre directo el modal de subida.
        setTimeout(() => uploadSegmentModal(d.segment.slug), 300);
    } catch (e) {
        alert('Error de conexión');
    } finally { newSegmentSubmit._busy = false; }
}

function uploadSegmentModal(slug) {
    let modal = document.getElementById('uploadSegmentModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'uploadSegmentModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:30000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #66ff66;border-radius:14px;max-width:560px;width:100%;margin:8px auto;padding:18px 16px;">' +
        '<h3 style="color:#66ff66;margin:0 0 4px;font-size:16px;">⬆️ Subir lista a "' + escapeHtml(slug) + '"</h3>' +
        '<div style="color:#aaa;font-size:11px;margin-bottom:12px;line-height:1.5;">Pisa la lista actual pero queda registro en historial. Usá <strong>una de las dos opciones</strong>: archivo CSV o URL de Sheets publicado-a-web.</div>' +

        '<div style="background:rgba(102,255,102,0.06);border:1px solid rgba(102,255,102,0.30);border-radius:8px;padding:11px;margin-bottom:10px;">' +
            '<label style="color:#66ff66;font-size:12px;font-weight:800;display:block;margin-bottom:6px;">📄 Opción A · Archivo CSV</label>' +
            '<input id="segUploadFile" type="file" accept=".csv,text/csv,text/plain" style="width:100%;color:#fff;font-size:12px;">' +
            '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:5px;">Columnas detectadas automáticamente. Tiene que tener al menos una columna <strong>username</strong> (o user / usuario / nombre / nick).</div>' +
        '</div>' +

        '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:11px;margin-bottom:14px;">' +
            '<label style="color:#00d4ff;font-size:12px;font-weight:800;display:block;margin-bottom:6px;">🔗 Opción B · URL de Google Sheets (publicado-a-web como CSV)</label>' +
            '<input id="segUploadUrl" type="url" placeholder="https://docs.google.com/spreadsheets/.../pub?output=csv" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:8px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;">' +
            '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:5px;">En tu Sheet: <strong>Archivo → Compartir → Publicar a la web</strong> → "como CSV" → copiar URL.</div>' +
        '</div>' +

        '<div style="display:flex;gap:8px;">' +
            '<button onclick="document.getElementById(\'uploadSegmentModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
            '<button onclick="uploadSegmentSubmit(' + escapeJsArg(slug) + ')" style="flex:2;background:linear-gradient(135deg,#66ff66,#4dabff);color:#000;border:none;padding:10px;border-radius:7px;font-weight:900;font-size:13px;cursor:pointer;letter-spacing:0.5px;">⬆️ SUBIR</button>' +
        '</div>' +
    '</div>';
    document.body.appendChild(modal);
}

async function uploadSegmentSubmit(slug) {
    if (uploadSegmentSubmit._busy) return;
    const fileInput = document.getElementById('segUploadFile');
    const url = (document.getElementById('segUploadUrl')?.value || '').trim();
    let body = null;
    let bodySizeKb = 0;
    if (fileInput && fileInput.files && fileInput.files[0]) {
        const f = fileInput.files[0];
        if (f.size > 20 * 1024 * 1024) { alert('Archivo muy grande (max 20MB). Si excede, recortá por fechas o subí en partes.'); return; }
        const text = await f.text();
        body = { csv: text, filename: f.name };
        bodySizeKb = Math.round(text.length / 1024);
    } else if (url) {
        body = { url };
    } else {
        alert('Elegí un archivo CSV o pegá una URL.');
        return;
    }
    uploadSegmentSubmit._busy = true;
    // Reemplazar el modal con un loader claro mientras procesa, asi el user no
    // ve la pantalla congelada — uploads de varios MB pueden tardar 10-30s.
    const modal = document.getElementById('uploadSegmentModal');
    if (modal) {
        modal.innerHTML = '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #66ff66;border-radius:14px;max-width:420px;width:100%;margin:8px auto;padding:30px 20px;text-align:center;">' +
            '<div style="font-size:36px;margin-bottom:10px;">⏳</div>' +
            '<div style="color:#66ff66;font-size:14px;font-weight:900;margin-bottom:6px;">Procesando…</div>' +
            '<div style="color:#aaa;font-size:11.5px;line-height:1.5;">' +
                (url ? 'Bajando CSV de la URL y parseando.' : 'Subiendo ' + bodySizeKb + ' KB y parseando.') +
                '<br>Puede tardar entre 10 y 60 segundos según el tamaño.' +
            '</div>' +
        '</div>';
    }
    try {
        const r = await authFetch('/api/admin/segments/' + encodeURIComponent(slug) + '/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        let d = {};
        try { d = await r.json(); } catch (_) {}
        if (!r.ok) {
            const msg = (d && d.error) || ('HTTP ' + r.status + ' — el server rechazó el upload.');
            alert('❌ ' + msg);
            // Re-abrir modal para que el user pueda corregir
            document.getElementById('uploadSegmentModal')?.remove();
            uploadSegmentModal(slug);
            return;
        }
        document.getElementById('uploadSegmentModal')?.remove();
        showToast('✅ ' + (d.rowsCount || 0) + ' usuarios cargados en "' + slug + '"', 'success');
        loadSegmentsAdmin();
    } catch (e) {
        console.error('uploadSegmentSubmit error:', e);
        alert('Error de conexión: ' + (e && e.message ? e.message : 'sin detalle') + '\n\nProbá de nuevo. Si el archivo es grande puede tardar — esperá 60s antes de cancelar.');
        document.getElementById('uploadSegmentModal')?.remove();
        uploadSegmentModal(slug);
    } finally { uploadSegmentSubmit._busy = false; }
}

async function toggleMasterSegment(slug, makeMaster) {
    const action = makeMaster ? 'marcar como Maestro' : 'desmarcar como Maestro';
    if (!confirm('¿' + action.charAt(0).toUpperCase() + action.slice(1) + ' el segmento "' + slug + '"?' + (makeMaster ? '\n\nVa a desmarcar a cualquier otro Maestro existente.' : ''))) return;
    try {
        const r = await authFetch('/api/admin/segments/' + encodeURIComponent(slug) + '/master', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isMaster: !!makeMaster })
        });
        const d = await r.json();
        if (!r.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        showToast(makeMaster ? '🌟 Marcado como Maestro' : '☆ Desmarcado', 'success');
        loadSegmentsAdmin();
    } catch (e) { alert('Error de conexión'); }
}

async function deleteSegment(slug) {
    if (!confirm('¿Borrar el segmento "' + slug + '"? Se pierde la lista actual y todo el historial.')) return;
    try {
        const r = await authFetch('/api/admin/segments/' + encodeURIComponent(slug), { method: 'DELETE' });
        const d = await r.json();
        if (!r.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        showToast('🗑️ Segmento borrado', 'success');
        loadSegmentsAdmin();
    } catch (e) { alert('Error de conexión'); }
}

async function importLightningSegmentModal() {
    // Busca relampagos disponibles para importar.
    let modal = document.getElementById('importLightningModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'importLightningModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:30000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #ffeb3b;border-radius:14px;max-width:520px;width:100%;margin:8px auto;padding:18px 16px;">' +
        '<h3 style="color:#ffeb3b;margin:0 0 4px;font-size:16px;">⚡ Importar relámpago como segmento</h3>' +
        '<div style="color:#aaa;font-size:11px;margin-bottom:12px;line-height:1.5;">Crea un segmento nuevo con los participantes del relámpago elegido. Después podés analizar quién cargó después.</div>' +
        '<div id="importLightningList" style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px;max-height:300px;overflow-y:auto;margin-bottom:14px;color:#aaa;font-size:12px;">⏳ Cargando relámpagos…</div>' +
        '<div style="display:flex;gap:8px;">' +
            '<button onclick="document.getElementById(\'importLightningModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
        '</div>' +
    '</div>';
    document.body.appendChild(modal);
    try {
        const r = await authFetch('/api/admin/raffles/lightning-roi?limit=20');
        const d = await r.json();
        const list = (d && d.raffles) || [];
        const cont = document.getElementById('importLightningList');
        if (list.length === 0) {
            cont.innerHTML = '<div style="text-align:center;padding:20px;">No hay relámpagos creados.</div>';
            return;
        }
        let html = '';
        for (const it of list) {
            const drawnTxt = it.drawnAt ? new Date(it.drawnAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
            html += '<div onclick="importLightningPick(' + escapeJsArg(it.id) + ',' + escapeJsArg(it.name) + ')" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:7px;padding:9px 11px;margin-bottom:6px;cursor:pointer;">';
            html += '<div style="color:#fff;font-weight:700;font-size:13px;">⚡ ' + escapeHtml(it.name) + ' <span style="color:#888;font-weight:400;font-size:10.5px;">· ' + escapeHtml(it.status) + '</span></div>';
            html += '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:3px;">' + (it.totalEntries || 0) + ' anotados · premio $' + (it.prizeValueARS||0).toLocaleString('es-AR') + ' · ' + drawnTxt + '</div>';
            html += '</div>';
        }
        cont.innerHTML = html;
    } catch (e) {
        const cont = document.getElementById('importLightningList');
        if (cont) cont.innerHTML = '<div style="color:#ff8080;padding:20px;text-align:center;">Error cargando relámpagos</div>';
    }
}

async function importLightningPick(raffleId, raffleName) {
    const slugDefault = ('relampago-' + (raffleName || 'rid')).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0, 60);
    const name = prompt('Nombre del segmento:', '⚡ ' + (raffleName || 'Relámpago'));
    if (!name) return;
    const slug = (prompt('Slug (auto-sugerido):', slugDefault) || slugDefault).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0, 60);
    if (!slug) return;
    try {
        // Crea el segmento (si ya existe, lo importa igual al mismo).
        const cr = await authFetch('/api/admin/segments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, slug, kind: 'lightning' })
        });
        const cd = await cr.json();
        if (!cr.ok && !/Ya existe/.test(cd.error || '')) { alert('❌ ' + (cd.error || 'Error')); return; }
        // Importa los participantes.
        const ir = await authFetch('/api/admin/segments/' + encodeURIComponent(slug) + '/import-lightning', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raffleId })
        });
        const id = await ir.json();
        if (!ir.ok) { alert('❌ ' + (id.error || 'Error')); return; }
        document.getElementById('importLightningModal')?.remove();
        showToast('⚡ Importados ' + id.rowsCount + ' participantes a "' + slug + '"', 'success');
        loadSegmentsAdmin();
    } catch (e) { alert('Error de conexión'); }
}

// Estado actual del modal de segmento — usado por los filtros para refetch.
const _segmentViewState = { slug: null, from: '', to: '', lens: 'all', topN: 50, analyze: false };

async function viewSegment(slug, opts) {
    opts = opts || {};
    if (slug !== _segmentViewState.slug) {
        // Slug cambio: reset filtros.
        _segmentViewState.slug = slug;
        _segmentViewState.from = '';
        _segmentViewState.to = '';
        _segmentViewState.lens = 'all';
        _segmentViewState.topN = 50;
        _segmentViewState.analyze = false;
    }
    if (opts.from != null) _segmentViewState.from = opts.from;
    if (opts.to != null) _segmentViewState.to = opts.to;
    if (opts.lens != null) _segmentViewState.lens = opts.lens;
    if (opts.topN != null) _segmentViewState.topN = opts.topN;
    if (opts.analyze != null) _segmentViewState.analyze = !!opts.analyze;

    let modal = document.getElementById('segmentDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'segmentDetailModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:30000;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto;';
        modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
        modal.innerHTML = '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #00d4ff;border-radius:12px;max-width:980px;width:100%;margin:8px auto;padding:18px 16px;position:relative;"><button onclick="document.getElementById(\'segmentDetailModal\').style.display=\'none\'" style="position:absolute;top:10px;right:14px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.20);color:#fff;font-size:20px;cursor:pointer;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;">✕</button><div id="segmentDetailBody"><div style="text-align:center;padding:40px;color:#888;">⏳ Cargando…</div></div></div>';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    const body = document.getElementById('segmentDetailBody');
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#888;">' + (_segmentViewState.analyze ? '⏳ Analizando cargas (puede tardar varios segundos por persona)…' : '⏳ Cargando…') + '</div>';
    try {
        const params = new URLSearchParams();
        if (_segmentViewState.from) params.set('from', _segmentViewState.from);
        if (_segmentViewState.to) params.set('to', _segmentViewState.to);
        if (_segmentViewState.lens && _segmentViewState.lens !== 'all') params.set('lens', _segmentViewState.lens);
        if (_segmentViewState.topN && _segmentViewState.lens === 'top') params.set('topN', String(_segmentViewState.topN));
        if (_segmentViewState.analyze) params.set('analyze', '1');
        const qs = params.toString();
        const url = '/api/admin/segments/' + encodeURIComponent(slug) + (qs ? '?' + qs : '');
        const r = await authFetch(url);
        const d = await r.json();
        if (!r.ok) { body.innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">' + escapeHtml(d.error || 'Error') + '</div>'; return; }
        body.innerHTML = _renderSegmentDetail(d);
    } catch (e) { body.innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">Error de conexión</div>'; }
}

function applySegmentFilters() {
    const fromInp = document.getElementById('segFilterFrom');
    const toInp = document.getElementById('segFilterTo');
    const lensSel = document.getElementById('segFilterLens');
    const topInp = document.getElementById('segFilterTopN');
    const analyzeChk = document.getElementById('segFilterAnalyze');
    const opts = {
        from: fromInp && fromInp.value ? new Date(fromInp.value).toISOString() : '',
        to: toInp && toInp.value ? new Date(toInp.value).toISOString() : '',
        lens: lensSel ? lensSel.value : 'all',
        topN: topInp && topInp.value ? parseInt(topInp.value, 10) : 50,
        analyze: analyzeChk ? !!analyzeChk.checked : false
    };
    viewSegment(_segmentViewState.slug, opts);
}

function clearSegmentFilters() {
    _segmentViewState.from = '';
    _segmentViewState.to = '';
    _segmentViewState.lens = 'all';
    _segmentViewState.topN = 50;
    _segmentViewState.analyze = false;
    viewSegment(_segmentViewState.slug, { from: '', to: '', lens: 'all', topN: 50, analyze: false });
}

function _renderSegmentDetail(d) {
    const s = d.segment;
    const users = d.users || [];
    const totals = d.totals || {};
    const uploads = d.uploads || [];
    const fromLocal = s.dateFrom ? _isoToDatetimeLocal(s.dateFrom) : '';
    const toLocal = s.dateTo ? _isoToDatetimeLocal(s.dateTo) : '';
    const conv = users.length ? Math.round((totals.converted || 0) / users.length * 100) : 0;
    const lens = s.lensApplied || 'all';
    const isTxLog = !!s.isTxLog;

    let html = '<h2 style="color:#00d4ff;margin:0 0 4px;font-size:18px;padding-right:48px;">📊 ' + escapeHtml(s.name) + '</h2>';
    html += '<div style="color:#aaa;font-size:11px;margin-bottom:12px;line-height:1.5;">' + escapeHtml(s.slug) + (s.description ? ' · ' + escapeHtml(s.description) : '') + (isTxLog ? ' · <strong style="color:#66ff66;">📁 Log de transacciones</strong> · ' + (s.rowsCount || 0) + ' filas' : '') + '</div>';

    // FILTROS (date range + lens) — solo si es tx-log; sino son filtros casi vacios.
    if (isTxLog) {
        html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:10px;padding:11px;margin-bottom:12px;">';
        html += '<div style="color:#00d4ff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🔎 Filtros de análisis</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;align-items:end;">';

        html += '<div><label style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Desde</label>';
        html += '<input id="segFilterFrom" type="datetime-local" value="' + fromLocal + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:12.5px;box-sizing:border-box;margin-top:3px;"></div>';

        html += '<div><label style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Hasta</label>';
        html += '<input id="segFilterTo" type="datetime-local" value="' + toLocal + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:12.5px;box-sizing:border-box;margin-top:3px;"></div>';

        html += '<div><label style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Lente</label>';
        html += '<select id="segFilterLens" onchange="document.getElementById(\'segFilterTopNBox\').style.display = (this.value === \'top\') ? \'block\' : \'none\';" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:12.5px;box-sizing:border-box;margin-top:3px;">';
        const lensOpts = [
            ['all', 'Todos'],
            ['top', '🏆 Top jugadores (por carga)'],
            ['deposit', '📥 Cargaron al menos 1 vez'],
            ['bonus', '🎁 Recibieron bonus'],
            ['withdraw', '📤 Hicieron descarga'],
            ['con-app', '📱 Con app instalada'],
            ['sin-app', '📱 Sin app'],
            ['relampago', '⚡ Participaron en relámpago']
        ];
        for (const [v, l] of lensOpts) {
            html += '<option value="' + v + '"' + (lens === v ? ' selected' : '') + '>' + l + '</option>';
        }
        html += '</select></div>';

        html += '<div id="segFilterTopNBox" style="display:' + (lens === 'top' ? 'block' : 'none') + ';"><label style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Top N</label>';
        html += '<input id="segFilterTopN" type="number" min="5" max="500" value="' + (_segmentViewState.topN || 50) + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:12.5px;box-sizing:border-box;margin-top:3px;"></div>';

        html += '</div>';
        html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;">';
        html += '<label style="display:flex;align-items:center;gap:6px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;"><input type="checkbox" id="segFilterAnalyze" ' + (_segmentViewState.analyze ? 'checked' : '') + '> ⚡ Cruzar con cargas reales (JUGAYGANA · más lento)</label>';
        html += '<button type="button" onclick="applySegmentFilters()" style="background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:9px 14px;border-radius:7px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;">🔍 APLICAR</button>';
        html += '<button type="button" onclick="clearSegmentFilters()" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 12px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Limpiar</button>';
        html += '</div>';
        html += '</div>';
    }

    // Stats
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Usuarios (filtrados)</div><div style="color:#fff;font-size:18px;font-weight:900;">' + users.length + '</div></div>';
    if (d.analyzed) {
        html += '<div style="background:rgba(102,255,102,0.10);border:1px solid rgba(102,255,102,0.40);border-radius:8px;padding:9px 12px;"><div style="color:#aaffaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Cargaron después</div><div style="color:#66ff66;font-size:18px;font-weight:900;">' + (totals.converted || 0) + '/' + users.length + ' (' + conv + '%)</div></div>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Monto cargado</div><div style="color:#66ff66;font-size:18px;font-weight:900;">' + _fmtMoney(totals.totalAmountPost || 0) + '</div></div>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Cargas (count)</div><div style="color:#fff;font-size:18px;font-weight:900;">' + (totals.totalCargasPost || 0) + '</div></div>';
    }
    html += '</div>';

    // Detectar si el archivo subido es un log de transacciones (las metas
    // tienen depositCount/withdrawCount/bonusCount). Si si, mostramos columnas
    // adicionales con esos totales.
    const hasTxAggregates = users.length > 0 && users.some(u =>
        u.meta && (u.meta.depositCount != null || u.meta.withdrawCount != null || u.meta.bonusCount != null)
    );

    // Tabla
    if (users.length > 0) {
        html += '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;max-height:55vh;overflow-y:auto;margin-bottom:14px;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
        html += '<thead style="position:sticky;top:0;background:#001a40;z-index:1;"><tr style="color:#00d4ff;text-align:left;">';
        html += '<th style="padding:8px 10px;font-weight:800;">#</th>';
        html += '<th style="padding:8px 10px;font-weight:800;">Usuario</th>';
        if (hasTxAggregates) {
            html += '<th style="padding:8px 10px;font-weight:800;text-align:center;" title="Cargas (deposits) en el archivo">📥 Cargas archivo</th>';
            html += '<th style="padding:8px 10px;font-weight:800;text-align:center;" title="Descargas (withdraws) en el archivo">📤 Descargas</th>';
            html += '<th style="padding:8px 10px;font-weight:800;text-align:center;" title="Bonos (individual_bonus) en el archivo">🎁 Bonos</th>';
            html += '<th style="padding:8px 10px;font-weight:800;text-align:center;" title="Última transacción en el archivo">Última</th>';
        }
        if (d.analyzed) {
            html += '<th style="padding:8px 10px;font-weight:800;text-align:center;" title="Cargas REALES en JUGAYGANA después del cutoff">⚡ Cargas POST</th>';
            html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Monto POST</th>';
            html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Volvió</th>';
        }
        html += '</tr></thead><tbody>';
        let i = 1;
        for (const u of users) {
            const m = u.meta || {};
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);">';
            html += '<td style="padding:7px 10px;color:#666;font-weight:700;">' + i + '</td>';
            html += '<td style="padding:7px 10px;color:#fff;font-weight:700;">' + escapeHtml(u.username) + (m.team ? '<div style="color:#888;font-weight:400;font-size:10px;">' + escapeHtml(m.team) + '</div>' : '') + '</td>';
            if (hasTxAggregates) {
                const dc = m.depositCount || 0, ds = m.depositSum || 0;
                const wc = m.withdrawCount || 0, ws = m.withdrawSum || 0;
                const bc = m.bonusCount || 0, bs = m.bonusSum || 0;
                const last = m.lastTime ? new Date(m.lastTime).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—';
                html += '<td style="padding:7px 10px;text-align:center;color:' + (dc > 0 ? '#66ff66' : '#666') + ';"><div style="font-weight:800;">' + dc + '</div>' + (ds > 0 ? '<div style="font-size:10px;color:#aaa;font-weight:600;">' + _fmtMoney(ds) + '</div>' : '') + '</td>';
                html += '<td style="padding:7px 10px;text-align:center;color:' + (wc > 0 ? '#ff8080' : '#666') + ';"><div style="font-weight:800;">' + wc + '</div>' + (ws > 0 ? '<div style="font-size:10px;color:#aaa;font-weight:600;">' + _fmtMoney(ws) + '</div>' : '') + '</td>';
                html += '<td style="padding:7px 10px;text-align:center;color:' + (bc > 0 ? '#ffeb3b' : '#666') + ';"><div style="font-weight:800;">' + bc + '</div>' + (bs > 0 ? '<div style="font-size:10px;color:#aaa;font-weight:600;">' + _fmtMoney(bs) + '</div>' : '') + '</td>';
                html += '<td style="padding:7px 10px;text-align:center;color:#aaa;font-size:10.5px;">' + last + '</td>';
            }
            if (d.analyzed) {
                const c = u.cargasPostCount || 0;
                const a = u.cargasPostAmount || 0;
                const cargasColor = u.converted ? '#66ff66' : '#888';
                html += '<td style="padding:7px 10px;text-align:center;color:' + cargasColor + ';font-weight:800;">' + c + '</td>';
                html += '<td style="padding:7px 10px;text-align:right;color:' + cargasColor + ';font-weight:800;">' + (a > 0 ? _fmtMoney(a) : '—') + '</td>';
                html += '<td style="padding:7px 10px;text-align:center;font-weight:900;">' + (u.converted ? '<span style="color:#66ff66;background:rgba(102,255,102,0.12);border:1px solid #66ff66;padding:2px 7px;border-radius:5px;">✅ Sí</span>' : '<span style="color:#aaa;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.20);padding:2px 7px;border-radius:5px;">— No</span>') + '</td>';
            }
            html += '</tr>';
            i++;
        }
        html += '</tbody></table></div>';

        // Si hay agregados, mostramos también totales por tipo arriba.
        if (hasTxAggregates) {
            const tot = users.reduce((acc, u) => {
                const m = u.meta || {};
                acc.dc += m.depositCount || 0; acc.ds += m.depositSum || 0;
                acc.wc += m.withdrawCount || 0; acc.ws += m.withdrawSum || 0;
                acc.bc += m.bonusCount || 0; acc.bs += m.bonusSum || 0;
                return acc;
            }, { dc:0, ds:0, wc:0, ws:0, bc:0, bs:0 });
            const totalsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px;">' +
                '<div style="background:rgba(102,255,102,0.10);border:1px solid rgba(102,255,102,0.40);border-radius:8px;padding:9px 12px;"><div style="color:#aaffaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">📥 Cargas archivo</div><div style="color:#66ff66;font-size:16px;font-weight:900;">' + tot.dc + ' · ' + _fmtMoney(tot.ds) + '</div></div>' +
                '<div style="background:rgba(255,128,128,0.06);border:1px solid rgba(255,128,128,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#ff8080;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">📤 Descargas archivo</div><div style="color:#ff8080;font-size:16px;font-weight:900;">' + tot.wc + ' · ' + _fmtMoney(tot.ws) + '</div></div>' +
                '<div style="background:rgba(255,235,59,0.08);border:1px solid rgba(255,235,59,0.40);border-radius:8px;padding:9px 12px;"><div style="color:#ffeb3b;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">🎁 Bonos archivo</div><div style="color:#ffeb3b;font-size:16px;font-weight:900;">' + tot.bc + ' · ' + _fmtMoney(tot.bs) + '</div></div>' +
            '</div>';
            // Insertamos antes de la tabla — busco el lugar usando un marcador.
            html = html.replace(/<div style="background:rgba\(0,0,0,0\.20\);border-radius:10px;overflow:hidden;max-height:55vh;/, totalsHtml + '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;max-height:55vh;');
        }
    }

    // Historial de subidas
    if (uploads.length > 0) {
        html += '<details style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px;">';
        html += '<summary style="cursor:pointer;color:#00d4ff;font-weight:800;font-size:12px;letter-spacing:0.5px;">📜 Historial de subidas (' + uploads.length + ')</summary>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-top:10px;">';
        html += '<thead><tr style="color:#aaa;text-align:left;border-bottom:1px solid rgba(255,255,255,0.10);">';
        html += '<th style="padding:6px 8px;font-weight:700;">Fecha</th>';
        html += '<th style="padding:6px 8px;font-weight:700;">Por</th>';
        html += '<th style="padding:6px 8px;font-weight:700;">Fuente</th>';
        html += '<th style="padding:6px 8px;font-weight:700;text-align:right;">Filas</th>';
        html += '</tr></thead><tbody>';
        for (const up of uploads) {
            const at = up.at ? new Date(up.at).toLocaleString('es-AR') : '—';
            const srcTag = up.source === 'sheets-url' ? '🔗 Sheets URL' : (up.source === 'lightning' ? '⚡ Relámpago' : (up.source === 'file' ? '📄 Archivo' : up.source || '—'));
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.04);">';
            html += '<td style="padding:5px 8px;color:#ddd;">' + at + '</td>';
            html += '<td style="padding:5px 8px;color:#aaa;">' + escapeHtml(up.by || '—') + '</td>';
            html += '<td style="padding:5px 8px;color:#fff;font-weight:600;">' + escapeHtml(srcTag) + (up.sourceDetail ? '<div style="color:#888;font-size:10px;font-weight:400;word-break:break-all;">' + escapeHtml(up.sourceDetail) + '</div>' : '') + '</td>';
            html += '<td style="padding:5px 8px;text-align:right;color:#00d4ff;font-weight:700;">' + (up.rowsCount || 0) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></details>';
    }

    return html;
}

// (reanalyzeSegment fue reemplazado por applySegmentFilters/clearSegmentFilters)

// ============================================
// CAMPAÑAS / LANDINGS (counter de /promo2k y similares)
// ============================================
//
// Lista todas las landings vistas (cada code es una entrada). Por cada
// landing podes tocar "Ver detalle" para ver KPIs y by-day.
async function loadCampaignsAdmin() {
    const c = document.getElementById('campaignsAdminContent');
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">⏳ Cargando…</div>';
    try {
        const r = await authFetch('/api/admin/landings');
        const d = await r.json();
        if (!r.ok) {
            c.innerHTML = '<div style="color:#ff8080;padding:18px;">❌ ' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        const landings = d.landings || [];

        // Siempre mostramos al menos /promo2k aunque no tenga visitas todavia.
        const knownCodes = new Set(landings.map(l => l.code));
        if (!knownCodes.has('promo2k')) {
            landings.unshift({ code: 'promo2k', totalVisits: 0, uniqueIps: 0, last24h: 0, last7d: 0, first: null, last: null });
        }

        // Dominio publico que mostramos en el admin. Hardcodeamos
        // autoreembolsos.com porque es el dominio definitivo para campañas
        // (aunque el server responda en cualquiera, siempre presentamos este
        // al admin para que copie el link tal cual va a salir publicado).
        // El link va al home con ?c=<code> — la promo se ve directamente en
        // la pantalla de login y el tracking se dispara solo.
        const PUBLIC_BASE = 'https://autoreembolsos.com';
        let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
        for (const l of landings) {
            const url = '/?c=' + l.code;
            const isPromo = l.code === 'promo2k';
            html += '<div style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.30);border-radius:10px;padding:14px;">';
            html += '  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">';
            html += '    <div>';
            html += '      <div style="color:#00d4ff;font-size:15px;font-weight:800;">' + (isPromo ? '⚡ ' : '📄 ') + escapeHtml(l.code) + '</div>';
            html += '      <div style="color:#aaa;font-size:11px;margin-top:2px;">URL: <code style="color:#fff;background:rgba(0,0,0,0.30);padding:2px 6px;border-radius:4px;">' + escapeHtml(PUBLIC_BASE) + escapeHtml(url) + '</code></div>';
            html += '    </div>';
            html += '    <div style="display:flex;gap:6px;">';
            html += '      <button type="button" onclick="copyCampaignLink(' + escapeJsArg(url) + ')" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 11px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">📋 Copiar link</button>';
            html += '      <button type="button" onclick="loadCampaignDetail(' + escapeJsArg(l.code) + ')" style="background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:7px 11px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;">📈 Ver detalle</button>';
            html += '    </div>';
            html += '  </div>';
            html += '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;">';
            html += _campaignKpi('Visitas totales', (l.totalVisits || 0).toLocaleString('es-AR'), '#00d4ff');
            html += _campaignKpi('Únicos (IP)', (l.uniqueIps || 0).toLocaleString('es-AR'), '#66ff66');
            html += _campaignKpi('Últimas 24h', (l.last24h || 0).toLocaleString('es-AR'), '#ffeb3b');
            html += _campaignKpi('Últimos 7 días', (l.last7d || 0).toLocaleString('es-AR'), '#ff9800');
            html += '  </div>';
            html += '  <div id="campaignDetail_' + escapeHtml(l.code) + '" style="margin-top:10px;display:none;"></div>';
            html += '</div>';
        }
        html += '</div>';
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div style="color:#ff8080;padding:18px;">Error de conexión</div>';
    }
}

function _campaignKpi(label, value, color) {
    return '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px;text-align:center;">' +
        '<div style="color:' + color + ';font-size:18px;font-weight:900;line-height:1;">' + value + '</div>' +
        '<div style="color:#888;font-size:10px;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">' + label + '</div>' +
    '</div>';
}

// Pinta una "etapa" del funnel (visita -> registro -> install -> reclamo).
// 'arrow' es el separador visual a la izquierda (vacio para la 1ra etapa).
function _funnelStep(label, value, sub, color, arrow) {
    let html = '<div style="display:flex;align-items:stretch;">';
    if (arrow) {
        html += '<div style="display:flex;align-items:center;color:#666;font-size:18px;padding:0 6px;flex-shrink:0;">' + arrow + '</div>';
    }
    html += '<div style="flex:1;background:rgba(0,0,0,0.30);border:1px solid ' + color + '40;border-radius:8px;padding:10px;text-align:center;">';
    html += '<div style="color:' + color + ';font-size:20px;font-weight:900;line-height:1;">' + value + '</div>';
    html += '<div style="color:#fff;font-size:10.5px;margin-top:5px;font-weight:700;">' + label + '</div>';
    html += '<div style="color:#888;font-size:9.5px;margin-top:2px;">' + sub + '</div>';
    html += '</div>';
    html += '</div>';
    return html;
}

async function copyCampaignLink(path) {
    // Mismo dominio publico que muestra la tarjeta. Si en el futuro queremos
    // hacerlo configurable, hay que sacarlo a un Config global.
    const fullUrl = 'https://autoreembolsos.com' + path;
    try {
        await navigator.clipboard.writeText(fullUrl);
        showToast('📋 Link copiado: ' + fullUrl, 'success');
    } catch (e) {
        // Fallback: prompt para que copien manualmente.
        prompt('Copiá el link:', fullUrl);
    }
}

async function loadCampaignDetail(code) {
    const box = document.getElementById('campaignDetail_' + code);
    if (!box) return;
    if (box.style.display === 'block') {
        box.style.display = 'none';
        return;
    }
    box.style.display = 'block';
    box.innerHTML = '<div style="color:#888;padding:14px;text-align:center;">⏳ Cargando detalle…</div>';
    try {
        const r = await authFetch('/api/admin/landings/' + encodeURIComponent(code) + '/stats');
        const d = await r.json();
        if (!r.ok) {
            box.innerHTML = '<div style="color:#ff8080;padding:14px;">❌ ' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        let h = '';

        // ============ FUNNEL: visita -> registro -> install -> reclamo ============
        const fn = d.funnel || { signups: 0, installed: 0, claimed: 0, claimedAmountTotal: 0 };
        const visitsForFunnel = d.uniqueIps || 0; // base = unicos para no inflar con F5s
        const pct = function (num, den) {
            if (!den || den === 0) return '—';
            return Math.round((num / den) * 100) + '%';
        };
        h += '<div style="background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(102,255,102,0.04));border:1px solid rgba(0,212,255,0.30);border-radius:10px;padding:14px;margin-bottom:8px;">';
        h += '<div style="color:#fff;font-weight:800;font-size:13px;margin-bottom:10px;">🎯 Funnel de conversión</div>';
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px;">';
        h += _funnelStep('1. Visitaron', visitsForFunnel.toLocaleString('es-AR'), '(visitantes únicos)', '#00d4ff', '');
        h += _funnelStep('2. Se registraron', (fn.signups || 0).toLocaleString('es-AR'), pct(fn.signups, visitsForFunnel) + ' de visitas', '#4dabff', '→');
        h += _funnelStep('3. Instalaron app', (fn.installed || 0).toLocaleString('es-AR'), pct(fn.installed, fn.signups) + ' de registrados', '#ffeb3b', '→');
        h += _funnelStep('4. Reclamaron bono', (fn.claimed || 0).toLocaleString('es-AR'), pct(fn.claimed, fn.installed) + ' de instalados', '#66ff66', '→');
        h += '</div>';
        if (fn.claimedAmountTotal > 0) {
            h += '<div style="color:#aaa;font-size:11px;text-align:right;border-top:1px dashed rgba(255,255,255,0.10);padding-top:8px;">';
            h += '💰 Plata regalada en bonos: <strong style="color:#66ff66;">$' + (fn.claimedAmountTotal || 0).toLocaleString('es-AR') + '</strong>';
            h += '</div>';
        }
        h += '</div>';

        // ============ Tabla de users atribuidos ============
        if (d.attributed && d.attributed.length > 0) {
            h += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:12px;margin-bottom:8px;">';
            h += '<div style="color:#fff;font-weight:800;font-size:12px;margin-bottom:8px;">👥 Usuarios atribuidos a esta campaña (' + d.attributed.length + ')</div>';
            h += '<div style="max-height:320px;overflow-y:auto;">';
            h += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
            h += '<thead><tr style="color:#888;text-align:left;border-bottom:1px solid rgba(255,255,255,0.10);">';
            h += '<th style="padding:5px 6px;">User</th>';
            h += '<th style="padding:5px 6px;">Se registró</th>';
            h += '<th style="padding:5px 6px;text-align:center;">App</th>';
            h += '<th style="padding:5px 6px;text-align:center;">Bono $</th>';
            h += '<th style="padding:5px 6px;">Reclamó</th>';
            h += '</tr></thead><tbody>';
            for (const u of d.attributed) {
                const signedUp = u.signedUpAt ? new Date(u.signedUpAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
                const claimedAt = u.bonusClaimedAt ? new Date(u.bonusClaimedAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
                h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
                h += '  <td style="padding:5px 6px;color:#fff;font-weight:600;">' + escapeHtml(u.username || '—') + '</td>';
                h += '  <td style="padding:5px 6px;color:#ddd;white-space:nowrap;">' + escapeHtml(signedUp) + '</td>';
                h += '  <td style="padding:5px 6px;text-align:center;">' + (u.installed ? '<span style="color:#66ff66;font-weight:800;">✅</span>' : '<span style="color:#666;">—</span>') + '</td>';
                h += '  <td style="padding:5px 6px;text-align:center;">' + (u.claimedBonus ? '<span style="color:#66ff66;font-weight:800;">$' + (u.bonusAmount || 0).toLocaleString('es-AR') + '</span>' : '<span style="color:#666;">—</span>') + '</td>';
                h += '  <td style="padding:5px 6px;color:#aaa;white-space:nowrap;">' + escapeHtml(claimedAt) + '</td>';
                h += '</tr>';
            }
            h += '</tbody></table>';
            h += '</div>';
            h += '</div>';
        }

        h += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:12px;">';

        // By-day chart simple (barras horizontales)
        h += '<div style="color:#fff;font-weight:800;font-size:12px;margin-bottom:8px;">📅 Visitas por día (últimos 30 días, ARG)</div>';
        if (!d.byDay || d.byDay.length === 0) {
            h += '<div style="color:#888;font-size:11px;padding:8px;">Sin datos todavía.</div>';
        } else {
            const maxVisits = Math.max.apply(null, d.byDay.map(x => x.visits || 0)) || 1;
            for (const day of d.byDay) {
                const pct = Math.max(2, Math.round((day.visits / maxVisits) * 100));
                h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px;">';
                h += '  <div style="width:78px;color:#aaa;flex-shrink:0;">' + escapeHtml(day.day) + '</div>';
                h += '  <div style="flex:1;background:rgba(255,255,255,0.05);border-radius:4px;height:18px;position:relative;">';
                h += '    <div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#00d4ff,#0080ff);border-radius:4px;"></div>';
                h += '  </div>';
                h += '  <div style="width:90px;text-align:right;color:#fff;font-weight:700;flex-shrink:0;">' + day.visits + ' <span style="color:#888;font-size:10px;">(' + day.uniqueIps + ' únicos)</span></div>';
                h += '</div>';
            }
        }
        h += '</div>';

        // Listado COMPLETO de visitas (no truncado). Incluye username (si vino
        // logueado), si tiene la app instalada y por que link entro.
        h += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:12px;margin-top:8px;">';
        const visitCount = (d.recent || []).length;
        h += '<div style="color:#fff;font-weight:800;font-size:12px;margin-bottom:8px;">🕒 Visitas registradas (' + visitCount + ')</div>';
        if (visitCount === 0) {
            h += '<div style="color:#888;font-size:11px;padding:8px;">Sin visitas todavía.</div>';
        } else {
            h += '<div style="max-height:520px;overflow-y:auto;border:1px solid rgba(255,255,255,0.05);border-radius:6px;">';
            h += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
            h += '<thead style="position:sticky;top:0;background:#0a0a1a;z-index:1;">';
            h += '<tr style="color:#888;text-align:left;border-bottom:1px solid rgba(255,255,255,0.15);">';
            h += '<th style="padding:7px 8px;">Cuándo</th>';
            h += '<th style="padding:7px 8px;">Usuario</th>';
            h += '<th style="padding:7px 8px;text-align:center;">App</th>';
            h += '<th style="padding:7px 8px;">Link</th>';
            h += '<th style="padding:7px 8px;">IP-hash</th>';
            h += '<th style="padding:7px 8px;">Referer</th>';
            h += '</tr></thead>';
            h += '<tbody>';
            for (const v of d.recent) {
                const when = v.at ? new Date(v.at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
                let appCell;
                if (v.installed === true) appCell = '<span style="color:#66ff66;font-weight:800;" title="Tiene la app instalada (PWA standalone)">✅</span>';
                else if (v.installed === false) appCell = '<span style="color:#ff8080;font-weight:700;" title="No tiene la app instalada">❌</span>';
                else appCell = '<span style="color:#666;" title="Visita anónima — no podemos saber si despues instalo">—</span>';
                h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
                h += '  <td style="padding:6px 8px;color:#ddd;white-space:nowrap;">' + escapeHtml(when) + '</td>';
                h += '  <td style="padding:6px 8px;color:' + (v.username ? '#66ff66' : '#888') + ';font-weight:' + (v.username ? '700' : '400') + ';">' + escapeHtml(v.username || '(anónimo)') + '</td>';
                h += '  <td style="padding:6px 8px;text-align:center;">' + appCell + '</td>';
                h += '  <td style="padding:6px 8px;"><code style="color:#00d4ff;background:rgba(0,212,255,0.08);padding:2px 6px;border-radius:4px;font-size:10px;">/?c=' + escapeHtml(v.code || code) + '</code></td>';
                h += '  <td style="padding:6px 8px;color:#666;font-family:monospace;font-size:10px;">' + escapeHtml(v.ipHashShort || '—') + '</td>';
                h += '  <td style="padding:6px 8px;color:#aaa;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(v.referer || '—') + '</td>';
                h += '</tr>';
            }
            h += '</tbody></table>';
            h += '</div>';
        }
        h += '</div>';

        box.innerHTML = h;
    } catch (e) {
        box.innerHTML = '<div style="color:#ff8080;padding:14px;">Error de conexión</div>';
    }
}

async function _loadRafflesGeneric(kind, containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">⏳ Cargando dashboard…</div>';
    try {
        const qs = '?kind=' + encodeURIComponent(kind);
        // Manejo granular: si history o spend fallan, igual mostramos lo que hay.
        // El cierre diario es paid-only (free no genera caja), asi que solo lo
        // pedimos cuando kind === 'paid'.
        const calls = [
            authFetch('/api/admin/raffles/dashboard' + qs),
            authFetch('/api/admin/raffles/history' + qs + '&limit=12')
        ];
        if (kind === 'paid') {
            calls.push(authFetch('/api/admin/raffles/spend-daily?days=' + _rafflesSpendDays));
        }
        const results = await Promise.allSettled(calls);
        const dashRes = results[0];
        const histRes = results[1];
        const spendRes = (kind === 'paid') ? results[2] : null;

        // Dashboard es obligatorio.
        if (dashRes.status !== 'fulfilled' || !dashRes.value.ok) {
            const err = dashRes.status === 'fulfilled'
                ? await dashRes.value.json().catch(() => ({error: 'parse error'}))
                : { error: dashRes.reason?.message || 'Error de conexión' };
            c.innerHTML = '<div style="color:#ff8080;padding:20px;">' + (err.error || 'Error cargando dashboard') + '</div>';
            return;
        }
        const dash = await dashRes.value.json();
        // History es opcional — si falla, mostramos vacio.
        let hist = { weeks: [] };
        if (histRes.status === 'fulfilled' && histRes.value.ok) {
            try { hist = await histRes.value.json(); } catch (_) { hist = { weeks: [] }; }
        } else {
            console.warn('history fetch failed, mostrando dashboard sin historial');
        }
        let spend = null;
        if (spendRes && spendRes.status === 'fulfilled' && spendRes.value.ok) {
            try { spend = await spendRes.value.json(); } catch (_) { spend = null; }
        }
        _rafflesAdminCache = dash;
        _rafflesAdminCache.__kind = kind;
        _rafflesHistoryCache = hist.weeks || [];
        _rafflesSpendCache = spend;
        c.innerHTML = _renderRafflesAdmin();
    } catch (e) {
        console.error('_loadRafflesGeneric error:', e);
        c.innerHTML = '<div style="color:#ff8080;">Error de conexión</div>';
    }
}

async function reloadRafflesSpend(days) {
    const d = parseInt(days, 10);
    if (Number.isFinite(d) && d > 0 && d <= 365) _rafflesSpendDays = d;
    try {
        const r = await authFetch('/api/admin/raffles/spend-daily?days=' + _rafflesSpendDays);
        if (!r.ok) {
            alert('No se pudo recargar el cierre diario');
            return;
        }
        _rafflesSpendCache = await r.json();
        const c = document.getElementById('rafflesAdminContent');
        if (c) c.innerHTML = _renderRafflesAdmin();
    } catch (e) {
        console.error('reloadRafflesSpend:', e);
        alert('Error de conexión recargando cierre diario');
    }
}

async function viewRafflesSpendDay(dayKey) {
    if (!dayKey) return;
    try {
        const r = await authFetch('/api/admin/raffles/spend-daily/' + encodeURIComponent(dayKey));
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            alert('Error: ' + (err.error || 'no se pudo cargar el detalle'));
            return;
        }
        const data = await r.json();
        _showRafflesSpendDayModal(data);
    } catch (e) {
        console.error('viewRafflesSpendDay:', e);
        alert('Error de conexión');
    }
}

function _showRafflesSpendDayModal(data) {
    const dayKey = data.dayKey || '—';
    const t = data.totals || {};
    const rows = data.rows || [];
    let html = '';
    html += '<div style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;" onclick="if(event.target===this)this.remove()">';
    html += '  <div style="background:#1a0033;border:2px solid #d4af37;border-radius:14px;max-width:780px;width:100%;margin:8px auto;padding:18px 14px 16px;position:relative;">';
    html += '    <button type="button" onclick="this.closest(\'div[style*=fixed]\').remove()" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;line-height:1;">✕</button>';
    html += '    <h3 style="color:#ffd700;margin:0 0 6px;font-size:16px;">📅 Cierre diario · ' + escapeHtml(dayKey) + '</h3>';
    html += '    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">';
    html += '      <div style="background:rgba(0,0,0,0.30);padding:8px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:1px;">Recaudado</div><div style="color:#d4af37;font-size:16px;font-weight:900;">' + _fmtMoney(t.totalARS) + '</div></div>';
    html += '      <div style="background:rgba(0,0,0,0.30);padding:8px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:1px;">Compras</div><div style="color:#fff;font-size:16px;font-weight:900;">' + (t.buys || 0) + '</div></div>';
    html += '      <div style="background:rgba(0,0,0,0.30);padding:8px;border-radius:8px;"><div style="color:#888;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:1px;">Cupos</div><div style="color:#00d4ff;font-size:16px;font-weight:900;">' + (t.cupos || 0) + '</div></div>';
    html += '    </div>';
    if (rows.length === 0) {
        html += '    <div style="text-align:center;padding:24px;color:#888;">Sin compras este dia.</div>';
    } else {
        html += '    <div style="background:rgba(0,0,0,0.30);border-radius:8px;overflow:hidden;max-height:60vh;overflow-y:auto;">';
        html += '      <table style="width:100%;border-collapse:collapse;font-size:11px;">';
        html += '        <thead style="position:sticky;top:0;background:#2d0052;"><tr>';
        html += '          <th style="text-align:left;padding:8px;color:#d4af37;font-weight:800;">Hora</th>';
        html += '          <th style="text-align:left;padding:8px;color:#d4af37;font-weight:800;">Usuario</th>';
        html += '          <th style="text-align:left;padding:8px;color:#d4af37;font-weight:800;">Sorteo</th>';
        html += '          <th style="text-align:right;padding:8px;color:#d4af37;font-weight:800;">Cupos</th>';
        html += '          <th style="text-align:right;padding:8px;color:#d4af37;font-weight:800;">Monto</th>';
        html += '          <th style="text-align:left;padding:8px;color:#d4af37;font-weight:800;">Tx</th>';
        html += '        </tr></thead><tbody>';
        for (const r of rows) {
            const dt = r.createdAt ? new Date(r.createdAt) : null;
            const hora = dt ? dt.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }) : '—';
            const numStr = (r.ticketNumbers && r.ticketNumbers.length)
                ? '<div style="color:#888;font-size:10px;margin-top:2px;">#' + r.ticketNumbers.slice(0, 12).join(', #') + (r.ticketNumbers.length > 12 ? ' …' : '') + '</div>'
                : '';
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);">';
            html += '  <td style="padding:8px;color:#aaa;white-space:nowrap;">' + hora + '</td>';
            html += '  <td style="padding:8px;color:#fff;font-weight:700;">' + escapeHtml(r.username || '') + '</td>';
            html += '  <td style="padding:8px;color:#ddd;">' + escapeHtml(r.raffleName || r.raffleType || '') + numStr + '</td>';
            html += '  <td style="padding:8px;color:#fff;text-align:right;">' + (r.cuposCount || 0) + '</td>';
            html += '  <td style="padding:8px;color:#d4af37;font-weight:800;text-align:right;white-space:nowrap;">' + _fmtMoney(r.amountARS) + '</td>';
            html += '  <td style="padding:8px;color:#666;font-size:10px;font-family:monospace;">' + escapeHtml(r.jugayganaTxId || '—') + '</td>';
            html += '</tr>';
        }
        html += '      </tbody></table>';
        html += '    </div>';
    }
    html += '  </div>';
    html += '</div>';
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
}

function _renderRafflesSpendSection(spend) {
    if (!spend || !spend.byDay) {
        return '<div style="text-align:center;padding:18px;color:#888;background:rgba(255,255,255,0.03);border-radius:8px;">Cierre diario no disponible (sin datos todavía).</div>';
    }
    const t = spend.totals || {};
    const range = spend.range || {};
    let html = '';

    // Banner totales del rango
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:10px;">';
    html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 10px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Total recaudado</div><div style="color:#d4af37;font-size:16px;font-weight:900;">' + _fmtMoney(t.totalARS) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 10px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Compras</div><div style="color:#fff;font-size:16px;font-weight:900;">' + (t.buys || 0) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 10px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Cupos</div><div style="color:#00d4ff;font-size:16px;font-weight:900;">' + (t.cupos || 0) + '</div></div>';
    html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 10px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Usuarios</div><div style="color:#66ff66;font-size:16px;font-weight:900;">' + (t.uniqueUsers || 0) + '</div></div>';
    html += '</div>';

    // Selector de rango
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;font-size:11px;color:#aaa;">';
    html += '  <span>Rango:</span>';
    for (const d of [7, 14, 30, 60, 90]) {
        const active = (range.days === d);
        html += '  <button type="button" onclick="reloadRafflesSpend(' + d + ')" style="background:' + (active ? '#d4af37' : 'rgba(255,255,255,0.06)') + ';color:' + (active ? '#000' : '#fff') + ';border:1px solid rgba(212,175,55,0.40);padding:4px 9px;border-radius:5px;font-weight:' + (active ? '900' : '700') + ';font-size:11px;cursor:pointer;">' + d + ' días</button>';
    }
    html += '  <span style="color:#666;margin-left:6px;">' + escapeHtml(range.from || '') + ' → ' + escapeHtml(range.to || '') + '</span>';
    html += '</div>';

    // Tabla por día (descendente, dia mas reciente arriba)
    const byDay = spend.byDay || [];
    if (byDay.length === 0) {
        html += '<div style="text-align:center;padding:18px;color:#888;background:rgba(255,255,255,0.03);border-radius:8px;">Sin compras en el rango seleccionado.</div>';
    } else {
        // Calcular el max para la barra de progreso visual.
        const maxARS = byDay.reduce((m, r) => Math.max(m, r.totalARS || 0), 0);
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;overflow:hidden;max-height:420px;overflow-y:auto;">';
        html += '  <table style="width:100%;border-collapse:collapse;font-size:11px;">';
        html += '    <thead style="position:sticky;top:0;background:#2d0052;"><tr>';
        html += '      <th style="text-align:left;padding:8px;color:#d4af37;font-weight:800;">Día</th>';
        html += '      <th style="text-align:right;padding:8px;color:#d4af37;font-weight:800;">Recaudado</th>';
        html += '      <th style="text-align:right;padding:8px;color:#d4af37;font-weight:800;">Compras</th>';
        html += '      <th style="text-align:right;padding:8px;color:#d4af37;font-weight:800;">Cupos</th>';
        html += '      <th style="text-align:right;padding:8px;color:#d4af37;font-weight:800;">Usuarios</th>';
        html += '      <th style="text-align:left;padding:8px;color:#d4af37;font-weight:800;width:30%;"></th>';
        html += '      <th style="text-align:center;padding:8px;color:#d4af37;font-weight:800;"></th>';
        html += '    </tr></thead><tbody>';
        for (const r of byDay) {
            const isToday = (r.dayKey === byDay[0].dayKey); // primer fila = hoy
            const pct = maxARS > 0 ? Math.round(((r.totalARS || 0) / maxARS) * 100) : 0;
            const dayLabel = (() => {
                try {
                    const d = new Date(r.dayKey + 'T00:00:00-03:00');
                    return d.toLocaleDateString('es-AR', { weekday:'short', day:'2-digit', month:'2-digit' });
                } catch (_) { return r.dayKey; }
            })();
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);' + (isToday ? 'background:rgba(212,175,55,0.06);' : '') + '">';
            html += '  <td style="padding:8px;color:#fff;font-weight:700;white-space:nowrap;">' + escapeHtml(r.dayKey) + ' <span style="color:#888;font-weight:400;">· ' + escapeHtml(dayLabel) + '</span></td>';
            html += '  <td style="padding:8px;text-align:right;color:#d4af37;font-weight:800;white-space:nowrap;">' + _fmtMoney(r.totalARS) + '</td>';
            html += '  <td style="padding:8px;text-align:right;color:#fff;">' + (r.buys || 0) + '</td>';
            html += '  <td style="padding:8px;text-align:right;color:#00d4ff;">' + (r.cupos || 0) + '</td>';
            html += '  <td style="padding:8px;text-align:right;color:#66ff66;">' + (r.uniqueUsers || 0) + '</td>';
            html += '  <td style="padding:8px;"><div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#d4af37,#ffd700);"></div></div></td>';
            html += '  <td style="padding:6px;text-align:center;">' + ((r.buys || 0) > 0 ? '<button type="button" onclick="viewRafflesSpendDay(' + JSON.stringify(r.dayKey) + ')" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:4px 8px;border-radius:5px;font-weight:700;font-size:10px;cursor:pointer;">Ver</button>' : '') + '</td>';
            html += '</tr>';
        }
        html += '    </tbody></table>';
        html += '</div>';
    }

    // Desglose por tipo
    if (spend.byType && spend.byType.length > 0) {
        html += '<div style="margin-top:10px;font-size:11px;color:#aaa;">';
        html += '<div style="font-weight:800;color:#d4af37;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Desglose por sorteo</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;">';
        for (const t of spend.byType) {
            html += '  <div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:8px 10px;">';
            html += '    <div style="color:#fff;font-weight:700;font-size:12px;">' + escapeHtml(t.raffleType) + '</div>';
            html += '    <div style="color:#d4af37;font-weight:800;font-size:13px;">' + _fmtMoney(t.totalARS) + '</div>';
            html += '    <div style="color:#888;font-size:10px;">' + (t.cupos || 0) + ' cupos · ' + (t.buys || 0) + ' compras</div>';
            html += '  </div>';
        }
        html += '</div></div>';
    }

    return html;
}

function _fmtMoney(n) { return '$' + (Number(n) || 0).toLocaleString('es-AR'); }
function _fmtPct(n, d) {
    if (!d) return '0%';
    return Math.round((n / d) * 100) + '%';
}

function _renderRafflesAdmin() {
    const dash = _rafflesAdminCache || { kpis: {}, byType: [], topBuyers: [], raffles: [] };
    const isFree = dash.__kind === 'free';
    const isLightning = dash.__kind === 'relampago';
    const k = dash.kpis || {};
    const drawDateStr = dash.drawDate ? new Date(dash.drawDate).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const accentColor = isLightning ? '#ffeb3b' : (isFree ? '#4dabff' : '#d4af37');
    const accentRGBA = isLightning ? '255,235,59' : (isFree ? '77,171,255' : '212,175,55');
    const titleEmoji = isLightning ? '⚡' : (isFree ? '🎁' : '💰');
    const titleText = isLightning ? 'Sorteos RELÁMPAGO' : (isFree ? 'Sorteos GRATIS' : 'Sorteos PAGOS');
    let html = '';

    // ===== Banner / KPIs =====
    html += '<div style="background:linear-gradient(135deg,#1a0033,#2d0052);border:1px solid rgba(' + accentRGBA + ',0.40);border-radius:12px;padding:14px;margin-bottom:14px;">';
    html += '  <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:10px;">';
    html += '    <div>';
    html += '      <div style="color:' + accentColor + ';font-size:11px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;">📊 ' + titleEmoji + ' ' + titleText + ' · semana ' + escapeHtml(dash.weekKey || '—') + '</div>';
    html += '      <div style="color:#aaa;font-size:11px;margin-top:2px;">Sorteo programado: <strong style="color:#fff;">' + drawDateStr + '</strong> · Lotería Nocturna 1° premio</div>';
    html += '    </div>';
    html += '    <div style="display:flex;gap:6px;flex-wrap:wrap;">';
    // POLITICA: sorteos pagos deshabilitados. Solo dejamos los botones que
    // no crean nuevas instancias (anunciar, sorteos viejos). "Force seed" y
    // "Sorteo prueba" quedan ocultos en pagos para evitar spawnear.
    if (!isFree && !isLightning) {
        html += '      <button type="button" disabled style="background:rgba(255,255,255,0.04);color:#666;border:1px solid rgba(255,255,255,0.10);padding:7px 11px;border-radius:6px;font-weight:700;font-size:11px;cursor:not-allowed;" title="Sorteos pagos deshabilitados por política — los activos se mantienen hasta sortearse">🚫 Force seed (off)</button>';
        html += '      <button type="button" onclick="announceRafflePicker()" style="background:rgba(102,255,102,0.10);color:#66ff66;border:1px solid rgba(102,255,102,0.40);padding:7px 11px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer;" title="Mandar push avisando de un sorteo activo (elegís sorteo + equipos + texto)">📣 Anunciar sorteo</button>';
        html += '      <button type="button" onclick="viewLegacyRaffles()" style="background:rgba(255,170,102,0.10);color:#ffaa66;border:1px solid rgba(255,170,102,0.40);padding:7px 11px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer;" title="Ver y purgar sorteos del modelo viejo">🗑️ Sorteos viejos</button>';
    }
    // Crear sorteo relampago: SOLO en la seccion de relampago.
    if (isLightning) {
        html += '      <button type="button" onclick="seedLightningRaffle()" style="background:linear-gradient(135deg,rgba(0,212,255,0.18),rgba(255,235,59,0.18));color:#fff7c2;border:1px solid #ffeb3b;padding:7px 11px;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;" title="Crear un sorteo RELÁMPAGO (premio configurable, hasta 3 simultáneos por auto-respawn)">⚡ Crear sorteo relámpago</button>';
        html += '      <button type="button" onclick="viewLightningROI()" style="background:rgba(102,255,102,0.10);color:#66ff66;border:1px solid rgba(102,255,102,0.40);padding:7px 11px;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;" title="ROI: cuánto cargaron los participantes después del relámpago vs. premio entregado">📊 ROI relámpago</button>';
        html += '      <button type="button" onclick="announceRafflePicker()" style="background:rgba(102,255,102,0.10);color:#66ff66;border:1px solid rgba(102,255,102,0.40);padding:7px 11px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer;" title="Mandar push avisando del sorteo activo">📣 Anunciar</button>';
    }
    if ((k.rafflesFilled || 0) + (dash.raffles||[]).filter(r=>r.status==='drawn').length > 0) {
        html += '      <button type="button" onclick="cleanupRaffles()" style="background:rgba(102,255,102,0.15);color:#66ff66;border:1px solid #66ff66;padding:7px 11px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer;">🧹 Archivar drawn</button>';
    }
    html += '    </div>';
    html += '  </div>';

    if (!isFree && !isLightning) {
        html += '  <div style="background:rgba(255,170,0,0.08);border:1px solid rgba(255,170,0,0.40);border-radius:8px;padding:10px 12px;margin-top:10px;font-size:11.5px;color:#ffcc66;line-height:1.5;">⚠️ <strong style="color:#ffaa00;">Sorteos pagos deshabilitados.</strong> Los activos siguen corriendo hasta sortearse normal. Cuando se llenan ya no se crean nuevos. La próxima semana arrancamos sorteos GRATIS por <strong>netwin</strong>.</div>';
    }

    // KPI grid (free no recauda — mostramos costo de premios + personas)
    const kpis = isFree ? [
        { label: 'Cupos asignados', val: (k.totalCuposSold || 0) + ' / ' + (k.totalCupos || 0), sub: _fmtPct(k.totalCuposSold, k.totalCupos), color: '#fff' },
        { label: 'Personas anotadas', val: String(k.uniqueBuyers || 0), color: '#4dabff' },
        { label: 'Sorteos llenos',  val: (k.rafflesFilled || 0) + ' / ' + (k.rafflesCount || 0), color: '#ffaa66' },
        { label: 'Premios pagados', val: _fmtMoney(k.prizesPaid),      color: '#66ff66' },
        { label: 'Premios pendientes', val: _fmtMoney(k.prizesPending), color: '#ff8080' },
        { label: 'Costo total premios', val: _fmtMoney((k.prizesPaid||0) + (k.prizesPending||0)), color: '#ffd700' }
    ] : [
        { label: 'Recaudación',     val: _fmtMoney(k.totalRevenue),    color: '#d4af37' },
        { label: 'Cupos vendidos',  val: (k.totalCuposSold || 0) + ' / ' + (k.totalCupos || 0), sub: _fmtPct(k.totalCuposSold, k.totalCupos), color: '#fff' },
        { label: 'Personas',        val: String(k.uniqueBuyers || 0),  color: '#00d4ff' },
        { label: 'Sorteos llenos',  val: (k.rafflesFilled || 0) + ' / ' + (k.rafflesCount || 0), color: '#ffaa66' },
        { label: 'Premios pagados', val: _fmtMoney(k.prizesPaid),      color: '#66ff66' },
        { label: 'Premios pendientes', val: _fmtMoney(k.prizesPending), color: '#ff8080' },
        { label: 'Ganancia neta',   val: _fmtMoney(k.netProfit),       color: (k.netProfit >= 0 ? '#66ff66' : '#ff8080') }
    ];
    html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">';
    for (const x of kpis) {
        html += '    <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 10px;">';
        html += '      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">' + x.label + '</div>';
        html += '      <div style="color:' + x.color + ';font-size:15px;font-weight:900;margin-top:3px;">' + x.val + '</div>';
        if (x.sub) html += '      <div style="color:#666;font-size:10px;margin-top:1px;">' + x.sub + '</div>';
        html += '    </div>';
    }
    html += '  </div>';
    html += '</div>';

    // ===== Stats por tipo =====
    if (dash.byType && dash.byType.length > 0) {
        html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:12px;margin-bottom:14px;">';
        html += '  <h3 style="color:#d4af37;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">📈 Por tipo · esta semana</h3>';
        html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">';
        for (const t of dash.byType) {
            const fillPct = t.instances ? Math.round((t.cuposSold / (t.instances * t.totalTickets)) * 100) : 0;
            html += '    <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;">';
            html += '      <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:6px;">' + t.emoji + ' ' + escapeHtml(t.label) + '</div>';
            html += '      <div style="font-size:11px;color:#aaa;line-height:1.6;">';
            html += '        <div>Instancias: <strong style="color:#fff;">' + t.instances + '</strong> (' + t.active + ' act · ' + t.filled + ' llenas · ' + t.drawn + ' sort.)</div>';
            html += '        <div>Cupos: <strong style="color:#fff;">' + t.cuposSold + '</strong> · <strong style="color:#d4af37;">' + _fmtMoney(t.revenue) + '</strong></div>';
            html += '        <div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;margin-top:6px;overflow:hidden;"><div style="height:100%;width:' + fillPct + '%;background:linear-gradient(90deg,#d4af37,#ffd700);"></div></div>';
            html += '      </div>';
            html += '    </div>';
        }
        html += '  </div>';
        html += '</div>';
    }

    // ===== Sorteos activos esta semana =====
    html += '<div style="margin-bottom:14px;">';
    html += '  <h3 style="color:#d4af37;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">🎫 Sorteos de la semana</h3>';
    if (!dash.raffles || dash.raffles.length === 0) {
        if (isLightning) {
            html += '  <div style="text-align:center;padding:30px;color:#888;background:rgba(255,255,255,0.03);border-radius:8px;">No hay sorteo RELÁMPAGO activo.<br>Tocá <strong style="color:#ffeb3b;">⚡ Crear sorteo relámpago</strong> arriba para abrir uno.</div>';
        } else {
            html += '  <div style="text-align:center;padding:30px;color:#888;background:rgba(255,255,255,0.03);border-radius:8px;">No hay sorteos activos. Tocá <strong>🌱 Force seed</strong>.</div>';
        }
    } else {
        html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px;">';
        for (const r of dash.raffles) html += _renderRaffleAdminCard(r);
        html += '  </div>';
    }
    html += '</div>';

    // ===== Top compradores (solo paid; en free no compran, se anotan) =====
    if (!isFree && dash.topBuyers && dash.topBuyers.length > 0) {
        html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:12px;margin-bottom:14px;">';
        html += '  <h3 style="color:#d4af37;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">🏅 Top compradores · esta semana</h3>';
        html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">';
        let idx = 1;
        for (const b of dash.topBuyers) {
            html += '    <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.30);border-radius:6px;padding:8px 10px;font-size:11px;gap:6px;">';
            html += '      <div style="display:flex;gap:8px;align-items:center;min-width:0;flex:1;">';
            html += '        <span style="color:' + (idx === 1 ? '#ffd700' : (idx === 2 ? '#c0c0c0' : (idx === 3 ? '#cd7f32' : '#666'))) + ';font-weight:900;font-size:13px;">#' + idx + '</span>';
            html += '        <span style="color:#fff;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(b.username) + '</span>';
            html += '      </div>';
            html += '      <div style="text-align:right;flex-shrink:0;"><div style="color:#d4af37;font-weight:800;">' + _fmtMoney(b.totalPaid) + '</div><div style="color:#888;font-size:10px;">' + b.cuposCount + ' cupos</div></div>';
            html += '    </div>';
            idx++;
        }
        html += '  </div>';
        html += '</div>';
    }

    // ===== Cierre diario (solo paid) =====
    if (!isFree) {
        html += '<div style="background:rgba(212,175,55,0.04);border:1px solid rgba(212,175,55,0.30);border-radius:10px;padding:12px;margin-bottom:14px;">';
        html += '  <h3 style="color:#d4af37;font-size:13px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">💵 Cierre diario · gasto en sorteos pagos</h3>';
        html += '  <div style="color:#aaa;font-size:11px;margin-bottom:10px;line-height:1.5;">Suma diaria de lo que la gente gastó comprando números (descontado de su saldo en JUGAYGANA). Es el dato para cuadrar el cierre contable contra la diferencia de la plataforma.</div>';
        html += _renderRafflesSpendSection(_rafflesSpendCache);
        html += '</div>';
    }

    // ===== Historial semanal =====
    html += '<div style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.25);border-radius:10px;padding:12px;">';
    html += '  <h3 style="color:#00d4ff;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">📅 Historial semana a semana</h3>';
    html += _renderHistoryWeeks(_rafflesHistoryCache || []);
    html += '</div>';

    return html;
}

function _renderRaffleAdminCard(r) {
    const sold = r.cuposSold || 0;
    const total = r.totalTickets || 0;
    const fillPct = total ? Math.round((sold / total) * 100) : 0;
    // Status label dinamico para 'drawn': diferenciamos completado vs
    // pendiente vs forfeit. Asi de un vistazo el admin ve cual sorteo ya
    // termino del todo y cual esta esperando algo.
    let statusLabel;
    if (r.status === 'drawn') {
        if (r.prizeForfeitedAt) {
            statusLabel = { txt: '❌ Sorteado · ganador NO calificó', color: '#ff8080' };
        } else if (r.prizeClaimedAt) {
            statusLabel = { txt: '✅ Completado · premio acreditado', color: '#66ff66' };
        } else if (r.prizeClaimable) {
            statusLabel = { txt: '🎁 Sorteado · esperando reclamo', color: '#ffaa66' };
        } else {
            statusLabel = { txt: '✅ Completado', color: '#66ff66' };
        }
    } else {
        statusLabel = {
            active:   { txt: 'Activo · vendiendo',    color: '#66ff66' },
            closed:   { txt: 'Cupo lleno · esperando sorteo', color: '#ffaa66' },
            archived: { txt: 'Archivado',             color: '#777' },
            cancelled:{ txt: 'Cancelado',             color: '#ff6666' }
        }[r.status] || { txt: r.status, color: '#aaa' };
    }
    const drawDate = r.drawDate ? new Date(r.drawDate).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';

    let html = '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;">';
    html += '  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">';
    html += '    <div style="font-weight:800;color:#fff;font-size:13px;">' + (r.emoji||'🎁') + ' ' + escapeHtml(r.name || '') + '</div>';
    html += '    <div style="font-size:10px;font-weight:700;color:' + statusLabel.color + ';white-space:nowrap;">' + statusLabel.txt + '</div>';
    html += '  </div>';
    html += '  <div style="height:6px;background:rgba(0,0,0,0.30);border-radius:3px;overflow:hidden;">';
    html += '    <div style="height:100%;width:' + fillPct + '%;background:linear-gradient(90deg,#d4af37,#ffd700);"></div>';
    html += '  </div>';
    html += '  <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;">';
    html += '    <span>' + sold + '/' + total + ' (' + fillPct + '%)</span>';
    html += '    <span>' + _fmtMoney(r.revenue) + '</span>';
    html += '  </div>';
    html += '  <div style="font-size:10px;color:#888;line-height:1.4;">📅 ' + drawDate + ' · ' + (r.participants||0) + ' personas · Premio ' + _fmtMoney(r.prizeValueARS) + '</div>';

    // Badge de audiencia: solo si el sorteo tiene restriccion (mode != all).
    // Util para que el admin vea de un vistazo a quien le llega.
    const audMode = r.audienceMode || 'all';
    if (audMode !== 'all') {
        let audTxt = '', audColor = '#aaa';
        if (audMode === 'user') {
            audTxt = '🧪 TEST · ' + (r.audienceUsernames || []).join(', ');
            audColor = '#ffeb3b';
        } else if (audMode === 'except') {
            audTxt = '🚫 Excepto: ' + (r.audienceTeams || []).join(', ');
            audColor = '#ff8080';
        } else if (audMode === 'only') {
            audTxt = '🎯 Solo: ' + (r.audienceTeams || []).join(', ');
            audColor = '#66ff66';
        }
        html += '  <div style="font-size:10px;color:' + audColor + ';background:rgba(255,255,255,0.04);border:1px solid ' + audColor + '40;border-radius:5px;padding:4px 7px;line-height:1.3;">' + escapeHtml(audTxt) + '</div>';
    }

    if (r.status === 'drawn') {
        const claimStatus = r.prizeForfeitedAt
            ? '<span style="color:#ff8080;">❌ Forfeit · ganador no calificaba (' + escapeHtml(r.prizeForfeitedReason || '') + ')</span>'
            : (r.prizeClaimedAt
                ? '<span style="color:#66ff66;">✅ Premio acreditado ' + new Date(r.prizeClaimedAt).toLocaleString('es-AR') + '</span>'
                : (r.prizeClaimable
                    ? '<span style="color:#ffaa66;">⏳ Esperando que el ganador reclame</span>'
                    : '<span style="color:#aaa;">Premio sin acreditar</span>'));
        html += '  <div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:6px;padding:8px;font-size:11px;line-height:1.5;color:#ddd;">';
        html += '    🏆 <strong>' + escapeHtml(r.winnerUsername || '—') + '</strong> con número <strong>#' + r.winningTicketNumber + '</strong>';
        if (r.lotteryDrawNumber && r.lotteryDrawNumber !== r.winningTicketNumber) {
            html += ' (Lotería sacó ' + r.lotteryDrawNumber + ', mapeado)';
        }
        html += '<br>' + claimStatus + '</div>';
    }

    html += '  <div style="display:flex;gap:6px;flex-wrap:wrap;">';
    html += '    <button type="button" onclick="viewRaffleParticipants(' + escapeJsArg(r.id) + ')" style="flex:1;min-width:90px;padding:7px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">📋 Detalle</button>';
    if (r.status === 'closed' || r.status === 'active') {
        html += '    <button type="button" onclick="drawRaffle(' + escapeJsArg(r.id) + ')" style="flex:1;min-width:90px;padding:7px;background:linear-gradient(135deg,#d4af37,#f7931e);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;">🎰 Sortear</button>';
        // Free no tiene reembolso (nadie pago), asi que el label dice "Eliminar".
        // Paid mantiene "Cancelar y reembolsar" para dejar claro que se devuelve la plata.
        const cancelLabel = r.isFree ? '🗑️ Eliminar' : '✖';
        const cancelTitle = r.isFree ? 'Eliminar sorteo gratis (saca a todos los anotados, no hay plata que devolver)' : 'Cancelar y reembolsar';
        html += '    <button type="button" onclick="cancelRaffle(' + escapeJsArg(r.id) + ')" style="padding:7px 9px;background:rgba(255,107,107,0.10);color:#ff6b6b;border:1px solid rgba(255,107,107,0.40);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;" title="' + escapeHtml(cancelTitle) + '">' + cancelLabel + '</button>';
    }
    // Borrado definitivo: aparece si esta drawn/cancelled/archived. Si hay
    // participantes, el flujo pasa a "force delete" con doble confirmacion
    // (perdes el historial). Util para limpiar sorteos de prueba donde
    // jugaste vos mismo o tu test user.
    if (r.status === 'drawn' || r.status === 'cancelled' || r.status === 'archived') {
        const hasParts = (r.participants || 0) > 0;
        const partsLabel = hasParts ? ' (' + r.participants + ')' : '';
        const btnTitle = hasParts
            ? 'Borrar definitivamente — vas a perder el historial de los ' + r.participants + ' participantes'
            : 'Borrar definitivamente (no hay participantes, no se pierde nada)';
        html += '    <button type="button" onclick="deleteRaffleHard(' + escapeJsArg(r.id) + ')" style="padding:7px 9px;background:rgba(255,107,107,0.15);color:#ff6b6b;border:1px solid #ff6b6b;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;" title="' + escapeHtml(btnTitle) + '">🗑️ Borrar' + partsLabel + '</button>';
    }
    html += '  </div>';
    html += '</div>';
    return html;
}

function _renderHistoryWeeks(weeks) {
    if (!weeks || weeks.length === 0) {
        return '<div style="color:#888;text-align:center;padding:14px;font-size:12px;">Aún no hay historial. Aparecerá acá apenas se sortee la primera semana.</div>';
    }
    let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
    for (const w of weeks) {
        const drawDate = w.drawDate ? new Date(w.drawDate).toLocaleDateString('es-AR') : '—';
        const fillPct = w.totalCupos ? Math.round((w.totalCuposSold / w.totalCupos) * 100) : 0;
        const detailOpen = !!_rafflesHistoryDetailCache[w.weekKey];
        html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(0,212,255,0.20);border-radius:8px;padding:10px;">';
        html += '  <div onclick="toggleHistoryDetail(' + escapeJsArg(w.weekKey) + ')" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;flex-wrap:wrap;gap:6px;">';
        html += '    <div style="flex:1;min-width:200px;">';
        html += '      <div style="color:#00d4ff;font-size:13px;font-weight:800;">' + escapeHtml(w.weekKey) + ' · ' + drawDate + '</div>';
        html += '      <div style="color:#aaa;font-size:11px;margin-top:2px;">' + w.totalRaffles + ' sorteos · ' + w.uniqueBuyers + ' personas · ' + w.totalCuposSold + ' cupos (' + fillPct + '%)</div>';
        html += '    </div>';
        html += '    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">';
        html += '      <div style="text-align:right;">';
        html += '        <div style="color:#d4af37;font-size:13px;font-weight:800;">' + _fmtMoney(w.totalRevenue) + '</div>';
        html += '        <div style="color:#888;font-size:10px;">recaudado</div>';
        html += '      </div>';
        html += '      <div style="text-align:right;">';
        const netColor = w.netProfit >= 0 ? '#66ff66' : '#ff8080';
        html += '        <div style="color:' + netColor + ';font-size:13px;font-weight:800;">' + _fmtMoney(w.netProfit) + '</div>';
        html += '        <div style="color:#888;font-size:10px;">neto</div>';
        html += '      </div>';
        html += '      <span style="color:#666;font-size:14px;">' + (detailOpen ? '▼' : '▶') + '</span>';
        html += '    </div>';
        html += '  </div>';
        if (detailOpen) {
            html += '  <div id="historyDetail_' + w.weekKey.replace(/[^a-zA-Z0-9]/g, '_') + '" style="margin-top:10px;border-top:1px solid rgba(0,212,255,0.15);padding-top:10px;">';
            html += _renderHistoryDetail(w.weekKey);
            html += '  </div>';
        }
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function _renderHistoryDetail(weekKey) {
    const data = _rafflesHistoryDetailCache[weekKey];
    if (!data) return '<div style="color:#888;font-size:11px;">⏳ Cargando…</div>';
    const raffles = data.raffles || [];
    if (raffles.length === 0) return '<div style="color:#888;font-size:11px;">Sin sorteos en esta semana.</div>';
    let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<thead><tr style="color:#aaa;text-align:left;border-bottom:1px solid rgba(255,255,255,0.10);">';
    html += '<th style="padding:5px 6px;">Sorteo</th>';
    html += '<th style="padding:5px 6px;">Cupos</th>';
    html += '<th style="padding:5px 6px;">Recaudado</th>';
    html += '<th style="padding:5px 6px;">Premio</th>';
    html += '<th style="padding:5px 6px;">Estado</th>';
    html += '<th style="padding:5px 6px;">Ganador</th>';
    html += '</tr></thead><tbody>';
    for (const r of raffles) {
        const claim = r.prizeClaimedAt ? '✅ Reclamado' : (r.status === 'drawn' ? '⏳ Pendiente' : '—');
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:5px 6px;color:#fff;">' + (r.emoji||'') + ' ' + escapeHtml(r.name||'') + '</td>';
        html += '<td style="padding:5px 6px;color:#ddd;">' + (r.cuposSold||0) + '/' + (r.totalTickets||0) + '</td>';
        html += '<td style="padding:5px 6px;color:#d4af37;">' + _fmtMoney(r.revenue) + '</td>';
        html += '<td style="padding:5px 6px;color:#aaa;">' + _fmtMoney(r.prizeValueARS) + '</td>';
        html += '<td style="padding:5px 6px;color:#888;font-size:10px;">' + escapeHtml(r.status||'') + (r.status==='drawn' ? '<br>' + claim : '') + '</td>';
        const winnerCell = r.winnerUsername
            ? '<strong style="color:#fff;">' + escapeHtml(r.winnerUsername) + '</strong> · #' + r.winningTicketNumber
            : '—';
        html += '<td style="padding:5px 6px;color:#aaa;">' + winnerCell + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

async function toggleHistoryDetail(weekKey) {
    const isOpen = !!_rafflesHistoryDetailCache[weekKey];
    if (isOpen) {
        delete _rafflesHistoryDetailCache[weekKey];
        const c = document.getElementById('rafflesAdminContent');
        if (c) c.innerHTML = _renderRafflesAdmin();
        return;
    }
    // Token unico por apertura: si el user cierra y reabre antes que la
    // request anterior responda, el callback antiguo no debe pisar la cache.
    const token = Date.now() + ':' + Math.random();
    _rafflesHistoryDetailCache[weekKey] = { loading: true, raffles: [], _token: token };
    const c = document.getElementById('rafflesAdminContent');
    if (c) c.innerHTML = _renderRafflesAdmin();
    try {
        const r = await authFetch('/api/admin/raffles/history/' + encodeURIComponent(weekKey));
        const d = await r.json();
        // Si en este momento la entrada ya no existe (user cerro) o tiene
        // otro token (user cerro+reabrio), descartamos esta respuesta.
        const cur = _rafflesHistoryDetailCache[weekKey];
        if (!cur || cur._token !== token) return;
        if (!r.ok) { _rafflesHistoryDetailCache[weekKey] = { raffles: [], error: d.error, _token: token }; }
        else { _rafflesHistoryDetailCache[weekKey] = Object.assign({}, d, { _token: token }); }
    } catch (e) {
        const cur = _rafflesHistoryDetailCache[weekKey];
        if (!cur || cur._token !== token) return;
        _rafflesHistoryDetailCache[weekKey] = { raffles: [], error: 'Error de conexión', _token: token };
    }
    if (c) c.innerHTML = _renderRafflesAdmin();
}

async function viewRaffleParticipants(id, cutoffISO, sourceMode, extra) {
    let modal = document.getElementById('raffleDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'raffleDetailModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:30000;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto;';
        modal.onclick = function (e) { if (e.target === modal) closeRaffleDetailModal(); };
        modal.innerHTML = '<div style="background:linear-gradient(135deg,#1a0033,#2d0052);border:2px solid #d4af37;border-radius:12px;max-width:760px;width:100%;margin:8px auto;padding:18px 16px;position:relative;"><button onclick="closeRaffleDetailModal()" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">✕</button><div id="raffleDetailBody"><div style="text-align:center;padding:40px;color:#888;">⏳ Cargando…</div></div></div>';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    const usingMaster = sourceMode === 'master';
    const loaderTxt = cutoffISO
        ? (usingMaster
            ? '⏳ Leyendo archivo Maestro…'
            : '⏳ Analizando cargas en JUGAYGANA hasta ' + new Date(cutoffISO).toLocaleString('es-AR') + '… (puede tardar varios segundos por persona)')
        : '⏳ Cargando…';
    document.getElementById('raffleDetailBody').innerHTML = '<div style="text-align:center;padding:40px;color:#888;">' + loaderTxt + '</div>';
    try {
        const params = new URLSearchParams();
        if (cutoffISO) params.set('cutoff', cutoffISO);
        if (sourceMode) params.set('source', sourceMode);
        if (extra && extra.from) params.set('from', extra.from);
        if (extra && extra.to) params.set('to', extra.to);
        const qs = params.toString();
        const url = '/api/admin/raffles/' + id + '/participants' + (qs ? '?' + qs : '');
        const r = await authFetch(url);
        const d = await r.json();
        if (!r.ok) { document.getElementById('raffleDetailBody').innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">' + escapeHtml(d.error || 'Error') + '</div>'; return; }
        document.getElementById('raffleDetailBody').innerHTML = _renderRaffleDetail(d);
    } catch (e) { document.getElementById('raffleDetailBody').innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">Error de conexión</div>'; }
}

// Devuelve el proximo lunes 21:00 ARG en ISO. Lo usamos como default del
// date picker en el modal de detalle del relampago — el user generalmente
// quiere simular "si fuera el lunes (sorteo Loteria Nacional Nocturna)".
function _nextMondayDrawISO() {
    const now = new Date();
    const argOffset = -3 * 60; // ARG es UTC-3
    const localOffset = now.getTimezoneOffset();
    const diffMin = argOffset - localOffset;
    const argNow = new Date(now.getTime() + diffMin * 60 * 1000);
    let daysToMon = (1 - argNow.getDay() + 7) % 7;
    if (daysToMon === 0 && argNow.getHours() >= 21) daysToMon = 7;
    const target = new Date(argNow);
    target.setDate(argNow.getDate() + daysToMon);
    target.setHours(21, 0, 0, 0);
    // De ARG-zoned a UTC real
    return new Date(target.getTime() - diffMin * 60 * 1000).toISOString();
}

// Convierte un ISO string a el formato YYYY-MM-DDTHH:MM que requiere
// <input type="datetime-local"> (sin zona, hora local del browser).
function _isoToDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Disparado por el boton "Analizar" en el modal de detalle del relampago.
// Lee la fecha del datetime input y refetch con cutoff.
function reanalyzeLightningParticipants(raffleId) {
    const inp = document.getElementById('lightningCutoffInput');
    if (!inp || !inp.value) {
        alert('Elegí una fecha y hora antes de analizar.');
        return;
    }
    const d = new Date(inp.value);
    if (isNaN(d.getTime())) {
        alert('Fecha inválida.');
        return;
    }
    const srcSel = document.getElementById('lightningSourceMode');
    const source = srcSel ? srcSel.value : 'daily';
    let extra = {};
    if (source === 'master' || source === 'daily') {
        const fromInp = document.getElementById('lightningMasterFrom');
        const toInp = document.getElementById('lightningMasterTo');
        if (fromInp && fromInp.value) {
            const fd = new Date(fromInp.value);
            if (!isNaN(fd.getTime())) extra.from = fd.toISOString();
        }
        if (toInp && toInp.value) {
            const td = new Date(toInp.value);
            if (!isNaN(td.getTime())) extra.to = td.toISOString();
        }
    }
    viewRaffleParticipants(raffleId, d.toISOString(), source, extra);
}

// Sube un CSV ad-hoc al endpoint /analyze-csv del relampago. Lee fechas
// Desde/Hasta del modal (si estan vacias el server usa createdAt..drawnAt).
// Re-renderiza el modal con la respuesta del server.
async function analyzeLightningWithCsv(raffleId, file) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
        alert('El archivo supera 100 MB.');
        return;
    }
    const fromInp = document.getElementById('lightningMasterFrom');
    const toInp = document.getElementById('lightningMasterTo');
    const params = new URLSearchParams();
    if (fromInp && fromInp.value) {
        const fd = new Date(fromInp.value);
        if (!isNaN(fd.getTime())) params.set('from', fd.toISOString());
    }
    if (toInp && toInp.value) {
        const td = new Date(toInp.value);
        if (!isNaN(td.getTime())) params.set('to', td.toISOString());
    }
    const qs = params.toString();
    const url = '/api/admin/raffles/' + raffleId + '/analyze-csv' + (qs ? '?' + qs : '');

    document.getElementById('raffleDetailBody').innerHTML =
        '<div style="padding:30px;text-align:center;color:#aaa;">📁 Procesando archivo... esto puede tardar 5-30s para CSVs grandes.</div>';
    try {
        const text = await file.text();
        const r = await authFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: text
        });
        const d = await r.json();
        if (!r.ok) {
            document.getElementById('raffleDetailBody').innerHTML =
                '<div style="color:#ff8080;padding:30px;text-align:center;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        document.getElementById('raffleDetailBody').innerHTML = _renderRaffleDetail(d);
    } catch (e) {
        document.getElementById('raffleDetailBody').innerHTML =
            '<div style="color:#ff8080;padding:30px;text-align:center;">Error subiendo archivo: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function closeRaffleDetailModal() {
    const modal = document.getElementById('raffleDetailModal');
    if (modal) modal.style.display = 'none';
}

// =============================================
// MASTER ANALYSIS — modal generico para 5 secciones
// =============================================
const _MASTER_LABELS = {
    relampago: '⚡ Relámpago',
    top_jugadores: '🏆 Top Jugadores',
    top_stats: '📊 Top Estadísticas',
    recuperacion: '💔 Recuperación de Clientes',
    automatizaciones: '🤖 Automatizaciones'
};

// Abre el modal del analisis maestro. Carga el snapshot mas reciente
// (GET) y permite re-analizar (POST) — cada apretada del boton "Actualizar"
// genera un snapshot nuevo y aparece en el historial.
async function openMasterAnalysisModal(section) {
    const label = _MASTER_LABELS[section] || section;
    let m = document.getElementById('masterAnalysisModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'masterAnalysisModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.70);display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div id="masterAnalysisBody" style="background:#1a0033;border:1px solid #00d4ff;border-radius:12px;padding:18px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto;color:#fff;font-family:system-ui;"></div>';
        m.onclick = (e) => { if (e.target === m) m.remove(); };
        document.body.appendChild(m);
    }
    const body = document.getElementById('masterAnalysisBody');
    body.innerHTML = '<div style="padding:30px;text-align:center;color:#aaa;">📊 Cargando ' + label + '...</div>';

    try {
        const r = await authFetch('/api/admin/master-analysis/' + encodeURIComponent(section));
        const d = await r.json();
        if (!r.ok) {
            body.innerHTML = '<div style="color:#ff8080;padding:20px;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        body.innerHTML = _renderMasterAnalysis(section, d.snapshot, d.history || []);
    } catch (e) {
        body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function closeMasterAnalysisModal() {
    const m = document.getElementById('masterAnalysisModal');
    if (m) m.remove();
}

// Re-analiza (POST) y refresca el modal con el snapshot nuevo + historial.
async function rerunMasterAnalysis(section) {
    const body = document.getElementById('masterAnalysisBody');
    if (body) body.innerHTML = '<div style="padding:30px;text-align:center;color:#aaa;">⚙️ Analizando archivo Maestro... (puede tardar 5-15s)</div>';
    try {
        const r = await authFetch('/api/admin/master-analysis/' + encodeURIComponent(section), { method: 'POST' });
        const d = await r.json();
        if (!r.ok) {
            body.innerHTML = '<div style="color:#ff8080;padding:20px;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        body.innerHTML = _renderMasterAnalysis(section, d.snapshot, d.history || []);
    } catch (e) {
        body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function _renderMasterAnalysis(section, snapshot, history) {
    const label = _MASTER_LABELS[section] || section;
    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">';
    html += '  <h3 style="margin:0;color:#00d4ff;font-size:18px;">📊 ' + label + ' · análisis del Maestro</h3>';
    html += '  <button type="button" onclick="closeMasterAnalysisModal()" style="background:rgba(255,128,128,0.15);color:#ff8080;border:1px solid rgba(255,128,128,0.45);padding:5px 10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">✕ Cerrar</button>';
    html += '</div>';

    if (!snapshot) {
        html += '<div style="background:rgba(255,235,59,0.10);border:1px solid #ffeb3b;border-radius:8px;padding:14px;color:#ffeb3b;font-size:13px;line-height:1.5;margin-bottom:12px;">Todavía no corriste un análisis para esta sección.</div>';
        html += '<button type="button" onclick="rerunMasterAnalysis(\'' + section + '\')" style="width:100%;background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:12px 14px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">🔍 ANALIZAR AHORA</button>';
        return html;
    }

    // Meta del snapshot actual.
    const ran = new Date(snapshot.ranAt).toLocaleString('es-AR');
    html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:10px;margin-bottom:12px;font-size:11.5px;color:#aaa;line-height:1.55;">';
    html += '  <strong style="color:#00d4ff;">Última actualización:</strong> ' + ran + (snapshot.ranBy ? ' · por <strong>' + escapeHtml(snapshot.ranBy) + '</strong>' : '') + '<br>';
    html += '  <strong style="color:#00d4ff;">Filas analizadas:</strong> ' + (snapshot.rowsAnalyzed || 0).toLocaleString('es-AR') + ' · <strong>Maestro:</strong> ' + escapeHtml(snapshot.masterSlug || '?');
    html += '</div>';

    html += _renderMasterAnalysisData(section, snapshot.data);

    // Boton actualizar
    html += '<div style="display:flex;gap:8px;margin:12px 0;">';
    html += '  <button type="button" onclick="rerunMasterAnalysis(\'' + section + '\')" style="flex:1;background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:11px 14px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">🔄 ACTUALIZAR análisis</button>';
    html += '</div>';

    // Historial
    if (history && history.length > 0) {
        html += '<details style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.10);padding-top:10px;">';
        html += '  <summary style="color:#aaa;cursor:pointer;font-size:11.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 0;">📚 Historial (' + history.length + ' snapshots anteriores)</summary>';
        html += '  <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">';
        for (const h of history) {
            const hran = new Date(h.ranAt).toLocaleString('es-AR');
            const summary = _summarizeMasterData(section, h.data);
            html += '    <div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:8px 10px;font-size:11px;color:#ddd;">';
            html += '      <div style="color:#888;font-size:10px;">' + hran + ' · por ' + escapeHtml(h.ranBy || 'admin') + ' · ' + (h.rowsAnalyzed || 0).toLocaleString('es-AR') + ' filas</div>';
            html += '      <div style="margin-top:3px;">' + summary + '</div>';
            html += '    </div>';
        }
        html += '  </div>';
        html += '</details>';
    }

    return html;
}

function _renderMasterAnalysisData(section, data) {
    if (!data) return '<div style="color:#888;font-style:italic;">Sin datos.</div>';
    let html = '';
    if (section === 'top_stats') {
        const d = data.deposits || {}, w = data.withdraws || {}, b = data.bonuses || {};
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">';
        html += _kpiCard('💰 Depósitos', d.count + ' x ' + _fmtMoney(d.sum) + ' (' + (d.uniqueUsers||0) + ' users)', '#66ff66');
        html += _kpiCard('💸 Retiros', w.count + ' x ' + _fmtMoney(w.sum) + ' (' + (w.uniqueUsers||0) + ' users)', '#ff8080');
        html += _kpiCard('🎁 Bonos', b.count + ' x ' + _fmtMoney(b.sum), '#ffaa66');
        html += _kpiCard('Neto a la casa', _fmtMoney(data.netToHouse), data.netToHouse >= 0 ? '#66ff66' : '#ff8080');
        html += '</div>';
    } else if (section === 'top_jugadores') {
        html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">Total: ' + (data.totalUsers||0) + ' jugadores · ' + _fmtMoney(data.totalDepositsSum||0) + ' (top 50 mostrados)</div>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:6px;max-height:380px;overflow-y:auto;">';
        html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
        html += '<thead><tr style="color:#00d4ff;text-align:left;"><th style="padding:5px;">#</th><th style="padding:5px;">Usuario</th><th style="padding:5px;text-align:center;">Cargas</th><th style="padding:5px;text-align:right;">Total</th></tr></thead><tbody>';
        const top = data.top || [];
        for (let i = 0; i < top.length; i++) {
            const x = top[i];
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);"><td style="padding:5px;color:#888;">' + (i+1) + '</td><td style="padding:5px;color:#fff;font-weight:700;">' + escapeHtml(x.username) + '</td><td style="padding:5px;text-align:center;color:#66ff66;font-weight:700;">' + x.count + '</td><td style="padding:5px;text-align:right;color:#ffd700;font-weight:800;">' + _fmtMoney(x.sum) + '</td></tr>';
        }
        html += '</tbody></table></div>';
    } else if (section === 'recuperacion') {
        const b = data.buckets || {};
        html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">Total: ' + (data.totalUsers||0) + ' jugadores con cargas en el archivo</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">';
        html += _kpiCard('🟢 Activos (<7d)', String(b.activo||0), '#66ff66');
        html += _kpiCard('🟡 En riesgo (7-14d)', String(b.en_riesgo||0), '#ffeb3b');
        html += _kpiCard('🟠 Perdidos (14-30d)', String(b.perdido||0), '#ffaa66');
        html += _kpiCard('🔴 Inactivos (>30d)', String(b.inactivo||0), '#ff8080');
        html += '</div>';
        const samples = data.samples || {};
        if (samples.en_riesgo && samples.en_riesgo.length > 0) {
            html += '<details style="margin-top:10px;"><summary style="color:#ffeb3b;cursor:pointer;font-size:11.5px;font-weight:700;">Ver muestra de "en riesgo" (' + samples.en_riesgo.length + ')</summary>';
            html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:6px;margin-top:6px;font-size:11px;color:#ddd;max-height:200px;overflow-y:auto;">';
            for (const u of samples.en_riesgo) {
                html += '<div style="padding:3px 5px;border-bottom:1px solid rgba(255,255,255,0.05);">' + escapeHtml(u.username) + ' · ' + u.daysSince + 'd';
            }
            html += '</div></details>';
        }
    } else if (section === 'automatizaciones') {
        html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">' + (data.totalRules||0) + ' reglas activas · ' + (data.totalUsersInMaster||0) + ' jugadores únicos en el maestro</div>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:6px;max-height:340px;overflow-y:auto;">';
        html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
        html += '<thead><tr style="color:#00d4ff;text-align:left;"><th style="padding:5px;">Regla</th><th style="padding:5px;text-align:center;">Mín. cargas</th><th style="padding:5px;text-align:center;">Ventana</th><th style="padding:5px;text-align:right;">Matchea</th></tr></thead><tbody>';
        for (const r of (data.rules || [])) {
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);"><td style="padding:5px;color:#fff;">' + escapeHtml(r.name) + '</td><td style="padding:5px;text-align:center;">' + r.minCharges + '</td><td style="padding:5px;text-align:center;">' + r.windowDays + 'd</td><td style="padding:5px;text-align:right;color:#66ff66;font-weight:800;">' + r.matches + '</td></tr>';
        }
        html += '</tbody></table></div>';
    } else if (section === 'relampago') {
        html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">' + (data.rafflesCount||0) + ' relámpagos activos/cerrados</div>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:6px;">';
        html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
        html += '<thead><tr style="color:#ffeb3b;text-align:left;"><th style="padding:5px;">Sorteo</th><th style="padding:5px;">Estado</th><th style="padding:5px;text-align:center;">Particip.</th><th style="padding:5px;text-align:right;">Califican (≥5 cargas)</th></tr></thead><tbody>';
        for (const r of (data.raffles || [])) {
            const pct = r.total ? Math.round((r.qualifying / r.total) * 100) : 0;
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);"><td style="padding:5px;color:#fff;">' + escapeHtml(r.name) + '</td><td style="padding:5px;color:#aaa;">' + r.status + '</td><td style="padding:5px;text-align:center;">' + r.total + '</td><td style="padding:5px;text-align:right;color:#66ff66;font-weight:800;">' + r.qualifying + '/' + r.total + ' (' + pct + '%)</td></tr>';
        }
        html += '</tbody></table></div>';
    }
    return html;
}

// Resumen de 1 linea de un snapshot historico (texto compacto).
function _summarizeMasterData(section, data) {
    if (!data) return '—';
    if (section === 'top_stats') return 'Dep ' + _fmtMoney(data.deposits && data.deposits.sum) + ' · Ret ' + _fmtMoney(data.withdraws && data.withdraws.sum) + ' · Neto ' + _fmtMoney(data.netToHouse);
    if (section === 'top_jugadores') return (data.totalUsers||0) + ' users · ' + _fmtMoney(data.totalDepositsSum);
    if (section === 'recuperacion') {
        const b = data.buckets || {};
        return '🟢' + (b.activo||0) + ' · 🟡' + (b.en_riesgo||0) + ' · 🟠' + (b.perdido||0) + ' · 🔴' + (b.inactivo||0);
    }
    if (section === 'automatizaciones') return (data.totalRules||0) + ' reglas · ' + (data.totalUsersInMaster||0) + ' users';
    if (section === 'relampago') return (data.rafflesCount||0) + ' relámpagos';
    return '—';
}

function _kpiCard(label, val, color) {
    return '<div style="background:rgba(0,0,0,0.35);border-radius:8px;padding:9px 10px;border:1px solid rgba(255,255,255,0.08);">' +
           '<div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">' + label + '</div>' +
           '<div style="color:' + color + ';font-size:14px;font-weight:900;margin-top:2px;">' + val + '</div></div>';
}

// LUPA por fila — pide detalle al server (CSV daily + LIVE) y muestra
// un mini modal flotante con la comparacion + breakdown por dia.
async function openLightningUserDetail(raffleId, username) {
    // Lee from/to del modal padre si estan.
    const fromInp = document.getElementById('lightningMasterFrom');
    const toInp = document.getElementById('lightningMasterTo');
    const params = new URLSearchParams({ username });
    if (fromInp && fromInp.value) {
        const fd = new Date(fromInp.value);
        if (!isNaN(fd.getTime())) params.set('from', fd.toISOString());
    }
    if (toInp && toInp.value) {
        const td = new Date(toInp.value);
        if (!isNaN(td.getTime())) params.set('to', td.toISOString());
    }

    // Modal vacio mientras carga.
    let m = document.getElementById('lightningUserDetailModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'lightningUserDetailModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div id="lightningUserDetailBody" style="background:#1a0033;border:1px solid #00d4ff;border-radius:12px;padding:20px;max-width:680px;width:100%;max-height:88vh;overflow-y:auto;color:#fff;font-family:system-ui;"></div>';
        m.onclick = (e) => { if (e.target === m) m.remove(); };
        document.body.appendChild(m);
    }
    document.getElementById('lightningUserDetailBody').innerHTML =
        '<div style="padding:30px;text-align:center;color:#aaa;">🔍 Cargando detalle de ' + escapeHtml(username) + '... (LIVE puede tardar 5-10s)</div>';

    try {
        const resp = await authFetch('/api/admin/raffles/' + raffleId + '/user-detail?' + params.toString());
        const d = await resp.json();
        if (!resp.ok) {
            document.getElementById('lightningUserDetailBody').innerHTML =
                '<div style="color:#ff8080;padding:20px;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        document.getElementById('lightningUserDetailBody').innerHTML = _renderLightningUserDetail(d);
    } catch (e) {
        document.getElementById('lightningUserDetailBody').innerHTML =
            '<div style="color:#ff8080;padding:20px;">Error de conexión: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function closeLightningUserDetail() {
    const m = document.getElementById('lightningUserDetailModal');
    if (m) m.remove();
}

function _renderLightningUserDetail(d) {
    const period = d.period || {};
    const pFrom = period.from ? new Date(period.from).toLocaleString('es-AR') : '—';
    const pTo = period.to ? new Date(period.to).toLocaleString('es-AR') : '—';
    const daily = d.daily || { count: 0, amount: 0, perDay: [] };
    const live = d.live;
    const part = d.participation;
    const mismatch = d.mismatch === true;

    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">';
    html += '  <h3 style="margin:0;color:#00d4ff;font-size:18px;">🔍 ' + escapeHtml(d.username) + '</h3>';
    html += '  <button type="button" onclick="closeLightningUserDetail()" style="background:rgba(255,128,128,0.15);color:#ff8080;border:1px solid rgba(255,128,128,0.45);padding:5px 10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">✕ Cerrar</button>';
    html += '</div>';
    html += '<div style="color:#aaa;font-size:11px;margin-bottom:12px;">Período: <b style="color:#fff;">' + pFrom + '</b> → <b style="color:#fff;">' + pTo + '</b></div>';

    // Participation
    if (part) {
        const tickets = (part.ticketNumbers || []).map(n => '#' + n).join(' ');
        html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px;">';
        html += '  <div style="color:#00d4ff;font-weight:800;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Participación</div>';
        html += '  <div><b>' + (part.cuposCount || 0) + ' cupo(s)</b> · Pagó ' + _fmtMoney(part.entryCostPaid || 0) + '</div>';
        html += '  <div style="color:#ddd;font-family:monospace;font-size:11px;margin-top:3px;">' + tickets + '</div>';
        if (part.lastBoughtAt) html += '  <div style="color:#aaa;font-size:11px;margin-top:3px;">Última compra: ' + new Date(part.lastBoughtAt).toLocaleString('es-AR') + '</div>';
        html += '</div>';
    }

    // Comparison summary
    const liveText = (live && !live.error)
        ? (live.count + ' (' + _fmtMoney(live.amount) + ')')
        : '<span style="color:#ff8080;">' + escapeHtml((live && live.error) || 'sin datos live') + '</span>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">';
    html += '  <div style="background:rgba(102,255,102,0.08);border:1px solid rgba(102,255,102,0.40);border-radius:8px;padding:10px;">';
    html += '    <div style="color:#aaffaa;font-weight:800;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px;">📄 CSV Importado</div>';
    html += '    <div style="font-size:18px;font-weight:900;color:#66ff66;">' + daily.count + '<span style="font-size:11px;color:#aaa;font-weight:400;"> cargas</span></div>';
    html += '    <div style="font-size:11px;color:#aaa;">' + _fmtMoney(daily.amount) + '</div>';
    html += '  </div>';
    html += '  <div style="background:rgba(255,235,59,0.08);border:1px solid rgba(255,235,59,0.40);border-radius:8px;padding:10px;">';
    html += '    <div style="color:#ffeb3b;font-weight:800;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px;">⚡ JUGAYGANA Live</div>';
    html += '    <div style="font-size:18px;font-weight:900;color:#ffeb3b;">' + liveText + '</div>';
    html += '  </div>';
    html += '</div>';

    if (mismatch) {
        html += '<div style="background:rgba(255,170,0,0.10);border:1px solid #ffaa00;border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#ffaa00;font-size:12px;font-weight:700;">⚠️ DISCREPANCIA: el CSV dice ' + daily.count + ' cargas pero LIVE dice ' + (live && live.count) + '. Revisá el archivo importado o re-importá.</div>';
    }

    // Per-day breakdown del CSV
    if (daily.perDay && daily.perDay.length > 0) {
        html += '<details open style="margin-bottom:10px;"><summary style="color:#aaa;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 0;">📆 Desglose por día (CSV) — ' + daily.perDay.length + ' días</summary>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:6px;margin-top:4px;">';
        html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
        html += '<thead><tr style="color:#aaa;text-align:left;"><th style="padding:5px;">Día</th><th style="padding:5px;text-align:center;">Cargas</th><th style="padding:5px;text-align:right;">Monto</th></tr></thead><tbody>';
        for (const row of daily.perDay) {
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);"><td style="padding:5px;color:#ddd;">' + new Date(row.date).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' }) + '</td><td style="padding:5px;text-align:center;color:#66ff66;font-weight:700;">' + row.count + '</td><td style="padding:5px;text-align:right;color:#fff;">' + _fmtMoney(row.amount) + '</td></tr>';
        }
        html += '</tbody></table></div></details>';
    } else {
        html += '<div style="color:#888;font-size:11.5px;margin-bottom:10px;font-style:italic;">📄 Sin filas en el CSV importado para este período.</div>';
    }

    // Depositos crudos del LIVE
    if (live && live.deposits && live.deposits.length > 0) {
        html += '<details style="margin-bottom:10px;"><summary style="color:#aaa;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 0;">⚡ Depósitos LIVE (' + live.deposits.length + ')</summary>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;padding:6px;margin-top:4px;max-height:240px;overflow-y:auto;">';
        html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
        html += '<thead><tr style="color:#aaa;text-align:left;"><th style="padding:5px;">Cuándo</th><th style="padding:5px;text-align:right;">Monto</th></tr></thead><tbody>';
        for (const dep of live.deposits) {
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);"><td style="padding:5px;color:#ddd;">' + new Date(dep.ts).toLocaleString('es-AR') + '</td><td style="padding:5px;text-align:right;color:#fff;font-weight:700;">' + _fmtMoney(dep.amount) + '</td></tr>';
        }
        html += '</tbody></table></div></details>';
    }

    return html;
}

// Verifica la columna Cargas: corre CSV (daily) + LIVE en paralelo y
// pinta en amarillo las filas con discrepancias.
async function verifyLightningCargas(raffleId) {
    const fromInp = document.getElementById('lightningMasterFrom');
    const toInp = document.getElementById('lightningMasterTo');
    const params = new URLSearchParams();
    if (fromInp && fromInp.value) {
        const fd = new Date(fromInp.value);
        if (!isNaN(fd.getTime())) params.set('from', fd.toISOString());
    }
    if (toInp && toInp.value) {
        const td = new Date(toInp.value);
        if (!isNaN(td.getTime())) params.set('to', td.toISOString());
    }
    const url = '/api/admin/raffles/' + raffleId + '/verify-cargas' + (params.toString() ? '?' + params.toString() : '');

    // Banner de loading arriba del modal.
    const body = document.getElementById('raffleDetailBody');
    let banner = document.getElementById('verifyCargasBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'verifyCargasBanner';
        banner.style.cssText = 'background:rgba(255,235,59,0.10);border:1px solid #ffeb3b;border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#ffeb3b;font-size:12px;font-weight:700;';
        body.insertBefore(banner, body.firstChild);
    }
    banner.innerHTML = '⏳ Verificando cargas contra LIVE para todos los participantes... (puede tardar)';

    try {
        const r = await authFetch(url);
        const d = await r.json();
        if (!r.ok) {
            banner.style.background = 'rgba(255,128,128,0.10)';
            banner.style.borderColor = '#ff8080';
            banner.style.color = '#ff8080';
            banner.innerHTML = '❌ ' + escapeHtml(d.error || 'Error');
            return;
        }
        const byUser = {};
        for (const row of (d.rows || [])) byUser[String(row.username).toLowerCase()] = row;

        // Pintar filas mismatch en amarillo + agregar tooltip con liveCount.
        const tbody = body.querySelector('table tbody');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(tr => {
                const ucell = tr.querySelector('td[data-username]');
                if (!ucell) return;
                const u = String(ucell.getAttribute('data-username') || '').toLowerCase();
                const v = byUser[u];
                if (!v) return;
                if (v.mismatch) {
                    tr.style.background = 'rgba(255,235,59,0.10)';
                    tr.title = 'CSV: ' + v.dailyCount + ' · LIVE: ' + v.liveCount + ' (diff ' + v.diff + ')';
                }
            });
        }

        if (d.mismatchesCount === 0) {
            banner.style.background = 'rgba(102,255,102,0.10)';
            banner.style.borderColor = '#66ff66';
            banner.style.color = '#66ff66';
            banner.innerHTML = '✅ Todo coincide: ' + d.total + '/' + d.total + ' participantes con cargas iguales en CSV y LIVE.';
        } else {
            banner.innerHTML = '⚠️ ' + d.mismatchesCount + ' de ' + d.total + ' participantes con discrepancia entre CSV y LIVE — filas resaltadas en amarillo. Pasá el mouse para ver los valores.';
        }
    } catch (e) {
        banner.style.background = 'rgba(255,128,128,0.10)';
        banner.style.borderColor = '#ff8080';
        banner.style.color = '#ff8080';
        banner.innerHTML = '❌ Error: ' + escapeHtml(e.message || '');
    }
}

function _renderRaffleDetail(d) {
    const r = d.raffle;
    const parts = d.participants || [];
    const isFree = !!r.isFree;
    const isLightning = r.raffleType === 'relampago';
    const lightning = d.lightning || null;
    const accent = isLightning ? '#ffeb3b' : (isFree ? '#4dabff' : '#d4af37');
    const accentRgba = isLightning ? '255,235,59' : (isFree ? '77,171,255' : '212,175,55');
    const winNum = r.winningTicketNumber;
    const totalPaid = parts.reduce((s, p) => s + (p.entryCostPaid || 0), 0);
    const totalCupos = parts.reduce((s, p) => s + (p.cuposCount || 0), 0);

    let html = '<h2 style="color:' + accent + ';margin:0 0 4px;font-size:18px;">' + (r.emoji||'🎁') + ' ' + escapeHtml(r.name) + (isFree ? ' <span style="color:#4dabff;font-size:11px;background:rgba(77,171,255,0.15);padding:2px 8px;border-radius:6px;border:1px solid #4dabff;letter-spacing:1px;">GRATIS</span>' : '') + '<button type="button" onclick="viewRaffleParticipants(' + escapeJsArg(r.id) + ')" style="float:right;background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:5px 10px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer;letter-spacing:0.5px;" title="Refrescar">🔄 Refrescar</button></h2>';

    // Linea de info del sorteo
    const subBits = [
        'Premio <strong style="color:#fff;">' + _fmtMoney(r.prizeValueARS) + '</strong>',
        '<strong style="color:#fff;">' + r.cuposSold + '/' + r.totalTickets + '</strong> cupos',
        isFree
            ? 'Mín. carga: <strong style="color:#fff;">' + _fmtMoney(r.minCargasARS) + '</strong>'
            : _fmtMoney(r.entryCost) + ' por número',
        '<strong style="color:#fff;">' + parts.length + '</strong> personas',
        'Sorteo: ' + (r.drawDate ? new Date(r.drawDate).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—')
    ];
    html += '<div style="color:#aaa;font-size:12px;margin-bottom:12px;line-height:1.6;">' + subBits.join(' · ') + '</div>';

    // Banner del ganador si ya se sorteó
    if (r.status === 'drawn' && r.winnerUsername) {
        const claimStatus = r.prizeClaimedAt
            ? '<span style="color:#66ff66;">✅ Premio acreditado ' + new Date(r.prizeClaimedAt).toLocaleString('es-AR') + '</span>'
            : '<span style="color:#ffaa66;">⏳ Premio sin acreditar todavía</span>';
        html += '<div style="background:rgba(0,212,255,0.10);border:1px solid #00d4ff;border-radius:8px;padding:10px;margin-bottom:12px;color:#fff;font-size:13px;line-height:1.5;">🏆 Ganador: <strong>' + escapeHtml(r.winnerUsername) + '</strong> · número <strong>#' + winNum + '</strong><br>' + claimStatus + '</div>';
    }

    // Totales del sorteo
    if (parts.length > 0) {
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:12px;">';
        html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:8px 10px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Personas</div><div style="color:#fff;font-size:16px;font-weight:900;">' + parts.length + '</div></div>';
        html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:8px 10px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Cupos</div><div style="color:#00d4ff;font-size:16px;font-weight:900;">' + totalCupos + '</div></div>';
        if (!isFree) {
            html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:8px 10px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Recaudado</div><div style="color:#d4af37;font-size:16px;font-weight:900;">' + _fmtMoney(totalPaid) + '</div></div>';
        }
        if (isLightning && lightning) {
            const tq = lightning.totalQualifying || 0;
            const pct = parts.length ? Math.round((tq / parts.length) * 100) : 0;
            html += '  <div style="background:rgba(102,255,102,0.10);border:1px solid rgba(102,255,102,0.40);border-radius:8px;padding:8px 10px;"><div style="color:#aaffaa;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Califican (' + lightning.minCargas + '+ cargas)</div><div style="color:#66ff66;font-size:16px;font-weight:900;">' + tq + '/' + parts.length + ' (' + pct + '%)</div></div>';
        }
        html += '</div>';
        if (isLightning && lightning) {
            html += '<div style="background:rgba(255,235,59,0.06);border:1px dashed rgba(255,235,59,0.40);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:#ffeb3b;line-height:1.5;">⚡ Regla relámpago: ganador necesita ≥<strong>' + lightning.minCargas + ' cargas reales</strong> con timestamp anterior al draw. ' + escapeHtml(lightning.cutoffNote || '') + '.</div>';
            // Selector de fecha para analizar "si fuera el lunes que viene,
            // quien califica?". Default = drawnAt si ya se sorteo, sino el
            // proximo lunes 21:00 ARG (= 00:00 UTC del martes). Datetime-local
            // requiere formato sin zona; usamos local del navegador.
            const cutISO = lightning.cutoff || _nextMondayDrawISO();
            const cutLocal = _isoToDatetimeLocal(cutISO);
            const sourceMode = lightning.sourceMode || 'daily';
            const masterUsed = lightning.masterUsed || null;
            // Defaults para Desde/Hasta del modo daily: usamos el rango que
            // devolvio el server si vino, sino vacio (que el server resuelve
            // a "desde createdAt del raffle hasta cutoff").
            const fromLocal = lightning.rangeFrom ? _isoToDatetimeLocal(lightning.rangeFrom) : '';
            const toLocal = lightning.rangeTo ? _isoToDatetimeLocal(lightning.rangeTo) : cutLocal;
            const showRange = (sourceMode === 'master' || sourceMode === 'daily');
            html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:10px;margin-bottom:12px;">';
            html += '  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">';

            html += '    <div style="flex:1;min-width:160px;">';
            html += '      <div style="color:#00d4ff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">🔌 Fuente de cargas</div>';
            html += '      <select id="lightningSourceMode" onchange="document.getElementById(\'lightningMasterRange\').style.display = (this.value === \'master\' || this.value === \'daily\') ? \'block\' : \'none\';" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;">';
            html += '        <option value="daily"' + (sourceMode === 'daily' ? ' selected' : '') + '>📄 Archivo CSV importado (rápido)</option>';
            html += '        <option value="live"' + (sourceMode === 'live' ? ' selected' : '') + '>JUGAYGANA (live · más lento)</option>';
            html += '        <option value="master"' + (sourceMode === 'master' ? ' selected' : '') + '>🌟 Archivo Maestro (Drive)</option>';
            html += '      </select>';
            html += '    </div>';

            html += '    <div style="flex:1;min-width:200px;">';
            html += '      <div style="color:#00d4ff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">📅 Fecha de corte (live)</div>';
            html += '      <input id="lightningCutoffInput" type="datetime-local" value="' + cutLocal + '" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;">';
            html += '    </div>';

            // safeId: sanitizado para usar como sufijo de un id HTML.
            // escapeJsArg agregaria comillas literales ("quot") al id —
            // technically funcionaba con getElementById pero rompia
            // querySelector y era frágil. Forzamos solo alfanumérico+_-
            const safeId = String(r.id).replace(/[^a-zA-Z0-9_-]/g, '');
            html += '    <button type="button" onclick="reanalyzeLightningParticipants(' + escapeJsArg(r.id) + ')" style="background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:9px 14px;border-radius:7px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;white-space:nowrap;">🔍 ANALIZAR</button>';
            html += '    <button type="button" onclick="document.getElementById(\'lightningCsvFile_' + safeId + '\').click()" title="Subir un CSV específico para analizar con precisión horaria" style="background:linear-gradient(135deg,#9d4edd,#6a0dad);color:#fff;border:none;padding:9px 14px;border-radius:7px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;white-space:nowrap;">📁 SUBIR CSV</button>';
            html += '    <input type="file" id="lightningCsvFile_' + safeId + '" accept=".csv,text/csv,text/plain" style="display:none;" onchange="analyzeLightningWithCsv(' + escapeJsArg(r.id) + ', this.files[0])">';

            html += '  </div>';

            // Range Desde/Hasta — visible si fuente = master o daily.
            html += '  <div id="lightningMasterRange" style="display:' + (showRange ? 'block' : 'none') + ';margin-top:8px;padding-top:8px;border-top:1px dashed rgba(0,212,255,0.30);">';
            html += '    <div style="display:flex;flex-wrap:wrap;gap:8px;">';
            html += '      <div style="flex:1;min-width:160px;"><div style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Desde</div><input id="lightningMasterFrom" type="datetime-local" value="' + fromLocal + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:12.5px;box-sizing:border-box;margin-top:3px;"></div>';
            html += '      <div style="flex:1;min-width:160px;"><div style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Hasta</div><input id="lightningMasterTo" type="datetime-local" value="' + toLocal + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(0,212,255,0.40);padding:7px 9px;border-radius:6px;font-size:12.5px;box-sizing:border-box;margin-top:3px;"></div>';
            html += '    </div>';
            html += '    <div style="color:#aaa;font-size:10.5px;margin-top:5px;line-height:1.4;">Cuenta los depósitos entre Desde y Hasta. Si dejás Desde vacío, arranca desde la creación del sorteo.</div>';
            html += '  </div>';

            // Notita explicativa segun modo activo.
            let noteText;
            if (sourceMode === 'daily') {
                noteText = '📄 Lee del CSV que subiste en "Importar movimientos". Elegí el rango Desde/Hasta para el período del sorteo.';
            } else if (masterUsed && masterUsed.source !== 'daily') {
                noteText = '✅ Resultado leído del archivo Maestro "' + escapeHtml(masterUsed.name || masterUsed.slug || '?') + '" (' + (masterUsed.rowsCount || 0) + ' filas).';
            } else {
                noteText = 'Modo live: pregunta a JUGAYGANA cada user (más lento, ~5-15s).';
            }
            html += '  <div style="color:#aaa;font-size:10.5px;margin-top:6px;line-height:1.4;">' + noteText + '</div>';

            html += '</div>';
        }
    }

    if (parts.length === 0) {
        html += '<div style="text-align:center;padding:30px;color:#888;">Aún no hay participantes.</div>';
        return html;
    }

    // Tabla con quien compro que numero
    html += '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;max-height:60vh;overflow-y:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead style="position:sticky;top:0;background:#2d0052;z-index:1;"><tr style="color:' + accent + ';text-align:left;">';
    html += '<th style="padding:8px 10px;font-weight:800;">#</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Usuario</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Cupos</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Números</th>';
    if (isLightning) {
        html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Cargas <button type="button" onclick="verifyLightningCargas(' + escapeJsArg(r.id) + ')" title="Verificar contra LIVE — marca discrepancias en amarillo" style="background:rgba(255,235,59,0.18);color:#ffeb3b;border:1px solid rgba(255,235,59,0.5);border-radius:4px;padding:1px 6px;font-size:10px;font-weight:800;cursor:pointer;margin-left:4px;">✓</button></th>';
        html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Califica</th>';
    }
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">' + (isFree ? 'Cuándo' : 'Pagó') + '</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;width:30px;"></th>';
    html += '</tr></thead><tbody>';

    let idx = 1;
    for (const p of parts) {
        const isWin = !!p.isWinner;
        const rowBg = isWin ? 'background:rgba(255,215,0,0.12);' : '';
        const winBadge = isWin ? ' 🏆' : '';
        // Resaltar el numero ganador entre los del user.
        const nums = (p.ticketNumbers || []).map(n => {
            const isWinNum = (winNum && n === winNum && isWin);
            return isWinNum
                ? '<span style="color:#ffd700;font-weight:900;background:rgba(255,215,0,0.20);padding:1px 5px;border-radius:4px;">#' + n + '</span>'
                : '#' + n;
        }).join(' ');

        const lastBuy = p.lastBoughtAt ? new Date(p.lastBoughtAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
        const purchasesN = (p.purchases || []).length;
        const hasMultiplePurchases = purchasesN > 1;

        html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);' + rowBg + '">';
        html += '<td style="padding:8px 10px;color:#666;font-weight:700;">' + idx + '</td>';
        html += '<td style="padding:8px 10px;color:#fff;font-weight:700;" data-username="' + escapeHtml(p.username) + '">' + escapeHtml(p.username) + winBadge + (isLightning ? ' <button type="button" onclick="openLightningUserDetail(' + escapeJsArg(r.id) + ',' + escapeJsArg(p.username) + ')" title="Lupa: detalle de cargas y depósitos" style="background:rgba(0,212,255,0.15);color:#00d4ff;border:1px solid rgba(0,212,255,0.45);border-radius:4px;padding:1px 5px;font-size:10px;cursor:pointer;margin-left:4px;">🔍</button>' : '') + '</td>';
        html += '<td style="padding:8px 10px;color:#fff;text-align:center;font-weight:700;">' + (p.cuposCount||0) + '</td>';
        html += '<td style="padding:8px 10px;color:#ddd;font-family:monospace;font-size:11px;line-height:1.6;word-break:break-word;">' + nums + '</td>';
        if (isLightning) {
            const cc = p.cargasCount || 0;
            const need = p.cargasRequired || 5;
            const ok = !!p.qualifies;
            const cargasColor = ok ? '#66ff66' : (cc === 0 ? '#ff8080' : '#ffaa66');
            html += '<td style="padding:8px 10px;text-align:center;font-weight:800;color:' + cargasColor + ';">' + cc + (cc < need ? ' <span style="color:#888;font-weight:400;font-size:10px;">(/'+ need + ')</span>' : '') + '</td>';
            html += '<td style="padding:8px 10px;text-align:center;font-weight:900;">' + (ok ? '<span style="color:#66ff66;background:rgba(102,255,102,0.12);border:1px solid #66ff66;padding:2px 7px;border-radius:5px;">✅ Sí</span>' : '<span style="color:#ff8080;background:rgba(255,128,128,0.10);border:1px solid #ff8080;padding:2px 7px;border-radius:5px;">❌ No</span>') + '</td>';
        }
        html += '<td style="padding:8px 10px;color:' + accent + ';text-align:right;white-space:nowrap;font-weight:800;">' + (isFree ? '<span style="color:#aaa;font-weight:400;font-size:10px;">' + lastBuy + '</span>' : _fmtMoney(p.entryCostPaid)) + '</td>';
        html += '<td style="padding:6px;text-align:center;">' + (hasMultiplePurchases ? '<button type="button" onclick="_toggleParticipantPurchases(this)" style="background:none;border:1px solid rgba(255,255,255,0.20);color:#fff;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:11px;" title="Ver compras (' + purchasesN + ')">+</button>' : '') + '</td>';
        html += '</tr>';

        // Subfila colapsada con el historial de compras (solo paid con >1 compra).
        if (hasMultiplePurchases) {
            const colspan = isLightning ? 8 : 6;
            html += '<tr class="raffle-purchases-row" style="display:none;background:rgba(0,0,0,0.25);">';
            html += '<td colspan="' + colspan + '" style="padding:10px 14px;font-size:11px;">';
            html += '<div style="color:#aaa;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Historial de compras (' + purchasesN + ')</div>';
            html += '<div style="display:flex;flex-direction:column;gap:4px;">';
            for (const s of p.purchases) {
                const dt = s.createdAt ? new Date(s.createdAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
                const numL = (s.ticketNumbers || []).slice().sort((a,b)=>a-b).map(n => '#' + n).join(' ');
                html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:5px;">';
                html += '<span style="color:#aaa;white-space:nowrap;">' + dt + '</span>';
                html += '<span style="color:#ddd;font-family:monospace;flex:1;">' + numL + '</span>';
                html += '<span style="color:' + accent + ';font-weight:800;white-space:nowrap;">' + _fmtMoney(s.amountARS) + '</span>';
                html += '</div>';
            }
            html += '</div></td></tr>';
        }
        idx++;
    }
    html += '</tbody></table></div>';
    return html;
}

// Toggle del subrow de compras dentro de _renderRaffleDetail.
function _toggleParticipantPurchases(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const next = tr.nextElementSibling;
    if (!next || !next.classList.contains('raffle-purchases-row')) return;
    const isOpen = next.style.display !== 'none';
    next.style.display = isOpen ? 'none' : 'table-row';
    btn.textContent = isOpen ? '+' : '−';
}

async function drawRaffle(id) {
    const r = (_rafflesAdminCache && _rafflesAdminCache.raffles || []).find(x => x.id === id);
    if (!r) return;
    const lotteryNumberStr = prompt(
        '🎟️ Sorteo de ' + r.name + '\n\n' +
        'Entrá el NÚMERO que salió en el 1° premio de la Lotería Nacional Nocturna del lunes:'
    );
    if (lotteryNumberStr === null) return;
    const lotteryNumber = parseInt(String(lotteryNumberStr).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(lotteryNumber) || lotteryNumber < 1) {
        showToast('Número de lotería inválido', 'error');
        return;
    }
    const winnerUsername = (prompt('Usuario ganador (opcional — si lo dejás vacío, lo busca el sistema por el número):') || '').trim();
    const lotteryDrawSource = (prompt('Descripción del sorteo (opcional):', 'Lotería Nacional Nocturna - 1° premio') || '').trim();
    if (!confirm('¿Cargar ganador con número ' + lotteryNumber + (winnerUsername ? ' (forzado: ' + winnerUsername + ')' : '') + '?')) return;
    try {
        const resp = await authFetch('/api/admin/raffles/' + id + '/draw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lotteryNumber,
                winnerUsername: winnerUsername || undefined,
                lotteryDrawSource,
                lotteryDrawDate: new Date().toISOString()
            })
        });
        const d = await resp.json();
        if (!resp.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        let msg = '🎰 SORTEADO\n\n';
        msg += '🏆 Ganador: ' + d.winnerUsername + '\n';
        msg += '🎫 Número: #' + d.winningTicketNumber + (d.lotteryWasMapped ? ' (mapeado del ' + d.lotteryDrawNumber + ')' : '') + '\n';
        msg += '📊 ' + d.totalCuposSold + ' cupos vendidos\n';
        msg += '💎 Premio: ' + _fmtMoney(d.prizeValueARS) + '\n';
        if (d.pushNotifications) msg += '\n📲 Push enviadas: ganador ' + (d.pushNotifications.winnerPushed||0) + ' · perdedores ' + (d.pushNotifications.losersPushed||0);
        msg += '\n\nEl ganador verá un botón en la app para acreditar el premio a su saldo.';
        alert(msg);
        loadRafflesAdmin();
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function cancelRaffle(id) {
    const r = (_rafflesAdminCache && _rafflesAdminCache.raffles || []).find(x => x.id === id);
    if (!r) return;
    const isFree = !!r.isFree;
    const personas = r.participants || 0;
    const msg = isFree
        ? '¿Eliminar el sorteo gratis "' + r.name + '"?\n\n' +
          'Hay ' + personas + (personas === 1 ? ' persona anotada' : ' personas anotadas') + ' que va' + (personas === 1 ? '' : 'n') + ' a perder su lugar.\n' +
          'Como es gratis no hay plata que devolver.\n\n' +
          'En su lugar se va a crear un nuevo sorteo gratis automáticamente.\n\n' +
          'No se puede deshacer.'
        : '¿Cancelar el sorteo "' + r.name + '" y reembolsar a los ' + personas + ' participantes?\n\nLa plata vuelve al saldo de cada uno.\nNo se puede deshacer.';
    if (!confirm(msg)) return;
    if (cancelRaffle._busy) return;
    cancelRaffle._busy = true;
    try {
        const resp = await authFetch('/api/admin/raffles/' + id + '/cancel', { method: 'POST' });
        const d = await resp.json();
        if (!resp.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        const toastMsg = isFree
            ? '🗑️ Sorteo gratis eliminado. Los ' + personas + ' anotados ya no lo ven.'
            : '✅ Cancelado · ' + (d.refundedCount||0) + ' reembolsos · ' + _fmtMoney(d.refundedAmount);
        showToast(toastMsg, 'success');
        loadRafflesAdmin();
    } catch (e) { showToast('Error de conexión', 'error'); }
    finally { cancelRaffle._busy = false; }
}

// Borrar definitivo un sorteo. Solo lo ofrecemos cuando NO hay participantes
// (boton ya filtra eso). Doble check del lado server por si la UI miente.
async function deleteRaffleHard(id) {
    const r = (_rafflesAdminCache && _rafflesAdminCache.raffles || []).find(x => x.id === id);
    if (!r) return;
    const partsCount = r.participants || 0;
    const hasParts = partsCount > 0;
    let force = false;
    if (hasParts) {
        // Doble confirmacion para no borrar historial real por accidente.
        if (!confirm('⚠️ "' + r.name + '" tiene ' + partsCount + (partsCount === 1 ? ' participante' : ' participantes') + '.\n\nSi lo borrás vas a perder el historial completo de esos jugadores en este sorteo.\n\n¿Seguro?')) return;
        if (!confirm('Última confirmación: vas a borrar el sorteo Y los ' + partsCount + ' registros de participación.\n\nEsto NO devuelve plata. Si querés devolver dinero, primero usá "Cancelar y reembolsar" y después borrás.\n\n¿Confirmás?')) return;
        force = true;
    } else {
        if (!confirm('¿Borrar definitivamente "' + r.name + '"?\n\nNo tiene participantes, así que no se pierde nada.\nNo se puede deshacer.')) return;
    }
    if (deleteRaffleHard._busy) return;
    deleteRaffleHard._busy = true;
    try {
        const url = '/api/admin/raffles/' + encodeURIComponent(id) + (force ? '?force=1' : '');
        const resp = await authFetch(url, { method: 'DELETE' });
        const d = await resp.json();
        if (!resp.ok) {
            alert('❌ ' + (d.error || 'Error') + (d.participants ? ' (participantes: ' + d.participants + ')' : ''));
            return;
        }
        const extra = (d.deletedParticipants > 0) ? ' · ' + d.deletedParticipants + ' participaciones eliminadas' : '';
        showToast('🗑️ Borrado · ' + (d.deletedName || '') + extra, 'success');
        loadRafflesAdmin();
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
    finally { deleteRaffleHard._busy = false; }
}

async function cleanupRaffles() {
    if (!confirm('¿Archivar todos los sorteos sorteados y reabrir los próximos? Idempotente.')) return;
    try {
        const resp = await authFetch('/api/admin/raffles/cleanup', { method: 'POST' });
        const d = await resp.json();
        if (!resp.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        showToast('🧹 Archivados ' + (d.archived||0) + ' sorteos. Panel limpio.', 'success');
        loadRafflesAdmin();
    } catch (e) { showToast('Error de conexión', 'error'); }
}

async function forceSeedRaffles() {
    try {
        const resp = await authFetch('/api/admin/raffles/seed', { method: 'POST' });
        const d = await resp.json();
        if (!resp.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        const created = d.created || 0;
        if (created > 0) {
            showToast('🌱 Seed OK · ' + created + ' sorteo' + (created===1?'':'s') + ' nuevo' + (created===1?'':'s') + ' creado' + (created===1?'':'s'), 'success');
            // Flujo A: si se crearon nuevos, ofrecer anunciar via picker
            if (confirm('¿Querés anunciar los sorteos nuevos a los usuarios ahora?')) {
                announceRafflePicker();
            }
        } else {
            showToast('🌱 Ya estaban los 4 sorteos activos. Nada que crear.', 'info');
        }
        loadRafflesAdmin();
    } catch (e) { showToast('Error de conexión', 'error'); }
}

// Abre el modal de configuracion del sorteo RELAMPAGO. Reemplazo de los
// prompt() encadenados — UX mucho mas clara con form proper, validacion
// visual y opciones para "requiere haber jugado pago" + auto-anunciar.
// Abre el modal de ROI del relampago. Lista los ultimos N relampagos y para
// cada uno: participantes, cargas que hicieron despues del relampago,
// premio entregado, neto. Sirve para que el dueno vea si la estrategia esta
// generando cargas reales mas alla del premio que reparte.
async function viewLightningROI() {
    let modal = document.getElementById('lightningROIModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'lightningROIModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:30000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #66ff66;border-radius:14px;max-width:920px;width:100%;margin:8px auto;padding:18px 16px;position:relative;"><button onclick="document.getElementById(\'lightningROIModal\').remove()" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">✕</button><div id="lightningROIBody"><div style="text-align:center;padding:40px;color:#888;">⏳ Cargando…</div></div></div>';
    document.body.appendChild(modal);
    try {
        const r = await authFetch('/api/admin/raffles/lightning-roi?limit=20');
        const d = await r.json();
        if (!r.ok) {
            document.getElementById('lightningROIBody').innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        document.getElementById('lightningROIBody').innerHTML = _renderLightningROI(d);
    } catch (e) {
        document.getElementById('lightningROIBody').innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">Error de conexión</div>';
    }
}

function _renderLightningROI(d) {
    const t = d.totals || {};
    const items = d.raffles || [];
    let html = '<h2 style="color:#66ff66;margin:0 0 4px;font-size:18px;">📊 ROI · Relámpago</h2>';
    html += '<div style="color:#aaa;font-size:11px;margin-bottom:12px;line-height:1.5;">Para cada relámpago: cuánto cargaron los participantes <strong style="color:#66ff66;">después</strong> del sorteo (o desde que se creó si todavía no se sorteó). Comparado contra el premio entregado, te dice si el gancho está generando actividad real.</div>';

    if (items.length === 0) {
        html += '<div style="color:#888;text-align:center;padding:30px;">Aún no hay sorteos relámpago en la base.</div>';
        return html;
    }

    // Totales arriba.
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:14px;">';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Sorteos</div><div style="color:#fff;font-size:18px;font-weight:900;">' + (t.totalRaffles || 0) + '</div></div>';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Participaciones</div><div style="color:#fff;font-size:18px;font-weight:900;">' + (t.totalEntries || 0) + '</div></div>';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Cargas POST</div><div style="color:#66ff66;font-size:18px;font-weight:900;">' + _fmtMoney(t.totalCargasPostAmount || 0) + '</div><div style="color:#aaa;font-size:10px;font-weight:600;">' + (t.totalCargasPostCount || 0) + ' cargas</div></div>';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Premios entregados</div><div style="color:#ff8080;font-size:18px;font-weight:900;">' + _fmtMoney(t.totalPrizeAwarded || 0) + '</div></div>';
    const netColor = (t.totalNet || 0) >= 0 ? '#66ff66' : '#ff8080';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:9px 12px;"><div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Net (cargas − premio)</div><div style="color:' + netColor + ';font-size:18px;font-weight:900;">' + _fmtMoney(t.totalNet || 0) + '</div></div>';
    html += '</div>';

    // Tabla.
    html += '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;max-height:55vh;overflow-y:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
    html += '<thead style="position:sticky;top:0;background:#001a40;z-index:1;"><tr style="color:#66ff66;text-align:left;">';
    html += '<th style="padding:8px 10px;font-weight:800;">#</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Sorteo</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Estado</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Anotados</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Premio</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Cargas POST</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Net</th>';
    html += '</tr></thead><tbody>';

    for (const it of items) {
        const stColor = it.status === 'drawn' ? '#00d4ff' : (it.status === 'closed' ? '#ffaa66' : (it.status === 'active' ? '#66ff66' : '#888'));
        const drawnTxt = it.drawnAt ? new Date(it.drawnAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
        const netColor2 = (it.net || 0) >= 0 ? '#66ff66' : '#ff8080';
        const forfeitBadge = it.forfeited ? ' <span style="color:#ff8080;font-size:9px;background:rgba(255,128,128,0.15);padding:1px 5px;border-radius:4px;border:1px solid #ff8080;">FORFEIT</span>' : '';
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);">';
        html += '<td style="padding:8px 10px;color:#aaa;font-weight:700;">#' + (it.instanceNumber || '?') + '</td>';
        html += '<td style="padding:8px 10px;color:#fff;font-weight:700;">' + escapeHtml(it.name || '') + forfeitBadge + '<div style="color:#888;font-size:10px;font-weight:400;">' + drawnTxt + (it.winnerUsername ? ' · 🏆 ' + escapeHtml(it.winnerUsername) : '') + '</div></td>';
        html += '<td style="padding:8px 10px;text-align:center;color:' + stColor + ';font-weight:800;">' + it.status + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;color:#fff;font-weight:700;">' + (it.totalEntries || 0) + '/' + (it.totalTickets || 0) + '</td>';
        html += '<td style="padding:8px 10px;text-align:right;color:' + (it.prizeAwarded > 0 ? '#ff8080' : '#666') + ';font-weight:800;">' + (it.prizeAwarded > 0 ? '−' + _fmtMoney(it.prizeAwarded) : '—') + '</td>';
        html += '<td style="padding:8px 10px;text-align:right;color:#66ff66;font-weight:800;">+' + _fmtMoney(it.cargasPostAmount || 0) + '<div style="color:#aaa;font-size:10px;font-weight:600;">' + (it.cargasPostCount || 0) + ' cargas · ' + (it.cargasPostUsers || 0) + ' users</div></td>';
        html += '<td style="padding:8px 10px;text-align:right;color:' + netColor2 + ';font-weight:900;">' + _fmtMoney(it.net || 0) + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
}

function seedLightningRaffle() {
    let modal = document.getElementById('lightningConfigModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'lightningConfigModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML =
        '<div style="background:linear-gradient(135deg,#001a40,#003f7a);border:2px solid #ffeb3b;border-radius:14px;max-width:520px;width:100%;margin:8px auto;padding:18px 16px;box-shadow:0 0 30px rgba(255,235,59,0.35);">' +
            '<h3 style="color:#ffeb3b;margin:0 0 4px;font-size:18px;">⚡ Crear sorteo RELÁMPAGO</h3>' +
            '<div style="color:#cce4ff;font-size:11.5px;margin-bottom:14px;line-height:1.5;">Sorteo gratis, 1 cupo por persona, el user elige su número del grid 1-100. <strong style="color:#fff;">No respawnea automático</strong> — cuando este se llena o se sortea, tocás de nuevo "Crear" para abrir otro.</div>' +

            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">' +
                '<div>' +
                    '<label style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Premio (ARS)</label>' +
                    '<input id="lightPrize" type="number" min="100" step="1000" value="200000" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,235,59,0.40);padding:9px 10px;border-radius:6px;font-size:14px;margin-top:3px;box-sizing:border-box;">' +
                '</div>' +
                '<div>' +
                    '<label style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Cupos (2 a 1000)</label>' +
                    '<input id="lightCupos" type="number" min="2" max="1000" step="1" value="100" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,235,59,0.40);padding:9px 10px;border-radius:6px;font-size:14px;margin-top:3px;box-sizing:border-box;">' +
                '</div>' +
            '</div>' +

            '<label style="display:flex;align-items:flex-start;gap:8px;background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:10px;margin-bottom:8px;cursor:pointer;">' +
                '<input type="checkbox" id="lightIsPaid" onchange="_lightTogglePaid()" style="margin-top:2px;flex-shrink:0;">' +
                '<div style="flex:1;">' +
                    '<div style="color:#d4af37;font-size:12px;font-weight:800;">💰 Sorteo PAGO (descuenta saldo)</div>' +
                    '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:2px;">Sin tildar = gratis (default). Tildado = se descuenta saldo. Si el user no tiene saldo, le mostramos el botón <strong style="color:#66ff66;">💬 QUIERO CARGAR</strong> que abre WhatsApp.</div>' +
                    '<div id="lightEntryCostBox" style="display:none;margin-top:8px;">' +
                        '<label style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Entrada (ARS por número)</label>' +
                        '<input id="lightEntryCost" type="number" min="1" step="100" value="1000" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(212,175,55,0.40);padding:9px 10px;border-radius:6px;font-size:14px;margin-top:3px;box-sizing:border-box;">' +
                    '</div>' +
                '</div>' +
            '</label>' +

            '<label style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,235,59,0.06);border:1px solid rgba(255,235,59,0.30);border-radius:8px;padding:10px;margin-bottom:8px;cursor:pointer;">' +
                '<input type="checkbox" id="lightRequirePaid" style="margin-top:2px;flex-shrink:0;">' +
                '<div>' +
                    '<div style="color:#ffeb3b;font-size:12px;font-weight:800;">🎫 Solo para clientes con número pago previo</div>' +
                    '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:2px;">Si tildás esto, solo van a poder inscribirse usuarios con al menos 1 número en algún sorteo pago. Útil del segundo relámpago en adelante.</div>' +
                '</div>' +
            '</label>' +

            '<div style="background:rgba(102,255,102,0.06);border:1px solid rgba(102,255,102,0.30);border-radius:8px;padding:10px;margin-bottom:8px;">' +
                '<label for="lightMinChargesWeek" style="display:block;color:#66ff66;font-size:12px;font-weight:800;margin-bottom:4px;cursor:pointer;">📊 Mínimo de cargas en la última semana</label>' +
                '<input id="lightMinChargesWeek" type="number" min="0" max="50" step="1" value="0" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(102,255,102,0.40);padding:8px 10px;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
                '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:5px;"><strong style="color:#fff;">0 = sin requisito.</strong> Si ponés ej. <strong style="color:#66ff66;">3</strong>, solo van a poder anotarse los que hayan tenido <strong>3 o más cargas reales</strong> en los últimos 7 días. Las bonificaciones <strong>NO cuentan</strong> — solo cargas con plata propia.</div>' +
            '</div>' +

            '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:10px;margin-bottom:8px;">' +
                '<div style="color:#00d4ff;font-size:12px;font-weight:800;margin-bottom:6px;">👥 Audiencia (¿a quiénes les llega?)</div>' +
                '<div style="display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:#ddd;">' +
                    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="lightAudMode" value="all" checked onchange="_lightUpdateTeamsBox()"> A todos los equipos</label>' +
                    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="lightAudMode" value="except" onchange="_lightUpdateTeamsBox()"> A todos <strong style="color:#ff8080;">excepto</strong> los equipos elegidos</label>' +
                    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="lightAudMode" value="only" onchange="_lightUpdateTeamsBox()"> <strong style="color:#66ff66;">Solo</strong> a los equipos elegidos</label>' +
                    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="lightAudMode" value="user" onchange="_lightUpdateTeamsBox()"> 🧪 <strong style="color:#ffeb3b;">Solo a 1 usuario específico (test)</strong></label>' +
                '</div>' +
                '<div id="lightTeamsBox" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(0,212,255,0.30);">' +
                    '<div style="color:#aaa;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Equipos</div>' +
                    '<div id="lightTeamsList" style="display:flex;flex-wrap:wrap;gap:6px;color:#aaa;font-size:11px;">⏳ Cargando…</div>' +
                '</div>' +
                '<div id="lightUserBox" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(255,235,59,0.30);">' +
                    '<div style="color:#ffeb3b;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Username (sin @)</div>' +
                    '<input id="lightAudUser" type="text" maxlength="80" placeholder="ej: lalodj" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,235,59,0.40);padding:8px 10px;border-radius:6px;font-size:13px;box-sizing:border-box;">' +
                    '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:5px;">Solo este usuario va a ver el sorteo. Útil para testear el flujo antes de abrirlo a todos.</div>' +
                '</div>' +
            '</div>' +

            '<label style="display:flex;align-items:flex-start;gap:8px;background:rgba(102,255,102,0.06);border:1px solid rgba(102,255,102,0.30);border-radius:8px;padding:10px;margin-bottom:14px;cursor:pointer;">' +
                '<input type="checkbox" id="lightAutoAnnounce" checked style="margin-top:2px;flex-shrink:0;">' +
                '<div>' +
                    '<div style="color:#66ff66;font-size:12px;font-weight:800;">📣 Anunciar a usuarios al crear</div>' +
                    '<div style="color:#aaa;font-size:10.5px;line-height:1.4;margin-top:2px;">Después de crear, abre el modal de anuncio con copy pre-cargado para que mandes el push.</div>' +
                '</div>' +
            '</label>' +

            '<div style="display:flex;gap:8px;">' +
                '<button onclick="document.getElementById(\'lightningConfigModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
                '<button onclick="seedLightningRaffleSubmit()" style="flex:2;background:linear-gradient(135deg,#ffeb3b,#ffd700);color:#001a40;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;letter-spacing:1px;">⚡ CREAR SORTEO</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(modal);
    setTimeout(() => { try { document.getElementById('lightPrize').focus(); document.getElementById('lightPrize').select(); } catch (_) {} }, 100);
}

// Toggle de la seccion de "Entrada (ARS)" cuando se tilda PAGO. Idempotente.
function _lightTogglePaid() {
    const chk = document.getElementById('lightIsPaid');
    const box = document.getElementById('lightEntryCostBox');
    if (box) box.style.display = (chk && chk.checked) ? 'block' : 'none';
}

// Toggle de los paneles de audiencia segun el modo seleccionado:
//   'all'           -> nada visible
//   'except'/'only' -> lista de equipos (carga lazy 1 sola vez)
//   'user'          -> input de username
// Idempotente: re-llamarla con el mismo modo no rompe nada.
async function _lightUpdateTeamsBox() {
    const radios = document.querySelectorAll('input[name="lightAudMode"]');
    let mode = 'all';
    for (const r of radios) { if (r.checked) { mode = r.value; break; } }
    const teamsBox = document.getElementById('lightTeamsBox');
    const userBox = document.getElementById('lightUserBox');
    if (teamsBox) teamsBox.style.display = (mode === 'except' || mode === 'only') ? 'block' : 'none';
    if (userBox) userBox.style.display = (mode === 'user') ? 'block' : 'none';
    if (mode === 'user') {
        setTimeout(() => { try { document.getElementById('lightAudUser')?.focus(); } catch (_) {} }, 50);
        return;
    }
    if (mode !== 'except' && mode !== 'only') return;
    const list = document.getElementById('lightTeamsList');
    if (!list || list.dataset.loaded === '1') return;
    try {
        const r = await authFetch('/api/admin/calendar/teams-available');
        const d = await r.json();
        const teams = (d && d.teams) || [];
        if (teams.length === 0) {
            list.innerHTML = '<span style="color:#888;">No hay equipos configurados.</span>';
            list.dataset.loaded = '1';
            return;
        }
        let h = '';
        for (const t of teams) {
            h += '<label style="display:inline-flex;align-items:center;gap:4px;color:#ddd;cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(0,212,255,0.20);border-radius:6px;padding:4px 8px;">' +
                '<input type="checkbox" class="lightTeamChk" value="' + escapeHtml(t) + '"> ' + escapeHtml(t) +
            '</label>';
        }
        list.innerHTML = h;
        list.dataset.loaded = '1';
    } catch (e) {
        list.innerHTML = '<span style="color:#888;">No se pudo cargar equipos.</span>';
    }
}

// Submit del form modal: arma el body y llama al endpoint. Anti-double
// click + cierra modal + ofrece anuncio si el checkbox esta tildado.
async function seedLightningRaffleSubmit() {
    if (seedLightningRaffleSubmit._busy) return;
    const prize = parseInt(document.getElementById('lightPrize')?.value, 10);
    const cupos = parseInt(document.getElementById('lightCupos')?.value, 10);
    const isPaid = !!document.getElementById('lightIsPaid')?.checked;
    const entryCost = isPaid ? parseInt(document.getElementById('lightEntryCost')?.value, 10) : 0;
    const requiresPaidTicket = !!document.getElementById('lightRequirePaid')?.checked;
    const requiresMinChargesLastWeek = Math.max(0, Math.min(50, parseInt(document.getElementById('lightMinChargesWeek')?.value, 10) || 0));
    const autoAnnounce = !!document.getElementById('lightAutoAnnounce')?.checked;
    if (!Number.isFinite(prize) || prize < 100) { alert('Premio inválido (mínimo $100).'); return; }
    if (!Number.isFinite(cupos) || cupos < 2 || cupos > 1000) { alert('Cupos inválidos (2 a 1000).'); return; }
    if (isPaid && (!Number.isFinite(entryCost) || entryCost < 1)) { alert('Para un RELÁMPAGO PAGO, la entrada debe ser ≥ $1.'); return; }

    // Audiencia: lee modo + equipos / usernames segun el panel visible.
    let audienceMode = 'all';
    const radios = document.querySelectorAll('input[name="lightAudMode"]');
    for (const r of radios) { if (r.checked) { audienceMode = r.value; break; } }
    let audienceTeams = [];
    let audienceUsernames = [];
    if (audienceMode === 'except' || audienceMode === 'only') {
        audienceTeams = Array.from(document.querySelectorAll('.lightTeamChk:checked')).map(c => c.value);
        if (audienceTeams.length === 0) {
            alert('Elegí al menos 1 equipo o cambiá el modo a "A todos los equipos".');
            return;
        }
    } else if (audienceMode === 'user') {
        const raw = (document.getElementById('lightAudUser')?.value || '').trim();
        if (!raw) { alert('Ingresá el username del usuario para testear.'); return; }
        audienceUsernames = raw.split(/[\s,]+/).map(u => u.replace(/^@/, '').toLowerCase()).filter(Boolean);
        if (audienceUsernames.length === 0) { alert('Username inválido.'); return; }
    }

    seedLightningRaffleSubmit._busy = true;
    try {
        const resp = await authFetch('/api/admin/raffles/seed-lightning', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prizeValueARS: prize,
                totalTickets: cupos,
                isFree: !isPaid,
                entryCost,
                requiresPaidTicket,
                requiresMinChargesLastWeek,
                audienceMode,
                audienceTeams,
                audienceUsernames
            })
        });
        const d = await resp.json();
        if (!resp.ok) {
            alert('❌ ' + (d.error || 'Error') + (d.raffle ? '\n\nActivo: ' + d.raffle.name + ' (' + (d.raffle.cuposSold || 0) + '/' + (d.raffle.totalTickets || 0) + ')\n\nBorrá o sorteá el actual antes de crear otro.' : ''));
            return;
        }
        document.getElementById('lightningConfigModal')?.remove();
        showToast('⚡ Sorteo RELÁMPAGO creado: ' + d.raffle.name, 'success');
        loadRafflesLightningAdmin();
        loadRafflesAdmin();
        if (autoAnnounce) {
            const announceTitle = '⚡ Nuevo sorteo RELÁMPAGO' + (isPaid ? ' PAGO' : '') + ' · $' + (d.raffle.prizeValueARS || prize).toLocaleString('es-AR');
            const announceBody = requiresPaidTicket
                ? '¡Solo para clientes con número pago previo! Entrá, elegí tu número del 1 al 100 y mirá cómo se llena.'
                : (isPaid
                    ? ('Entrada $' + entryCost.toLocaleString('es-AR') + ' por número · 1 por persona. Entrá, elegí tu número del 1 al 100 y mirá cómo se llena el cupo.')
                    : '¡GRATIS! Entrá, elegí tu número del 1 al 100 y mirá cómo se llena el cupo. 1 número por persona.');
            if (audienceMode === 'user') {
                // Modo test: push DIRECTO solo a esos usernames (sin abrir el
                // modal masivo). Bypass hasAppOnly para que llegue a cualquier
                // token (browser o PWA standalone).
                try {
                    const r = await authFetch('/api/admin/raffles/' + encodeURIComponent(d.raffle.id) + '/announce', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: announceTitle, body: announceBody, usernames: audienceUsernames, hasAppOnly: false })
                    });
                    const dd = await r.json();
                    if (r.ok) {
                        showToast('📤 Push enviado a ' + audienceUsernames.join(', ') + ' (' + (dd.sent || 0) + '/' + (dd.eligible || 0) + ')', 'success');
                    } else {
                        showToast('⚠️ Push no enviado: ' + (dd.error || 'Error'), 'warning');
                    }
                } catch (_) {
                    showToast('⚠️ Push no enviado (error de red)', 'warning');
                }
            } else {
                announceRaffleOpen(d.raffle.id, {
                    title: announceTitle,
                    body: announceBody,
                    presetType: 'relampago'
                });
            }
        }
    } catch (e) {
        alert('Error de conexión');
    }
    finally { seedLightningRaffleSubmit._busy = false; }
}

// Crea un sorteo de prueba on-demand. Pensado para validar el flujo
// punta a punta sin gastar mucha plata real (entry $100, premio $500,
// 5 cupos por default). Si ya hay uno activo, el endpoint avisa.
async function seedTestRaffle() {
    const entry = prompt('Entrada del sorteo de prueba (en pesos)', '100');
    if (entry === null) return;
    const prize = prompt('Premio del sorteo de prueba (en pesos)', '500');
    if (prize === null) return;
    const cupos = prompt('Cantidad de cupos (2 a 100)', '5');
    if (cupos === null) return;
    if (seedTestRaffle._busy) return;
    seedTestRaffle._busy = true;
    try {
        const resp = await authFetch('/api/admin/raffles/seed-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entryCost: parseInt(entry, 10) || 100,
                prizeValueARS: parseInt(prize, 10) || 500,
                totalTickets: parseInt(cupos, 10) || 5
            })
        });
        const d = await resp.json();
        if (!resp.ok) {
            alert('❌ ' + (d.error || 'Error') + (d.raffle ? '\n\nActivo: ' + d.raffle.name + ' (' + d.raffle.cuposSold + '/' + d.raffle.totalTickets + ')' : ''));
            return;
        }
        showToast('🧪 Sorteo de prueba creado: ' + d.raffle.name, 'success');
        loadRafflesAdmin();
        if (confirm('¿Querés anunciar el sorteo a los usuarios ahora?')) {
            announceRaffleOpen(d.raffle.id, {
                title: '🧪 ' + d.raffle.name,
                body: 'Sorteo de prueba abierto. Entrada $' + (d.raffle.entryCost || 100).toLocaleString('es-AR') + ', premio $' + (d.raffle.prizeValueARS || 500).toLocaleString('es-AR') + '. Entrá y elegí tu número.',
                presetType: 'test'
            });
        }
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
    finally { seedTestRaffle._busy = false; }
}

// ============================================================
// ANNOUNCE — Anunciar sorteo a los usuarios via push masivo
// ============================================================
// Flujo A (post-seed): el admin acaba de crear un sorteo. Le ofrecemos
//   anunciarlo enseguida con copy pre-cargado.
// Flujo B (standalone): boton "Anunciar sorteo" -> picker de sorteos
//   activos -> modal de anuncio. Sirve para reanunciar despues.

// Picker: lista los sorteos active/closed (vivos) y deja al admin elegir
// uno para anunciar. Util cuando quiere reanunciar dias despues.
async function announceRafflePicker() {
    let modal = document.getElementById('announcePickerModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'announcePickerModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
    modal.innerHTML = '<div style="background:#1a0033;border:2px solid #66ff66;border-radius:12px;max-width:560px;width:100%;margin:8px auto;padding:18px 16px;">' +
        '<h3 style="color:#66ff66;margin:0 0 10px;font-size:16px;">📣 Elegí el sorteo a anunciar</h3>' +
        '<div id="announcePickerList" style="color:#aaa;text-align:center;padding:24px;">⏳ Cargando…</div>' +
        '<button onclick="document.getElementById(\'announcePickerModal\').remove()" style="margin-top:10px;width:100%;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Cerrar</button>' +
        '</div>';
    document.body.appendChild(modal);

    try {
        const r = await authFetch('/api/admin/raffles');
        const d = await r.json();
        const list = document.getElementById('announcePickerList');
        const live = (d.raffles || []).filter(x => x.status === 'active' || x.status === 'closed');
        if (live.length === 0) {
            list.innerHTML = '<div style="color:#888;padding:14px;font-size:12px;">No hay sorteos activos para anunciar.</div>';
            return;
        }
        let h = '<div style="display:flex;flex-direction:column;gap:6px;">';
        for (const r of live) {
            const sold = r._ticketCounter || 0;
            const total = r.totalTickets || 0;
            const isLight = r.raffleType === 'relampago';
            h += '<div onclick="announceRaffleFromPicker(' + escapeJsArg(r.id) + ')" style="cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid ' + (isLight ? '#ffeb3b' : 'rgba(255,255,255,0.15)') + ';border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;">' +
                '<div style="font-size:24px;">' + (r.emoji || '🎁') + '</div>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="color:#fff;font-weight:800;font-size:13px;line-height:1.3;">' + escapeHtml(r.name) + (isLight ? ' <span style="color:#ffeb3b;font-size:10px;">⚡</span>' : '') + '</div>' +
                    '<div style="color:#aaa;font-size:11px;">' + sold + '/' + total + ' · Premio $' + (r.prizeValueARS || 0).toLocaleString('es-AR') + ' · ' + (r.isFree ? 'GRATIS' : 'Entry $' + (r.entryCost || 0).toLocaleString('es-AR')) + '</div>' +
                '</div>' +
                '<div style="color:#66ff66;font-size:18px;">›</div>' +
            '</div>';
        }
        h += '</div>';
        list.innerHTML = h;
    } catch (e) {
        const list = document.getElementById('announcePickerList');
        if (list) list.innerHTML = '<div style="color:#ff8080;">Error de conexión</div>';
    }
}

function announceRaffleFromPicker(id) {
    const cache = (_rafflesAdminCache && _rafflesAdminCache.raffles) || [];
    const r = cache.find(x => x.id === id);
    document.getElementById('announcePickerModal')?.remove();
    if (!r) {
        // Si no esta en cache (por ejemplo otro tab), llamamos sin preset
        announceRaffleOpen(id, { title: '', body: '' });
        return;
    }
    const isLight = r.raffleType === 'relampago';
    const isFree = r.isFree;
    const presetType = isLight ? 'relampago' : (r.raffleType === 'test' ? 'test' : (isFree ? 'free' : 'paid'));
    let title, body;
    if (isLight) {
        title = '⚡ Sorteo RELÁMPAGO · $' + (r.prizeValueARS || 0).toLocaleString('es-AR');
        body = '¡GRATIS por única vez! Entrá ahora — te anotamos automático. ' + (r.totalTickets || 100) + ' cupos, primero llega primero adentro.';
    } else if (isFree) {
        title = '🎁 ' + r.name;
        body = 'Sorteo GRATIS disponible. Si tenés cargas en los últimos 30 días te anotamos automático cuando entrés a la app.';
    } else {
        title = '🎫 ' + r.name + ' · Premio $' + (r.prizeValueARS || 0).toLocaleString('es-AR');
        body = 'Elegí tu número de la suerte (1 al 100). Entrada $' + (r.entryCost || 0).toLocaleString('es-AR') + '. Si ganás, te acreditamos el premio automáticamente.';
    }
    announceRaffleOpen(id, { title, body, presetType });
}

// Modal de composicion del anuncio. preset = { title, body, presetType }
async function announceRaffleOpen(raffleId, preset) {
    preset = preset || {};
    let modal = document.getElementById('announceRaffleModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'announceRaffleModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto;';
    modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
    modal.innerHTML = '<div style="background:#1a0033;border:2px solid #66ff66;border-radius:14px;max-width:560px;width:100%;margin:8px auto;padding:18px 16px;">' +
        '<h3 style="color:#66ff66;margin:0 0 4px;font-size:16px;">📣 Anunciar sorteo</h3>' +
        '<div style="color:#aaa;font-size:11px;margin-bottom:10px;">Push masivo. Limitado a 8 envíos por minuto.</div>' +
        '<label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Título</label>' +
        '<input id="announceTitle" type="text" maxlength="100" value="' + escapeHtml(preset.title || '') + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 10px;border-radius:6px;font-size:13px;margin:4px 0 10px;box-sizing:border-box;">' +
        '<label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Mensaje</label>' +
        '<textarea id="announceBody" maxlength="500" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 10px;border-radius:6px;font-size:13px;margin:4px 0 10px;box-sizing:border-box;min-height:75px;resize:vertical;">' + escapeHtml(preset.body || '') + '</textarea>' +
        '<label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Equipos a notificar</label>' +
        '<div id="announceTeamsBox" style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px;margin:4px 0 10px;max-height:160px;overflow-y:auto;">' +
            '<label style="display:block;color:#fff;font-size:12px;font-weight:800;margin-bottom:6px;cursor:pointer;"><input type="checkbox" id="announceTeamsAll" checked onchange="_announceToggleAll(this.checked)"> ✅ Todos los equipos</label>' +
            '<div id="announceTeamsList" style="display:flex;flex-wrap:wrap;gap:8px;color:#aaa;font-size:11px;">⏳ Cargando…</div>' +
        '</div>' +
        '<label style="display:block;color:#ddd;font-size:12px;font-weight:600;margin-bottom:12px;cursor:pointer;"><input type="checkbox" id="announceHasApp" checked> Solo a usuarios con app instalada</label>' +
        '<div style="display:flex;gap:8px;">' +
            '<button onclick="document.getElementById(\'announceRaffleModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
            '<button onclick="announceRaffleSend(' + escapeJsArg(raffleId) + ')" style="flex:2;background:linear-gradient(135deg,#66ff66,#00d4ff);color:#000;border:none;padding:10px;border-radius:6px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;">📤 Enviar push</button>' +
        '</div>' +
        '</div>';
    document.body.appendChild(modal);

    // Cargar equipos disponibles
    try {
        const r = await authFetch('/api/admin/calendar/teams-available');
        const d = await r.json();
        const teams = (d && d.teams) || [];
        const list = document.getElementById('announceTeamsList');
        if (!list) return;
        if (teams.length === 0) {
            list.innerHTML = '<span style="color:#888;">No hay equipos configurados — el push va a todos.</span>';
            return;
        }
        let h = '';
        for (const t of teams) {
            h += '<label style="display:inline-flex;align-items:center;gap:4px;color:#ddd;cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:6px;padding:4px 8px;">' +
                '<input type="checkbox" class="announceTeamChk" value="' + escapeHtml(t) + '" onchange="_announceUpdateAllChk()"> ' + escapeHtml(t) +
            '</label>';
        }
        list.innerHTML = h;
    } catch (e) {
        const list = document.getElementById('announceTeamsList');
        if (list) list.innerHTML = '<span style="color:#888;">No se pudo cargar equipos. El push va a todos.</span>';
    }
}

// Toggle "todos los equipos" -> destildea individuales
function _announceToggleAll(checked) {
    const chks = document.querySelectorAll('.announceTeamChk');
    if (checked) {
        chks.forEach(c => { c.checked = false; });
    }
}

// Si tildaste algun equipo, destilda "todos"
function _announceUpdateAllChk() {
    const all = document.getElementById('announceTeamsAll');
    if (!all) return;
    const anyChecked = Array.from(document.querySelectorAll('.announceTeamChk')).some(c => c.checked);
    all.checked = !anyChecked;
}

async function announceRaffleSend(raffleId) {
    const title = (document.getElementById('announceTitle')?.value || '').trim();
    const body = (document.getElementById('announceBody')?.value || '').trim();
    if (!title || !body) { alert('Falta título o mensaje'); return; }
    const allTeams = document.getElementById('announceTeamsAll')?.checked;
    const teams = allTeams ? [] : Array.from(document.querySelectorAll('.announceTeamChk:checked')).map(c => c.value);
    const hasAppOnly = !!document.getElementById('announceHasApp')?.checked;
    const teamsStr = teams.length === 0 ? 'todos los equipos' : teams.length + ' equipo' + (teams.length === 1 ? '' : 's');
    if (!confirm('¿Mandar push a ' + teamsStr + (hasAppOnly ? ' (solo con app)' : '') + '?')) return;
    if (announceRaffleSend._busy) return;
    announceRaffleSend._busy = true;
    try {
        const r = await authFetch('/api/admin/raffles/' + encodeURIComponent(raffleId) + '/announce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, teams, hasAppOnly })
        });
        const d = await r.json();
        if (!r.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        alert('📤 Anuncio enviado\n\nElegibles: ' + (d.eligible || 0) + '\nEnviadas: ' + d.sent + '\nFallidas: ' + (d.failed || 0));
        document.getElementById('announceRaffleModal')?.remove();
    } catch (e) {
        alert('Error de conexión');
    }
    finally { announceRaffleSend._busy = false; }
}

// Lista los sorteos del modelo viejo (iphone/caribe/auto/other) que sigan
// activos en la DB. Muestra qué hay y permite purgarlos (cancelar +
// reembolsar a los participantes que pagaron).
async function viewLegacyRaffles() {
    let modal = document.getElementById('legacyRafflesModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'legacyRafflesModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:30000;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto;';
        modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
        modal.innerHTML = '<div style="background:linear-gradient(135deg,#1a0033,#2d0052);border:2px solid #ffaa66;border-radius:12px;max-width:760px;width:100%;margin:8px auto;padding:18px 16px;position:relative;"><button onclick="document.getElementById(\'legacyRafflesModal\').style.display=\'none\'" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">✕</button><div id="legacyRafflesBody"><div style="text-align:center;padding:40px;color:#888;">⏳ Cargando…</div></div></div>';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    document.getElementById('legacyRafflesBody').innerHTML = '<div style="text-align:center;padding:40px;color:#888;">⏳ Cargando…</div>';
    try {
        const r = await authFetch('/api/admin/raffles/legacy');
        const d = await r.json();
        if (!r.ok) {
            document.getElementById('legacyRafflesBody').innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        const list = d.raffles || [];
        let html = '<h2 style="color:#ffaa66;margin:0 0 6px;font-size:18px;">🗑️ Sorteos viejos en la base</h2>';
        html += '<div style="color:#aaa;font-size:12px;margin-bottom:14px;line-height:1.5;">Estos son sorteos del modelo anterior (loss-credit con iPhone/Caribe/Auto) que todavía están activos. Si los purgás, se cancelan, se reembolsa a quienes hayan pagado entry, y desaparecen del lado del user.</div>';
        if (list.length === 0) {
            html += '<div style="color:#66ff66;background:rgba(102,255,102,0.10);border:1px solid #66ff66;border-radius:8px;padding:14px;text-align:center;">✅ No hay sorteos viejos. Todo limpio.</div>';
        } else {
            html += '<div style="background:rgba(255,170,102,0.10);border:1px solid #ffaa66;border-radius:8px;padding:10px;margin-bottom:12px;color:#ffaa66;font-size:12px;font-weight:700;">⚠️ Hay ' + list.length + ' sorteo' + (list.length===1?'':'s') + ' del modelo viejo en la DB.</div>';
            html += '<div style="max-height:50vh;overflow-y:auto;">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.10);color:#aaa;text-align:left;"><th style="padding:6px 8px;">Sorteo</th><th style="padding:6px 8px;">Tipo</th><th style="padding:6px 8px;">Cupos</th><th style="padding:6px 8px;">Recaudado</th><th style="padding:6px 8px;">Status</th></tr></thead><tbody>';
            for (const r of list) {
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
                html += '<td style="padding:6px 8px;color:#fff;">' + (r.emoji||'') + ' ' + escapeHtml(r.name||'') + '</td>';
                html += '<td style="padding:6px 8px;color:#ddd;">' + escapeHtml(r.raffleType||'') + (r.entryMode==='wagered'?' (wagered)':'') + '</td>';
                html += '<td style="padding:6px 8px;color:#aaa;">' + (r.cuposSold||0) + '/' + (r.totalTickets||0) + ' (' + (r.participants||0) + 'p)</td>';
                html += '<td style="padding:6px 8px;color:#d4af37;">' + _fmtMoney(r.revenue) + '</td>';
                html += '<td style="padding:6px 8px;color:#888;">' + escapeHtml(r.status||'') + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table></div>';
            html += '<button onclick="purgeLegacyRaffles()" style="margin-top:14px;width:100%;background:linear-gradient(135deg,#ff6b6b,#ff8866);color:#fff;border:none;padding:12px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">🗑️ Cancelar TODOS y reembolsar a participantes</button>';
        }
        document.getElementById('legacyRafflesBody').innerHTML = html;
    } catch (e) {
        document.getElementById('legacyRafflesBody').innerHTML = '<div style="color:#ff8080;padding:30px;text-align:center;">Error de conexión</div>';
    }
}

async function purgeLegacyRaffles() {
    if (!confirm('¿Cancelar TODOS los sorteos del modelo viejo y reembolsar a los participantes que hayan pagado? No se puede deshacer.')) return;
    try {
        const resp = await authFetch('/api/admin/raffles/purge-legacy', { method: 'POST' });
        const d = await resp.json();
        if (!resp.ok) { alert('❌ ' + (d.error || 'Error')); return; }
        let msg = '🗑️ Purga completa\n\n';
        msg += '✅ ' + (d.cancelled || 0) + ' sorteo' + ((d.cancelled||0)===1?'':'s') + ' cancelado' + ((d.cancelled||0)===1?'':'s') + '\n';
        msg += '💰 ' + (d.refundedCount || 0) + ' reembolso' + ((d.refundedCount||0)===1?'':'s') + ' por ' + _fmtMoney(d.refundedAmount) + '\n';
        if (d.errors > 0) msg += '⚠️ ' + d.errors + ' error' + (d.errors===1?'':'es') + ' (revisá los logs)\n';
        alert(msg);
        const modal = document.getElementById('legacyRafflesModal');
        if (modal) modal.style.display = 'none';
        loadRafflesAdmin();
    } catch (e) { showToast('Error de conexión', 'error'); }
}



// 🧪 Modo test: dispara todas las notifs (engagement + samples de bonus)
// a un usuario para verificar UX. Usa ScheduledNotification (cron poller),
// espaciadas ~100s entre cada una para que el SO no las agrupe.
async function testFireAutomation() {
    const username = (prompt('Usuario para testear (ej: lalodj):') || '').trim();
    if (!username) return;
    const intervalSeconds = parseInt(prompt('Intervalo entre notifs (segundos, default 100):', '100'), 10) || 100;
    const ok = confirm('Vas a disparar TODAS las notifs (engagement pool + 2 samples de bono) al usuario "' + username + '" cada ' + intervalSeconds + 's. ¿Confirmás?');
    if (!ok) return;
    try {
        const r = await authFetch('/api/admin/automation/test-fire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, intervalSeconds, includeBonus: true })
        });
        const d = await r.json();
        if (!r.ok || !d.success) {
            showToast(d.error || 'Error en test', 'error');
            return;
        }
        const last = d.lastAt ? new Date(d.lastAt).toLocaleTimeString('es-AR') : '?';
        const first = d.firstAt ? new Date(d.firstAt).toLocaleTimeString('es-AR') : '?';
        showToast('✅ ' + d.total + ' notifs programadas para ' + d.username + ' (entre ' + first + ' y ' + last + ')', 'success');
        // Mostrar detalle.
        const list = (d.notifications || []).map(n => '  ' + n.n + ') ' + n.kind + ' · ' + new Date(n.scheduledFor).toLocaleTimeString('es-AR') + ' — ' + n.title).join('\n');
        alert('🧪 Test programado para ' + d.username + ':\n\n' + list + '\n\n💡 El cron poller corre cada 60s, así que puede haber hasta 1min de delay sobre el horario programado.');
    } catch (e) { showToast('Error de conexión', 'error'); }
}


// ============================================================
// TOP JUGADORES — segmentacion custom por owner
// ============================================================
const _TOP_PLAYERS_STATE = {
    period: 'month',     // w1 | w2 | w3 | w4 | month
    segment: 'all',      // all | caliente | en_riesgo | perdido | inactivo
    team: '',
    hasApp: 'all',       // all | yes | no
    tier: '',
    limit: 500,
    data: null
};

const _TOP_PLAYERS_SEGMENTS = [
    { key: 'CALIENTE',  label: 'Calientes',   emoji: '🔥', color: '#ff6b35', desc: '10+ cargas última semana' },
    { key: 'ACTIVO',    label: 'Activos',     emoji: '✅', color: '#66ff66', desc: 'Hizo carga reciente' },
    { key: 'EN_RIESGO', label: 'En riesgo',   emoji: '⚠️', color: '#ffaa66', desc: 'Sin carga 5-9 días' },
    { key: 'PERDIDO',   label: 'Perdidos',    emoji: '😟', color: '#ff8080', desc: 'Sin carga 10-19 días' },
    { key: 'INACTIVO',  label: 'Inactivos',   emoji: '💀', color: '#888888', desc: 'Sin carga 20+ días' }
];

async function loadTopPlayers() {
    const c = document.getElementById('topPlayersContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state">⏳ Cargando segmentación…</div>';
    const qs = new URLSearchParams({
        period: _TOP_PLAYERS_STATE.period,
        segment: _TOP_PLAYERS_STATE.segment,
        hasApp: _TOP_PLAYERS_STATE.hasApp,
        limit: String(_TOP_PLAYERS_STATE.limit)
    });
    if (_TOP_PLAYERS_STATE.team) qs.set('team', _TOP_PLAYERS_STATE.team);
    if (_TOP_PLAYERS_STATE.tier) qs.set('tier', _TOP_PLAYERS_STATE.tier);
    try {
        const r = await authFetch('/api/admin/players/segments?' + qs.toString());
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            c.innerHTML = '<div style="color:#ff8080;padding:20px;">' + (err.error || 'Error') + '</div>';
            return;
        }
        _TOP_PLAYERS_STATE.data = await r.json();
        c.innerHTML = _renderTopPlayers();
    } catch (e) {
        console.error('loadTopPlayers:', e);
        c.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión</div>';
    }
}

function _setTopPlayersFilter(key, val) {
    _TOP_PLAYERS_STATE[key] = val;
    loadTopPlayers();
}

function _renderTopPlayers() {
    const d = _TOP_PLAYERS_STATE.data;
    if (!d) return '<div class="empty-state">Sin datos</div>';
    const counts = d.counts || {};
    const players = d.players || [];
    const teams = d.teamsAvailable || [];
    const range = d.range || {};

    let html = '';

    // Periodo
    html += '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px;color:#aaa;margin-bottom:8px;">';
    html += '<span style="font-weight:800;text-transform:uppercase;letter-spacing:1px;">Periodo:</span>';
    const periods = [
        { k: 'w1', label: 'Semana 1' },
        { k: 'w2', label: 'Semana 2' },
        { k: 'w3', label: 'Semana 3' },
        { k: 'w4', label: 'Semana 4' },
        { k: 'month', label: 'Mes completo' }
    ];
    for (const p of periods) {
        const active = _TOP_PLAYERS_STATE.period === p.k;
        html += '<button type="button" onclick="_setTopPlayersFilter(\'period\',\'' + p.k + '\')" style="background:' + (active ? '#d4af37' : 'rgba(255,255,255,0.06)') + ';color:' + (active ? '#000' : '#fff') + ';border:1px solid rgba(212,175,55,0.40);padding:5px 10px;border-radius:6px;font-weight:' + (active ? '900' : '700') + ';font-size:11px;cursor:pointer;">' + p.label + '</button>';
    }
    html += '<span style="margin-left:8px;color:#666;font-size:10px;">' + escapeHtml(range.label || '') + '</span>';
    html += '</div>';

    // Filtros equipo / app / tier
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:11px;color:#aaa;">';
    html += '<span style="font-weight:800;text-transform:uppercase;letter-spacing:1px;">App:</span>';
    for (const a of [{ k: 'all', l: 'Todos' }, { k: 'yes', l: 'Con app' }, { k: 'no', l: 'Sin app' }]) {
        const active = _TOP_PLAYERS_STATE.hasApp === a.k;
        html += '<button type="button" onclick="_setTopPlayersFilter(\'hasApp\',\'' + a.k + '\')" style="background:' + (active ? '#00d4ff' : 'rgba(255,255,255,0.06)') + ';color:' + (active ? '#000' : '#fff') + ';border:1px solid rgba(0,212,255,0.40);padding:4px 9px;border-radius:6px;font-weight:' + (active ? '900' : '700') + ';font-size:11px;cursor:pointer;">' + a.l + '</button>';
    }

    html += '<span style="margin-left:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Equipo:</span>';
    html += '<select onchange="_setTopPlayersFilter(\'team\', this.value)" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:11px;">';
    html += '<option value="">— todos —</option>';
    for (const t of teams) {
        const sel = _TOP_PLAYERS_STATE.team === t ? ' selected' : '';
        html += '<option value="' + escapeHtml(t) + '"' + sel + '>' + escapeHtml(t) + '</option>';
    }
    html += '</select>';

    html += '<span style="margin-left:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Tier:</span>';
    html += '<select onchange="_setTopPlayersFilter(\'tier\', this.value)" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:11px;">';
    // SIN_DATOS no aparece como filtro de notify: son usuarios sin estadisticas
    // confiables, asi que mandarles push masivo segmentado por tier no tiene
    // sentido (siempre quedan incluidos cuando tier='' = todos).
    for (const t of [{ k: '', l: '— todos —' }, { k: 'VIP', l: 'VIP' }, { k: 'ORO', l: 'ORO' }, { k: 'PLATA', l: 'PLATA' }, { k: 'BRONCE', l: 'BRONCE' }, { k: 'NUEVO', l: 'NUEVO' }]) {
        const sel = _TOP_PLAYERS_STATE.tier === t.k ? ' selected' : '';
        html += '<option value="' + t.k + '"' + sel + '>' + t.l + '</option>';
    }
    html += '</select>';
    html += '</div></div>';

    // Tarjetas de segmentos clickeables
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin-bottom:12px;">';
    const allSeg = { key: 'all', label: 'Todos', emoji: '👥', color: '#fff', desc: 'Todos los jugadores' };
    const totalShown = counts.total || 0;
    const segCards = [allSeg, ..._TOP_PLAYERS_SEGMENTS];
    for (const s of segCards) {
        const isAll = s.key === 'all';
        const count = isAll ? totalShown : (counts[s.key] || 0);
        const active = (_TOP_PLAYERS_STATE.segment.toLowerCase() === s.key.toLowerCase());
        html += '<button type="button" onclick="_setTopPlayersFilter(\'segment\',\'' + s.key.toLowerCase() + '\')" style="background:' + (active ? 'rgba(' + _hexToRgb(s.color) + ',0.15)' : 'rgba(0,0,0,0.30)') + ';border:2px solid ' + (active ? s.color : 'rgba(255,255,255,0.10)') + ';border-radius:10px;padding:10px;text-align:left;cursor:pointer;color:#fff;">';
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:18px;">' + s.emoji + '</span><span style="color:' + s.color + ';font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:1px;">' + s.label + '</span></div>';
        html += '<div style="color:#fff;font-size:22px;font-weight:900;">' + count.toLocaleString('es-AR') + '</div>';
        html += '<div style="color:#888;font-size:10px;margin-top:2px;">' + s.desc + '</div>';
        html += '</button>';
    }
    html += '</div>';

    // Bulk notify (solo si filtro segment != all y hay con app)
    if (_TOP_PLAYERS_STATE.segment !== 'all') {
        const segUp = _TOP_PLAYERS_STATE.segment.toUpperCase();
        const segMeta = _TOP_PLAYERS_SEGMENTS.find(s => s.key === segUp);
        const eligible = players.filter(p => p.hasApp).length;
        const noAppCount = players.filter(p => !p.hasApp).length;
        html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:10px;padding:12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;">';
        html += '<div style="font-size:12px;color:#ddd;">';
        html += '<strong>' + eligible + '</strong> con app (push directo) · <strong>' + noAppCount + '</strong> sin app (WhatsApp por línea del equipo)';
        html += '</div>';
        if (eligible > 0) {
            html += '<button type="button" onclick="_openTopPlayersNotifyModal(\'' + segUp + '\')" style="background:linear-gradient(135deg,#00d4ff,#0088ff);color:#000;border:none;padding:8px 14px;border-radius:6px;font-weight:800;font-size:12px;cursor:pointer;">📲 Notificar ' + (segMeta ? segMeta.label : segUp) + ' con app (' + eligible + ')</button>';
        }
        html += '</div>';
    }

    // Tabla de jugadores
    if (players.length === 0) {
        html += '<div style="text-align:center;padding:30px;color:#888;background:rgba(255,255,255,0.03);border-radius:10px;">No hay jugadores en este segmento con los filtros aplicados.</div>';
        return html;
    }

    html += '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;max-height:65vh;overflow-y:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
    html += '<thead style="position:sticky;top:0;background:#2d0052;z-index:1;"><tr style="color:#d4af37;text-align:left;">';
    html += '<th style="padding:8px 10px;font-weight:800;">#</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Usuario</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Estado</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Tier</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">App</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Equipo</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Cargas (período)</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">$ período</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Días sin carga</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">$ neto 30d</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Bonos 30d</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Acción</th>';
    html += '</tr></thead><tbody>';

    let idx = 1;
    for (const p of players) {
        const segMeta = _TOP_PLAYERS_SEGMENTS.find(s => s.key === p.segment) || { color: '#fff', emoji: '·', label: p.segment };
        const tierColor = { VIP: '#ffd700', ORO: '#f0a060', PLATA: '#bbbbbb', BRONCE: '#cd7f32', NUEVO: '#66ff66', SIN_DATOS: '#666' }[p.tier] || '#888';
        const opp = p.isOpportunist ? ' <span title="Oportunista" style="color:#ff8080;font-size:11px;">⚠️</span>' : '';
        const wa = p.linePhone ? '<a href="https://wa.me/' + encodeURIComponent(p.linePhone.replace(/[^\d]/g, '')) + '" target="_blank" style="color:#25D366;text-decoration:none;font-weight:700;">📞</a>' : '';
        const dni = p.daysSinceLastDeposit;
        const dniStr = dni == null ? 'nunca' : (dni + ' día' + (dni === 1 ? '' : 's'));

        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:8px 10px;color:#666;">' + idx + '</td>';
        html += '<td style="padding:8px 10px;color:#fff;font-weight:700;">' + escapeHtml(p.username) + opp + '</td>';
        html += '<td style="padding:8px 10px;color:' + segMeta.color + ';font-weight:800;font-size:11px;">' + segMeta.emoji + ' ' + segMeta.label + '</td>';
        html += '<td style="padding:8px 10px;color:' + tierColor + ';font-weight:800;">' + (p.tier || '—') + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;">' + (p.hasApp ? '<span style="color:#66ff66;font-weight:800;">✅</span>' : '<span style="color:#888;">❌</span>') + '</td>';
        html += '<td style="padding:8px 10px;color:#ddd;font-size:10.5px;">' + (p.team ? escapeHtml(p.team) : '<span style="color:#666;">—</span>') + ' ' + wa + '</td>';
        html += '<td style="padding:8px 10px;color:#fff;text-align:right;font-weight:700;">' + (p.chargesInPeriod || 0) + '</td>';
        html += '<td style="padding:8px 10px;color:#d4af37;text-align:right;font-weight:800;white-space:nowrap;">' + _fmtMoney(p.depositsInPeriod) + '</td>';
        html += '<td style="padding:8px 10px;color:' + (dni == null ? '#888' : (dni > 19 ? '#888' : (dni > 9 ? '#ff8080' : (dni > 4 ? '#ffaa66' : '#66ff66')))) + ';text-align:center;font-weight:800;">' + dniStr + '</td>';
        html += '<td style="padding:8px 10px;color:' + ((p.netToHouse30d || 0) >= 0 ? '#66ff66' : '#ff8080') + ';text-align:right;font-weight:700;white-space:nowrap;">' + _fmtMoney(p.netToHouse30d) + '</td>';
        html += '<td style="padding:8px 10px;color:#aaa;text-align:right;white-space:nowrap;">' + _fmtMoney(p.bonusGiven30d) + (p.roiPerBonus != null ? '<div style="color:#666;font-size:10px;">ROI ' + (p.roiPerBonus.toFixed(1)) + 'x</div>' : '') + '</td>';
        html += '<td style="padding:6px;text-align:center;white-space:nowrap;">';
        html += '<button type="button" onclick="_topPlayerDetail(' + escapeJsArg(p.username) + ')" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:4px 8px;border-radius:5px;font-size:10px;cursor:pointer;">Ver</button>';
        html += '</td>';
        html += '</tr>';
        idx++;
    }
    html += '</tbody></table></div>';
    return html;
}

function _hexToRgb(hex) {
    const h = String(hex || '#fff').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return r + ',' + g + ',' + b;
}

// =============================================
// NUMEROS DE RESPALDO — listado de usuarios que dejaron telefono de contacto
// desde el chip "📞 Tu N°" en la home. Acceso protegido por PIN (1818) en
// el cliente — el dueño no quiere que cualquier admin vea la lista.
// =============================================
let _BACKUP_PHONES_UNLOCKED = false;
let _BACKUP_PHONES_CACHE = null;

function loadBackupPhonesGate() {
    const c = document.getElementById('backupPhonesContent');
    const refreshBtn = document.getElementById('backupPhonesRefreshBtn');
    if (!c) return;
    if (_BACKUP_PHONES_UNLOCKED) {
        if (refreshBtn) {
            refreshBtn.style.display = '';
            refreshBtn.onclick = () => { _BACKUP_PHONES_CACHE = null; loadBackupPhonesData(); };
        }
        loadBackupPhonesData();
        return;
    }
    if (refreshBtn) refreshBtn.style.display = 'none';
    let html = '';
    html += '<div style="max-width:380px;margin:30px auto;background:rgba(31,140,255,0.06);border:1px solid rgba(31,140,255,0.40);border-radius:10px;padding:18px;">';
    html += '  <div style="font-size:14px;color:#1f8cff;font-weight:700;margin-bottom:6px;">🔒 Sección protegida</div>';
    html += '  <div style="font-size:12px;color:#bbb;line-height:1.5;margin-bottom:12px;">Esta sección requiere PIN para abrirse. Sólo el dueño tiene acceso a los números.</div>';
    html += '  <input id="backupPhonesPin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN" autocomplete="off" style="width:100%;background:rgba(0,0,0,0.45);color:#fff;border:1px solid rgba(255,255,255,0.18);padding:9px 11px;border-radius:6px;font-size:14px;letter-spacing:6px;text-align:center;box-sizing:border-box;margin-bottom:10px;">';
    html += '  <button id="backupPhonesPinBtn" type="button" style="width:100%;background:linear-gradient(135deg,#1f8cff 0%,#0d47a1 100%);color:#fff;border:none;padding:9px 12px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Desbloquear</button>';
    html += '  <div id="backupPhonesPinError" style="margin-top:8px;font-size:11px;color:#ff8a8a;display:none;">PIN incorrecto.</div>';
    html += '</div>';
    c.innerHTML = html;
    const pinInput = document.getElementById('backupPhonesPin');
    const pinBtn = document.getElementById('backupPhonesPinBtn');
    const pinErr = document.getElementById('backupPhonesPinError');
    const tryUnlock = () => {
        const v = String((pinInput && pinInput.value) || '').trim();
        if (v === '1818') {
            _BACKUP_PHONES_UNLOCKED = true;
            if (pinErr) pinErr.style.display = 'none';
            loadBackupPhonesGate();
        } else {
            if (pinErr) pinErr.style.display = '';
            if (pinInput) { pinInput.value = ''; pinInput.focus(); }
        }
    };
    if (pinBtn) pinBtn.addEventListener('click', tryUnlock);
    if (pinInput) {
        pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
        setTimeout(() => { try { pinInput.focus(); } catch (_) {} }, 30);
    }
}

async function loadBackupPhonesData() {
    const c = document.getElementById('backupPhonesContent');
    if (!c) return;
    if (!_BACKUP_PHONES_CACHE) {
        c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando números…</div>';
    }
    try {
        const r = await authFetch('/api/admin/backup-phones?limit=5000');
        if (!r.ok) {
            c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#ff8a8a;">Error: ' + r.status + '</div>';
            return;
        }
        const d = await r.json();
        _BACKUP_PHONES_CACHE = d;
        renderBackupPhones(d);
    } catch (e) {
        c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#ff8a8a;">Error de conexión: ' + (e.message || e) + '</div>';
    }
}

function renderBackupPhones(d) {
    const c = document.getElementById('backupPhonesContent');
    if (!c) return;
    const items = (d && d.items) || [];
    let html = '';
    html += '<div style="background:rgba(31,140,255,0.06);border:1px solid rgba(31,140,255,0.30);border-radius:10px;padding:12px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">';
    html += '  <div>';
    html += '    <div style="color:#1f8cff;font-weight:700;font-size:13px;margin-bottom:4px;">Total registrado: ' + items.length + '</div>';
    html += '    <div style="color:#bbb;font-size:11px;line-height:1.5;">Usuarios que dejaron su número de respaldo desde el chip de la home. Ordenado por más reciente.</div>';
    html += '  </div>';
    html += '  <button id="backupPhonesCsvBtn" type="button" style="background:linear-gradient(135deg,#25d366 0%,#128c4f 100%);color:#fff;border:none;padding:9px 14px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;">⬇️ Descargar CSV</button>';
    html += '</div>';
    if (items.length === 0) {
        html += '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">Todavía nadie dejó número de respaldo.</div>';
    } else {
        html += '<div style="overflow-x:auto;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '  <thead><tr style="background:rgba(255,255,255,0.04);">';
        html += '    <th style="text-align:left;padding:8px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Equipo</th>';
        html += '    <th style="text-align:left;padding:8px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Usuario</th>';
        html += '    <th style="text-align:left;padding:8px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Teléfono</th>';
        html += '    <th style="text-align:left;padding:8px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Fecha</th>';
        html += '  </tr></thead>';
        html += '  <tbody>';
        for (const it of items) {
            const dt = it.submittedAt ? new Date(it.submittedAt) : null;
            const dtStr = dt ? dt.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
            html += '<tr>';
            html += '  <td style="padding:7px 10px;color:#ccc;border-bottom:1px solid rgba(255,255,255,0.05);">' + escapeHtml(it.team || '—') + '</td>';
            html += '  <td style="padding:7px 10px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.05);">' + escapeHtml(it.username || '') + '</td>';
            html += '  <td style="padding:7px 10px;color:#66e69b;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.05);font-family:monospace;">' + escapeHtml(it.phone || '') + '</td>';
            html += '  <td style="padding:7px 10px;color:#999;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;">' + escapeHtml(dtStr) + '</td>';
            html += '</tr>';
        }
        html += '  </tbody></table>';
        html += '</div>';
    }
    c.innerHTML = html;
    const csvBtn = document.getElementById('backupPhonesCsvBtn');
    if (csvBtn) csvBtn.addEventListener('click', downloadBackupPhonesCsv);
}

async function downloadBackupPhonesCsv() {
    try {
        const r = await authFetch('/api/admin/backup-phones.csv');
        if (!r.ok) {
            alert('No se pudo descargar el CSV (HTTP ' + r.status + ')');
            return;
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'numeros-respaldo-' + (new Date().toISOString().slice(0, 10)) + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1500);
    } catch (e) {
        alert('Error descargando CSV: ' + (e.message || e));
    }
}

// =============================================
// ENCUESTA — seccion del admin con distribucion + estrategia editable
// =============================================
let _ENCUESTA_CACHE = null;
let _ENCUESTA_POLL = null;

async function loadEncuesta() {
    const c = document.getElementById('encuestaContent');
    if (!c) return;
    if (!_ENCUESTA_CACHE) {
        c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando respuestas…</div>';
    }
    try {
        // Stats agregadas + timeline (TODOS los respondentes con netToHouse30d
        // joineado de PlayerStats) + config de estrategia. NO usamos /players/
        // segments porque ese filtra por actividad reciente y deja afuera a
        // los que respondieron pero no cargaron — el contador y la lista
        // tienen que matchear.
        const [statsR, timelineR, strategyR] = await Promise.all([
            authFetch('/api/admin/users/notif-preference-stats'),
            authFetch('/api/admin/encuesta/timeline?limit=500'),
            authFetch('/api/admin/notif-strategy')
        ]);
        const stats = statsR.ok ? await statsR.json() : null;
        const timeline = timelineR.ok ? await timelineR.json() : null;
        const strategy = strategyR.ok ? await strategyR.json() : null;

        // Mapeamos timeline al shape que espera el render (compat con la lista
        // que venía de segments). La key sigue siendo `list.players` para no
        // tocar el render.
        const list = timeline ? { players: timeline.items || [] } : null;

        _ENCUESTA_CACHE = { stats, list, strategy, timeline };
        c.innerHTML = _renderEncuesta();

        // Arrancar polling si no esta corriendo: refresca cada 30s para
        // ver gente nueva entrando.
        if (_ENCUESTA_POLL) clearInterval(_ENCUESTA_POLL);
        _ENCUESTA_POLL = setInterval(() => {
            const sec = document.getElementById('encuestaSection');
            if (!sec || !sec.classList.contains('active')) {
                clearInterval(_ENCUESTA_POLL);
                _ENCUESTA_POLL = null;
                return;
            }
            _refreshEncuestaSilent();
        }, 30000);
    } catch (e) {
        console.error('loadEncuesta:', e);
        c.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión: ' + escapeHtml(e.message || '') + '</div>';
    }
}

// Refresh silencioso sin loader, solo actualiza la lista. Usa el mismo
// endpoint que loadEncuesta (/encuesta/timeline) para que la lista no se
// reduzca al subset filtrado por actividad — antes pegaba a /players/
// segments?period=month y a los 30s la tabla se vaciaba a los 7 activos.
async function _refreshEncuestaSilent() {
    try {
        const [statsR, timelineR] = await Promise.all([
            authFetch('/api/admin/users/notif-preference-stats'),
            authFetch('/api/admin/encuesta/timeline?limit=500')
        ]);
        if (statsR.ok && timelineR.ok) {
            const stats = await statsR.json();
            const timeline = await timelineR.json();
            const list = { players: (timeline && timeline.items) || [] };
            // Mantenemos strategy del cache (no cambia tan seguido).
            _ENCUESTA_CACHE.stats = stats;
            _ENCUESTA_CACHE.list = list;
            _ENCUESTA_CACHE.timeline = timeline;
            const c = document.getElementById('encuestaContent');
            if (c) c.innerHTML = _renderEncuesta();
        }
    } catch (_) { /* silencioso */ }
}

// _ENCUESTA_TAB controla qué hoja se muestra: 'estrategia' | 'gente' | 'roi' | 'historial'.
// _ENCUESTA_HISTORY_CACHE guarda la última respuesta del weekly-history para no
// repegar al backend cada switch.
window._ENCUESTA_TAB = window._ENCUESTA_TAB || 'estrategia';
window._ENCUESTA_HISTORY_CACHE = window._ENCUESTA_HISTORY_CACHE || null;

function _setEncuestaTab(tab) {
    window._ENCUESTA_TAB = tab;
    const c = document.getElementById('encuestaContent');
    if (c) c.innerHTML = _renderEncuesta();
    // Carga lazy de la historia semanal cuando se entra por primera vez.
    if (tab === 'historial') {
        loadEncuestaWeeklyHistory();
    }
}

function _renderEncuestaTabsNav(activeTab) {
    const tabs = [
        { k: 'estrategia', l: '📋 Estrategia' },
        { k: 'gente',      l: '👥 Gente que se une' },
        { k: 'roi',        l: '📊 ROI / Reacciones' },
        { k: 'historial',  l: '📅 Historial semanal' }
    ];
    let html = '<div style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid rgba(212,175,55,0.20);margin-bottom:14px;padding-bottom:6px;">';
    for (const t of tabs) {
        const active = t.k === activeTab;
        html += '<button type="button" onclick="_setEncuestaTab(\'' + t.k + '\')" style="background:' + (active ? 'linear-gradient(135deg,#d4af37,#b8941a)' : 'rgba(255,255,255,0.04)') + ';color:' + (active ? '#000' : '#ddd') + ';border:1px solid ' + (active ? '#d4af37' : 'rgba(212,175,55,0.30)') + ';padding:7px 13px;border-radius:8px;font-weight:' + (active ? '900' : '700') + ';font-size:12px;cursor:pointer;letter-spacing:0.3px;">' + t.l + '</button>';
    }
    html += '</div>';
    return html;
}

function _renderEncuesta() {
    const d = _ENCUESTA_CACHE || {};
    const stats = d.stats || { total: 0, counts: {} };
    const counts = stats.counts || {};
    // En el sumatorio sumamos solo_reembolsos como "respondio" (es una
    // respuesta valida, no es 'no quiere'). opt_out sigue contando como
    // respondio para los users viejos.
    const respondedTotal = (counts.suave || 0) + (counts.normal || 0) + (counts.activo || 0) + (counts.opt_out || 0) + (counts.solo_reembolsos || 0);

    const tab = window._ENCUESTA_TAB || 'estrategia';
    let html = '';
    html += _renderEncuestaTabsNav(tab);
    if (tab === 'estrategia')      html += _renderEncuestaTabEstrategia(d, respondedTotal);
    else if (tab === 'gente')      html += _renderEncuestaTabGente(d, respondedTotal);
    else if (tab === 'roi')        html += _renderEncuestaTabROI(d);
    else if (tab === 'historial')  html += _renderEncuestaTabHistorial();
    else                            html += _renderEncuestaTabEstrategia(d, respondedTotal);
    // Post-render hook: hidratamos el cronograma semanal después de que el
    // caller asigne innerHTML. setTimeout(0) garantiza que el placeholder
    // ya esté en el DOM cuando loadWeeklySchedule busque el elemento.
    if (tab === 'estrategia') {
        setTimeout(() => { try { loadWeeklySchedule(7); } catch (_) {} }, 0);
    }
    return html;
}

// Tab 1: Estrategia — pregunta + editor + simulator + activar.
function _renderEncuestaTabEstrategia(d, respondedTotal) {
    const strategy = d.strategy || null;
    let html = '';
    html += _renderSurveyQuestion();
    html += _renderStrategyEditor(strategy, respondedTotal);
    return html;
}

// Tab 2: Gente que se va uniendo. KPI + filtros + tabla en orden cronológico
// con el botón Regalar bono por usuario. También muestra el contador de
// respondentes y cuánto falta para la próxima wave automática.
function _renderEncuestaTabGente(d, respondedTotal) {
    const stats = d.stats || { total: 0, counts: {} };
    const list = d.list || { players: [] };
    const counts = stats.counts || {};
    const total = stats.total || 0;
    const sumPref = (counts.suave || 0) + (counts.normal || 0) + (counts.activo || 0) + (counts.opt_out || 0) + (counts.solo_reembolsos || 0);
    const sinResp = total - sumPref;
    const pct = (n) => total ? ((n / total) * 100).toFixed(1) + '%' : '0%';

    const strategy = d.strategy || null;
    const isActive = !!(strategy && strategy.isActive);
    const threshold = (strategy && strategy.autoRepeatThreshold) || 100;
    const lastFired = (strategy && strategy.lastAutoFiredAtRespCount) || 0;
    const autoFireCount = (strategy && strategy.autoFireCount) || 0;
    const nextThreshold = (Math.floor(respondedTotal / threshold) + 1) * threshold;
    const remaining = Math.max(0, nextThreshold - respondedTotal);

    let html = '';

    // Banner de progreso de cohortes +N
    html += '<div style="background:linear-gradient(135deg,rgba(102,255,102,0.10),rgba(212,175,55,0.05));border:1px solid rgba(102,255,102,0.40);border-radius:10px;padding:12px;margin-bottom:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px;">';
    html += '<h3 style="color:#66ff66;font-size:13px;margin:0;letter-spacing:1px;text-transform:uppercase;">📈 Progreso de respuestas</h3>';
    html += '<div style="color:#aaa;font-size:11px;">' + respondedTotal.toLocaleString('es-AR') + ' respondieron · falta ' + remaining + ' para llegar a ' + nextThreshold + '</div>';
    html += '</div>';
    const progressPct = Math.min(100, Math.round((respondedTotal % threshold) / threshold * 100));
    html += '<div style="background:rgba(0,0,0,0.40);border-radius:10px;height:14px;overflow:hidden;">';
    html += '<div style="background:linear-gradient(90deg,#66ff66,#d4af37);height:100%;width:' + progressPct + '%;transition:width 0.3s;"></div>';
    html += '</div>';
    if (!isActive && respondedTotal >= threshold) {
        html += '<div style="color:#66ff66;font-size:11.5px;margin-top:8px;">✅ Llegamos a ' + threshold + ' — ya podés ver la previa y activar la estrategia desde la pestaña <strong>📋 Estrategia</strong>.</div>';
    } else if (!isActive) {
        html += '<div style="color:#aaa;font-size:11.5px;margin-top:8px;">🔒 Esperando ' + threshold + ' respuestas para desbloquear preview/activar la primera estrategia.</div>';
    } else {
        html += '<div style="color:#66ff66;font-size:11.5px;margin-top:8px;">✅ Estrategia activa · auto-waves disparadas: ' + autoFireCount + ' · última al cruzar ' + lastFired.toLocaleString('es-AR') + ' respuestas.</div>';
    }
    html += '</div>';

    // KPIs por tier.
    html += '<h3 style="color:#d4af37;font-size:13px;margin:14px 0 8px;text-transform:uppercase;letter-spacing:1px;">📊 Distribución actual</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:14px;">';
    html += _kpiCard('Total usuarios', total.toLocaleString('es-AR'), '#fff');
    html += _kpiCard('🟢 SUAVE', (counts.suave || 0).toLocaleString('es-AR') + ' · ' + pct(counts.suave || 0), '#66ff66');
    html += _kpiCard('🟡 NORMAL', (counts.normal || 0).toLocaleString('es-AR') + ' · ' + pct(counts.normal || 0), '#ffd700');
    html += _kpiCard('🔴 ACTIVO', (counts.activo || 0).toLocaleString('es-AR') + ' · ' + pct(counts.activo || 0), '#ff8c5a');
    html += _kpiCard('🔔 SOLO REEMB', ((counts.solo_reembolsos || 0) + (counts.opt_out || 0)).toLocaleString('es-AR') + ' · ' + pct((counts.solo_reembolsos || 0) + (counts.opt_out || 0)), '#00d4ff');
    html += _kpiCard('Sin responder', sinResp.toLocaleString('es-AR') + ' · ' + pct(sinResp), '#888');
    html += '</div>';

    // Filtros
    html += '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
    html += '<span style="color:#aaa;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Ver:</span>';
    const filters = [
        { k: 'all', l: 'Todas las respuestas' },
        { k: 'suave', l: '🟢 SUAVE' },
        { k: 'normal', l: '🟡 NORMAL' },
        { k: 'activo', l: '🔴 ACTIVO' },
        { k: 'solo_reembolsos', l: '🔔 SOLO REEMB' },
        { k: 'opt_out', l: '🚫 OPT-OUT (legacy)' }
    ];
    const cur = (window._ENCUESTA_FILTER || 'all');
    for (const f of filters) {
        const active = cur === f.k;
        html += '<button type="button" onclick="_setEncuestaFilter(\'' + f.k + '\')" style="background:' + (active ? '#d4af37' : 'rgba(255,255,255,0.06)') + ';color:' + (active ? '#000' : '#fff') + ';border:1px solid rgba(212,175,55,0.35);padding:5px 10px;border-radius:6px;font-weight:' + (active ? '900' : '700') + ';font-size:11px;cursor:pointer;">' + f.l + '</button>';
    }
    html += '</div>';

    // Tabla — orden cronológico desc (los más nuevos arriba).
    const players = list.players || [];
    const respondedOnly = players
        .filter(p => !!p.notifPreference)
        .sort((a, b) => {
            const ta = a.notifPreferenceAt ? new Date(a.notifPreferenceAt).getTime() : 0;
            const tb = b.notifPreferenceAt ? new Date(b.notifPreferenceAt).getTime() : 0;
            return tb - ta;
        });
    const filtered = respondedOnly.filter(p => {
        if (cur === 'all') return true;
        return p.notifPreference === cur;
    });

    if (filtered.length === 0) {
        html += '<div style="text-align:center;padding:30px;color:#888;background:rgba(255,255,255,0.03);border-radius:10px;">';
        if (respondedOnly.length === 0) {
            html += 'Todavía nadie respondió la encuesta. La gente la verá la primera vez que entre a la PWA.';
        } else {
            html += 'No hay usuarios con ese filtro.';
        }
        html += '</div>';
        return html;
    }

    html += '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;max-height:65vh;overflow-y:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
    html += '<thead style="position:sticky;top:0;background:#2d0052;z-index:1;"><tr style="color:#d4af37;text-align:left;">';
    html += '<th style="padding:8px 10px;font-weight:800;">#</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Usuario</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Encuesta</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Cuándo respondió</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Equipo</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">$ neto 30d</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">App</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Regalar</th>';
    html += '</tr></thead><tbody>';

    let idx = 1;
    for (const p of filtered) {
        const ans = p.notifPreferenceAt ? new Date(p.notifPreferenceAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:8px 10px;color:#666;">' + idx + '</td>';
        html += '<td style="padding:8px 10px;color:#fff;font-weight:700;">' + escapeHtml(p.username) + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;white-space:nowrap;">' + _fmtNotifPref(p.notifPreference) + '</td>';
        html += '<td style="padding:8px 10px;color:#aaa;text-align:right;font-size:10.5px;">' + ans + '</td>';
        html += '<td style="padding:8px 10px;color:#ddd;font-size:10.5px;">' + (p.team ? escapeHtml(p.team) : '<span style="color:#666;">—</span>') + '</td>';
        html += '<td style="padding:8px 10px;color:' + ((p.netToHouse30d || 0) >= 0 ? '#66ff66' : '#ff8080') + ';text-align:right;font-weight:700;white-space:nowrap;">' + _fmtMoney(p.netToHouse30d) + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;">' + (p.hasApp ? '<span style="color:#66ff66;">✅</span>' : '<span style="color:#888;">❌</span>') + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;white-space:nowrap;">';
        html += '<button type="button" onclick="openGrantBonusModal(' + escapeJsArg(p.username) + ')" style="background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:4px 9px;border-radius:6px;font-weight:900;font-size:10.5px;cursor:pointer;letter-spacing:0.3px;">🎁 Regalar</button>';
        html += '</td>';
        html += '</tr>';
        idx++;
    }
    html += '</tbody></table></div>';
    return html;
}

// Tab 3: ROI / Reacciones — el contenedor de reacciones existente.
function _renderEncuestaTabROI(d) {
    let html = '';
    html += '<div style="margin-bottom:10px;color:#aaa;font-size:11.5px;">Cómo está reaccionando la gente a las pushes que mandamos. Tier × cargas reales.</div>';
    html += _renderReactionsContainer();
    return html;
}

// Tab 4: Historial semanal — pulla weekly-history y arma tabla.
function _renderEncuestaTabHistorial() {
    const cache = window._ENCUESTA_HISTORY_CACHE;
    let html = '<div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
    html += '<div style="color:#aaa;font-size:11.5px;">Resumen semanal: respuestas nuevas, pushes mandadas, cargas reales y ROI estimado.</div>';
    html += '<button type="button" onclick="loadEncuestaWeeklyHistory(true)" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:700;">🔄 Refrescar</button>';
    html += '</div>';
    html += '<div id="encuestaHistorialBox">';
    if (!cache) {
        html += '<div style="text-align:center;padding:30px;color:#aaa;">⏳ Cargando historial semanal…</div>';
    } else {
        html += _renderWeeklyHistoryTable(cache);
    }
    html += '</div>';
    return html;
}

async function loadEncuestaWeeklyHistory(force) {
    if (!force && window._ENCUESTA_HISTORY_CACHE) return;
    try {
        const r = await authFetch('/api/admin/encuesta/weekly-history?weeks=12');
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            const box = document.getElementById('encuestaHistorialBox');
            if (box) box.innerHTML = '<div style="color:#ff8080;padding:14px;font-size:11.5px;">' + escapeHtml(err.error || 'Error al cargar historial') + '</div>';
            return;
        }
        const data = await r.json();
        window._ENCUESTA_HISTORY_CACHE = data;
        const box = document.getElementById('encuestaHistorialBox');
        if (box) box.innerHTML = _renderWeeklyHistoryTable(data);
    } catch (e) {
        const box = document.getElementById('encuestaHistorialBox');
        if (box) box.innerHTML = '<div style="color:#ff8080;padding:14px;font-size:11.5px;">Error de conexión: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function _renderWeeklyHistoryTable(d) {
    const buckets = d.buckets || [];
    if (buckets.length === 0) {
        return '<div style="color:#888;text-align:center;padding:20px;">Sin datos.</div>';
    }
    let html = '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
    html += '<thead><tr style="color:#d4af37;text-align:left;background:rgba(212,175,55,0.10);">';
    html += '<th style="padding:7px 9px;">Semana</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Respuestas nuevas</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Pushes</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Entregadas</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Clicks WA</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Reembolsos</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Regalos cash</th>';
    html += '<th style="padding:7px 9px;text-align:right;">$ regalado total</th>';
    html += '</tr></thead><tbody>';
    for (const b of buckets) {
        const week = new Date(b.weekStart).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' });
        const dlvPct = b.pushSent ? Math.round((b.pushDelivered / b.pushSent) * 100) : 0;
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:7px 9px;color:#fff;font-weight:700;">' + escapeHtml(week) + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#66ff66;font-weight:800;">' + b.newRespondents + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#fff;">' + b.pushSent + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#ddd;">' + b.pushDelivered + ' <span style="color:#666;font-size:10px;">(' + dlvPct + '%)</span></td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#00d4ff;">' + (b.waClicks || 0) + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#ddd;">' + b.refundsGiven + ' · $' + (b.refundsAmount || 0).toLocaleString('es-AR') + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#ddd;">' + b.giveawayCount + ' · $' + (b.giveawayAmount || 0).toLocaleString('es-AR') + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#ffd700;font-weight:800;">$' + (b.totalRegalado || 0).toLocaleString('es-AR') + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
}

// =============================================
// REVIEWS — opiniones de usuarios (admin con username completo + filtros)
// =============================================
let _ADMIN_REVIEWS_BUCKET = 'all';

async function loadAdminReviews() {
    const c = document.getElementById('reviewsAdminContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando opiniones…</div>';
    try {
        const r = await authFetch('/api/admin/reviews?bucket=' + _ADMIN_REVIEWS_BUCKET + '&limit=300');
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            c.innerHTML = '<div style="color:#ff8080;padding:20px;">Error: ' + escapeHtml(err.error || '') + '</div>';
            return;
        }
        const data = await r.json();
        c.innerHTML = _renderAdminReviews(data);
    } catch (e) {
        c.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function _setAdminReviewsBucket(bucket) {
    _ADMIN_REVIEWS_BUCKET = bucket;
    loadAdminReviews();
}

async function deleteAdminReview(id, username) {
    if (!id) return;
    if (!confirm('¿Borrar la opinión de "' + (username || '') + '"? Esta acción no se puede deshacer.')) return;
    try {
        const r = await authFetch('/api/admin/reviews/' + encodeURIComponent(id), { method: 'DELETE' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
            showToast('❌ ' + (d.error || 'No se pudo borrar'), 'error');
            return;
        }
        showToast('✅ Opinión borrada', 'success');
        loadAdminReviews();
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

function _renderAdminReviewsStars(n) {
    const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    let html = '';
    for (let i = 1; i <= 5; i++) {
        html += i <= v
            ? '<span style="color:#ffd700;">★</span>'
            : '<span style="color:#444;">★</span>';
    }
    return html;
}

function _renderAdminReviews(d) {
    const total = Number(d.total || 0);
    const avg = Number(d.avgStars || 0);
    const counts = d.counts || {};
    const items = Array.isArray(d.items) ? d.items : [];
    const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%';
    const bucket = _ADMIN_REVIEWS_BUCKET;

    let html = '';

    // KPI cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:14px;">';
    html += _kpiCard('Total opiniones', total.toLocaleString('es-AR'), '#fff');
    html += _kpiCard('Promedio', avg.toFixed(2) + ' / 5', '#ffd700');
    html += _kpiCard('😊 Bueno (4-5★)', (counts.bueno || 0) + ' · ' + pct(counts.bueno || 0), '#66ff66');
    html += _kpiCard('😐 Regular (3★)', (counts.regular || 0) + ' · ' + pct(counts.regular || 0), '#ffd700');
    html += _kpiCard('😟 Malo (1-2★)', (counts.malo || 0) + ' · ' + pct(counts.malo || 0), '#ff8080');
    html += '</div>';

    // Filter buttons
    const filters = [
        { k: 'all',     l: 'Todas' },
        { k: 'bueno',   l: '😊 Bueno (4-5★)',   color: '#66ff66' },
        { k: 'regular', l: '😐 Regular (3★)',   color: '#ffd700' },
        { k: 'malo',    l: '😟 Malo (1-2★)',    color: '#ff8080' }
    ];
    html += '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
    html += '<span style="color:#aaa;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Filtrar:</span>';
    for (const f of filters) {
        const active = f.k === bucket;
        const c = f.color || '#d4af37';
        html += '<button type="button" onclick="_setAdminReviewsBucket(\'' + f.k + '\')" style="background:' + (active ? c : 'rgba(255,255,255,0.06)') + ';color:' + (active ? '#000' : '#fff') + ';border:1px solid ' + c + '55;padding:5px 11px;border-radius:6px;font-weight:' + (active ? '900' : '700') + ';font-size:11px;cursor:pointer;">' + f.l + '</button>';
    }
    html += '</div>';

    if (items.length === 0) {
        html += '<div style="text-align:center;padding:40px;color:#888;background:rgba(255,255,255,0.03);border-radius:10px;">No hay opiniones con ese filtro.</div>';
        return html;
    }

    // Tabla
    html += '<div style="background:rgba(0,0,0,0.20);border-radius:10px;overflow:hidden;max-height:65vh;overflow-y:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead style="position:sticky;top:0;background:#2d0052;z-index:1;"><tr style="color:#d4af37;text-align:left;">';
    html += '<th style="padding:8px 10px;font-weight:800;">Usuario</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Estrellas</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">Comentario</th>';
    html += '<th style="padding:8px 10px;font-weight:800;">📞 Teléfono</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:right;">Cuándo</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Bucket</th>';
    html += '<th style="padding:8px 10px;font-weight:800;text-align:center;">Acciones</th>';
    html += '</tr></thead><tbody>';

    for (const it of items) {
        const when = it.updatedAt
            ? new Date(it.updatedAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
            : '—';
        const bucketLabel = it.bucket === 'bueno' ? '<span style="color:#66ff66;font-weight:800;">😊 BUENO</span>'
            : it.bucket === 'regular' ? '<span style="color:#ffd700;font-weight:800;">😐 REGULAR</span>'
            : '<span style="color:#ff8080;font-weight:800;">😟 MALO</span>';
        const phoneCell = it.contactPhone
            ? ('<a href="https://wa.me/' + encodeURIComponent(it.contactPhone.replace(/[^\d+]/g, '').replace(/^\+/, '')) + '" target="_blank" rel="noopener noreferrer" style="color:#25d366;font-weight:800;text-decoration:none;font-family:monospace;">' + escapeHtml(it.contactPhone) + '</a>')
            : '<span style="color:#555;font-style:italic;">—</span>';
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:8px 10px;color:#fff;font-weight:700;">' + escapeHtml(it.username || '') + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;letter-spacing:2px;">' + _renderAdminReviewsStars(it.stars) + '</td>';
        html += '<td style="padding:8px 10px;color:#ddd;line-height:1.4;">' + (it.comment ? escapeHtml(it.comment) : '<span style="color:#666;font-style:italic;">(sin comentario)</span>') + '</td>';
        html += '<td style="padding:8px 10px;white-space:nowrap;">' + phoneCell + '</td>';
        html += '<td style="padding:8px 10px;color:#aaa;text-align:right;font-size:10.5px;white-space:nowrap;">' + escapeHtml(when) + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;">' + bucketLabel + '</td>';
        html += '<td style="padding:8px 10px;text-align:center;white-space:nowrap;">';
        html += '<button type="button" onclick="deleteAdminReview(' + escapeJsArg(it.id) + ',' + escapeJsArg(it.username || '') + ')" style="background:rgba(255,80,80,0.10);color:#ff6b6b;border:1px solid rgba(255,80,80,0.45);padding:4px 9px;border-radius:6px;font-weight:800;font-size:10.5px;cursor:pointer;" title="Borrar esta opinión">🗑️ Borrar</button>';
        html += '</td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';

    html += '<div style="color:#888;font-size:10.5px;margin-top:8px;text-align:center;">Mostrando ' + items.length + ' de ' + total + ' opiniones · ' + (bucket === 'all' ? 'todos los buckets' : bucket) + '</div>';
    return html;
}

// =============================================
// WIN-BACK AUTOMÁTICO — admin section
// =============================================
let _WINBACK_CACHE = null;
window._WINBACK_TAB = window._WINBACK_TAB || 'config';

async function loadWinback() {
    const c = document.getElementById('winbackContent');
    if (!c) return;
    c.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando…</div>';
    try {
        const r = await authFetch('/api/admin/winback');
        if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            c.innerHTML = '<div style="color:#ff8080;padding:20px;">Error: ' + escapeHtml(e.error || '') + '</div>';
            return;
        }
        const cfg = await r.json();
        _WINBACK_CACHE = { cfg, preview: null, history: null };
        c.innerHTML = _renderWinback();
        // Lazy load preview/history al entrar a esas tabs.
        if (window._WINBACK_TAB === 'preview') loadWinbackPreview();
        if (window._WINBACK_TAB === 'history') loadWinbackHistory();
    } catch (e) {
        c.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function _setWinbackTab(tab) {
    window._WINBACK_TAB = tab;
    const c = document.getElementById('winbackContent');
    if (c) c.innerHTML = _renderWinback();
    if (tab === 'preview') loadWinbackPreview();
    if (tab === 'history') loadWinbackHistory();
}

function _renderWinback() {
    const d = _WINBACK_CACHE || {};
    const cfg = d.cfg || {};
    const tab = window._WINBACK_TAB || 'config';
    let html = '';
    // Banner de estado.
    const isActive = !!cfg.isActive;
    const lastRun = cfg.lastCronRunAt ? new Date(cfg.lastCronRunAt).toLocaleString('es-AR') : 'nunca';
    html += '<div style="background:' + (isActive ? 'rgba(102,255,102,0.10)' : 'rgba(255,80,80,0.06)') + ';border:1px solid ' + (isActive ? 'rgba(102,255,102,0.40)' : 'rgba(255,80,80,0.30)') + ';border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">';
    html += '<div>';
    html += '<div style="color:' + (isActive ? '#66ff66' : '#ff8080') + ';font-weight:900;font-size:14px;letter-spacing:1px;">' + (isActive ? '✅ ACTIVO' : '⏸️ PAUSADO') + '</div>';
    html += '<div style="color:#aaa;font-size:11px;margin-top:2px;">Última corrida del cron: ' + escapeHtml(lastRun) + ' · Total enviadas: t1=' + ((cfg.totalSentByTier && cfg.totalSentByTier.tier1) || 0) + ' t2=' + ((cfg.totalSentByTier && cfg.totalSentByTier.tier2) || 0) + ' t3=' + ((cfg.totalSentByTier && cfg.totalSentByTier.tier3) || 0) + '</div>';
    html += '</div>';
    if (isActive) {
        html += '<button type="button" onclick="toggleWinback(false)" style="background:linear-gradient(135deg,#888,#555);color:#fff;border:none;padding:9px 16px;border-radius:8px;font-weight:900;font-size:12px;cursor:pointer;">⏸️ DESACTIVAR</button>';
    } else {
        html += '<button type="button" onclick="toggleWinback(true)" style="background:linear-gradient(135deg,#66ff66,#2a8);color:#000;border:none;padding:9px 16px;border-radius:8px;font-weight:900;font-size:12px;cursor:pointer;">▶️ ACTIVAR</button>';
    }
    html += '</div>';

    // Tabs nav.
    const tabs = [
        { k: 'config',  l: '⚙️ Configuración' },
        { k: 'preview', l: '👁️ Vista previa' },
        { k: 'history', l: '📊 Historial' }
    ];
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid rgba(212,175,55,0.20);margin-bottom:14px;padding-bottom:6px;">';
    for (const t of tabs) {
        const active = t.k === tab;
        html += '<button type="button" onclick="_setWinbackTab(\'' + t.k + '\')" style="background:' + (active ? 'linear-gradient(135deg,#d4af37,#b8941a)' : 'rgba(255,255,255,0.04)') + ';color:' + (active ? '#000' : '#ddd') + ';border:1px solid ' + (active ? '#d4af37' : 'rgba(212,175,55,0.30)') + ';padding:7px 13px;border-radius:8px;font-weight:' + (active ? '900' : '700') + ';font-size:12px;cursor:pointer;letter-spacing:0.3px;">' + t.l + '</button>';
    }
    html += '</div>';

    if (tab === 'config')       html += _renderWinbackConfig(cfg);
    else if (tab === 'preview') html += _renderWinbackPreview(d.preview);
    else if (tab === 'history') html += _renderWinbackHistory(d.history);
    return html;
}

function _renderWinbackConfig(cfg) {
    const m1 = cfg.tier1Message || {}, m2 = cfg.tier2Message || {}, m3 = cfg.tier3Message || {};
    let html = '';

    // Tier 1
    html += '<div style="background:rgba(157,78,221,0.06);border:1px solid rgba(157,78,221,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '<h3 style="color:#b48bff;margin:0 0 6px;font-size:13px;letter-spacing:1px;">🟣 TIER 1 — TE EXTRAÑAMOS (sin bono)</h3>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">';
    html += '<label style="color:#bbb;font-size:11px;">Días sin cargar para disparar:</label>';
    html += '<input type="number" id="wb_tier1Days" value="' + (cfg.tier1Days || 7) + '" min="3" max="30" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '</div>';
    html += '<input type="text" id="wb_tier1Title" value="' + escapeHtml(m1.title || '') + '" maxlength="80" placeholder="Título del push" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;margin-bottom:6px;">';
    html += '<textarea id="wb_tier1Body" maxlength="200" rows="2" placeholder="Cuerpo del push" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;font-family:inherit;resize:vertical;">' + escapeHtml(m1.body || '') + '</textarea>';
    html += '</div>';

    // Tier 2
    html += '<div style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '<h3 style="color:#ffd700;margin:0 0 6px;font-size:13px;letter-spacing:1px;">🟡 TIER 2 — REGALO CASH</h3>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">';
    html += '<label style="color:#bbb;font-size:11px;">Días sin cargar:</label>';
    html += '<input type="number" id="wb_tier2Days" value="' + (cfg.tier2Days || 14) + '" min="7" max="45" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '<label style="color:#bbb;font-size:11px;">Monto regalo $:</label>';
    html += '<input type="number" id="wb_tier2BonusAmount" value="' + (cfg.tier2BonusAmount || 1000) + '" min="0" max="50000" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:90px;">';
    html += '<label style="color:#bbb;font-size:11px;">Vence en horas:</label>';
    html += '<input type="number" id="wb_tier2DurationHours" value="' + (cfg.tier2DurationHours || 48) + '" min="6" max="168" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '<label style="color:#bbb;font-size:11px;">Cap diario:</label>';
    html += '<input type="number" id="wb_dailyCapTier2" value="' + (cfg.dailyCapTier2 || 50) + '" min="0" max="5000" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '</div>';
    html += '<input type="text" id="wb_tier2Title" value="' + escapeHtml(m2.title || '') + '" maxlength="80" placeholder="Título" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;margin-bottom:6px;">';
    html += '<textarea id="wb_tier2Body" maxlength="200" rows="2" placeholder="Cuerpo" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;font-family:inherit;resize:vertical;">' + escapeHtml(m2.body || '') + '</textarea>';
    html += '</div>';

    // Tier 3
    html += '<div style="background:rgba(255,107,53,0.06);border:1px solid rgba(255,107,53,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '<h3 style="color:#ff8c5a;margin:0 0 6px;font-size:13px;letter-spacing:1px;">🔴 TIER 3 — BONO % EN CARGAS (cod50/cod100)</h3>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">';
    html += '<label style="color:#bbb;font-size:11px;">Días sin cargar:</label>';
    html += '<input type="number" id="wb_tier3Days" value="' + (cfg.tier3Days || 30) + '" min="14" max="90" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '<label style="color:#bbb;font-size:11px;">% bono:</label>';
    html += '<input type="number" id="wb_tier3BonusPct" value="' + (cfg.tier3BonusPct || 100) + '" min="25" max="200" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '<label style="color:#bbb;font-size:11px;">$ sugerido:</label>';
    html += '<input type="number" id="wb_tier3SuggestedAmount" value="' + (cfg.tier3SuggestedAmount || 2000) + '" min="500" max="100000" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:90px;">';
    html += '<label style="color:#bbb;font-size:11px;">Vence horas:</label>';
    html += '<input type="number" id="wb_tier3DurationHours" value="' + (cfg.tier3DurationHours || 72) + '" min="12" max="168" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '<label style="color:#bbb;font-size:11px;">Cap diario:</label>';
    html += '<input type="number" id="wb_dailyCapTier3" value="' + (cfg.dailyCapTier3 || 100) + '" min="0" max="5000" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '</div>';
    html += '<input type="text" id="wb_tier3Title" value="' + escapeHtml(m3.title || '') + '" maxlength="80" placeholder="Título" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;margin-bottom:6px;">';
    html += '<textarea id="wb_tier3Body" maxlength="200" rows="2" placeholder="Cuerpo" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;font-family:inherit;resize:vertical;">' + escapeHtml(m3.body || '') + '</textarea>';
    html += '</div>';

    // Tier 4 cooldown
    html += '<div style="background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.20);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '<h3 style="color:#888;margin:0 0 6px;font-size:13px;letter-spacing:1px;">⏸️ TIER 4 — COOLDOWN (no mandar más)</h3>';
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
    html += '<label style="color:#bbb;font-size:11px;">Días sin cargar para entrar al cooldown:</label>';
    html += '<input type="number" id="wb_tier4Days" value="' + (cfg.tier4Days || 60) + '" min="30" max="365" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:12px;width:70px;">';
    html += '<span style="color:#888;font-size:10.5px;">Después de este umbral se considera lost user, no spamear.</span>';
    html += '</div>';
    html += '</div>';

    // Filtros.
    html += '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '<h3 style="color:#00d4ff;margin:0 0 8px;font-size:12px;letter-spacing:1px;">🎯 FILTROS</h3>';
    html += '<label style="display:block;color:#ddd;font-size:12px;margin-bottom:6px;cursor:pointer;"><input type="checkbox" id="wb_onlySurveyResponders" ' + (cfg.onlySurveyResponders ? 'checked' : '') + '> Solo a usuarios que respondieron la encuesta</label>';
    html += '<label style="display:block;color:#ddd;font-size:12px;cursor:pointer;"><input type="checkbox" id="wb_excludeOpportunists" ' + (cfg.excludeOpportunists ? 'checked' : '') + '> Excluir oportunistas (reclaman bonos sin cargar)</label>';
    html += '</div>';

    // Botones.
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button type="button" onclick="saveWinback()" style="flex:1;min-width:160px;background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">💾 GUARDAR cambios</button>';
    html += '<button type="button" onclick="testFireWinback()" style="flex:1;min-width:160px;background:linear-gradient(135deg,#ff8c5a,#cc6633);color:#fff;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;" title="Dispara una pasada del cron AHORA (respeta isActive=false → solo simula).">🧪 Disparar wave de prueba</button>';
    html += '</div>';

    return html;
}

function _renderWinbackPreview(p) {
    if (!p) {
        return '<div style="text-align:center;padding:30px;color:#aaa;font-size:11.5px;">⏳ Cargando vista previa…</div>';
    }
    const c = p.counts || {};
    let html = '';
    html += '<div style="margin-bottom:10px;color:#aaa;font-size:11.5px;">Cuántos usuarios cumplirían cada tier en la próxima corrida del cron (con la config actual). No se manda nada — es solo simulación.</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:12px;">';
    html += _kpiCard('🟣 Tier 1', (c.tier1 || 0).toLocaleString('es-AR'), '#b48bff');
    html += _kpiCard('🟡 Tier 2', (c.tier2 || 0).toLocaleString('es-AR'), '#ffd700');
    html += _kpiCard('🔴 Tier 3', (c.tier3 || 0).toLocaleString('es-AR'), '#ff8c5a');
    html += _kpiCard('⏸️ Tier 4 cooldown', (c.tier4 || 0).toLocaleString('es-AR'), '#888');
    html += _kpiCard('Filtrados', (c.skipped_filter || 0).toLocaleString('es-AR'), '#888');
    html += _kpiCard('Ya enviado', (c.skipped_already || 0).toLocaleString('es-AR'), '#888');
    html += _kpiCard('Sin token FCM', (c.skipped_no_token || 0).toLocaleString('es-AR'), '#ff8080');
    html += '</div>';
    // Sample lists.
    const samples = p.samples || {};
    const tiers = [
        { k: 'tier1', l: '🟣 Tier 1 — te extrañamos', color: '#b48bff' },
        { k: 'tier2', l: '🟡 Tier 2 — regalo cash', color: '#ffd700' },
        { k: 'tier3', l: '🔴 Tier 3 — cod' + ((p.cfg && p.cfg.tier3BonusPct) || 100), color: '#ff8c5a' }
    ];
    for (const t of tiers) {
        const list = samples[t.k] || [];
        if (list.length === 0) continue;
        html += '<div style="background:rgba(0,0,0,0.20);border:1px solid ' + t.color + '30;border-radius:8px;padding:10px;margin-bottom:8px;">';
        html += '<div style="color:' + t.color + ';font-weight:900;font-size:11.5px;letter-spacing:1px;margin-bottom:6px;">' + t.l + ' — primeros ' + list.length + '</div>';
        html += '<div style="font-size:11px;color:#ddd;">';
        html += list.map(u => '<span style="display:inline-block;background:rgba(255,255,255,0.05);padding:3px 7px;margin:2px;border-radius:5px;">' + escapeHtml(u.username) + ' <span style="color:#888;">(' + u.days + 'd' + (u.hasTokens ? '' : ' · sin app') + ')</span></span>').join('');
        html += '</div></div>';
    }
    return html;
}

function _renderWinbackHistory(h) {
    if (!h) {
        return '<div style="text-align:center;padding:30px;color:#aaa;font-size:11.5px;">⏳ Cargando historial…</div>';
    }
    const t = h.byTier || {};
    let html = '';
    html += '<div style="margin-bottom:10px;color:#aaa;font-size:11.5px;">Cómo reacciona la gente a cada wave en los últimos ' + (h.days || 30) + ' días. <strong style="color:#66ff66;">Recovered</strong> = volvió y cargó · <strong style="color:#ffd700;">Opportunist</strong> = reclamó bono pero no cargó · <strong style="color:#888;">No response</strong> = no hizo nada (después de 14 días).</div>';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;overflow:hidden;margin-bottom:14px;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr style="color:#d4af37;background:rgba(212,175,55,0.10);text-align:left;">';
    html += '<th style="padding:7px 9px;">Tier</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Enviadas</th>';
    html += '<th style="padding:7px 9px;text-align:right;">✅ Recovered</th>';
    html += '<th style="padding:7px 9px;text-align:right;">⚠️ Oportunista</th>';
    html += '<th style="padding:7px 9px;text-align:right;">❌ No response</th>';
    html += '<th style="padding:7px 9px;text-align:right;">⏳ Pending</th>';
    html += '<th style="padding:7px 9px;text-align:right;">$ depositado</th>';
    html += '<th style="padding:7px 9px;text-align:right;">% recuperación</th>';
    html += '</tr></thead><tbody>';
    const labels = { tier1: '🟣 Tier 1', tier2: '🟡 Tier 2', tier3: '🔴 Tier 3' };
    for (const k of ['tier1','tier2','tier3']) {
        const r = t[k] || { sent: 0, recovered: 0, opportunist: 0, no_response: 0, pending: 0, deposited: 0 };
        const recPct = r.sent ? ((r.recovered / r.sent) * 100).toFixed(1) + '%' : '0%';
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:7px 9px;font-weight:800;">' + labels[k] + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#fff;">' + r.sent + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#66ff66;font-weight:800;">' + r.recovered + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#ffd700;">' + r.opportunist + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#888;">' + r.no_response + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#aaa;">' + r.pending + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#ffd700;font-weight:800;">$' + (r.deposited || 0).toLocaleString('es-AR') + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#fff;font-weight:800;">' + recPct + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Lista detallada (últimos 100).
    const items = h.items || [];
    if (items.length === 0) {
        html += '<div style="text-align:center;padding:30px;color:#888;background:rgba(255,255,255,0.03);border-radius:10px;">Todavía no hay envíos. Activá la estrategia para que el cron empiece a mandar.</div>';
        return html;
    }
    html += '<h3 style="color:#d4af37;font-size:12px;margin:14px 0 6px;letter-spacing:1px;">ÚLTIMOS ENVÍOS</h3>';
    html += '<div style="background:rgba(0,0,0,0.20);border-radius:8px;overflow:hidden;max-height:55vh;overflow-y:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
    html += '<thead style="position:sticky;top:0;background:#2d0052;"><tr style="color:#d4af37;text-align:left;">';
    html += '<th style="padding:7px 9px;">Usuario</th>';
    html += '<th style="padding:7px 9px;">Tier</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Cuándo</th>';
    html += '<th style="padding:7px 9px;text-align:center;">Outcome</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Bono</th>';
    html += '<th style="padding:7px 9px;text-align:right;">Cargó</th>';
    html += '</tr></thead><tbody>';
    for (const it of items) {
        const tierLbl = it.bonusType === 'none' ? '🟣 1' : it.bonusType === 'giveaway' ? '🟡 2' : it.bonusType === 'promo' ? '🔴 3' : '?';
        const when = it.sentAt ? new Date(it.sentAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
        const outcomeColor = it.outcome === 'recovered' ? '#66ff66' : it.outcome === 'opportunist' ? '#ffd700' : it.outcome === 'no_response' ? '#888' : '#aaa';
        const outcomeLbl = it.outcome === 'recovered' ? '✅ recovered' : it.outcome === 'opportunist' ? '⚠️ oportunista' : it.outcome === 'no_response' ? '❌ no resp' : '⏳ pending';
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:7px 9px;color:#fff;font-weight:700;">' + escapeHtml(it.username) + '</td>';
        html += '<td style="padding:7px 9px;color:#fff;">' + tierLbl + '</td>';
        html += '<td style="padding:7px 9px;color:#aaa;text-align:right;font-size:10.5px;white-space:nowrap;">' + escapeHtml(when) + '</td>';
        html += '<td style="padding:7px 9px;text-align:center;color:' + outcomeColor + ';font-weight:800;font-size:10.5px;">' + outcomeLbl + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:#ddd;">' + (it.bonusAmount > 0 ? '$' + it.bonusAmount.toLocaleString('es-AR') : '—') + '</td>';
        html += '<td style="padding:7px 9px;text-align:right;color:' + (it.realDepositMade ? '#66ff66' : '#888') + ';font-weight:' + (it.realDepositMade ? '800' : '400') + ';">' + (it.realDepositMade ? '$' + (it.realDepositAmount || 0).toLocaleString('es-AR') : '—') + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
}

async function loadWinbackPreview() {
    try {
        const r = await authFetch('/api/admin/winback/preview');
        if (!r.ok) return;
        const d = await r.json();
        if (!_WINBACK_CACHE) _WINBACK_CACHE = {};
        _WINBACK_CACHE.preview = d;
        const c = document.getElementById('winbackContent');
        if (c) c.innerHTML = _renderWinback();
    } catch (_) { /* ignore */ }
}

async function loadWinbackHistory() {
    try {
        const r = await authFetch('/api/admin/winback/history?days=30');
        if (!r.ok) return;
        const d = await r.json();
        if (!_WINBACK_CACHE) _WINBACK_CACHE = {};
        _WINBACK_CACHE.history = d;
        const c = document.getElementById('winbackContent');
        if (c) c.innerHTML = _renderWinback();
    } catch (_) { /* ignore */ }
}

async function saveWinback() {
    const get = (id) => (document.getElementById(id) || {}).value;
    const getNum = (id) => Number(get(id));
    const getChk = (id) => !!(document.getElementById(id) || {}).checked;
    const body = {
        tier1Days: getNum('wb_tier1Days'),
        tier2Days: getNum('wb_tier2Days'),
        tier3Days: getNum('wb_tier3Days'),
        tier4Days: getNum('wb_tier4Days'),
        tier1Message: { title: get('wb_tier1Title') || '', body: get('wb_tier1Body') || '' },
        tier2Message: { title: get('wb_tier2Title') || '', body: get('wb_tier2Body') || '' },
        tier3Message: { title: get('wb_tier3Title') || '', body: get('wb_tier3Body') || '' },
        tier2BonusAmount: getNum('wb_tier2BonusAmount'),
        tier2DurationHours: getNum('wb_tier2DurationHours'),
        tier3BonusPct: getNum('wb_tier3BonusPct'),
        tier3SuggestedAmount: getNum('wb_tier3SuggestedAmount'),
        tier3DurationHours: getNum('wb_tier3DurationHours'),
        onlySurveyResponders: getChk('wb_onlySurveyResponders'),
        excludeOpportunists: getChk('wb_excludeOpportunists'),
        dailyCapTier2: getNum('wb_dailyCapTier2'),
        dailyCapTier3: getNum('wb_dailyCapTier3')
    };
    try {
        const r = await authFetch('/api/admin/winback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok) {
            showToast('❌ ' + (d.error || 'Error al guardar'), 'error');
            return;
        }
        _WINBACK_CACHE.cfg = d;
        showToast('✅ Configuración guardada', 'success');
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

async function toggleWinback(activate) {
    const verb = activate ? 'ACTIVAR' : 'DESACTIVAR';
    if (!confirm('¿' + verb + ' la estrategia win-back? ' + (activate
        ? 'El cron va a empezar a mandar pushes/regalos de forma automática a usuarios inactivos según la config.'
        : 'Las pushes auto-programadas quedan pausadas.'))) return;
    try {
        const r = await authFetch('/api/admin/winback/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activate: !!activate })
        });
        const d = await r.json();
        if (!r.ok) {
            showToast('❌ ' + (d.error || 'Error'), 'error');
            return;
        }
        _WINBACK_CACHE.cfg = d;
        showToast('✅ Win-back ' + (activate ? 'activo' : 'desactivado'), 'success');
        const c = document.getElementById('winbackContent');
        if (c) c.innerHTML = _renderWinback();
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

async function testFireWinback() {
    if (!confirm('¿Disparar una pasada del cron AHORA?\n\nSi la estrategia está pausada esto va a forzar el envío real igual. ¿Seguro?')) return;
    showToast('⏳ Disparando wave...', 'info');
    try {
        const r = await authFetch('/api/admin/winback/test-fire-once', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) {
            showToast('❌ ' + (d.error || 'Error'), 'error');
            return;
        }
        const res = d.result || {};
        const lines = ['✅ Wave disparada'];
        if (res.tier1 != null) lines.push('Tier 1: ' + res.tier1);
        if (res.tier2 != null) lines.push('Tier 2: ' + res.tier2);
        if (res.tier3 != null) lines.push('Tier 3: ' + res.tier3);
        if (res.skipped) lines.push(res.skipped);
        showToast(lines.join(' · '), 'success');
        loadWinback();
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

function _renderReactionsContainer() {
    let html = '';
    html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:12px;margin-top:14px;">';
    html += '  <h3 style="color:#d4af37;font-size:13px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">📈 Reporte de reacción · cómo va respondiendo la gente</h3>';
    html += '  <p style="color:#aaa;font-size:11px;margin:0 0 8px;">Cruzamos pushes enviadas con cargas reales en el período para ver qué tier convierte mejor.</p>';
    html += '  <div id="reactionsReportBox" style="margin-top:6px;">';
    html += '    <div style="text-align:center;padding:16px;color:#aaa;font-size:11.5px;"><button type="button" onclick="loadReactionsReport()" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:700;">📈 Cargar reporte de reacciones</button></div>';
    html += '  </div>';
    html += '</div>';
    return html;
}

function _setEncuestaFilter(f) {
    window._ENCUESTA_FILTER = f;
    const c = document.getElementById('encuestaContent');
    if (c) c.innerHTML = _renderEncuesta();
}

// Renderiza el bloque "Pregunta + 4 opciones" tal cual la ve el user
// en la PWA. Sirve como recordatorio al admin de que prometio cuando
// arma la estrategia. Numeros aca SIEMPRE deben matchear con los
// defaults del editor de estrategia abajo.
function _renderSurveyQuestion() {
    let html = '';
    html += '<div style="background:linear-gradient(135deg,rgba(212,175,55,0.10),rgba(106,13,173,0.10));border:1px solid rgba(212,175,55,0.40);border-radius:12px;padding:14px;margin-bottom:14px;">';
    html += '  <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px;">';
    html += '    <h3 style="color:#ffd700;font-size:14px;margin:0;font-weight:900;letter-spacing:0.5px;">📋 Pregunta que ve el usuario en la PWA</h3>';
    html += '    <span style="color:#888;font-size:10.5px;">Si cambia esto, cambialo TAMBIÉN en el editor de estrategia.</span>';
    html += '  </div>';
    html += '  <div style="background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:14px;">';
    html += '    <div style="text-align:center;margin-bottom:10px;">';
    html += '      <div style="font-size:28px;line-height:1;margin-bottom:4px;">🤔</div>';
    html += '      <div style="font-weight:900;font-size:15px;color:#ffd700;">¿Cuántas notificaciones querés recibir?</div>';
    html += '      <div style="color:#bbb;font-size:11.5px;margin-top:3px;">Elegí el plan que más te conviene. Lo podés cambiar después.</div>';
    html += '    </div>';
    html += '    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">';
    // 4 opciones (idem index.html)
    html += '      <div style="background:linear-gradient(135deg,rgba(102,255,102,0.12),rgba(102,255,102,0.04));border:1.5px solid #66ff66;border-radius:10px;padding:10px;">';
    html += '        <div style="font-weight:900;font-size:12px;color:#66ff66;letter-spacing:1px;">🟢 SUAVE</div>';
    html += '        <div style="font-size:11px;color:#cce4cc;margin-top:3px;line-height:1.5;"><strong>2 bonos</strong> · <strong>5 invitaciones a jugar</strong> · <strong>2 regalos</strong> al mes<br><span style="color:#aaa;">Para los que prefieren tranquilidad</span></div>';
    html += '      </div>';
    html += '      <div style="background:linear-gradient(135deg,rgba(255,235,59,0.14),rgba(255,235,59,0.04));border:2px solid #ffd700;border-radius:10px;padding:10px;position:relative;">';
    html += '        <div style="position:absolute;top:-8px;right:8px;background:#ffd700;color:#1a0033;font-size:9px;font-weight:900;padding:2px 7px;border-radius:7px;letter-spacing:1px;">⭐ DEFAULT</div>';
    html += '        <div style="font-weight:900;font-size:12px;color:#ffd700;letter-spacing:1px;">🟡 NORMAL</div>';
    html += '        <div style="font-size:11px;color:#eee;margin-top:3px;line-height:1.5;"><strong>4 bonos</strong> · <strong>5 invitaciones a jugar</strong> · <strong>2 regalos</strong> al mes<br><span style="color:#aaa;">Equilibrio entre estar al tanto y no saturar</span></div>';
    html += '      </div>';
    html += '      <div style="background:linear-gradient(135deg,rgba(255,107,53,0.14),rgba(255,107,53,0.04));border:1.5px solid #ff8c5a;border-radius:10px;padding:10px;">';
    html += '        <div style="font-weight:900;font-size:12px;color:#ff8c5a;letter-spacing:1px;">🔴 ACTIVO</div>';
    html += '        <div style="font-size:11px;color:#ffd5c2;margin-top:3px;line-height:1.5;"><strong>6 bonos</strong> · <strong>10 invitaciones a jugar</strong> · <strong>3 regalos</strong> al mes<br><span style="color:#aaa;">Para los que quieren todo lo que tenemos</span></div>';
    html += '      </div>';
    html += '      <div style="background:rgba(0,212,255,0.10);border:1.5px solid #00d4ff;border-radius:10px;padding:10px;">';
    html += '        <div style="font-weight:900;font-size:12px;color:#00d4ff;letter-spacing:1px;">🔔 SOLO REEMBOLSOS</div>';
    html += '        <div style="font-size:11px;color:#aacde8;margin-top:3px;line-height:1.5;">Recibo notificaciones <strong>solo cuando tenga un reembolso disponible</strong>.<br><span style="color:#aaa;">Para los que prefieren mínimo lo justo.</span></div>';
    html += '      </div>';
    html += '    </div>';
    html += '  </div>';
    html += '</div>';
    return html;
}

// Modal de "Regalar bono" lanzado desde cada fila de la encuesta.
// 3 tipos: COD50 (50% en cargas) · COD100 (100% en cargas) · CASH (regalo de plata).
function openGrantBonusModal(username) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.id = 'grantBonusOverlay';
    overlay.innerHTML =
        '<div style="background:#1a0033;border:2px solid #d4af37;border-radius:14px;max-width:440px;width:100%;padding:18px;color:#fff;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
                '<h3 style="color:#ffd700;margin:0;font-size:15px;letter-spacing:1px;">🎁 Regalar bono a ' + escapeHtml(username) + '</h3>' +
                '<button type="button" onclick="closeGrantBonusModal()" style="background:transparent;color:#aaa;border:none;font-size:18px;cursor:pointer;">✕</button>' +
            '</div>' +
            '<p style="color:#bbb;font-size:11.5px;margin:0 0 12px;line-height:1.5;">Elegí el tipo de bono. Va a aparecer al instante en la app del usuario.</p>' +
            '<div style="display:flex;flex-direction:column;gap:8px;">' +
                '<label style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,215,0,0.30);padding:10px;border-radius:8px;cursor:pointer;">' +
                    '<input type="radio" name="grantType" value="cod50" checked>' +
                    '<span style="flex:1;"><strong style="color:#ffd700;">🟡 Bono 50%</strong> · cód <strong>COD50</strong> en wa.link</span>' +
                '</label>' +
                '<label style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,107,53,0.30);padding:10px;border-radius:8px;cursor:pointer;">' +
                    '<input type="radio" name="grantType" value="cod100">' +
                    '<span style="flex:1;"><strong style="color:#ff8c5a;">🔴 Bono 100%</strong> · cód <strong>COD100</strong> en wa.link</span>' +
                '</label>' +
                '<label style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1.5px solid rgba(102,255,102,0.30);padding:10px;border-radius:8px;cursor:pointer;">' +
                    '<input type="radio" name="grantType" value="cash">' +
                    '<span style="flex:1;"><strong style="color:#66ff66;">💵 Regalo de plata</strong> · botón "RECLAMAR" auto en la app</span>' +
                '</label>' +
            '</div>' +
            '<div style="margin-top:12px;">' +
                '<label style="color:#aaa;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Monto (ARS)</label>' +
                '<input type="number" id="grantAmount" min="100" step="100" value="2000" style="width:100%;background:rgba(0,0,0,0.40);border:1px solid rgba(255,215,0,0.30);color:#fff;padding:9px;border-radius:6px;font-size:14px;font-weight:800;margin-top:4px;">' +
                '<div style="color:#888;font-size:10.5px;margin-top:4px;">Para 50%/100% es el monto base sugerido (ej. 2.000). Para cash es la plata exacta a regalar.</div>' +
            '</div>' +
            '<div style="margin-top:10px;">' +
                '<label style="color:#aaa;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Vence en (horas)</label>' +
                '<input type="number" id="grantHours" min="1" max="168" step="1" value="24" style="width:100%;background:rgba(0,0,0,0.40);border:1px solid rgba(255,215,0,0.30);color:#fff;padding:9px;border-radius:6px;font-size:14px;font-weight:800;margin-top:4px;">' +
            '</div>' +
            '<div id="grantBonusResult" style="margin-top:10px;font-size:11.5px;min-height:18px;"></div>' +
            '<div style="display:flex;gap:8px;margin-top:12px;">' +
                '<button type="button" onclick="closeGrantBonusModal()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
                '<button type="button" id="grantBonusSubmit" onclick="submitGrantBonus(' + escapeJsArg(username) + ')" style="flex:2;background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;">🎁 ENVIAR BONO</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
}

function closeGrantBonusModal() {
    const o = document.getElementById('grantBonusOverlay');
    if (o) o.remove();
}

async function submitGrantBonus(username) {
    const radios = document.querySelectorAll('input[name="grantType"]');
    let type = 'cod50';
    for (const r of radios) if (r.checked) { type = r.value; break; }
    const amount = Number((document.getElementById('grantAmount') || {}).value || 0);
    const hours = Number((document.getElementById('grantHours') || {}).value || 24);
    const result = document.getElementById('grantBonusResult');
    const btn = document.getElementById('grantBonusSubmit');
    if (!isFinite(amount) || amount <= 0) {
        if (result) { result.style.color = '#ff8080'; result.textContent = '⚠️ Monto inválido.'; }
        return;
    }
    if (!confirm('¿Mandar este bono a ' + username + '? Le va a llegar push y se le activa en la app.')) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
    if (result) { result.style.color = '#aaa'; result.textContent = '⏳ Enviando...'; }
    try {
        const r = await authFetch('/api/admin/encuesta/grant-bonus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, type, amount, durationHours: hours })
        });
        const d = await r.json();
        if (!r.ok) {
            if (result) { result.style.color = '#ff8080'; result.textContent = '❌ ' + (d.error || 'Error'); }
            if (btn) { btn.disabled = false; btn.textContent = '🎁 ENVIAR BONO'; }
            return;
        }
        const tipoTxt = type === 'cash'
            ? ('regalo de plata $' + amount.toLocaleString('es-AR'))
            : ('bono ' + (type === 'cod50' ? '50%' : '100%') + ' (cód ' + d.code + ') sobre carga de $' + amount.toLocaleString('es-AR'));
        showToast('✅ ' + tipoTxt + ' enviado a ' + username, 'success');
        closeGrantBonusModal();
    } catch (e) {
        if (result) { result.style.color = '#ff8080'; result.textContent = '❌ Error de conexión'; }
        if (btn) { btn.disabled = false; btn.textContent = '🎁 ENVIAR BONO'; }
    }
}

// Pinta el badge de la preferencia de la encuesta de notifs en la tabla.
function _fmtNotifPref(pref) {
    const map = {
        suave:           { bg: 'rgba(102,255,102,0.15)', bd: '#66ff66', fg: '#66ff66', label: '🟢 SUAVE' },
        normal:          { bg: 'rgba(255,215,0,0.15)',   bd: '#ffd700', fg: '#ffd700', label: '🟡 NORMAL' },
        activo:          { bg: 'rgba(255,107,53,0.15)',  bd: '#ff8c5a', fg: '#ff8c5a', label: '🔴 ACTIVO' },
        solo_reembolsos: { bg: 'rgba(0,212,255,0.12)',   bd: '#00d4ff', fg: '#00d4ff', label: '🔔 SOLO REEMB' },
        opt_out:         { bg: 'rgba(255,255,255,0.04)', bd: '#888',    fg: '#888',    label: '🚫 OFF' }
    };
    if (!pref) return '<span style="color:#666;font-size:10.5px;">— sin responder</span>';
    const m = map[pref] || { bg: 'rgba(255,255,255,0.04)', bd: '#888', fg: '#888', label: String(pref) };
    return '<span style="display:inline-block;background:' + m.bg + ';border:1px solid ' + m.bd + ';color:' + m.fg + ';padding:2px 7px;border-radius:8px;font-size:10px;font-weight:800;letter-spacing:0.5px;">' + m.label + '</span>';
}

// Render del editor de estrategia mensual: 4 cards con inputs editables
// (bonos/juegos/regalos/budget) + cap mensual + boton guardar.
function _renderStrategyEditor(strategy, respondedTotal) {
    const threshold = (strategy && strategy.autoRepeatThreshold) || 100;
    const totalResponded = Number(respondedTotal) || 0;
    const gateLocked = totalResponded < threshold;
    const prefs = (strategy && strategy.preferences) || {};
    const tiers = [
        { key: 'suave',           label: '🟢 SUAVE',         color: '#66ff66' },
        { key: 'normal',          label: '🟡 NORMAL',        color: '#ffd700' },
        { key: 'activo',          label: '🔴 ACTIVO',        color: '#ff8c5a' },
        { key: 'solo_reembolsos', label: '🔔 SOLO REEMB',    color: '#00d4ff' }
    ];
    const monthlyCap = (strategy && strategy.monthlyCap) || 1000000;
    const updatedAt = (strategy && strategy.updatedAt) ? new Date(strategy.updatedAt).toLocaleString('es-AR') : '—';
    const updatedBy = (strategy && strategy.updatedBy) || '—';

    let html = '';
    html += '<div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:10px;padding:12px;margin-bottom:14px;">';
    html += '  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;flex-wrap:wrap;gap:6px;">';
    html += '    <h3 style="color:#d4af37;font-size:13px;margin:0;text-transform:uppercase;letter-spacing:1px;">⚙️ Estrategia mensual de notificaciones</h3>';
    html += '    <div style="color:#888;font-size:10.5px;">Última actualización: ' + escapeHtml(updatedAt) + ' · por ' + escapeHtml(updatedBy) + '</div>';
    html += '  </div>';
    html += '  <p style="color:#bbb;font-size:11px;line-height:1.5;margin:0 0 6px;">Por cada nivel de la encuesta, definí cuántos pushes y cuánta plata por usuario al mes. Los SOLO REEMBOLSOS reciben sólo cuando hay un reembolso disponible.</p>';
    html += '  <p style="color:#66ff66;font-size:11px;line-height:1.5;margin:0 0 10px;background:rgba(102,255,102,0.06);border:1px solid rgba(102,255,102,0.30);border-radius:6px;padding:6px 10px;">✅ <strong>Inscripción automática:</strong> los usuarios que respondan la encuesta DESPUÉS de activar la estrategia se incorporan automáticamente al plan que les corresponde. No hace falta editar nada cuando suma gente.</p>';

    html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">';
    for (const t of tiers) {
        const cur = prefs[t.key] || {};
        html += '    <div style="background:rgba(0,0,0,0.30);border:1px solid rgba(' + _hexToRgb(t.color) + ',0.40);border-radius:10px;padding:10px;">';
        html += '      <div style="color:' + t.color + ';font-weight:900;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">' + t.label + '</div>';
        html += _strategyInput('Bonos/mes',    'strat_' + t.key + '_bonos',   cur.bonos   || 0);
        html += _strategyInput('Invitaciones a jugar/mes', 'strat_' + t.key + '_juegos', cur.juegos || 0);
        html += _strategyInput('Regalos/mes',  'strat_' + t.key + '_regalos', cur.regalos || 0);
        html += _strategyInput('Presupuesto $/mes por user', 'strat_' + t.key + '_budget', cur.budget || 0);
        if (t.key === 'solo_reembolsos') {
            html += '<div style="color:#888;font-size:10px;margin-top:4px;font-style:italic;line-height:1.4;">⚠️ Solo recibe push si hay reembolso disponible. Bonos/juegos/regalos no aplican.</div>';
        }
        html += '    </div>';
    }
    html += '  </div>';

    // ===== Lo que el admin completa: tipo de bono + plata total =====
    const bonusType = (strategy && strategy.bonusType) || 'cash';
    const monthlyTotalToDistribute = (strategy && strategy.monthlyTotalToDistribute) || 1000000;
    html += '  <div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:10px;margin-top:12px;">';
    html += '    <div style="color:#00d4ff;font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">🎁 Lo que vos completás del mes</div>';
    html += '    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">';
    html += '      <div style="flex:1;min-width:180px;">';
    html += '        <label style="display:block;color:#bbb;font-size:11px;margin-bottom:3px;">Tipo de bono</label>';
    html += '        <input type="text" id="strat_bonusType" value="' + escapeHtml(bonusType) + '" placeholder="cash / free_spin / deposit_match" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;">';
    html += '      </div>';
    html += '      <div style="flex:1;min-width:180px;">';
    html += '        <label style="display:block;color:#bbb;font-size:11px;margin-bottom:3px;">💰 Plata total a regalar ($/mes)</label>';
    html += '        <input type="number" id="strat_monthlyTotalToDistribute" value="' + monthlyTotalToDistribute + '" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:7px 10px;border-radius:6px;font-size:12px;box-sizing:border-box;">';
    html += '      </div>';
    html += '    </div>';
    html += '    <div style="color:#888;font-size:10.5px;margin-top:6px;">El sistema reparte esta plata entre los participantes según su tier (VIP 50% · STD 35% · Casual 15%).</div>';
    html += '  </div>';

    // Cap mensual global
    html += '  <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap;">';
    html += '    <label style="color:#d4af37;font-weight:800;font-size:12px;">💰 Tope técnico de regalos ($):</label>';
    html += '    <input type="number" id="strat_monthlyCap" value="' + monthlyCap + '" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:6px 10px;border-radius:6px;font-size:13px;width:140px;">';
    html += '    <span style="color:#888;font-size:10.5px;">Hard cap. La distribución no puede excederlo.</span>';
    html += '  </div>';

    // Ventana horaria de envío. Cada user recibe el push a una hora random
    // dentro de [start, end). Default 18-21.
    const windowStartHour = (strategy && Number.isFinite(strategy.windowStartHour)) ? strategy.windowStartHour : 18;
    const windowEndHour   = (strategy && Number.isFinite(strategy.windowEndHour))   ? strategy.windowEndHour   : 21;
    html += '  <div style="background:rgba(102,255,102,0.06);border:1px solid rgba(102,255,102,0.30);border-radius:8px;padding:10px;margin-top:10px;">';
    html += '    <div style="color:#66ff66;font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">📅 Ventana horaria de envío</div>';
    html += '    <p style="color:#bbb;font-size:11px;line-height:1.5;margin:0 0 8px;">Cada user recibe la notificación a una hora <strong>random</strong> dentro de esta ventana. Si la ventana de hoy ya pasó cuando se dispara la wave, se reprograma para mañana.</p>';
    html += '    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">';
    html += '      <label style="color:#ddd;font-size:12px;">Desde</label>';
    html += '      <input type="number" id="strat_windowStartHour" value="' + windowStartHour + '" min="0" max="23" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:6px 8px;border-radius:6px;font-size:13px;width:70px;">';
    html += '      <span style="color:#888;font-size:11px;">hs</span>';
    html += '      <label style="color:#ddd;font-size:12px;">Hasta</label>';
    html += '      <input type="number" id="strat_windowEndHour" value="' + windowEndHour + '" min="1" max="24" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:6px 8px;border-radius:6px;font-size:13px;width:70px;">';
    html += '      <span style="color:#888;font-size:11px;">hs</span>';
    html += '      <span id="strat_windowPreview" style="color:#66ff66;font-size:11px;font-weight:700;margin-left:6px;">' + String(windowStartHour).padStart(2,'0') + ':00 a ' + String(windowEndHour).padStart(2,'0') + ':00</span>';
    html += '    </div>';
    html += '  </div>';

    // Save + Preview + Activate (con gate hasta llegar a `threshold` respuestas)
    const isActive = !!(strategy && strategy.isActive);
    const activatedAt = (strategy && strategy.activatedAt) ? new Date(strategy.activatedAt).toLocaleString('es-AR') : null;
    if (gateLocked && !isActive) {
        html += '  <div style="background:rgba(255,215,0,0.06);border:1.5px dashed rgba(255,215,0,0.50);border-radius:10px;padding:12px;margin-top:12px;">';
        html += '    <div style="color:#ffd700;font-weight:900;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">🔒 Esperando respuestas — Preview/Activar bloqueados</div>';
        html += '    <div style="color:#bbb;font-size:11.5px;line-height:1.5;">Llevamos <strong style="color:#fff;">' + totalResponded.toLocaleString('es-AR') + '</strong> de <strong style="color:#ffd700;">' + threshold + '</strong> respuestas. Cuando lleguemos al piso podés ver la previa y activar la primera estrategia.</div>';
        html += '    <div style="background:rgba(0,0,0,0.40);border-radius:8px;height:10px;overflow:hidden;margin-top:8px;">';
        const pgPct = Math.min(100, Math.round((totalResponded / threshold) * 100));
        html += '      <div style="background:linear-gradient(90deg,#66ff66,#ffd700);height:100%;width:' + pgPct + '%;"></div>';
        html += '    </div>';
        html += '  </div>';
    }
    html += '  <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">';
    html += '    <button type="button" onclick="loadRecommendedDefaults()" id="loadDefaultsBtn" style="flex:1;min-width:160px;background:rgba(212,175,55,0.10);color:#ffd700;border:1px solid rgba(212,175,55,0.45);padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;" title="Rellena los inputs con los valores recomendados (matchean la Pregunta de arriba). No guarda hasta que apretes Guardar.">🔄 Cargar valores recomendados</button>';
    if (gateLocked && !isActive) {
        html += '    <button type="button" disabled style="flex:1;min-width:160px;background:rgba(157,78,221,0.20);color:#aaa;border:1px dashed rgba(157,78,221,0.40);padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:not-allowed;" title="Llegá a ' + threshold + ' respuestas para desbloquear">🔒 VER PREVIA</button>';
    } else {
        html += '    <button type="button" onclick="previewNotifStrategy()" id="previewStrategyBtn" style="flex:1;min-width:160px;background:linear-gradient(135deg,#9d4edd,#6a0dad);color:#fff;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">👁️ VER PREVIA</button>';
    }
    html += '    <button type="button" onclick="saveNotifStrategy()" id="saveStrategyBtn" style="flex:1;min-width:160px;background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">💾 GUARDAR estrategia</button>';
    if (isActive) {
        html += '    <button type="button" onclick="toggleNotifStrategy(false)" id="activateStrategyBtn" style="flex:1;min-width:160px;background:linear-gradient(135deg,#888,#555);color:#fff;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">⏸️ DESACTIVAR estrategia</button>';
    } else if (gateLocked) {
        html += '    <button type="button" disabled style="flex:1;min-width:160px;background:rgba(102,255,102,0.20);color:#aaa;border:1px dashed rgba(102,255,102,0.40);padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:not-allowed;" title="Llegá a ' + threshold + ' respuestas para desbloquear">🔒 ACTIVAR estrategia</button>';
    } else {
        html += '    <button type="button" onclick="toggleNotifStrategy(true)" id="activateStrategyBtn" style="flex:1;min-width:160px;background:linear-gradient(135deg,#66ff66,#2a8;);color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;">✅ ACTIVAR estrategia</button>';
    }
    html += '  </div>';
    if (isActive && activatedAt) {
        html += '  <div style="color:#66ff66;font-size:10.5px;margin-top:6px;">✅ Activa desde ' + escapeHtml(activatedAt) + ' · auto-waves disparadas: <strong>' + ((strategy && strategy.autoFireCount) || 0) + '</strong></div>';
    }
    // Botón para abrir el modal de calendario en cualquier momento.
    html += '  <div style="margin-top:8px;">';
    html += '    <button type="button" onclick="openStrategySchedule()" style="background:rgba(102,255,102,0.10);color:#66ff66;border:1px solid rgba(102,255,102,0.45);padding:7px 12px;border-radius:6px;font-weight:700;font-size:11.5px;cursor:pointer;">📅 Ver calendario de envíos</button>';
    html += '    <span style="color:#888;font-size:10.5px;margin-left:6px;">Ventana horaria + próximos disparos pendientes</span>';
    html += '  </div>';

    // ===== TEST FIRE: probar todas las notifs en un user cada 1 min =====
    html += '  <div style="background:rgba(255,80,80,0.06);border:1px dashed rgba(255,80,80,0.40);border-radius:8px;padding:10px;margin-top:14px;">';
    html += '    <div style="color:#ff8080;font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">🧪 Test fire — probar TODAS las notifs en un user (cada 1 min)</div>';
    html += '    <p style="color:#aaa;font-size:11px;margin:0 0 8px;line-height:1.4;">Mete un username y le mandamos 5 pushes (bono, juga, regalo, reembolso, 100%×2hs) con 1 min de gap. El user tiene que tener la app instalada y notifs activadas. Útil para QA.</p>';
    html += '    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
    html += '      <input type="text" id="testFireUsername" placeholder="lalodj" style="flex:1;min-width:160px;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:8px 10px;border-radius:6px;font-size:13px;">';
    html += '      <input type="number" id="testFireCount" value="5" min="1" max="10" style="width:90px;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:8px 10px;border-radius:6px;font-size:13px;" title="cantidad de notifs">';
    html += '      <button type="button" onclick="testFireNotifications()" id="testFireBtn" style="background:linear-gradient(135deg,#ff5050,#a02020);color:#fff;border:none;padding:9px 16px;border-radius:7px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;">🔥 DISPARAR TEST</button>';
    html += '    </div>';
    html += '    <div id="testFireResult" style="color:#aaa;font-size:11px;margin-top:6px;"></div>';
    html += '  </div>';

    html += '</div>';

    // ===== CRONOGRAMA SEMANAL — placeholder, se hidrata con fetch =====
    html += '<div id="weeklyScheduleBox" style="margin-top:14px;"></div>';

    // ===== SIMULADOR =====
    html += _renderStrategySimulator(strategy);

    return html;
}

// Carga + renderiza el cronograma semanal de notificaciones programadas.
// Lo dispara loadEncuesta después de pintar el editor para no bloquear el
// render principal. Re-cargable desde el botón 🔄 del header del cronograma.
async function loadWeeklySchedule(days) {
    const box = document.getElementById('weeklyScheduleBox');
    if (!box) return;
    const d = Math.max(1, Math.min(30, parseInt(days, 10) || 7));
    box.innerHTML = '<div style="background:rgba(0,212,255,0.04);border:1px dashed rgba(0,212,255,0.30);border-radius:10px;padding:14px;text-align:center;color:#aaa;font-size:12px;">⏳ Cargando cronograma semanal…</div>';
    try {
        const r = await authFetch('/api/admin/notif-strategy/weekly-schedule?days=' + d);
        if (!r.ok) {
            box.innerHTML = '<div style="background:rgba(255,128,128,0.06);border:1px solid rgba(255,128,128,0.40);border-radius:10px;padding:14px;color:#ff8080;font-size:12px;">Error ' + r.status + ' cargando cronograma</div>';
            return;
        }
        const data = await r.json();
        box.innerHTML = _renderWeeklySchedule(data, d);
    } catch (e) {
        box.innerHTML = '<div style="background:rgba(255,128,128,0.06);border:1px solid rgba(255,128,128,0.40);border-radius:10px;padding:14px;color:#ff8080;font-size:12px;">Error de conexión: ' + (e.message || e) + '</div>';
    }
}

function _renderWeeklySchedule(d, currentDays) {
    const w = d.window || { label: '18:00 a 21:00' };
    const days = d.days || [];
    const tierLabels  = { suave: '🟢', normal: '🟡', activo: '🔴', solo_reembolsos: '🔔' };
    const tierColors  = { suave: '#66ff66', normal: '#ffd700', activo: '#ff8c5a', solo_reembolsos: '#00d4ff' };
    const catLabels   = { bonos: '🎁', juegos: '🎰', regalos: '💎' };
    const catColors   = { bonos: '#ffd700', juegos: '#9d4edd', regalos: '#25d366' };
    const total = d.totalPushes || 0;
    const dn = currentDays || 7;

    let html = '';
    html += '<div style="background:linear-gradient(135deg,rgba(0,212,255,0.08),rgba(31,140,255,0.04));border:1.5px solid rgba(0,212,255,0.45);border-radius:12px;padding:14px;">';

    // Header
    html += '  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">';
    html += '    <div>';
    html += '      <div style="color:#00d4ff;font-weight:900;font-size:14px;letter-spacing:1px;text-transform:uppercase;">🗓️ Cronograma — próximos ' + dn + ' días</div>';
    html += '      <div style="color:#bbb;font-size:11px;margin-top:3px;">Cómo avanza la estrategia día por día y a qué público le toca cada notif. Ventana: <strong style="color:#fff;">' + escapeHtml(w.label) + '</strong></div>';
    html += '    </div>';
    html += '    <div style="display:flex;gap:6px;align-items:center;">';
    html += '      <select id="weeklyScheduleDays" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:6px;font-size:11px;" onchange="loadWeeklySchedule(this.value)">';
    [7, 14, 30].forEach(opt => {
        html += '<option value="' + opt + '"' + (opt === dn ? ' selected' : '') + '>' + opt + ' días</option>';
    });
    html += '      </select>';
    html += '      <button type="button" onclick="loadWeeklySchedule(document.getElementById(\'weeklyScheduleDays\').value)" title="Refrescar" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.45);padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">🔄</button>';
    html += '    </div>';
    html += '  </div>';

    // Resumen
    html += '  <div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:11.5px;">';
    html += '    <span style="color:#fff;"><strong style="color:#00d4ff;">' + total + '</strong> pushes pendientes</span>';
    html += '    <span style="color:#fff;"><strong style="color:#00d4ff;">' + (d.totalUniqueUsers || 0) + '</strong> users distintos</span>';
    html += '    <span style="color:#888;">Pushes salen al azar dentro de la ventana de cada día</span>';
    html += '  </div>';

    // Tabla con columnas: día, total, por tier, por categoría, horarios
    if (days.length === 0) {
        html += '  <div style="text-align:center;color:#aaa;padding:20px;font-size:12px;">Sin datos.</div>';
    } else {
        html += '  <div style="overflow-x:auto;">';
        html += '  <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:560px;">';
        html += '    <thead><tr style="background:rgba(255,255,255,0.04);">';
        html += '      <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Día</th>';
        html += '      <th style="text-align:right;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Pushes</th>';
        html += '      <th style="text-align:right;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Users</th>';
        html += '      <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Público (por tier)</th>';
        html += '      <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Categorías</th>';
        html += '      <th style="text-align:left;padding:7px 10px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.10);">Horario</th>';
        html += '    </tr></thead><tbody>';
        const today = new Date();
        const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        for (const day of days) {
            const isToday = day.day === todayKey;
            const dayLbl = day.dayName + ' ' + day.day.slice(8) + '/' + day.day.slice(5, 7);
            const rowStyle = isToday ? 'background:rgba(255,215,0,0.06);' : '';
            html += '<tr style="' + rowStyle + '">';
            html += '  <td style="padding:6px 10px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.05);">' + (isToday ? '<strong style="color:#ffd700;">⭐ ' + escapeHtml(dayLbl) + ' (hoy)</strong>' : escapeHtml(dayLbl)) + '</td>';
            html += '  <td style="padding:6px 10px;text-align:right;color:#fff;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.05);">' + day.total + '</td>';
            html += '  <td style="padding:6px 10px;text-align:right;color:#bbb;border-bottom:1px solid rgba(255,255,255,0.05);">' + day.uniqueUsers + '</td>';
            // Tier breakdown
            html += '  <td style="padding:6px 10px;color:#bbb;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;">';
            const tierParts = [];
            for (const t of ['suave', 'normal', 'activo']) {
                const c = day.byTier[t] || 0;
                if (c > 0) tierParts.push('<span style="color:' + tierColors[t] + ';font-weight:700;">' + tierLabels[t] + ' ' + c + '</span>');
            }
            html += tierParts.length > 0 ? tierParts.join(' · ') : '<span style="color:#666;">—</span>';
            html += '  </td>';
            // Category breakdown
            html += '  <td style="padding:6px 10px;color:#bbb;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;">';
            const catParts = [];
            for (const c of ['bonos', 'juegos', 'regalos']) {
                const n = day.byCategory[c] || 0;
                if (n > 0) catParts.push('<span style="color:' + catColors[c] + ';">' + catLabels[c] + ' ' + n + '</span>');
            }
            html += catParts.length > 0 ? catParts.join(' · ') : '<span style="color:#666;">—</span>';
            html += '  </td>';
            // Time range
            const fmtTime = (iso) => {
                if (!iso) return '—';
                try { return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); }
                catch (_) { return '—'; }
            };
            html += '  <td style="padding:6px 10px;color:#aaa;font-family:monospace;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.05);">';
            if (day.total > 0) {
                html += escapeHtml(fmtTime(day.firstAt)) + ' → ' + escapeHtml(fmtTime(day.lastAt));
            } else {
                html += '<span style="color:#666;">—</span>';
            }
            html += '  </td>';
            html += '</tr>';
        }
        html += '  </tbody></table>';
        html += '  </div>';
    }

    // Leyenda de iconos
    html += '  <div style="margin-top:8px;font-size:10.5px;color:#888;line-height:1.6;">';
    html += '    <strong style="color:#aaa;">Tier:</strong> 🟢 suave · 🟡 normal · 🔴 activo · 🔔 solo reembolsos &nbsp;·&nbsp; ';
    html += '    <strong style="color:#aaa;">Categorías:</strong> 🎁 bonos · 🎰 juegos · 💎 regalos';
    html += '  </div>';

    html += '</div>';
    return html;
}

// Simulador con N personas por tier para mostrar reparto.
function _renderStrategySimulator(strategy) {
    if (!strategy) return '';
    const prefs = strategy.preferences || {};
    const total = Number(strategy.monthlyTotalToDistribute) || 0;
    const bonusType = strategy.bonusType || 'cash';

    // Ejemplo con 100 personas en cada tier (los opt y solo_reembolsos
    // no reciben regalos en esta cuenta).
    const N = 100;
    const tiers = [
        { key: 'suave',           label: '🟢 SUAVE',         color: '#66ff66', share: 0.10 },
        { key: 'normal',          label: '🟡 NORMAL',        color: '#ffd700', share: 0.40 },
        { key: 'activo',          label: '🔴 ACTIVO',        color: '#ff8c5a', share: 0.50 },
        { key: 'solo_reembolsos', label: '🔔 SOLO REEMB',    color: '#00d4ff', share: 0.00 }
    ];

    let html = '';
    html += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:12px;margin-bottom:14px;">';
    html += '  <h3 style="color:#d4af37;font-size:13px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">🎯 Simulador · 100 personas en cada tier</h3>';
    html += '  <p style="color:#aaa;font-size:11px;margin:0 0 10px;line-height:1.5;">Suponé que tenés 100 personas en cada nivel. Esto es lo que le llegaría a cada una al mes con la config actual. La plata total ($' + total.toLocaleString('es-AR') + ') se reparte por tier según su peso.</p>';

    html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">';
    for (const t of tiers) {
        const cur = prefs[t.key] || {};
        const tierTotalShare = Math.round(total * t.share);
        const perUser = N > 0 ? Math.round(tierTotalShare / N) : 0;
        const totalPushes = (cur.bonos || 0) + (cur.juegos || 0) + (cur.regalos || 0);
        html += '    <div style="background:rgba(0,0,0,0.30);border:1px solid rgba(' + _hexToRgb(t.color) + ',0.40);border-radius:10px;padding:10px;">';
        html += '      <div style="color:' + t.color + ';font-weight:900;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">' + t.label + ' · ' + N + ' users</div>';
        if (t.key === 'solo_reembolsos') {
            html += '      <div style="color:#aaa;font-size:11px;line-height:1.5;font-style:italic;">Solo reciben push si tienen un reembolso disponible. No reciben bonos ni regalos en esta distribución.</div>';
        } else {
            html += '      <div style="font-size:11.5px;color:#ddd;line-height:1.7;">';
            html += '        ▸ <strong style="color:#fff;">' + (cur.bonos || 0) + '</strong> bonos al mes<br>';
            html += '        ▸ <strong style="color:#fff;">' + (cur.juegos || 0) + '</strong> invitaciones a jugar<br>';
            html += '        ▸ <strong style="color:#fff;">' + (cur.regalos || 0) + '</strong> regalos<br>';
            html += '        <span style="color:#888;font-size:10px;">(' + totalPushes + ' pushes/mes c/u)</span>';
            html += '      </div>';
            html += '      <div style="margin-top:8px;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.10);font-size:11px;color:#bbb;">';
            html += '        Reparto del pozo: <strong style="color:' + t.color + ';">' + Math.round(t.share * 100) + '%</strong> = $' + tierTotalShare.toLocaleString('es-AR');
            html += '        <div style="color:#aaa;font-size:10.5px;margin-top:2px;">≈ <strong>$' + perUser.toLocaleString('es-AR') + '</strong>/user · tipo: <strong style="color:#ffd700;">' + escapeHtml(bonusType) + '</strong></div>';
            html += '      </div>';
        }
        html += '    </div>';
    }
    html += '  </div>';
    html += '</div>';
    return html;
}

function _strategyInput(label, id, val) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px;">' +
           '<label style="color:#bbb;font-size:11px;flex:1;">' + label + '</label>' +
           '<input type="number" id="' + id + '" value="' + (val || 0) + '" style="background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:5px 8px;border-radius:5px;font-size:12px;width:80px;text-align:right;">' +
           '</div>';
}

async function saveNotifStrategy() {
    const btn = document.getElementById('saveStrategyBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando...'; }
    const tiers = ['suave', 'normal', 'activo', 'solo_reembolsos'];
    const preferences = {};
    for (const t of tiers) {
        preferences[t] = {
            bonos:   Number((document.getElementById('strat_' + t + '_bonos')   || {}).value) || 0,
            juegos:  Number((document.getElementById('strat_' + t + '_juegos')  || {}).value) || 0,
            regalos: Number((document.getElementById('strat_' + t + '_regalos') || {}).value) || 0,
            budget:  Number((document.getElementById('strat_' + t + '_budget')  || {}).value) || 0
        };
    }
    const monthlyCap = Number((document.getElementById('strat_monthlyCap') || {}).value) || 0;
    const monthlyTotalToDistribute = Number((document.getElementById('strat_monthlyTotalToDistribute') || {}).value) || 0;
    const bonusType = String((document.getElementById('strat_bonusType') || {}).value || '').trim() || 'cash';
    const windowStartHour = Number((document.getElementById('strat_windowStartHour') || {}).value);
    const windowEndHour   = Number((document.getElementById('strat_windowEndHour')   || {}).value);
    try {
        const r = await authFetch('/api/admin/notif-strategy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences, monthlyCap, monthlyTotalToDistribute, bonusType, windowStartHour, windowEndHour })
        });
        const d = await r.json();
        if (!r.ok) {
            showToast('❌ ' + (d.error || 'Error guardando'), 'error');
        } else {
            showToast('✅ Estrategia guardada', 'success');
            _ENCUESTA_CACHE.strategy = d;
            const c = document.getElementById('encuestaContent');
            if (c) c.innerHTML = _renderEncuesta();
        }
    } catch (e) {
        showToast('Error de conexión', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '💾 GUARDAR estrategia'; }
    }
}

// Genera la previa NO-PERSISTIDA y la muestra en un modal con la
// distribucion real (users que respondieron, top receivers, inactivos).
async function previewNotifStrategy() {
    // Para que la previa refleje los inputs actuales de la pantalla aun
    // sin guardar, primero hacemos un POST silencioso y luego un GET de
    // preview. Si el admin todavia no toco, alcanza el GET solo.
    const btn = document.getElementById('previewStrategyBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando previa...'; }

    let m = document.getElementById('strategyPreviewModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'strategyPreviewModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:10003;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div id="strategyPreviewBody" style="background:#1a0033;border:1px solid #9d4edd;border-radius:12px;padding:18px;max-width:880px;width:100%;max-height:92vh;overflow-y:auto;color:#fff;font-family:system-ui;"></div>';
        m.onclick = (e) => { if (e.target === m) m.remove(); };
        document.body.appendChild(m);
    }
    const body = document.getElementById('strategyPreviewBody');
    body.innerHTML = '<div style="padding:30px;text-align:center;color:#aaa;">⏳ Generando previa con datos reales…</div>';

    try {
        // Persistir lo que esta en el form para que el preview lea ese estado.
        await _saveNotifStrategyForPreview();
        const r = await authFetch('/api/admin/notif-strategy/preview');
        const d = await r.json();
        if (!r.ok) {
            body.innerHTML = '<div style="color:#ff8080;padding:20px;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        body.innerHTML = _renderStrategyPreview(d);
    } catch (e) {
        body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error: ' + escapeHtml(e.message || '') + '</div>';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '👁️ VER PREVIA'; }
    }
}

function closeStrategyPreviewModal() {
    const m = document.getElementById('strategyPreviewModal');
    if (m) m.remove();
}

// POST silencioso que guarda lo que esta en los inputs sin notificar.
async function _saveNotifStrategyForPreview() {
    const tiers = ['suave', 'normal', 'activo', 'solo_reembolsos'];
    const preferences = {};
    for (const t of tiers) {
        preferences[t] = {
            bonos:   Number((document.getElementById('strat_' + t + '_bonos')   || {}).value) || 0,
            juegos:  Number((document.getElementById('strat_' + t + '_juegos')  || {}).value) || 0,
            regalos: Number((document.getElementById('strat_' + t + '_regalos') || {}).value) || 0,
            budget:  Number((document.getElementById('strat_' + t + '_budget')  || {}).value) || 0
        };
    }
    const monthlyCap = Number((document.getElementById('strat_monthlyCap') || {}).value) || 0;
    const monthlyTotalToDistribute = Number((document.getElementById('strat_monthlyTotalToDistribute') || {}).value) || 0;
    const bonusType = String((document.getElementById('strat_bonusType') || {}).value || '').trim() || 'cash';
    const windowStartHour = Number((document.getElementById('strat_windowStartHour') || {}).value);
    const windowEndHour   = Number((document.getElementById('strat_windowEndHour')   || {}).value);
    try {
        await authFetch('/api/admin/notif-strategy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences, monthlyCap, monthlyTotalToDistribute, bonusType, windowStartHour, windowEndHour })
        });
    } catch (_) { /* silencioso */ }
}

function _renderStrategyPreview(d) {
    const tiers = ['suave', 'normal', 'activo', 'solo_reembolsos'];
    const tierLabels = { suave: '🟢 SUAVE', normal: '🟡 NORMAL', activo: '🔴 ACTIVO', solo_reembolsos: '🔔 SOLO REEMB' };
    const tierColors = { suave: '#66ff66', normal: '#ffd700', activo: '#ff8c5a', solo_reembolsos: '#00d4ff' };
    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.10);padding-bottom:10px;margin-bottom:12px;">';
    html += '  <h3 style="margin:0;color:#9d4edd;font-size:18px;">👁️ Previa de estrategia · NO se guardó nada</h3>';
    html += '  <button type="button" onclick="closeStrategyPreviewModal()" style="background:rgba(255,128,128,0.15);color:#ff8080;border:1px solid rgba(255,128,128,0.45);padding:5px 10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">✕ Cerrar</button>';
    html += '</div>';

    // Header con totales
    html += '<div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:10px;padding:12px;margin-bottom:14px;">';
    html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">';
    html += _kpiCard('💰 Plata total a repartir', _fmtMoney(d.monthlyTotalToDistribute), '#ffd700');
    html += _kpiCard('Usuarios que respondieron', (d.respondedTotal || 0).toLocaleString('es-AR'), '#fff');
    const bd = d.bonusDefaults || {};
    const tt = bd.bonus100pctTimed || {};
    html += _kpiCard('Bono 50% al depósito', bd.bonus50pct ? '✅ activo' : '❌ off', '#66ff66');
    html += _kpiCard('Bono 100% x ' + (tt.durationHours || 2) + 'hs', tt.enabled ? ('✅ ' + (tt.startHour || 19) + ':00–' + ((tt.startHour || 19) + (tt.durationHours || 2)) + ':00') : '❌ off', '#9d4edd');
    html += '  </div>';
    html += '</div>';

    // Distribucion por tier
    html += '<h4 style="color:#d4af37;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">📊 Reparto por tier</h4>';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;overflow:hidden;margin-bottom:14px;">';
    html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#d4af37;text-align:left;background:rgba(212,175,55,0.10);">';
    html += '<th style="padding:6px 8px;">Tier</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Users</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Activos</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Inactivos</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Pozo del tier</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Para activos (80%)</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Para inactivos (20%)</th>';
    html += '</tr></thead><tbody>';
    for (const t of tiers) {
        const tp = (d.tierPlans && d.tierPlans[t]) || {};
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:6px 8px;color:' + tierColors[t] + ';font-weight:800;">' + tierLabels[t] + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#fff;">' + (tp.userCount || 0) + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#66ff66;">' + (tp.activeCount || 0) + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#ff8080;">' + (tp.inactiveCount || 0) + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#ffd700;font-weight:800;">' + _fmtMoney(tp.tierBudget) + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#66ff66;">' + _fmtMoney(tp.activeBudget) + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#888;">' + _fmtMoney(tp.inactiveBudget) + ' <span style="font-size:9px;color:#666;">(NO DISP.)</span></td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Top 10 receivers
    const top = d.topReceivers || [];
    if (top.length > 0) {
        html += '<h4 style="color:#66ff66;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">🏆 Top 10 que más reciben (por pérdida + actividad)</h4>';
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;overflow:hidden;margin-bottom:14px;max-height:280px;overflow-y:auto;">';
        html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
        html += '<thead><tr style="color:#66ff66;text-align:left;background:rgba(102,255,102,0.08);"><th style="padding:6px 8px;">#</th><th style="padding:6px 8px;">Usuario</th><th style="padding:6px 8px;">Tier</th><th style="padding:6px 8px;">Estado</th><th style="padding:6px 8px;text-align:right;">Pérdida 30d</th><th style="padding:6px 8px;text-align:right;">Cargas 30d</th><th style="padding:6px 8px;text-align:right;">Asignado</th></tr></thead><tbody>';
        for (let i = 0; i < top.length; i++) {
            const u = top[i];
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
            html += '<td style="padding:6px 8px;color:#888;">' + (i+1) + '</td>';
            html += '<td style="padding:6px 8px;color:#fff;font-weight:700;">' + escapeHtml(u.username) + '</td>';
            html += '<td style="padding:6px 8px;color:' + (tierColors[u.tier] || '#fff') + ';font-weight:800;font-size:10px;">' + (tierLabels[u.tier] || u.tier) + '</td>';
            html += '<td style="padding:6px 8px;color:#aaa;font-size:10.5px;">' + escapeHtml(u.activityStatus || '—') + '</td>';
            html += '<td style="padding:6px 8px;text-align:right;color:#ff8080;font-weight:700;">' + _fmtMoney(u.netToHouse30d) + '</td>';
            html += '<td style="padding:6px 8px;text-align:right;color:#fff;">' + (u.chargesCount30d || 0) + '</td>';
            html += '<td style="padding:6px 8px;text-align:right;color:#66ff66;font-weight:900;white-space:nowrap;">' + _fmtMoney(u.assignedARS) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
    }

    // Inactivos
    const inact = d.topInactives || [];
    if (inact.length > 0) {
        html += '<h4 style="color:#ff8080;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">⛔ Inactivos · plata asignada pero NO DISPONIBLE</h4>';
        html += '<div style="background:rgba(255,128,128,0.05);border:1px solid rgba(255,128,128,0.20);border-radius:8px;overflow:hidden;margin-bottom:14px;max-height:240px;overflow-y:auto;">';
        html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
        html += '<thead><tr style="color:#ff8080;text-align:left;background:rgba(255,128,128,0.08);"><th style="padding:6px 8px;">Usuario</th><th style="padding:6px 8px;">Tier</th><th style="padding:6px 8px;">Estado</th><th style="padding:6px 8px;text-align:right;">Asignado</th><th style="padding:6px 8px;">Razón</th></tr></thead><tbody>';
        for (const u of inact) {
            html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
            html += '<td style="padding:6px 8px;color:#fff;font-weight:700;">' + escapeHtml(u.username) + '</td>';
            html += '<td style="padding:6px 8px;color:' + (tierColors[u.tier] || '#fff') + ';font-weight:800;font-size:10px;">' + (tierLabels[u.tier] || u.tier) + '</td>';
            html += '<td style="padding:6px 8px;color:#aaa;">' + escapeHtml(u.activityStatus || '—') + '</td>';
            html += '<td style="padding:6px 8px;text-align:right;color:#ff8080;font-weight:700;">' + _fmtMoney(u.assignedARS) + '</td>';
            html += '<td style="padding:6px 8px;color:#888;font-size:10.5px;font-style:italic;">' + escapeHtml(u.reason || '') + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
    }

    // CTAs finales
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">';
    html += '  <button type="button" onclick="closeStrategyPreviewModal()" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 16px;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer;">Cerrar previa (no guardar)</button>';
    html += '  <button type="button" onclick="closeStrategyPreviewModal();saveNotifStrategy()" style="background:linear-gradient(135deg,#00d4ff,#0080ff);color:#000;border:none;padding:9px 16px;border-radius:7px;font-weight:900;font-size:12px;cursor:pointer;">💾 Confirmar y GUARDAR</button>';
    html += '</div>';

    return html;
}

// Rellena los inputs del editor con los valores recomendados. NO guarda
// nada hasta que el admin apriete GUARDAR. Los numeros matchean la
// Pregunta de la encuesta que ve el user en la PWA.
function loadRecommendedDefaults() {
    const recommendations = {
        suave:           { bonos: 2, juegos: 5,  regalos: 2, budget: 100000 },
        normal:          { bonos: 4, juegos: 5,  regalos: 2, budget: 100000 },
        activo:          { bonos: 6, juegos: 10, regalos: 3, budget: 100000 },
        solo_reembolsos: { bonos: 0, juegos: 0,  regalos: 0, budget: 0 }
    };
    for (const tier of Object.keys(recommendations)) {
        const r = recommendations[tier];
        const setVal = (suffix, val) => {
            const el = document.getElementById('strat_' + tier + '_' + suffix);
            if (el) el.value = String(val);
        };
        setVal('bonos', r.bonos);
        setVal('juegos', r.juegos);
        setVal('regalos', r.regalos);
        setVal('budget', r.budget);
    }
    const cap = document.getElementById('strat_monthlyCap');
    if (cap) cap.value = '1000000';
    const total = document.getElementById('strat_monthlyTotalToDistribute');
    if (total) total.value = '250000';
    const bt = document.getElementById('strat_bonusType');
    if (bt) bt.value = '50% en cargas + 1× 100% al mes';
    // Ventana horaria recomendada: 18-21hs (3hs de pico de tráfico).
    const wStart = document.getElementById('strat_windowStartHour');
    const wEnd   = document.getElementById('strat_windowEndHour');
    const wPrev  = document.getElementById('strat_windowPreview');
    if (wStart) wStart.value = '18';
    if (wEnd)   wEnd.value   = '21';
    if (wPrev)  wPrev.textContent = '18:00 a 21:00';
    showToast('🔄 Valores recomendados cargados (ventana 18:00–21:00) — no guardados hasta que aprietes Guardar', 'info');
}

// Dispara el test endpoint para mandar N notifs cada 1 min al user.
async function testFireNotifications() {
    const inp = document.getElementById('testFireUsername');
    const countInp = document.getElementById('testFireCount');
    const result = document.getElementById('testFireResult');
    const btn = document.getElementById('testFireBtn');
    const username = (inp && inp.value || '').trim();
    const count = Math.min(10, Math.max(1, Number(countInp && countInp.value) || 5));
    if (!username) {
        if (result) { result.style.color = '#ff8080'; result.textContent = '⚠️ Ingresá un username.'; }
        return;
    }
    if (!confirm('¿Disparar ' + count + ' notifs de test a "' + username + '" cada 1 min? El user va a recibir ' + count + ' pushes seguidas.')) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Disparando...'; }
    if (result) { result.style.color = '#aaa'; result.textContent = '⏳ Programando notifs...'; }
    try {
        const r = await authFetch('/api/admin/notif-strategy/test-fire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, count })
        });
        const d = await r.json();
        if (!r.ok) {
            if (result) { result.style.color = '#ff8080'; result.textContent = '❌ ' + (d.error || 'Error'); }
            return;
        }
        const lines = (d.blueprints || []).map(b => '· min ' + b.fireInMin + ': ' + b.title).join('<br>');
        if (result) {
            result.style.color = '#66ff66';
            result.innerHTML = '✅ ' + escapeHtml(d.message) + '<br><span style="color:#ddd;font-size:10.5px;">' + lines + '</span>';
        }
        showToast('✅ Test fire programado · ' + count + ' notifs a ' + username, 'success');
    } catch (e) {
        if (result) { result.style.color = '#ff8080'; result.textContent = '❌ Error de conexión'; }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔥 DISPARAR TEST'; }
    }
}

// Activa/desactiva la estrategia. Cuando isActive=true, el cron de
// reembolsos-recordatorio respeta la preferencia 'solo_reembolsos'.
async function toggleNotifStrategy(activate) {
    const verb = activate ? 'ACTIVAR' : 'DESACTIVAR';
    if (!confirm('¿' + verb + ' la estrategia? ' + (activate
        ? 'Los crons mensuales y los recordatorios diarios de reembolso van a empezar a respetar esta config.'
        : 'Los pushes auto-programados van a quedar pausados.'))) return;
    try {
        const r = await authFetch('/api/admin/notif-strategy/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activate: !!activate })
        });
        const d = await r.json();
        if (!r.ok) {
            showToast('❌ ' + (d.error || 'Error'), 'error');
            return;
        }
        const act = d._activation || null;
        if (activate && act) {
            const sch = act.scheduled || {};
            const msg = '✅ Activa · ' + (sch.totalPushes || 0) + ' notifs programadas para ' + (sch.totalUsers || 0) + ' users';
            showToast(msg, 'success');
        } else {
            showToast('✅ Estrategia ' + (activate ? 'activa' : 'desactivada') + (act && act.cancelledPending ? ' · ' + act.cancelledPending + ' cancelados' : ''), 'success');
        }
        _ENCUESTA_CACHE.strategy = d;
        const c = document.getElementById('encuestaContent');
        if (c) c.innerHTML = _renderEncuesta();
        // Al activar, mostrar modal con el detalle del calendario configurado:
        // ventana horaria, próximos disparos pendientes y resumen por tier.
        if (activate) {
            try { await openStrategySchedule(); } catch (_) {}
        }
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

// Modal con el detalle del calendario de envíos. Se abre solo después de
// activar (toggleNotifStrategy(true)) o manualmente desde el botón
// "📅 Ver calendario de envíos" del editor.
async function openStrategySchedule() {
    let m = document.getElementById('strategyScheduleModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'strategyScheduleModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:10004;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div id="strategyScheduleBody" style="background:#0f1024;border:1px solid #66ff66;border-radius:12px;padding:18px;max-width:760px;width:100%;max-height:92vh;overflow-y:auto;color:#fff;font-family:system-ui;"></div>';
        m.onclick = (e) => { if (e.target === m) m.remove(); };
        document.body.appendChild(m);
    }
    const body = document.getElementById('strategyScheduleBody');
    body.innerHTML = '<div style="padding:30px;text-align:center;color:#aaa;">⏳ Cargando calendario…</div>';
    try {
        const r = await authFetch('/api/admin/notif-strategy/schedule');
        const d = await r.json();
        if (!r.ok) {
            body.innerHTML = '<div style="color:#ff8080;padding:20px;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        body.innerHTML = _renderStrategySchedule(d);
    } catch (e) {
        body.innerHTML = '<div style="color:#ff8080;padding:20px;">Error: ' + escapeHtml(e.message || '') + '</div>';
    }
}

function closeStrategyScheduleModal() {
    const m = document.getElementById('strategyScheduleModal');
    if (m) m.remove();
}

function _renderStrategySchedule(d) {
    const w = d.window || { startHour: 18, endHour: 21, label: '18:00 a 21:00' };
    const tierLabels = { suave: '🟢 SUAVE', normal: '🟡 NORMAL', activo: '🔴 ACTIVO', solo_reembolsos: '🔔 SOLO REEMB' };
    const tierColors = { suave: '#66ff66', normal: '#ffd700', activo: '#ff8c5a', solo_reembolsos: '#00d4ff' };
    const catLabels = { bonos: '🎁 Bonos', juegos: '🎰 Juegos', regalos: '💎 Regalos', otros: '📌 Otros' };
    const catColors = { bonos: '#ffd700', juegos: '#9d4edd', regalos: '#25d366', otros: '#aaa' };
    const tc = d.tierCounts || {};
    const cc = d.categoryCounts || {};
    const daily = d.dailyDistribution || [];
    const items = d.items || [];

    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.10);padding-bottom:10px;margin-bottom:12px;">';
    html += '  <h3 style="margin:0;color:#66ff66;font-size:18px;">📅 Calendario de envíos · ' + escapeHtml(d.monthKey || '') + '</h3>';
    html += '  <button type="button" onclick="closeStrategyScheduleModal()" style="background:rgba(255,128,128,0.15);color:#ff8080;border:1px solid rgba(255,128,128,0.45);padding:5px 10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">✕ Cerrar</button>';
    html += '</div>';

    // Header con totales grandes
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;">';
    html += '  <div style="background:rgba(102,255,102,0.08);border:1px solid rgba(102,255,102,0.40);border-radius:10px;padding:12px;">';
    html += '    <div style="color:#66ff66;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Total programado</div>';
    html += '    <div style="color:#fff;font-size:24px;font-weight:900;">' + (d.pendingTotal || 0) + '</div>';
    html += '    <div style="color:#888;font-size:10px;">notifs pendientes</div>';
    html += '  </div>';
    html += '  <div style="background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.40);border-radius:10px;padding:12px;">';
    html += '    <div style="color:#d4af37;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Usuarios incluidos</div>';
    html += '    <div style="color:#fff;font-size:24px;font-weight:900;">' + (d.uniqueUsers || 0) + '</div>';
    html += '    <div style="color:#888;font-size:10px;">distintos</div>';
    html += '  </div>';
    html += '  <div style="background:rgba(31,140,255,0.08);border:1px solid rgba(31,140,255,0.40);border-radius:10px;padding:12px;">';
    html += '    <div style="color:#1f8cff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Días con envíos</div>';
    html += '    <div style="color:#fff;font-size:24px;font-weight:900;">' + daily.length + '</div>';
    html += '    <div style="color:#888;font-size:10px;">del mes en curso</div>';
    html += '  </div>';
    html += '</div>';

    // Ventana configurada
    html += '<div style="background:rgba(102,255,102,0.06);border:1px solid rgba(102,255,102,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '  <div style="color:#66ff66;font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Ventana horaria</div>';
    html += '  <div style="color:#fff;font-size:18px;font-weight:800;">' + escapeHtml(w.label) + '</div>';
    html += '  <div style="color:#bbb;font-size:11px;margin-top:4px;line-height:1.5;">Cada usuario recibe sus notificaciones a horas <strong>random</strong> distintas dentro de esta ventana, repartidas en días distintos del mes.</div>';
    html += '</div>';

    // Desglose por categoría
    html += '<div style="background:rgba(157,78,221,0.06);border:1px solid rgba(157,78,221,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '  <div style="color:#9d4edd;font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Por categoría</div>';
    html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">';
    for (const cat of ['bonos', 'juegos', 'regalos']) {
        html += '    <div style="background:rgba(0,0,0,0.30);border:1px solid rgba(' + _hexToRgb(catColors[cat]) + ',0.40);border-radius:8px;padding:8px;">';
        html += '      <div style="color:' + catColors[cat] + ';font-weight:900;font-size:11px;letter-spacing:1px;">' + catLabels[cat] + '</div>';
        html += '      <div style="color:#fff;font-size:18px;font-weight:800;margin-top:2px;">' + (cc[cat] || 0) + '</div>';
        html += '    </div>';
    }
    html += '  </div>';
    html += '</div>';

    // Desglose por tier
    html += '<div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
    html += '  <div style="color:#d4af37;font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Por tier de la encuesta</div>';
    html += '  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">';
    for (const t of Object.keys(tierLabels)) {
        const c = tc[t] || 0;
        html += '    <div style="background:rgba(0,0,0,0.30);border:1px solid rgba(' + _hexToRgb(tierColors[t]) + ',0.40);border-radius:8px;padding:8px;">';
        html += '      <div style="color:' + tierColors[t] + ';font-weight:900;font-size:11px;letter-spacing:1px;">' + tierLabels[t] + '</div>';
        html += '      <div style="color:#fff;font-size:18px;font-weight:800;margin-top:2px;">' + c + '</div>';
        html += '      <div style="color:#888;font-size:10px;">notifs pendientes</div>';
        html += '    </div>';
    }
    html += '  </div>';
    if (d.earliestAt && d.latestAt) {
        const e1 = new Date(d.earliestAt).toLocaleString('es-AR');
        const e2 = new Date(d.latestAt).toLocaleString('es-AR');
        html += '  <div style="color:#bbb;font-size:11px;margin-top:8px;line-height:1.5;">Primer envío: <strong style="color:#fff;">' + escapeHtml(e1) + '</strong> · Último: <strong style="color:#fff;">' + escapeHtml(e2) + '</strong></div>';
    }
    html += '</div>';

    // Distribución por día (mini bar chart en HTML).
    if (daily.length > 0) {
        const maxCount = daily.reduce((m, x) => Math.max(m, x.count), 0);
        html += '<div style="background:rgba(31,140,255,0.06);border:1px solid rgba(31,140,255,0.30);border-radius:10px;padding:12px;margin-bottom:12px;">';
        html += '  <div style="color:#1f8cff;font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Distribución por día</div>';
        html += '  <div style="display:flex;gap:3px;align-items:flex-end;overflow-x:auto;padding-bottom:6px;">';
        for (const day of daily) {
            const pct = maxCount > 0 ? Math.round((day.count / maxCount) * 100) : 0;
            const barH = Math.max(4, pct);
            const dayLabel = day.day.slice(8); // DD
            html += '<div title="' + escapeHtml(day.day) + ' — ' + day.count + ' notifs" style="flex:0 0 28px;display:flex;flex-direction:column;align-items:center;gap:3px;">';
            html += '  <div style="color:#fff;font-size:10px;font-weight:700;">' + day.count + '</div>';
            html += '  <div style="background:linear-gradient(180deg,#1f8cff,#0d47a1);width:22px;height:' + barH + 'px;border-radius:3px 3px 0 0;"></div>';
            html += '  <div style="color:#888;font-size:9px;">' + dayLabel + '</div>';
            html += '</div>';
        }
        html += '  </div>';
        html += '</div>';
    }

    // Listado detallado
    if (items.length === 0) {
        html += '<div class="empty-state" style="padding:30px;text-align:center;color:#aaa;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.10);border-radius:10px;">';
        html += '  Todavía no hay disparos pendientes de la estrategia.<br>';
        html += '  <span style="color:#888;font-size:11px;">Activá la estrategia para que el calendario completo del mes quede armado.</span>';
        html += '</div>';
    } else {
        html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px;">';
        html += '  <div style="color:#bbb;font-size:11px;margin-bottom:8px;padding:0 4px;">Ordenado por hora de envío. Mostrando hasta 200 de ' + (d.pendingTotal || 0) + '.</div>';
        html += '  <div style="overflow-x:auto;">';
        html += '  <table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
        html += '    <thead><tr style="background:rgba(255,255,255,0.04);">';
        html += '      <th style="text-align:left;padding:6px 8px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Hora</th>';
        html += '      <th style="text-align:left;padding:6px 8px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Usuario</th>';
        html += '      <th style="text-align:left;padding:6px 8px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Tier</th>';
        html += '      <th style="text-align:left;padding:6px 8px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Categoría</th>';
        html += '      <th style="text-align:left;padding:6px 8px;color:#ddd;border-bottom:1px solid rgba(255,255,255,0.08);">Título</th>';
        html += '    </tr></thead><tbody>';
        for (const it of items) {
            const dt = it.scheduledFor ? new Date(it.scheduledFor) : null;
            const dtStr = dt ? dt.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const tierLbl = tierLabels[it.tier] || (it.tier || '—');
            const tierCol = tierColors[it.tier] || '#aaa';
            const catLbl  = catLabels[it.category] || (it.category || '—');
            const catCol  = catColors[it.category] || '#aaa';
            html += '<tr>';
            html += '  <td style="padding:5px 8px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.04);font-family:monospace;">' + escapeHtml(dtStr) + '</td>';
            html += '  <td style="padding:5px 8px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.04);">' + escapeHtml(it.targetUsername || '') + '</td>';
            html += '  <td style="padding:5px 8px;color:' + tierCol + ';border-bottom:1px solid rgba(255,255,255,0.04);font-weight:700;">' + escapeHtml(tierLbl) + '</td>';
            html += '  <td style="padding:5px 8px;color:' + catCol + ';border-bottom:1px solid rgba(255,255,255,0.04);font-weight:700;">' + escapeHtml(catLbl) + '</td>';
            html += '  <td style="padding:5px 8px;color:#bbb;border-bottom:1px solid rgba(255,255,255,0.04);">' + escapeHtml(it.title || '') + '</td>';
            html += '</tr>';
        }
        html += '  </tbody></table>';
        html += '  </div>';
        html += '</div>';
    }

    html += '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">';
    html += '  <button type="button" onclick="openStrategySchedule()" style="background:rgba(102,255,102,0.10);color:#66ff66;border:1px solid rgba(102,255,102,0.45);padding:8px 14px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">🔄 Refrescar</button>';
    html += '  <button type="button" onclick="closeStrategyScheduleModal()" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:8px 14px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Cerrar</button>';
    html += '</div>';

    return html;
}

// Reporte de reaccion: pegamos al endpoint y renderizamos al final del
// panel. Lo recargamos solo on-demand (boton "🔄 Refrescar reacciones").
async function loadReactionsReport() {
    const cont = document.getElementById('reactionsReportBox');
    if (!cont) return;
    cont.innerHTML = '<div style="padding:14px;text-align:center;color:#aaa;font-size:11.5px;">⏳ Cargando reacciones de los últimos 30 días…</div>';
    try {
        const r = await authFetch('/api/admin/notif-strategy/reactions?days=30');
        const d = await r.json();
        if (!r.ok) {
            cont.innerHTML = '<div style="color:#ff8080;padding:14px;font-size:11.5px;">' + escapeHtml(d.error || 'Error') + '</div>';
            return;
        }
        cont.innerHTML = _renderReactionsReport(d);
    } catch (e) {
        cont.innerHTML = '<div style="color:#ff8080;padding:14px;font-size:11.5px;">Error de conexión</div>';
    }
}

function _renderReactionsReport(d) {
    const tiers = [
        { k: 'suave',           l: '🟢 SUAVE',         color: '#66ff66' },
        { k: 'normal',          l: '🟡 NORMAL',        color: '#ffd700' },
        { k: 'activo',          l: '🔴 ACTIVO',        color: '#ff8c5a' },
        { k: 'solo_reembolsos', l: '🔔 SOLO REEMB',    color: '#00d4ff' }
    ];
    let html = '';
    html += '<div style="font-size:11px;color:#aaa;margin-bottom:8px;">Pushes enviadas y conversiones de los últimos ' + (d.days || 30) + ' días, agrupadas por tier de la encuesta.</div>';
    html += '<div style="background:rgba(0,0,0,0.30);border-radius:6px;overflow:hidden;">';
    html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#d4af37;text-align:left;background:rgba(212,175,55,0.10);">';
    html += '<th style="padding:6px 8px;">Tier</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Pushes</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Entregadas</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Fallidas</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Cargas (período)</th>';
    html += '<th style="padding:6px 8px;text-align:right;">Users que cargaron</th>';
    html += '<th style="padding:6px 8px;text-align:right;">$ depositado</th>';
    html += '</tr></thead><tbody>';
    for (const t of tiers) {
        const b = (d.buckets && d.buckets[t.k]) || { sent: 0, delivered: 0, failed: 0 };
        const c = (d.conversions && d.conversions[t.k]) || { users: 0, deposits: 0, sum: 0 };
        const dlvPct = b.sent ? Math.round((b.delivered / b.sent) * 100) : 0;
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.05);">';
        html += '<td style="padding:6px 8px;color:' + t.color + ';font-weight:800;">' + t.l + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#fff;">' + b.sent + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#66ff66;">' + b.delivered + ' <span style="color:#666;font-size:10px;">(' + dlvPct + '%)</span></td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#ff8080;">' + b.failed + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#fff;">' + c.deposits + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#fff;">' + c.users + '</td>';
        html += '<td style="padding:6px 8px;text-align:right;color:#ffd700;font-weight:800;white-space:nowrap;">' + _fmtMoney(c.sum) + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;color:#888;font-size:10.5px;">';
    html += '<span>Total users con respuesta: ' + (d.totalUsers || 0).toLocaleString('es-AR') + '</span>';
    html += '<button type="button" onclick="loadReactionsReport()" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer;font-weight:700;">🔄 Refrescar</button>';
    html += '</div>';
    return html;
}

function _topPlayerDetail(username) {
    const d = _TOP_PLAYERS_STATE.data;
    if (!d) return;
    const p = (d.players || []).find(x => x.username === username);
    if (!p) return;
    const last = p.lastRealDepositDate ? new Date(p.lastRealDepositDate).toLocaleString('es-AR') : 'nunca';
    const seenApp = p.lastSeenApp ? new Date(p.lastSeenApp).toLocaleString('es-AR') : 'nunca';
    // Mapeo de preferencia de encuesta a texto legible. 'opt_out' es legacy
    // y se trata semanticamente igual que solo_reembolsos (recibo solo
    // cuando hay un reembolso disponible) — no es 'no quiero nada'.
    const prefMap = {
        suave: '🟢 SUAVE (2 bonos · 5 invitaciones · 2 regalos/mes)',
        normal: '🟡 NORMAL (4 bonos · 5 invitaciones · 2 regalos/mes)',
        activo: '🔴 ACTIVO (6 bonos · 10 invitaciones · 3 regalos/mes)',
        solo_reembolsos: '🔔 SOLO REEMBOLSOS (recibe push solo cuando hay reembolso disponible)',
        opt_out: '🔔 SOLO REEMBOLSOS (legacy)'
    };
    const prefAt = p.notifPreferenceAt ? new Date(p.notifPreferenceAt).toLocaleString('es-AR') : null;
    const prefLine = p.notifPreference
        ? '📋 Encuesta: ' + (prefMap[p.notifPreference] || p.notifPreference) + (prefAt ? ' · respondió ' + prefAt : '')
        : '📋 Encuesta: — sin responder';
    const lines = [
        '👤 ' + p.username + (p.name ? ' (' + p.name + ')' : ''),
        '',
        '📊 Segmento: ' + p.segment + ' · Tier: ' + p.tier + ' · ' + p.activityStatus,
        '📱 App: ' + (p.hasApp ? 'INSTALADA ✅' : 'NO instalada ❌') + ' · Última visita: ' + seenApp,
        '👥 Equipo: ' + (p.team || '—') + (p.linePhone ? ' (línea ' + p.linePhone + ')' : ''),
        '📞 Teléfono: ' + (p.phone || '—'),
        prefLine,
        '',
        '— CARGAS REALES —',
        'Última carga: ' + last + ' (' + (p.daysSinceLastDeposit == null ? 'nunca' : p.daysSinceLastDeposit + 'd atrás') + ')',
        'Período seleccionado: ' + p.chargesInPeriod + ' cargas · $' + (p.depositsInPeriod || 0).toLocaleString('es-AR'),
        'Última semana: ' + p.chargesLast7d + ' cargas · $' + (p.depositsLast7d || 0).toLocaleString('es-AR'),
        'Últimos 30 días: ' + p.realChargesCount30d + ' cargas · $' + (p.realDeposits30d || 0).toLocaleString('es-AR'),
        '',
        '— BONOS RECIBIDOS —',
        'Total: ' + p.bonusClaimsCount + ' bonos · $' + (p.bonusClaimsTotal || 0).toLocaleString('es-AR'),
        '$ Bonos 30d: ' + (p.bonusGiven30d || 0).toLocaleString('es-AR'),
        'Neto a la casa 30d: $' + (p.netToHouse30d || 0).toLocaleString('es-AR'),
        'ROI por bono: ' + (p.roiPerBonus != null ? p.roiPerBonus.toFixed(2) + 'x' : '—'),
        p.isOpportunist ? '⚠️ FLAGGED: oportunista (reclama bonos sin cargar)' : '',
        '',
        '— RECUPERACIÓN —',
        'Pushes lifetime: ' + p.recoveryAttemptsLifetime,
        'Último push: ' + (p.lastRecoveryPushAt ? new Date(p.lastRecoveryPushAt).toLocaleString('es-AR') : 'nunca')
    ].filter(Boolean).join('\n');
    alert(lines);
}

function _openTopPlayersNotifyModal(segment) {
    let modal = document.getElementById('topPlayersNotifyModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'topPlayersNotifyModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:40000;display:flex;align-items:center;justify-content:center;padding:14px;';
    const segMeta = _TOP_PLAYERS_SEGMENTS.find(s => s.key === segment) || { label: segment, color: '#fff' };
    // Escapamos team y segment porque vienen del nombre real del equipo
    // (puede contener caracteres) y del query string. Si dejamos pasar
    // raw a innerHTML, un nombre de equipo con `<script>` rompe la pagina.
    const teamLabel = _TOP_PLAYERS_STATE.team ? ' del equipo ' + escapeHtml(_TOP_PLAYERS_STATE.team) : '';
    modal.innerHTML =
        '<div style="background:#1a0033;border:2px solid ' + segMeta.color + ';border-radius:12px;max-width:480px;width:100%;padding:18px;">' +
        '  <h3 style="color:' + segMeta.color + ';margin:0 0 6px;font-size:16px;">📲 Notificar a ' + escapeHtml(segMeta.label || '') + teamLabel + '</h3>' +
        '  <div style="color:#aaa;font-size:11px;margin-bottom:12px;line-height:1.5;">Push masivo solo a los que tienen la app instalada con notificaciones activas. Los sin app NO reciben (para esos usá WhatsApp por la línea del equipo).</div>' +
        '  <label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Título</label>' +
        '  <input id="topNotifyTitle" type="text" maxlength="80" placeholder="Ej: Te extrañamos 🎁" style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 10px;border-radius:6px;font-size:13px;margin:4px 0 10px;box-sizing:border-box;">' +
        '  <label style="color:#aaa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Mensaje</label>' +
        '  <textarea id="topNotifyBody" maxlength="240" placeholder="Volvé hoy y te damos $X. Hasta las 23:59." style="width:100%;background:rgba(0,0,0,0.50);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:9px 10px;border-radius:6px;font-size:13px;margin:4px 0 12px;box-sizing:border-box;min-height:75px;resize:vertical;"></textarea>' +
        '  <div style="display:flex;gap:8px;">' +
        '    <button type="button" onclick="document.getElementById(\'topPlayersNotifyModal\').remove()" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Cancelar</button>' +
        '    <button type="button" onclick="_sendTopPlayersNotify(\'' + segment + '\')" style="flex:2;background:linear-gradient(135deg,' + segMeta.color + ',#00d4ff);color:#000;border:none;padding:10px;border-radius:6px;font-weight:900;font-size:12px;cursor:pointer;letter-spacing:0.5px;">📤 Enviar push</button>' +
        '  </div>' +
        '</div>';
    document.body.appendChild(modal);
    setTimeout(() => { try { document.getElementById('topNotifyTitle').focus(); } catch (_) {} }, 100);
}

async function _sendTopPlayersNotify(segment) {
    const title = (document.getElementById('topNotifyTitle')?.value || '').trim();
    const body = (document.getElementById('topNotifyBody')?.value || '').trim();
    if (!title || !body) { alert('Falta título o mensaje'); return; }
    if (!confirm('Enviar push a TODOS los jugadores ' + segment + (_TOP_PLAYERS_STATE.team ? ' del equipo ' + _TOP_PLAYERS_STATE.team : '') + ' con app?')) return;
    if (_sendTopPlayersNotify._busy) return;
    _sendTopPlayersNotify._busy = true;
    try {
        const r = await authFetch('/api/admin/players/segments/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                segment,
                team: _TOP_PLAYERS_STATE.team || null,
                tier: _TOP_PLAYERS_STATE.tier || null,
                title,
                body
            })
        });
        const d = await r.json();
        if (!r.ok) { alert('Error: ' + (d.error || 'no se pudo enviar')); return; }
        alert('✅ Push enviado\n\nElegibles: ' + d.eligible + '\nEnviadas: ' + d.sent + '\nFallidas: ' + (d.failed || 0));
        document.getElementById('topPlayersNotifyModal')?.remove();
    } catch (e) {
        alert('Error de conexión');
    }
    finally { _sendTopPlayersNotify._busy = false; }
}
