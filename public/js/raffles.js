// =====================================================================
// RAFFLES — Sorteos pagados (cliente)
// =====================================================================
// 4 niveles de premio paralelos. Comprás números con tu saldo de la
// plataforma; cuando se llena un cupo se abre otro automaticamente.
// Sorteo todos los lunes en la Lotería Nacional Nocturna (1° premio).
// Si tu número gana, aparece un botón para acreditar el premio a tu
// saldo desde la app.
// =====================================================================
window.VIP = window.VIP || {};

VIP.raffles = (function () {
    let _data = null;
    let _refreshTimer = null;

    async function _fetchActive() {
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/raffles/active`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            console.error('raffles fetch error:', e);
            return null;
        }
    }

    function _esc(s) {
        const div = document.createElement('div');
        div.textContent = String(s == null ? '' : s);
        return div.innerHTML;
    }

    function _fmt(n) {
        return Number(n || 0).toLocaleString('es-AR');
    }

    function _formatNumbers(nums) {
        if (!nums || !nums.length) return '';
        const sorted = nums.slice().sort((a, b) => a - b);
        const groups = [];
        let start = sorted[0], prev = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
            groups.push(start === prev ? '#' + start : '#' + start + '-' + prev);
            start = prev = sorted[i];
        }
        groups.push(start === prev ? '#' + start : '#' + start + '-' + prev);
        return groups.join(', ');
    }

    function _renderClaimableBanner(claimable) {
        if (!claimable || !claimable.length) return '';
        let html = '<div style="background:linear-gradient(135deg,#0f4c00,#1a8200);border:2px solid #66ff66;border-radius:12px;padding:14px;margin-bottom:14px;">';
        html += '<div style="color:#66ff66;font-weight:900;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">🏆 ¡GANASTE!</div>';
        for (const c of claimable) {
            html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;margin-top:8px;">';
            html += '<div style="color:#fff;font-weight:800;font-size:14px;margin-bottom:4px;">' + (c.emoji || '🏆') + ' ' + _esc(c.name) + '</div>';
            html += '<div style="color:#ddd;font-size:12px;margin-bottom:8px;">Número ganador: <strong>#' + c.winningTicketNumber + '</strong> · Premio: <strong>$' + _fmt(c.prizeValueARS) + '</strong></div>';
            html += '<button onclick="VIP.raffles.claimPrize(\'' + c.id + '\')" style="width:100%;background:#ffd700;color:#000;border:none;padding:11px;border-radius:8px;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:1px;">🎁 RECLAMAR $' + _fmt(c.prizeValueARS) + '</button>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function _renderRaffleCard(r, balance) {
        const sold = r.cuposSold || 0;
        const total = r.totalTickets || 0;
        const remaining = r.cuposRemaining;
        const fillPct = total ? Math.round((sold / total) * 100) : 0;
        const myNums = r.myTicketNumbers || [];
        const closed = r.status !== 'active';
        const drawn = r.status === 'drawn';
        const canAfford = balance >= (r.entryCost || 0);

        let html = '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.30);border-radius:12px;padding:14px;margin-bottom:12px;">';
        // header
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
        html += '<div style="font-size:34px;line-height:1;">' + (r.emoji || '🎁') + '</div>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="color:#ffd700;font-size:15px;font-weight:900;line-height:1.2;">' + _esc(r.name) + '</div>';
        html += '<div style="color:#bbb;font-size:11px;line-height:1.3;">Premio: <strong style="color:#fff;">$' + _fmt(r.prizeValueARS) + '</strong> · Cupo: ' + total + ' núm. × $' + _fmt(r.entryCost) + '</div>';
        html += '</div>';
        html += '</div>';

        // progress
        html += '<div style="height:8px;background:rgba(0,0,0,0.30);border-radius:4px;overflow:hidden;margin:8px 0;">';
        html += '<div style="height:100%;width:' + fillPct + '%;background:linear-gradient(90deg,#d4af37,#ffd700);"></div>';
        html += '</div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#999;margin-bottom:10px;">';
        html += '<span>' + sold + '/' + total + ' vendidos (' + fillPct + '%)</span>';
        html += '<span>' + remaining + ' disponibles</span>';
        html += '</div>';

        // my numbers
        if (myNums.length > 0) {
            html += '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:8px;margin-bottom:10px;">';
            html += '<div style="color:#ffd700;font-size:11px;font-weight:800;margin-bottom:4px;">TUS NÚMEROS (' + myNums.length + ')</div>';
            html += '<div style="color:#fff;font-size:13px;font-weight:700;word-break:break-word;">' + _esc(_formatNumbers(myNums)) + '</div>';
            html += '</div>';
        }

        // status / draw result
        if (drawn) {
            const youWon = r.iAmWinner;
            html += '<div style="background:' + (youWon ? 'rgba(102,255,102,0.10)' : 'rgba(255,107,53,0.10)') + ';border-radius:8px;padding:10px;font-size:12px;line-height:1.4;color:#ddd;">';
            html += youWon
                ? '🏆 <strong style="color:#66ff66;">¡Ganaste!</strong> Número ' + r.winningTicketNumber + '. Mirá arriba para reclamar.'
                : '🎲 Sorteado · número ganador <strong>#' + r.winningTicketNumber + '</strong> — ganó @' + _esc(r.winnerUsername || '');
            html += '</div>';
        } else if (closed) {
            html += '<div style="background:rgba(255,107,53,0.10);border-radius:8px;padding:10px;font-size:12px;color:#ffaa66;">⏳ Cupo lleno. Esperando sorteo del lunes en la Lotería Nacional Nocturna.</div>';
        } else {
            // CTA. Cap visible alineado con el backend (50). Si remaining
            // es menor, mostramos solo lo que queda. Si es mucha plata,
            // mostramos pasos saltados para que el select no tenga 50 opciones.
            const max = Math.min(remaining, 50);
            const steps = max <= 10 ? Array.from({length: max}, (_, i) => i + 1)
                : max <= 25 ? [1,2,3,4,5,10,15,20,25].filter(n => n <= max)
                : [1,2,3,5,10,15,20,25,30,40,50].filter(n => n <= max);
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">';
            html += '<select id="raffle_qty_' + _esc(r.id) + '" type="button" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);border-radius:6px;padding:7px 10px;font-size:13px;font-weight:700;">';
            for (const q of steps) {
                html += '<option value="' + q + '">' + q + ' núm. = $' + _fmt(q * r.entryCost) + '</option>';
            }
            html += '</select>';
            // ID del raffle interpolado de forma segura: JSON.stringify garantiza
            // escape correcto aun si por alguna razon viene con caracteres raros.
            const safeId = JSON.stringify(String(r.id));
            html += '<button id="raffle_buy_' + _esc(r.id) + '" type="button" onclick="VIP.raffles.buyNumber(' + safeId + ')" ' + (canAfford ? '' : 'disabled') + ' style="flex:1;min-width:140px;background:' + (canAfford ? 'linear-gradient(135deg,#d4af37,#f7931e)' : 'rgba(120,120,120,0.40)') + ';color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:' + (canAfford ? 'pointer' : 'not-allowed') + ';letter-spacing:0.5px;">' + (canAfford ? '🎫 COMPRAR' : '🔒 SIN SALDO') + '</button>';
            html += '</div>';
            html += '<div style="color:#888;font-size:10px;margin-top:6px;line-height:1.4;">Se debita de tu saldo. Sorteo: ' + _esc(r.lotteryRule || 'Lotería Nacional Nocturna del lunes próximo') + '</div>';
        }

        html += '</div>';
        return html;
    }

    function _render() {
        const modal = document.getElementById('rafflesModal');
        const body = document.getElementById('rafflesModalBody');
        if (!modal || !body) return;
        if (!_data) {
            body.innerHTML = '<div style="text-align:center;color:#aaa;padding:40px 0;">Cargando...</div>';
            return;
        }
        const balance = Number(_data.balance || 0);
        let html = '';
        // banner ganadores no reclamados
        html += _renderClaimableBanner(_data.claimable || []);

        // header con saldo
        html += '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.25);border-radius:10px;padding:10px 14px;margin-bottom:14px;">';
        html += '<div><div style="color:#aaa;font-size:11px;font-weight:700;letter-spacing:1px;">SALDO DISPONIBLE</div><div style="color:#ffd700;font-size:20px;font-weight:900;">$' + _fmt(balance) + '</div></div>';
        html += '<div style="text-align:right;color:#aaa;font-size:11px;line-height:1.4;">Sorteos<br><strong style="color:#fff;font-size:13px;">todos los lunes</strong></div>';
        html += '</div>';

        // intro
        html += '<div style="background:rgba(255,255,255,0.03);border-left:3px solid #d4af37;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:14px;font-size:11.5px;color:#ccc;line-height:1.5;">';
        html += '<strong style="color:#ffd700;">Cómo funciona:</strong> elegí un sorteo, cuántos números querés y comprá con tu saldo. Cuando se llena el cupo, abrimos otro idéntico. Cada lunes a la noche se sortea contra el 1° premio de la Lotería Nacional Nocturna. Si ganás, te aparece un botón acá mismo para acreditar el premio a tu saldo.';
        html += '</div>';

        const list = (_data.raffles || []).filter(r => r.status !== 'archived' && r.status !== 'cancelled');
        if (list.length === 0) {
            html += '<div style="text-align:center;color:#aaa;padding:30px 0;">No hay sorteos disponibles en este momento.</div>';
        } else {
            for (const r of list) html += _renderRaffleCard(r, balance);
        }

        body.innerHTML = html;
    }

    async function open() {
        const modal = document.getElementById('rafflesModal');
        if (!modal) return;
        modal.style.display = 'flex';
        _data = null;
        _render();
        const data = await _fetchActive();
        if (data) { _data = data; _render(); }
        // refresh suave cada 30s
        if (_refreshTimer) clearInterval(_refreshTimer);
        _refreshTimer = setInterval(async () => {
            if (modal.style.display === 'none') return;
            const d = await _fetchActive();
            if (d) { _data = d; _render(); }
        }, 30000);
    }

    function close() {
        const modal = document.getElementById('rafflesModal');
        if (modal) modal.style.display = 'none';
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    }

    let _buying = false;
    async function buyNumber(raffleId) {
        // Guard contra doble click (mobile lo dispara seguido).
        if (_buying) return;
        const sel = document.getElementById('raffle_qty_' + raffleId);
        const qty = sel ? Math.max(1, parseInt(sel.value, 10) || 1) : 1;
        const r = (_data && _data.raffles || []).find(x => x.id === raffleId);
        if (!r) return;
        const cost = qty * (r.entryCost || 0);
        if (!confirm('¿Comprar ' + qty + ' número' + (qty > 1 ? 's' : '') + ' del ' + r.name + ' por $' + _fmt(cost) + '?')) return;
        _buying = true;
        const btn = document.getElementById('raffle_buy_' + raffleId);
        const origText = btn ? btn.textContent : null;
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando…'; }
        try {
            const resp = await fetch(`${VIP.config.API_URL}/api/raffles/${raffleId}/buy`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ quantity: qty })
            });
            const data = await resp.json();
            if (data && data.success) {
                const nums = (data.ticketNumbers || []).join(', #');
                VIP.ui.showToast('🎫 ¡Compraste #' + nums + '! Suerte.', 'success');
                if (data.cupoFilled) {
                    VIP.ui.showToast('🔥 Se llenó el cupo. Ya hay un sorteo nuevo abierto.', 'success');
                }
                const d = await _fetchActive();
                if (d) { _data = d; _render(); }
            } else {
                VIP.ui.showToast('⚠️ ' + ((data && data.error) || 'No se pudo comprar'), 'error');
                if (btn && origText !== null) { btn.disabled = false; btn.textContent = origText; }
            }
        } catch (e) {
            console.error('buyNumber error:', e);
            VIP.ui.showToast('Error de conexión', 'error');
            if (btn && origText !== null) { btn.disabled = false; btn.textContent = origText; }
        } finally {
            _buying = false;
        }
    }

    let _claiming = false;
    async function claimPrize(raffleId) {
        if (_claiming) return;
        if (!confirm('¿Acreditar el premio a tu saldo?')) return;
        _claiming = true;
        try {
            const resp = await fetch(`${VIP.config.API_URL}/api/raffles/${raffleId}/claim-prize`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            const data = await resp.json();
            if (data && data.success) {
                VIP.ui.showToast('🏆 ' + (data.message || 'Premio acreditado'), 'success');
                const d = await _fetchActive();
                if (d) { _data = d; _render(); }
            } else {
                VIP.ui.showToast('⚠️ ' + ((data && data.error) || 'No se pudo acreditar'), 'error');
            }
        } catch (e) {
            console.error('claimPrize error:', e);
            VIP.ui.showToast('Error de conexión', 'error');
        } finally {
            _claiming = false;
        }
    }

    return { open, close, buyNumber, claimPrize };
})();
