// =====================================================================
// RULETA DIARIA — 1 giro/día por user con PWA + notifs activadas
// =====================================================================
// Flujo:
//   1) Al cargar el home, fetch /api/roulette/status
//      - si NO elegible (sin FCM token) → no muestra nada
//      - si elegible y ya giró HOY → card mostrando resultado de hoy
//      - si elegible y NO giró → card "GIRAR LA RULETA"
//   2) Click "GIRAR" → abre modal con animación de ruleta, llama
//      POST /api/roulette/spin, muestra premio. Si gana, JUGAYGANA ya
//      acreditó server-side automático.
//   3) Transparencia: tabla de probabilidades visible en el modal
//      ("el premio más grande es el menos probable").
// =====================================================================
(function () {
    'use strict';
    window.VIP = window.VIP || {};

    let _state = null; // { eligible, alreadySpun, spin, prizes }
    let _spinning = false;

    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }
    function _fmt(n) { return Number(n || 0).toLocaleString('es-AR'); }

    async function loadStatus() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/roulette/status`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return;
            const d = await r.json();
            if (!d || !d.success) return;
            _state = d;
            renderHomeCard();
        } catch (e) { /* best-effort */ }
    }

    function renderHomeCard() {
        const c = document.getElementById('rouletteHomeCard');
        if (!c) return;
        if (!_state || !_state.eligible) { c.style.display = 'none'; c.innerHTML = ''; return; }

        const spin = _state.spin;
        // Render compacto: banda fina arriba del home con CTA en una sola
        // línea. Tap → abre el modal con el detalle / giro real.
        let html = '';
        if (_state.alreadySpun && spin) {
            const won = Number(spin.prizeARS || 0) > 0;
            if (won && spin.status === 'credited') {
                html += '<div onclick="VIP.roulette && VIP.roulette.open()" style="cursor:pointer;background:linear-gradient(135deg,#0f4c00,#1a8200);border:1px solid #ffd700;border-radius:8px;padding:6px 10px;margin:6px auto;max-width:560px;display:flex;align-items:center;gap:8px;font-size:12.5px;">';
                html += '<span style="font-size:16px;">🎰</span>';
                html += '<span style="color:#fff;font-weight:800;flex:1;">Ganaste <strong style="color:#ffd700;">$' + _fmt(spin.prizeARS) + '</strong> hoy · acreditado</span>';
                html += '<span style="color:#ffd700;font-size:11px;">›</span>';
                html += '</div>';
            } else if (won && spin.status === 'credit_failed') {
                html += '<div onclick="VIP.roulette && VIP.roulette.open()" style="cursor:pointer;background:rgba(255,170,102,0.10);border:1px solid #ffaa66;border-radius:8px;padding:6px 10px;margin:6px auto;max-width:560px;display:flex;align-items:center;gap:8px;font-size:12.5px;">';
                html += '<span style="font-size:16px;">⚠️</span>';
                html += '<span style="color:#fff;font-weight:700;flex:1;">Ganaste $' + _fmt(spin.prizeARS) + ' — acreditación falló, escribinos</span>';
                html += '<span style="color:#ffaa66;font-size:11px;">›</span>';
                html += '</div>';
            } else {
                html += '<div onclick="VIP.roulette && VIP.roulette.open()" style="cursor:pointer;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.18);border-radius:8px;padding:6px 10px;margin:6px auto;max-width:560px;display:flex;align-items:center;gap:8px;font-size:12.5px;">';
                html += '<span style="font-size:16px;opacity:0.7;">🎰</span>';
                html += '<span style="color:#ccc;flex:1;">Hoy no ganaste · volvé mañana</span>';
                html += '<span style="color:#888;font-size:11px;">›</span>';
                html += '</div>';
            }
        } else {
            // No giró → banda fina con CTA + pulse sutil
            html += '<div onclick="VIP.roulette && VIP.roulette.open()" style="cursor:pointer;background:linear-gradient(90deg,#4a0080,#7c00cc);border:1.5px solid #ffd700;border-radius:8px;padding:7px 10px;margin:6px auto;max-width:560px;display:flex;align-items:center;gap:8px;font-size:12.5px;box-shadow:0 0 10px rgba(255,215,0,0.30);animation:roulettePulseHome 2.2s ease-in-out infinite;">';
            html += '<span style="font-size:16px;">🎰</span>';
            html += '<span style="color:#fff;font-weight:800;flex:1;">Ruleta diaria · <span style="color:#ffd700;">girá y ganá hasta $10.000</span></span>';
            html += '<span style="background:#ffd700;color:#000;font-weight:900;padding:3px 9px;border-radius:6px;font-size:11px;letter-spacing:0.5px;">GIRAR</span>';
            html += '</div>';
            html += '<style>@keyframes roulettePulseHome { 0%,100% { box-shadow: 0 0 10px rgba(255,215,0,0.30); } 50% { box-shadow: 0 0 16px rgba(255,215,0,0.55); } }</style>';
        }
        c.innerHTML = html;
        c.style.display = '';
    }

    function _prizesTable() {
        if (!_state || !_state.prizes) return '';
        // Transparencia: mostramos cada premio con su probabilidad.
        // Aclaración explícita: el premio más grande es el menos probable.
        let html = '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,215,0,0.30);border-radius:10px;padding:10px 12px;margin:10px 0;">';
        html += '<div style="color:#ffd700;font-weight:900;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">🎯 Probabilidades transparentes</div>';
        html += '<div style="color:#bbb;font-size:10.5px;line-height:1.4;margin-bottom:8px;font-style:italic;">El premio más grande es el menos probable. Cuanto más alto el monto, menos chances de salir — así nos aseguramos que la ruleta sea sostenible.</div>';
        const total = _state.prizes.reduce((s, p) => s + (p.weight || 0), 0) || 100;
        for (const p of _state.prizes) {
            const pct = ((p.weight || 0) / total * 100).toFixed(0);
            const color = p.value >= 10000 ? '#ffd700' : (p.value >= 1000 ? '#ff8c5a' : (p.value > 0 ? '#aaffaa' : '#888'));
            html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">';
            html += '<span style="color:' + color + ';font-weight:700;">' + (p.emoji || '') + ' ' + _esc(p.label) + '</span>';
            html += '<span style="color:#888;font-family:monospace;font-weight:700;">' + pct + '%</span>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function open() {
        const modal = document.getElementById('rouletteModal');
        if (!modal) return;
        if (!_state) { loadStatus(); }
        _renderModal();
        modal.style.display = 'flex';
    }

    function close() {
        const modal = document.getElementById('rouletteModal');
        if (modal) modal.style.display = 'none';
    }

    function _renderModal(spinResult) {
        const modal = document.getElementById('rouletteModal');
        if (!modal) return;
        if (!_state) {
            modal.innerHTML = '<div style="background:#1a0033;border:2px solid #d4af37;border-radius:14px;padding:30px;color:#fff;text-align:center;max-width:560px;width:100%;margin:14px auto;">⏳ Cargando…</div>';
            return;
        }
        const spin = spinResult || _state.spin;
        const alreadySpun = !!(spin && (spin.prizeARS != null));
        let html = '<div style="background:linear-gradient(180deg,#1a0033,#0a001a);border:2px solid #ffd700;border-radius:16px;padding:20px 16px;color:#fff;max-width:560px;width:100%;margin:14px auto;position:relative;">';
        html += '<button onclick="VIP.roulette.close()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.20);color:#fff;font-size:18px;cursor:pointer;line-height:1;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;">✕</button>';
        html += '<h2 style="color:#ffd700;text-align:center;margin:0 0 4px;font-size:22px;font-weight:900;letter-spacing:1.5px;padding-right:36px;">🎰 RULETA DIARIA</h2>';
        html += '<p style="color:#ddd;text-align:center;margin:0 0 14px;font-size:12px;line-height:1.4;">1 giro por día · auto-acreditación si ganás</p>';

        if (alreadySpun) {
            // Estado: ya giró hoy.
            const won = Number(spin.prizeARS || 0) > 0;
            if (won && spin.status === 'credited') {
                html += '<div id="rouletteResultBox" style="background:linear-gradient(135deg,rgba(102,255,102,0.10),rgba(255,215,0,0.10));border:2px solid #66ff66;border-radius:14px;padding:24px 16px;text-align:center;margin-bottom:12px;">';
                html += '<div style="font-size:60px;line-height:1;margin-bottom:8px;">🎉</div>';
                html += '<div style="color:#66ff66;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">¡GANASTE!</div>';
                html += '<div style="color:#fff;font-size:32px;font-weight:900;margin-bottom:6px;">$' + _fmt(spin.prizeARS) + '</div>';
                html += '<div style="background:rgba(102,255,102,0.20);border:1px solid #66ff66;border-radius:8px;padding:9px 12px;margin-top:10px;color:#fff;font-size:13px;font-weight:800;">✅ Acreditado a tu saldo automáticamente</div>';
                if (spin.creditTxId) html += '<div style="color:#888;font-size:10px;margin-top:6px;font-family:monospace;">tx: ' + _esc(spin.creditTxId) + '</div>';
                html += '</div>';
            } else if (won && spin.status === 'credit_failed') {
                html += '<div style="background:rgba(255,170,102,0.10);border:2px solid #ffaa66;border-radius:14px;padding:20px 16px;text-align:center;margin-bottom:12px;">';
                html += '<div style="font-size:48px;margin-bottom:6px;">⚠️</div>';
                html += '<div style="color:#ffaa66;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">PREMIO PENDIENTE</div>';
                html += '<div style="color:#fff;font-size:24px;font-weight:900;margin-bottom:6px;">$' + _fmt(spin.prizeARS) + '</div>';
                html += '<div style="color:#ffd0a0;font-size:12px;margin-top:8px;">Ganaste pero la acreditación automática falló. Escribinos por WhatsApp al número principal y te lo cargamos.</div>';
                html += '</div>';
            } else {
                html += '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.20);border-radius:14px;padding:24px 16px;text-align:center;margin-bottom:12px;">';
                html += '<div style="font-size:54px;margin-bottom:6px;">😔</div>';
                html += '<div style="color:#aaa;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">Hoy no fue tu día</div>';
                html += '<div style="color:#ddd;font-size:14px;">Volvé mañana a partir de las 00:00 para girar otra vez 🎰</div>';
                html += '</div>';
            }
            html += _prizesTable();
            html += '<button onclick="VIP.roulette.close()" style="width:100%;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:12px;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;">CERRAR</button>';
        } else {
            // Estado: aún no giró. CTA grande + tabla de probabilidades.
            html += '<div id="rouletteResultBox" style="background:linear-gradient(135deg,#4a0080,#7c00cc);border:2px solid #ffd700;border-radius:14px;padding:28px 16px;text-align:center;margin-bottom:12px;box-shadow:inset 0 0 30px rgba(255,215,0,0.20);">';
            html += '<div style="font-size:72px;line-height:1;margin-bottom:6px;animation:rouletteIcon 2s ease-in-out infinite;">🎰</div>';
            html += '<div style="color:#ffd700;font-size:16px;font-weight:900;letter-spacing:1px;margin-bottom:4px;">Tu giro de hoy te espera</div>';
            html += '<div style="color:#fff;font-size:13px;margin-bottom:14px;opacity:0.92;">Tocá <strong>GIRAR</strong> y la suerte decide. Si ganás, se acredita solo a tu saldo.</div>';
            html += '<button id="rouletteSpinBtn" onclick="VIP.roulette.spin()" style="background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:16px 40px;border-radius:12px;font-weight:900;font-size:18px;cursor:pointer;letter-spacing:2px;box-shadow:0 4px 16px rgba(255,215,0,0.50);">🎰 GIRAR</button>';
            html += '</div>';
            html += '<style>@keyframes rouletteIcon { 0%, 100% { transform: rotate(-10deg); } 50% { transform: rotate(10deg); } }</style>';
            html += _prizesTable();
        }
        html += '</div>';
        modal.innerHTML = html;
    }

    async function spin() {
        if (_spinning) return;
        _spinning = true;
        // Animación: el botón se transforma en spinner + cuenta regresiva visual.
        const box = document.getElementById('rouletteResultBox');
        if (box) {
            box.innerHTML = '<div style="font-size:80px;line-height:1;margin-bottom:10px;display:inline-block;animation:rouletteSpin 0.5s linear infinite;">🎰</div>' +
                '<div style="color:#ffd700;font-size:14px;font-weight:900;letter-spacing:2px;text-transform:uppercase;">GIRANDO...</div>' +
                '<style>@keyframes rouletteSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>';
        }
        try {
            // Mínimo 1.5s de animación para que se "sienta" la ruleta.
            const [resp] = await Promise.all([
                fetch(`${VIP.config.API_URL}/api/roulette/spin`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' }
                }),
                new Promise(r => setTimeout(r, 1500))
            ]);
            const d = await resp.json();
            if (!resp.ok) {
                if (d && d.alreadySpun) {
                    _state.alreadySpun = true;
                    _state.spin = d.spin;
                    _renderModal();
                } else {
                    if (box) box.innerHTML = '<div style="color:#ff8080;padding:20px;">❌ ' + _esc((d && d.error) || 'Error') + '</div>';
                }
                _spinning = false;
                return;
            }
            // Construimos un "spin" del shape que espera _renderModal y refrescamos.
            _state.alreadySpun = true;
            _state.spin = {
                prizeARS: d.prize.prizeARS,
                prizeLabel: d.prize.prizeLabel,
                status: d.prize.status,
                spunAt: new Date().toISOString(),
                creditTxId: d.prize.transactionId || null
            };
            _renderModal();
            renderHomeCard();
            // Refrescar saldo del header si la app lo expone.
            try { if (window.VIP && VIP.auth && typeof VIP.auth.refreshBalance === 'function') VIP.auth.refreshBalance(); } catch (_) {}
        } catch (e) {
            if (box) box.innerHTML = '<div style="color:#ff8080;padding:20px;">Error de conexión</div>';
        } finally {
            _spinning = false;
        }
    }

    VIP.roulette = { loadStatus, open, close, spin };

    // Boot: cargar status apenas el usuario esté autenticado.
    document.addEventListener('DOMContentLoaded', () => {
        const tryLoad = () => {
            if (VIP.state && VIP.state.currentToken) loadStatus();
            else setTimeout(tryLoad, 1500);
        };
        setTimeout(tryLoad, 800);
    });

    // Refresh al volver visible.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') loadStatus();
    });
})();
