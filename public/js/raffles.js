// =====================================================================
// RAFFLES — Sorteos mensuales (cliente)
// =====================================================================
window.VIP = window.VIP || {};

VIP.raffles = (function () {
    let _data = null;

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

    function _renderImage(r) {
        if (r.imageUrl) {
            return '<div style="width:100%;height:160px;background-image:url(\'' + _esc(r.imageUrl) + '\');background-size:cover;background-position:center;border-radius:10px;"></div>';
        }
        // Fallback: emoji grande sobre gradient.
        return '<div style="width:100%;height:160px;background:linear-gradient(135deg,#3d1f6e,#1a0033);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:70px;">' + (r.emoji || '🎁') + '</div>';
    }

    function _renderRaffle(r) {
        const youIn = r.userIsParticipating;
        const canAfford = r.userCanAfford;
        const myTicketsIfDrawn = r.userIsParticipating && r.ticketsPerParticipantIfDrawnNow != null
            ? r.ticketsPerParticipantIfDrawnNow : null;
        const drawDateStr = r.drawDate ? new Date(r.drawDate).toLocaleDateString('es-AR') : '—';

        let actionBtn;
        if (r.status !== 'active') {
            actionBtn = '<button disabled style="width:100%;padding:11px;background:rgba(255,255,255,0.10);color:#888;border:none;border-radius:10px;font-weight:800;font-size:14px;">Cerrado</button>';
        } else if (youIn) {
            actionBtn = '<button disabled style="width:100%;padding:11px;background:rgba(37,211,102,0.20);color:#25d366;border:1px solid rgba(37,211,102,0.50);border-radius:10px;font-weight:800;font-size:14px;cursor:default;">✅ Estás participando' + (myTicketsIfDrawn ? ' · ' + myTicketsIfDrawn + ' tickets' : '') + '</button>';
        } else if (!canAfford) {
            actionBtn = '<button disabled style="width:100%;padding:11px;background:rgba(255,255,255,0.06);color:#888;border:1px solid rgba(255,255,255,0.10);border-radius:10px;font-weight:800;font-size:14px;cursor:not-allowed;">🔒 Necesitás $' + r.entryCost.toLocaleString('es-AR') + ' en pérdidas</button>';
        } else {
            actionBtn = '<button onclick="VIP.raffles.participate(\'' + r.id + '\')" style="width:100%;padding:12px;background:linear-gradient(135deg,#d4af37,#f7931e);color:#000;border:none;border-radius:10px;font-weight:900;font-size:15px;cursor:pointer;letter-spacing:0.5px;">🎫 Participar (cuesta $' + r.entryCost.toLocaleString('es-AR') + ')</button>';
        }

        const ticketsLabel = r.ticketsPerParticipantIfDrawnNow != null
            ? '<small style="color:#ffd700;">Si se sortea ahora: ' + r.ticketsPerParticipantIfDrawnNow + ' ticket(s) por persona</small>'
            : '<small style="color:#666;">Sin participantes todavía</small>';

        // Premio + payout proyectado.
        let prizeInfo = '';
        if (r.prizeValueARS && r.prizeValueARS > 0) {
            const fill = r.fillRatePct || 0;
            const projected = r.projectedPayoutARS || 0;
            prizeInfo = '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:9px 12px;text-align:center;">' +
                '<div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">💎 Premio si se llena el cupo</div>' +
                '<div style="color:#ffd700;font-weight:900;font-size:16px;margin:2px 0;">$' + r.prizeValueARS.toLocaleString('es-AR') + '</div>' +
                '<div style="color:' + (fill >= 100 ? '#25d366' : '#ffc850') + ';font-size:11px;">' +
                '  Cupo actual: ' + fill + '% → si se sortea ahora pagaría <strong>$' + projected.toLocaleString('es-AR') + '</strong>' +
                '</div>' +
                '</div>';
        }

        return '<div style="background:rgba(0,0,0,0.40);border:1px solid rgba(212,175,55,0.30);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;">' +
               _renderImage(r) +
               '<div>' +
               '  <h3 style="color:#ffd700;margin:0 0 4px;font-size:17px;font-weight:800;">' + (r.emoji || '🎁') + ' ' + _esc(r.prizeName) + '</h3>' +
               '  <p style="color:#aaa;margin:0;font-size:12px;line-height:1.5;">' + _esc(r.description || '') + '</p>' +
               '</div>' +
               prizeInfo +
               '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11px;color:#888;">' +
               '  <span>👥 <strong style="color:#fff;">' + r.participantCount + '</strong> participan</span>' +
               '  <span>🎫 <strong style="color:#fff;">' + r.totalTickets + '</strong> tickets totales</span>' +
               '  <span>📅 Sorteo: <strong style="color:#fff;">' + _esc(drawDateStr) + '</strong></span>' +
               '</div>' +
               '<div style="text-align:center;">' + ticketsLabel + '</div>' +
               actionBtn +
               '</div>';
    }

    function _render() {
        const list = document.getElementById('rafflesList');
        if (!list) return;
        if (!_data || !_data.success) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#ff8080;">No se pudieron cargar los sorteos. Probá más tarde.</div>';
            return;
        }
        // Budget bar.
        const bar = document.getElementById('rafflesBudgetBar');
        const av = document.getElementById('rafflesBudgetAvailable');
        const detail = document.getElementById('rafflesBudgetDetail');
        if (_data.budget && av && detail) {
            av.textContent = '$' + (_data.budget.available || 0).toLocaleString('es-AR');
            detail.textContent = 'Pérdida del mes: $' + (_data.budget.netwinLoss || 0).toLocaleString('es-AR') +
                                 ' · Ya usado en sorteos: $' + (_data.budget.spent || 0).toLocaleString('es-AR');
            if (bar) bar.style.display = 'block';
        }
        const raffles = _data.raffles || [];
        if (raffles.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">No hay sorteos activos este mes.</div>';
            return;
        }
        list.innerHTML = raffles.map(_renderRaffle).join('');
    }

    async function open() {
        const modal = document.getElementById('rafflesModal');
        if (!modal) return;
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        const list = document.getElementById('rafflesList');
        if (list) list.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">⏳ Cargando sorteos…</div>';
        _data = await _fetchActive();
        _render();
    }
    function close() {
        const modal = document.getElementById('rafflesModal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    async function participate(raffleId) {
        if (!confirm('¿Participar de este sorteo? Te van a descontar los créditos correspondientes.')) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/raffles/${raffleId}/participate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                }
            });
            const d = await r.json();
            if (!r.ok || !d.success) {
                VIP.ui.showToast(d.error || 'Error al participar', 'error');
                return;
            }
            VIP.ui.showToast(d.message || '¡Listo!', 'success');
            // Refrescar lista para mostrar nuevo estado.
            _data = await _fetchActive();
            _render();
        } catch (e) {
            VIP.ui.showToast('Error de conexión', 'error');
        }
    }

    return { open, close, participate };
})();
