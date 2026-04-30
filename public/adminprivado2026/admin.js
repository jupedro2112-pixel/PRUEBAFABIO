// ============================================
// Admin Panel — versión light
// Solo: Número principal vigente + reportes (refunds + ingresos)
// ============================================

const API_URL = '';
let currentToken = localStorage.getItem('adminToken') || null;
let currentAdmin = null;

const USER_LINES_SLOTS = 8;

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
        reportDaily: 'reportDailySection',
        reportWeekly: 'reportWeeklySection',
        reportMonthly: 'reportMonthlySection',
        ingresos: 'ingresosSection'
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
    let html = '';
    for (let i = 0; i < USER_LINES_SLOTS; i++) {
        const s = data[i] || {};
        const prefix = s.prefix || '';
        const phone = s.phone || '';
        html += `
            <div style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="background:linear-gradient(135deg,#d4af37 0%,#f7931e 100%);color:#000;font-weight:800;font-size:11px;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
                    <span style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Equipo ${i + 1}</span>
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
    container.innerHTML = html;
}

async function loadUserLines() {
    try {
        const r = await authFetch('/api/admin/user-lines');
        if (!r.ok) {
            renderUserLinesSlots([]);
            return;
        }
        const data = await r.json();
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

function renderRefundsReport(container, data, type) {
    const s = data.summary || {};
    const refunds = data.refunds || [];
    const series = data.series || [];

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

    // Lista de reclamos
    html += '<h3 style="color:#d4af37;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:24px 0 10px;">Detalle de reclamos</h3>';
    if (refunds.length === 0) {
        html += '<div class="empty-state">No hay reclamos en este rango.</div>';
    } else {
        html += '<table class="report-table"><thead><tr><th>Usuario</th><th>Período</th><th>Monto</th><th>Reclamado</th></tr></thead><tbody>';
        for (const ref of refunds) {
            html += '<tr>';
            html += '  <td><strong>' + escapeHtml(ref.username) + '</strong></td>';
            html += '  <td>' + escapeHtml(ref.period || '-') + '</td>';
            html += '  <td>' + formatMoney(ref.amount) + '</td>';
            html += '  <td>' + escapeHtml(formatDate(ref.claimedAt)) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
    }

    container.innerHTML = html;
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
