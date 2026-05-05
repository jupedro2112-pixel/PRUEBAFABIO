// =====================================================================
// RAFFLES — Sorteos mensuales (cliente)
// =====================================================================
// Modelo LOSS-CREDIT compartido:
//   - El user "gasta" su PERDIDA del mes (netwin loss = cargas - retiros).
//   - Cada cupo cuesta entryCost de loss credit:
//       📱 iPhone — $100.000  (100 cupos, hasta 50 por persona)
//       🏖️ Caribe — $50.000   (1000 cupos, hasta 50 por persona)
//       🚗 Auto   — $100.000  (1000 cupos, hasta 50 por persona)
//   - Budget compartido: si perdiste $1M podés gastarlo como quieras.
//   - El user elige sus números de la grilla. Tomados se ven tachados.
//   - Sorteo: últimas 2 cifras del 1° premio Lotería Nacional Nocturna
//     del primer lunes del mes próximo (mismo numero, distintos ganadores).
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

    function _renderImage(r, height) {
        const h = height || 110;
        if (r.imageUrl) {
            return '<div style="width:100%;height:' + h + 'px;background-image:url(\'' + _esc(r.imageUrl) + '\');background-size:cover;background-position:center;border-radius:10px;"></div>';
        }
        return '<div style="width:100%;height:' + h + 'px;background:linear-gradient(135deg,#3d1f6e,#1a0033);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:' + Math.round(h/2.3) + 'px;">' + (r.emoji || '🎁') + '</div>';
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

    // -----------------------------------------------------------------
    // Card de un sorteo (con grilla picker, multi-cupo loss-credit).
    // -----------------------------------------------------------------
    function _renderCategoryCard(r, budget) {
        const userCupos = r.userCupos || 0;
        const userTicketNumbers = r.userTicketNumbers || [];
        const maxPerUser = r.maxCuposPerUser || 1;
        const entryCost = r.entryCost || 0;
        const netwinLoss = budget.netwinLoss || 0;
        const available = budget.available || 0; // loss credit que queda
        const userMaxBuyable = r.userMaxBuyable || 0;
        const userRemainingCap = r.userRemainingCap != null ? r.userRemainingCap : Math.max(0, maxPerUser - userCupos);
        const drawDateStr = r.drawDate
            ? new Date(r.drawDate).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const claimedMap = r.claimedNumbers || {};
        const headerName = _esc(r.prizeName);

        // Estado del user.
        const meets = available >= entryCost;
        let statusBlock;
        if (userCupos >= maxPerUser) {
            statusBlock = '<div style="background:rgba(37,211,102,0.10);border:1px solid rgba(37,211,102,0.40);border-radius:8px;padding:10px;text-align:center;">' +
                '<div style="color:#25d366;font-size:13px;font-weight:900;">✅ Tenés ' + userCupos + ' número' + (userCupos===1?'':'s') + ' (máximo ' + maxPerUser + ')</div>' +
                '<div style="color:#ffd700;font-weight:900;font-size:13px;margin-top:4px;word-break:break-word;">' + _esc(_formatNumbers(userTicketNumbers)) + '</div>' +
                '<small style="color:#888;display:block;margin-top:3px;">Ya tenés el cupo lleno en este sorteo.</small>' +
                '</div>';
        } else if (userCupos > 0 && meets) {
            statusBlock = '<div style="background:rgba(37,211,102,0.10);border:1px solid rgba(37,211,102,0.40);border-radius:8px;padding:10px;text-align:center;">' +
                '<div style="color:#25d366;font-size:13px;font-weight:900;">✅ Tenés ' + userCupos + ' número' + (userCupos===1?'':'s') + '</div>' +
                '<div style="color:#ffd700;font-weight:900;font-size:13px;margin-top:4px;word-break:break-word;">' + _esc(_formatNumbers(userTicketNumbers)) + '</div>' +
                '<small style="color:#aaa;display:block;margin-top:3px;">Podés agregar hasta ' + userMaxBuyable + ' más (alcanza tu pérdida + cap del sorteo).</small>' +
                '</div>';
        } else if (userCupos > 0 && !meets) {
            statusBlock = '<div style="background:rgba(255,200,80,0.10);border:1px solid rgba(255,200,80,0.40);border-radius:8px;padding:10px;text-align:center;">' +
                '<div style="color:#ffc850;font-size:13px;font-weight:800;">Tenés ' + userCupos + ' número' + (userCupos===1?'':'s') + ' — sin pérdida disponible para más</div>' +
                '<div style="color:#ffd700;font-weight:900;font-size:13px;margin-top:4px;word-break:break-word;">' + _esc(_formatNumbers(userTicketNumbers)) + '</div>' +
                '</div>';
        } else if (meets) {
            statusBlock = '<div style="background:rgba(255,200,80,0.10);border:1px solid rgba(255,200,80,0.40);border-radius:8px;padding:10px;text-align:center;">' +
                '<div style="color:#ffc850;font-size:13px;font-weight:800;">🎉 Podés reclamar hasta ' + userMaxBuyable + ' número' + (userMaxBuyable===1?'':'s') + '</div>' +
                '<small style="color:#aaa;display:block;margin-top:3px;">Cada uno consume $' + entryCost.toLocaleString('es-AR') + ' de tu pérdida del mes.</small>' +
                '</div>';
        } else {
            const need = Math.max(0, entryCost - available);
            const progress = Math.min(100, Math.round((available / Math.max(1, entryCost)) * 100));
            statusBlock = '<div style="background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.30);border-radius:8px;padding:10px;">' +
                '<div style="color:#ff8080;font-size:12px;font-weight:800;text-align:center;">🔒 Te faltan $' + need.toLocaleString('es-AR') + ' de pérdida para 1 número</div>' +
                '<div style="background:rgba(0,0,0,0.40);border-radius:8px;height:8px;overflow:hidden;margin-top:8px;">' +
                '  <div style="height:100%;width:' + progress + '%;background:linear-gradient(90deg,#d4af37,#f7931e);"></div>' +
                '</div>' +
                '<small style="color:#888;display:block;margin-top:4px;text-align:center;">Pérdida disponible $' + available.toLocaleString('es-AR') + ' / costo $' + entryCost.toLocaleString('es-AR') + '</small>' +
                '</div>';
        }

        // Grilla de numeros — adaptable a totalTickets (100 o 1000).
        // Para 1000+: scroll vertical interno. Cells siempre se ven en mobile.
        const cols = r.totalTickets <= 100 ? 10 : 20;
        const cellPad = r.totalTickets <= 100 ? '6px 0' : '4px 0';
        const cellFont = r.totalTickets <= 100 ? '11px' : '9px';
        const gridMaxHeight = r.totalTickets <= 100 ? 'auto' : '320px';
        const userClaimedSet = new Set(userTicketNumbers);
        const canClaim = meets && userCupos < maxPerUser && r.status === 'active';

        let grid = '<div style="max-height:' + gridMaxHeight + ';overflow-y:auto;background:rgba(0,0,0,0.30);border-radius:8px;padding:6px;">';
        grid += '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:3px;font-family:monospace;font-size:' + cellFont + ';">';
        for (let n = 1; n <= r.totalTickets; n++) {
            const owner = claimedMap[n];
            if (userClaimedSet.has(n)) {
                grid += '<button disabled style="background:#25d366;color:#000;font-weight:900;border:none;border-radius:3px;padding:' + cellPad + ';cursor:default;" title="TU NÚMERO">' + n + '✓</button>';
            } else if (owner) {
                grid += '<button disabled title="@' + _esc(owner) + '" style="background:rgba(255,255,255,0.04);color:#555;border:none;border-radius:3px;padding:' + cellPad + ';text-decoration:line-through;cursor:not-allowed;">' + n + '</button>';
            } else if (canClaim) {
                grid += '<button onclick="VIP.raffles.claimNumber(\'' + r.id + '\', ' + n + ')" style="background:rgba(212,175,55,0.20);color:#ffd700;border:1px solid rgba(212,175,55,0.40);border-radius:3px;padding:' + cellPad + ';cursor:pointer;font-weight:700;">' + n + '</button>';
            } else {
                grid += '<button disabled style="background:rgba(255,255,255,0.03);color:#666;border:none;border-radius:3px;padding:' + cellPad + ';cursor:not-allowed;">' + n + '</button>';
            }
        }
        grid += '</div></div>';

        const lotteryRuleBlock = r.lotteryRule
            ? '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:8px 10px;">' +
              '  <div style="color:#00d4ff;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:center;">🎯 Cómo se sortea</div>' +
              '  <div style="color:#ddd;font-size:11px;margin-top:3px;line-height:1.4;text-align:center;">' + _esc(r.lotteryRule) + '</div>' +
              '</div>'
            : '';

        return '<div style="background:rgba(212,175,55,0.05);border:2px solid rgba(212,175,55,0.40);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px;margin-bottom:18px;box-sizing:border-box;">' +
               _renderImage(r, 110) +
               '<div>' +
               '  <h3 style="color:#ffd700;margin:0 0 4px;font-size:17px;font-weight:800;line-height:1.2;">' + (r.emoji || '🎁') + ' ' + headerName + '</h3>' +
               '  <p style="color:#aaa;margin:0;font-size:12px;line-height:1.5;">' + _esc(r.description || '') + '</p>' +
               '</div>' +
               '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
               '  <div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:8px;text-align:center;">' +
               '    <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">💎 Premio</div>' +
               '    <div style="color:#ffd700;font-weight:900;font-size:15px;">$' + (r.prizeValueARS||0).toLocaleString('es-AR') + '</div>' +
               '  </div>' +
               '  <div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:8px;text-align:center;">' +
               '    <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">💸 Costo/cupo</div>' +
               '    <div style="color:#fff;font-weight:900;font-size:15px;">$' + entryCost.toLocaleString('es-AR') + '</div>' +
               '    <small style="color:#666;font-size:9px;">de pérdida</small>' +
               '  </div>' +
               '</div>' +
               '<div style="text-align:center;color:#888;font-size:11px;">' + (r.totalCuposSold||0) + ' / ' + r.totalTickets + ' números reclamados · sorteo el ' + drawDateStr + '</div>' +
               lotteryRuleBlock +
               statusBlock +
               '<div>' +
               '  <div style="color:#aaa;font-size:11px;text-align:center;margin-bottom:6px;">📋 Elegí tu número (max ' + maxPerUser + ' por persona)</div>' +
                grid +
               '</div>' +
               '</div>';
    }

    // -----------------------------------------------------------------
    function _render() {
        const list = document.getElementById('rafflesList');
        if (!list) return;
        if (!_data || !_data.success) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#ff8080;">No se pudieron cargar los sorteos. Probá más tarde.</div>';
            return;
        }
        // Budget bar — pérdida del mes + ya gastado + disponible.
        const bar = document.getElementById('rafflesBudgetBar');
        const av = document.getElementById('rafflesBudgetAvailable');
        const detail = document.getElementById('rafflesBudgetDetail');
        if (_data.budget && av && detail) {
            const loss = _data.budget.netwinLoss || 0;
            const spent = _data.budget.spent || 0;
            const available = _data.budget.available || 0;
            av.textContent = '$' + available.toLocaleString('es-AR');
            detail.innerHTML = '💸 Pérdida del mes: <strong style="color:#ffd700;">$' + loss.toLocaleString('es-AR') + '</strong> · Ya gastado: <strong style="color:#fff;">$' + spent.toLocaleString('es-AR') + '</strong>';
            if (bar) bar.style.display = 'block';
        }
        const raffles = _data.raffles || [];
        const wagered = raffles.filter(r => r.entryMode === 'wagered');
        if (wagered.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">No hay sorteos activos este mes.</div>';
            return;
        }

        // Orden: Auto, Caribe, iPhone (mayor premio primero).
        const order = { auto: 0, caribe: 1, iphone: 2 };
        wagered.sort((a, b) => (order[a.raffleType] ?? 9) - (order[b.raffleType] ?? 9));

        const budget = _data.budget || {};

        let html = '';
        // Banner principal del modelo.
        html += '<div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:10px;padding:11px;margin-bottom:10px;text-align:center;">';
        html += '  <div style="color:#d4af37;font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:1px;">🎁 SORTEOS POR PÉRDIDA</div>';
        html += '  <div style="color:#aaa;font-size:11px;margin-top:4px;line-height:1.5;">Cada cupo se paga con tu PÉRDIDA del mes. Acumulable hasta 50 números por sorteo. Elegís dónde participar. Sorteo por la <strong style="color:#fff;">Lotería Nacional Nocturna</strong> del primer lunes — verificable.</div>';
        html += '</div>';
        // Reglas + anti-fraude.
        html += '<div style="background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.30);border-radius:10px;padding:11px;margin-bottom:12px;">';
        html += '  <div style="color:#ff8080;font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:center;margin-bottom:6px;">⚠️ REGLAS</div>';
        html += '  <ul style="margin:0;padding-left:16px;color:#ddd;font-size:11px;line-height:1.6;">';
        html += '    <li><strong style="color:#fff;">Acumulable hasta 50 números por sorteo</strong> (compartís el budget de pérdida entre los 3).</li>';
        html += '    <li><strong style="color:#ff8080;">Vamos a analizar el juego de cada uno.</strong> Si cargás y retirás todo sin jugar, te bloqueamos los cupos.</li>';
        html += '    <li><strong style="color:#25d366;">Para retirar el premio: ser parte de la COMUNIDAD.</strong> Es requisito.</li>';
        html += '  </ul>';
        html += '</div>';

        for (const r of wagered) {
            html += _renderCategoryCard(r, budget);
        }
        list.innerHTML = html;
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

    async function claimNumber(raffleId, number) {
        const raffle = (_data && _data.raffles || []).find(x => x.id === raffleId);
        const cost = raffle ? (raffle.entryCost || 0) : 0;
        if (!confirm(
            '¿Reclamar el número ' + number + '?\n\n' +
            '💸 Cuesta $' + cost.toLocaleString('es-AR') + ' de tu PÉRDIDA del mes.\n' +
            '🎫 Acumulable hasta 50 números en este sorteo.\n' +
            '🏆 Si la Lotería Nacional Nocturna saca tu número, ganás.\n' +
            '🤝 Para retirar el premio tenés que estar EN LA COMUNIDAD.\n' +
            '⚠️ Movimientos sospechosos (cargas+retiros sin jugar) = cupo bloqueado.'
        )) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/raffles/${raffleId}/claim-number`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ number })
            });
            const d = await r.json();
            if (!r.ok || !d.success) { VIP.ui.showToast(d.error || 'Error al reclamar', 'error'); return; }
            VIP.ui.showToast(d.message || '¡Listo!', 'success');
            _data = await _fetchActive();
            _render();
        } catch (e) {
            VIP.ui.showToast('Error de conexión', 'error');
        }
    }

    return { open, close, claimNumber };
})();
