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
        const userCupos = r.userCupos || 0;
        const maxBuyable = r.userMaxBuyable || 0;
        const drawDateStr = r.drawDate ? new Date(r.drawDate).toLocaleDateString('es-AR') : '—';

        let actionBlock;
        if (r.status !== 'active') {
            actionBlock = '<button disabled style="width:100%;padding:11px;background:rgba(255,255,255,0.10);color:#888;border:none;border-radius:10px;font-weight:800;font-size:14px;">Cerrado</button>';
        } else if (maxBuyable === 0 && userCupos === 0) {
            actionBlock = '<button disabled style="width:100%;padding:11px;background:rgba(255,255,255,0.06);color:#888;border:1px solid rgba(255,255,255,0.10);border-radius:10px;font-weight:800;font-size:14px;cursor:not-allowed;">🔒 Cada cupo vale $' + r.entryCost.toLocaleString('es-AR') + ' (cargá al menos eso este mes)</button>';
        } else if (maxBuyable === 0 && userCupos > 0) {
            actionBlock = '<button disabled style="width:100%;padding:11px;background:rgba(37,211,102,0.20);color:#25d366;border:1px solid rgba(37,211,102,0.50);border-radius:10px;font-weight:800;font-size:14px;cursor:default;">✅ Tenés ' + userCupos + ' cupo' + (userCupos===1?'':'s') + ' · sin créditos para más</button>';
        } else {
            // Selector de cantidad + boton.
            const youHave = userCupos > 0
                ? '<div style="text-align:center;color:#25d366;font-size:11px;margin-bottom:6px;">Ya tenés <strong>' + userCupos + '</strong> cupo' + (userCupos===1?'':'s') + ' en este sorteo</div>'
                : '';
            actionBlock = youHave +
                '<div style="display:flex;gap:6px;align-items:center;background:rgba(0,0,0,0.30);border:1px solid rgba(212,175,55,0.30);border-radius:10px;padding:6px;">' +
                '  <button onclick="VIP.raffles.adjustQty(\'' + r.id + '\', -1)" style="background:rgba(255,255,255,0.10);color:#fff;border:none;border-radius:6px;width:36px;height:36px;font-size:18px;cursor:pointer;font-weight:800;">−</button>' +
                '  <input type="number" id="raffleQty_' + r.id + '" value="1" min="1" max="' + maxBuyable + '" data-cost="' + r.entryCost + '" oninput="VIP.raffles.refreshQtyLabel(\'' + r.id + '\')" style="flex:1;text-align:center;padding:8px;border-radius:6px;background:rgba(0,0,0,0.40);border:1px solid rgba(255,255,255,0.10);color:#fff;font-weight:800;font-size:15px;min-width:50px;">' +
                '  <button onclick="VIP.raffles.adjustQty(\'' + r.id + '\', 1)" style="background:rgba(255,255,255,0.10);color:#fff;border:none;border-radius:6px;width:36px;height:36px;font-size:18px;cursor:pointer;font-weight:800;">+</button>' +
                '  <button onclick="VIP.raffles.setMax(\'' + r.id + '\', ' + maxBuyable + ')" style="background:rgba(255,200,80,0.20);color:#ffc850;border:1px solid rgba(255,200,80,0.40);border-radius:6px;padding:8px 10px;font-size:11px;cursor:pointer;font-weight:700;">MAX (' + maxBuyable + ')</button>' +
                '</div>' +
                '<button onclick="VIP.raffles.participate(\'' + r.id + '\')" style="width:100%;padding:12px;background:linear-gradient(135deg,#d4af37,#f7931e);color:#000;border:none;border-radius:10px;font-weight:900;font-size:15px;cursor:pointer;letter-spacing:0.5px;margin-top:8px;">🎫 Comprar <span id="raffleQtyLabel_' + r.id + '">1 cupo</span> · <span id="raffleCostLabel_' + r.id + '">$' + r.entryCost.toLocaleString('es-AR') + '</span></button>';
        }

        // Label de "tus chances".
        let chancesLabel;
        if (r.totalCuposSold > 0 && userCupos > 0) {
            const chancePct = Math.round((userCupos / r.totalCuposSold) * 1000) / 10;
            chancesLabel = '<small style="color:#ffd700;">Tus chances ahora: <strong>' + userCupos + '/' + r.totalCuposSold + '</strong> cupos (' + chancePct + '%)</small>';
        } else if (r.totalCuposSold > 0) {
            chancesLabel = '<small style="color:#888;">Hay ' + r.totalCuposSold + ' cupo' + (r.totalCuposSold===1?'':'s') + ' vendido' + (r.totalCuposSold===1?'':'s') + ' de ' + r.totalTickets + '</small>';
        } else {
            chancesLabel = '<small style="color:#666;">Sin cupos vendidos todavía</small>';
        }

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
               '  <span>👥 <strong style="color:#fff;">' + (r.uniqueParticipants||0) + '</strong> personas</span>' +
               '  <span>🎫 <strong style="color:#fff;">' + (r.totalCuposSold||0) + '/' + r.totalTickets + '</strong> cupos vendidos</span>' +
               '  <span>💰 <strong style="color:#fff;">$' + r.entryCost.toLocaleString('es-AR') + '</strong> por cupo</span>' +
               '  <span>📅 <strong style="color:#fff;">' + _esc(drawDateStr) + '</strong></span>' +
               '</div>' +
               '<div style="text-align:center;">' + chancesLabel + '</div>' +
               actionBlock +
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
            const cargas = (_data.budget.monthlyDeposit != null
                ? _data.budget.monthlyDeposit
                : (_data.budget.netwinLoss || 0));
            detail.textContent = 'Cargas del mes: $' + cargas.toLocaleString('es-AR') +
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

    function _qtyInput(raffleId) {
        return document.getElementById('raffleQty_' + raffleId);
    }
    function adjustQty(raffleId, delta) {
        const inp = _qtyInput(raffleId);
        if (!inp) return;
        const max = parseInt(inp.max, 10) || 1;
        const cur = parseInt(inp.value, 10) || 1;
        const next = Math.max(1, Math.min(max, cur + delta));
        inp.value = next;
        refreshQtyLabel(raffleId);
    }
    function setMax(raffleId, max) {
        const inp = _qtyInput(raffleId);
        if (!inp) return;
        inp.value = max;
        refreshQtyLabel(raffleId);
    }
    function refreshQtyLabel(raffleId) {
        const inp = _qtyInput(raffleId);
        if (!inp) return;
        const cost = parseInt(inp.dataset.cost, 10) || 0;
        const max = parseInt(inp.max, 10) || 1;
        let q = parseInt(inp.value, 10) || 1;
        if (q < 1) q = 1;
        if (q > max) { q = max; inp.value = max; }
        const lblQ = document.getElementById('raffleQtyLabel_' + raffleId);
        const lblC = document.getElementById('raffleCostLabel_' + raffleId);
        if (lblQ) lblQ.textContent = q + ' cupo' + (q===1?'':'s');
        if (lblC) lblC.textContent = '$' + (cost * q).toLocaleString('es-AR');
    }

    async function participate(raffleId) {
        const inp = _qtyInput(raffleId);
        const qty = inp ? Math.max(1, parseInt(inp.value, 10) || 1) : 1;
        const cost = inp ? (parseInt(inp.dataset.cost, 10) || 0) * qty : 0;
        if (!confirm('¿Comprar ' + qty + ' cupo' + (qty===1?'':'s') + ' por $' + cost.toLocaleString('es-AR') + '? Se descuenta de tu monto cargado del mes.')) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/raffles/${raffleId}/participate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ quantity: qty })
            });
            const d = await r.json();
            if (!r.ok || !d.success) {
                VIP.ui.showToast(d.error || 'Error al participar', 'error');
                return;
            }
            VIP.ui.showToast(d.message || '¡Listo!', 'success');
            _data = await _fetchActive();
            _render();
        } catch (e) {
            VIP.ui.showToast('Error de conexión', 'error');
        }
    }

    return { open, close, participate, adjustQty, setMax, refreshQtyLabel };
})();
