// =====================================================================
// RAFFLES — Sorteos pagos + gratis (cliente)
// =====================================================================
// Sorteos PAGOS: 4 niveles ($2M/$1M/$500k/$100k). Comprás números con tu
// saldo. Podés ELEGIR los números que quieras del grid 1-100. Si ganás, el
// premio se acredita automáticamente.
// Sorteos GRATIS: 4 niveles para clientes activos. Auto-participación: si
// tuviste cargas suficientes en los últimos 30 días, el sistema te asigna
// un número automáticamente cuando abrís el modal. 1 número por persona.
// =====================================================================
window.VIP = window.VIP || {};

VIP.raffles = (function () {
    let _data = null;
    let _refreshTimer = null;
    let _buying = false;
    let _claiming = false;
    let _picker = null; // { raffleId, picked: Set<number> }

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
        return sorted.map(n => '#' + n).join(', ');
    }

    // Banner unificado de "FELICITACIONES" para sorteos ganados en las
    // ultimas 24h. Si el premio ya fue acreditado automaticamente, mostramos
    // un mensaje celebratorio sin boton. Si todavia hay que reclamar, el
    // boton dispara claimPrize().
    function _renderRecentWinsBanner(recentWins) {
        if (!recentWins || !recentWins.length) return '';
        let html = '<div style="background:linear-gradient(135deg,#0f4c00,#1a8200,#ffd700);background-size:200% 200%;border:3px solid #ffd700;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 0 20px rgba(255,215,0,0.40);position:relative;overflow:hidden;">';
        html += '<div style="position:absolute;top:-10px;right:-10px;font-size:80px;opacity:0.10;">🏆</div>';
        html += '<div style="color:#ffd700;font-weight:900;font-size:14px;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;text-shadow:0 1px 2px rgba(0,0,0,0.50);">🎉 ¡FELICITACIONES, GANASTE!</div>';
        html += '<div style="color:#fff;font-size:11.5px;margin-bottom:10px;line-height:1.5;font-weight:600;">Esto se queda visible por <strong style="color:#ffd700;">24 horas</strong> para que lo veas con tranquilidad 💫</div>';
        for (const c of recentWins) {
            const credited = !!c.prizeClaimedAt;
            const needsClaim = !credited && c.prizeClaimable;
            html += '<div style="background:rgba(0,0,0,0.50);border-radius:10px;padding:12px;margin-top:10px;border:1px solid rgba(255,215,0,0.40);">';
            html += '<div style="color:#fff;font-weight:900;font-size:15px;margin-bottom:6px;">' + (c.emoji || '🏆') + ' ' + _esc(c.name) + '</div>';
            html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;">';
            html += '<div style="background:rgba(255,215,0,0.15);border:1px solid rgba(255,215,0,0.40);border-radius:8px;padding:8px 12px;flex:1;min-width:120px;text-align:center;">';
            html += '<div style="color:#ffd700;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Número ganador</div>';
            html += '<div style="color:#fff;font-size:24px;font-weight:900;line-height:1.2;">#' + c.winningTicketNumber + '</div>';
            html += '</div>';
            html += '<div style="background:rgba(102,255,102,0.10);border:1px solid rgba(102,255,102,0.40);border-radius:8px;padding:8px 12px;flex:1;min-width:120px;text-align:center;">';
            html += '<div style="color:#66ff66;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Premio</div>';
            html += '<div style="color:#fff;font-size:20px;font-weight:900;line-height:1.2;">$' + _fmt(c.prizeValueARS) + '</div>';
            html += '</div></div>';
            if (credited) {
                html += '<div style="background:rgba(102,255,102,0.20);border:1px solid #66ff66;border-radius:8px;padding:10px;text-align:center;">';
                html += '<div style="color:#66ff66;font-size:13px;font-weight:900;">✅ Premio acreditado a tu saldo</div>';
                html += '<div style="color:#bbe6bb;font-size:11px;margin-top:2px;">Ya está disponible para jugar — ¡buena suerte! 🎰</div>';
                html += '</div>';
            } else if (needsClaim) {
                html += '<button type="button" onclick="VIP.raffles.claimPrize(' + JSON.stringify(c.id) + ')" style="width:100%;background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:13px;border-radius:10px;font-weight:900;font-size:15px;cursor:pointer;letter-spacing:1px;box-shadow:0 4px 10px rgba(255,215,0,0.30);">🎁 RECLAMAR $' + _fmt(c.prizeValueARS) + '</button>';
                html += '<div style="color:#ffe699;font-size:10px;text-align:center;margin-top:6px;">⚠️ La acreditación automática falló — tocá el botón para acreditar manualmente.</div>';
            } else {
                html += '<div style="background:rgba(255,170,102,0.15);border:1px solid rgba(255,170,102,0.40);border-radius:8px;padding:10px;text-align:center;">';
                html += '<div style="color:#ffaa66;font-size:12px;font-weight:700;">⏳ Estamos acreditando tu premio…</div>';
                html += '</div>';
            }
            if (c.hoursRemaining > 0) {
                html += '<div style="color:#aaa;font-size:10px;text-align:center;margin-top:6px;font-style:italic;">Esta felicitación se oculta en ~' + c.hoursRemaining + ' h</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // Banner legacy "Reclamable" — para casos donde recentWins no aplica
    // (sorteo viejo > 24h con auto-credit fallido). Mantenemos compat.
    function _renderClaimableBanner(claimable, recentWinIds) {
        if (!claimable || !claimable.length) return '';
        const skip = new Set(recentWinIds || []);
        const rest = claimable.filter(c => !skip.has(c.id));
        if (rest.length === 0) return '';
        let html = '<div style="background:linear-gradient(135deg,#0f4c00,#1a8200);border:2px solid #66ff66;border-radius:12px;padding:14px;margin-bottom:14px;">';
        html += '<div style="color:#66ff66;font-weight:900;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">🏆 Premio sin reclamar</div>';
        html += '<div style="color:#bbe6bb;font-size:11px;margin-bottom:8px;line-height:1.4;">Tenés un premio anterior que aún no se acreditó. Tocá el botón para acreditarlo a tu saldo.</div>';
        for (const c of rest) {
            html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;margin-top:8px;">';
            html += '<div style="color:#fff;font-weight:800;font-size:14px;margin-bottom:4px;">' + (c.emoji || '🏆') + ' ' + _esc(c.name) + '</div>';
            html += '<div style="color:#ddd;font-size:12px;margin-bottom:8px;">Número ganador: <strong>#' + c.winningTicketNumber + '</strong> · Premio: <strong>$' + _fmt(c.prizeValueARS) + '</strong></div>';
            html += '<button type="button" onclick="VIP.raffles.claimPrize(' + JSON.stringify(c.id) + ')" style="width:100%;background:#ffd700;color:#000;border:none;padding:11px;border-radius:8px;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:1px;">🎁 RECLAMAR $' + _fmt(c.prizeValueARS) + '</button>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function _renderAutoEnrolledBanner(autoEnrolled) {
        if (!autoEnrolled || !autoEnrolled.length) return '';
        let html = '<div style="background:linear-gradient(135deg,#1a3d6e,#2a5a8a);border:2px solid #4dabff;border-radius:12px;padding:12px;margin-bottom:14px;">';
        html += '<div style="color:#4dabff;font-weight:900;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">🎉 Te anotamos en sorteos gratis</div>';
        html += '<div style="color:#dde9f0;font-size:12px;line-height:1.5;">Por tus cargas de este mes te tocan estos números <strong>gratis</strong>:</div>';
        html += '<ul style="margin:6px 0 0;padding-left:18px;color:#fff;font-size:12.5px;line-height:1.8;">';
        for (const e of autoEnrolled) {
            html += '<li>' + (e.emoji || '🎁') + ' <strong>' + _esc(e.raffleName) + '</strong> — número <strong>#' + e.ticketNumber + '</strong> (premio $' + _fmt(e.prizeValueARS) + ')</li>';
        }
        html += '</ul></div>';
        return html;
    }

    function _renderPaidCard(r, balance) {
        const sold = r.cuposSold || 0;
        const total = r.totalTickets || 0;
        const remaining = r.cuposRemaining;
        const fillPct = total ? Math.round((sold / total) * 100) : 0;
        const myNums = r.myTicketNumbers || [];
        const closed = r.status !== 'active';
        const drawn = r.status === 'drawn';
        const canAfford = balance >= (r.entryCost || 0);

        let html = '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.30);border-radius:12px;padding:14px;margin-bottom:12px;">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
        html += '<div style="font-size:34px;line-height:1;">' + (r.emoji || '🎁') + '</div>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="color:#ffd700;font-size:15px;font-weight:900;line-height:1.2;">' + _esc(r.name) + '</div>';
        html += '<div style="color:#bbb;font-size:11px;line-height:1.3;">Premio: <strong style="color:#fff;">$' + _fmt(r.prizeValueARS) + '</strong> · Cupo: ' + total + ' núm. × $' + _fmt(r.entryCost) + '</div>';
        html += '</div></div>';

        html += '<div style="height:8px;background:rgba(0,0,0,0.30);border-radius:4px;overflow:hidden;margin:8px 0;">';
        html += '<div style="height:100%;width:' + fillPct + '%;background:linear-gradient(90deg,#d4af37,#ffd700);"></div></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#999;margin-bottom:10px;">';
        html += '<span>' + sold + '/' + total + ' vendidos (' + fillPct + '%)</span>';
        html += '<span>' + remaining + ' disponibles</span></div>';

        if (myNums.length > 0) {
            html += '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:8px;margin-bottom:10px;">';
            html += '<div style="color:#ffd700;font-size:11px;font-weight:800;margin-bottom:4px;">TUS NÚMEROS (' + myNums.length + ')</div>';
            html += '<div style="color:#fff;font-size:13px;font-weight:700;word-break:break-word;">' + _esc(_formatNumbers(myNums)) + '</div></div>';
        }

        if (drawn) {
            const youWon = r.iAmWinner;
            html += '<div style="background:' + (youWon ? 'rgba(102,255,102,0.10)' : 'rgba(255,107,53,0.10)') + ';border-radius:8px;padding:10px;font-size:12px;line-height:1.4;color:#ddd;">';
            html += youWon
                ? '🏆 <strong style="color:#66ff66;">¡Ganaste!</strong> Número ' + r.winningTicketNumber + '. ' + (r.prizeClaimedAt ? 'Premio acreditado a tu saldo.' : 'Si no se acreditó automático, tocá Reclamar arriba.')
                : '🎲 Sorteado · número ganador <strong>#' + r.winningTicketNumber + '</strong> — ganó @' + _esc(r.winnerUsername || '');
            html += '</div>';
        } else if (closed) {
            html += '<div style="background:rgba(255,107,53,0.10);border-radius:8px;padding:10px;font-size:12px;color:#ffaa66;">⏳ Cupo lleno. Esperando sorteo del lunes en la Lotería Nacional Nocturna.</div>';
        } else {
            html += '<div style="background:rgba(212,175,55,0.05);border:1px dashed rgba(212,175,55,0.30);border-radius:6px;padding:8px;margin:6px 0 8px;font-size:11px;color:#ddd;line-height:1.5;">';
            html += '💡 <strong style="color:#ffd700;">Tip:</strong> tocá <strong>"Elegir números"</strong> y elegí los que quieras del 1 al 100. Si no querés elegir, podés pedir aleatorio. Hasta 50 números por compra.';
            html += '</div>';
            html += '<button type="button" onclick="VIP.raffles.openPicker(' + JSON.stringify(r.id) + ')" ' + (canAfford ? '' : 'disabled') + ' style="width:100%;background:' + (canAfford ? 'linear-gradient(135deg,#d4af37,#f7931e)' : 'rgba(120,120,120,0.40)') + ';color:#000;border:none;padding:11px;border-radius:8px;font-weight:900;font-size:13px;cursor:' + (canAfford ? 'pointer' : 'not-allowed') + ';letter-spacing:0.5px;">' + (canAfford ? '🎫 ELEGIR NÚMEROS' : '🔒 SIN SALDO ($' + _fmt(r.entryCost) + ' por número)') + '</button>';
        }

        html += '</div>';
        return html;
    }

    function _renderFreeCard(r) {
        const sold = r.cuposSold || 0;
        const total = r.totalTickets || 0;
        const remaining = r.cuposRemaining;
        const fillPct = total ? Math.round((sold / total) * 100) : 0;
        const myNums = r.myTicketNumbers || [];
        const closed = r.status !== 'active';
        const drawn = r.status === 'drawn';
        const enrolled = myNums.length > 0;

        let html = '<div style="background:rgba(77,171,255,0.06);border:1px solid rgba(77,171,255,0.40);border-radius:12px;padding:14px;margin-bottom:12px;">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
        html += '<div style="font-size:34px;line-height:1;">' + (r.emoji || '🎁') + '</div>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="color:#4dabff;font-size:15px;font-weight:900;line-height:1.2;">' + _esc(r.name) + '</div>';
        html += '<div style="color:#bbb;font-size:11px;line-height:1.3;">Premio: <strong style="color:#fff;">$' + _fmt(r.prizeValueARS) + '</strong> · GRATIS para activos · Mín. carga: <strong style="color:#4dabff;">$' + _fmt(r.minCargasARS) + '</strong> · Tope ' + total + ' personas</div>';
        html += '</div></div>';

        html += '<div style="height:8px;background:rgba(0,0,0,0.30);border-radius:4px;overflow:hidden;margin:8px 0;">';
        html += '<div style="height:100%;width:' + fillPct + '%;background:linear-gradient(90deg,#4dabff,#79c2ff);"></div></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#999;margin-bottom:10px;">';
        html += '<span>' + sold + '/' + total + ' anotados (' + fillPct + '%)</span>';
        html += '<span>' + remaining + ' lugares</span></div>';

        if (enrolled) {
            html += '<div style="background:rgba(77,171,255,0.15);border:1px solid #4dabff;border-radius:8px;padding:10px;text-align:center;">';
            html += '<div style="color:#4dabff;font-size:11px;font-weight:800;letter-spacing:1px;margin-bottom:4px;">✅ ESTÁS ANOTADO</div>';
            html += '<div style="color:#fff;font-size:18px;font-weight:900;">Número <strong>#' + myNums[0] + '</strong></div>';
            html += '</div>';
        } else if (drawn) {
            html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;font-size:12px;color:#aaa;">🎲 Sorteado · ganó @' + _esc(r.winnerUsername || '') + ' con #' + r.winningTicketNumber + '</div>';
        } else if (closed) {
            html += '<div style="background:rgba(255,107,53,0.10);border-radius:8px;padding:10px;font-size:12px;color:#ffaa66;">⏳ Cupo lleno. Esperando el sorteo del lunes.</div>';
        } else {
            html += '<div style="background:rgba(255,170,102,0.10);border-radius:8px;padding:10px;font-size:12px;color:#ffaa66;line-height:1.5;">⚠️ <strong>No estás anotado todavía.</strong> Necesitás <strong>$' + _fmt(r.minCargasARS) + '</strong> de cargas en los últimos 30 días. Cuando llegues al monto, te anotamos automáticamente.</div>';
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
        const allRaffles = (_data.raffles || []).filter(r => r.status !== 'archived' && r.status !== 'cancelled');
        const paid = allRaffles.filter(r => !r.isFree);
        const free = allRaffles.filter(r => r.isFree);

        let html = '';
        const recentWins = _data.recentWins || [];
        html += _renderRecentWinsBanner(recentWins);
        html += _renderClaimableBanner(_data.claimable || [], recentWins.map(w => w.id));
        html += _renderAutoEnrolledBanner(_data.autoEnrolled || []);

        // Header con saldo
        html += '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.25);border-radius:10px;padding:10px 14px;margin-bottom:14px;">';
        html += '<div><div style="color:#aaa;font-size:11px;font-weight:700;letter-spacing:1px;">SALDO DISPONIBLE</div><div style="color:#ffd700;font-size:20px;font-weight:900;">$' + _fmt(balance) + '</div></div>';
        html += '<div style="text-align:right;color:#aaa;font-size:11px;line-height:1.4;">Sorteos<br><strong style="color:#fff;font-size:13px;">todos los lunes</strong></div></div>';

        // === PAGOS ===
        if (paid.length > 0) {
            html += '<div style="margin:18px 0 8px;display:flex;align-items:center;gap:8px;">';
            html += '<div style="flex:1;height:2px;background:linear-gradient(90deg,transparent,#d4af37);"></div>';
            html += '<h3 style="margin:0;color:#ffd700;font-size:14px;font-weight:900;letter-spacing:2px;">💰 SORTEOS PAGOS</h3>';
            html += '<div style="flex:1;height:2px;background:linear-gradient(90deg,#d4af37,transparent);"></div></div>';
            html += '<div style="background:rgba(255,255,255,0.03);border-left:3px solid #d4af37;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px;font-size:11.5px;color:#ccc;line-height:1.5;">';
            html += '<strong style="color:#ffd700;">💡 Podés elegir tu/s número/s favorito/s</strong> del 1 al 100. Si no querés elegir, pedí aleatorio. Hasta 50 por compra. Si ganás, te <strong>acreditamos el premio automáticamente</strong> a tu saldo.';
            html += '</div>';
            for (const r of paid) html += _renderPaidCard(r, balance);
        }

        // === GRATIS ===
        if (free.length > 0) {
            html += '<div style="margin:22px 0 8px;display:flex;align-items:center;gap:8px;">';
            html += '<div style="flex:1;height:2px;background:linear-gradient(90deg,transparent,#4dabff);"></div>';
            html += '<h3 style="margin:0;color:#4dabff;font-size:14px;font-weight:900;letter-spacing:2px;">🎁 SORTEOS GRATIS</h3>';
            html += '<div style="flex:1;height:2px;background:linear-gradient(90deg,#4dabff,transparent);"></div></div>';
            html += '<div style="background:rgba(77,171,255,0.06);border-left:3px solid #4dabff;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px;font-size:11.5px;color:#ccc;line-height:1.5;">';
            html += '<strong style="color:#4dabff;">💎 Exclusivo para clientes activos.</strong> No tenés que pagar — si llegás al mínimo de cargas en los últimos 30 días, te anotamos <strong>automáticamente</strong>. 1 número por persona, máximo 100 personas por sorteo.';
            html += '</div>';
            for (const r of free) html += _renderFreeCard(r);
        }

        if (paid.length === 0 && free.length === 0) {
            html += '<div style="text-align:center;color:#aaa;padding:30px 0;">No hay sorteos disponibles en este momento.</div>';
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
        if (_refreshTimer) clearInterval(_refreshTimer);
        _refreshTimer = setInterval(async () => {
            if (modal.style.display !== 'flex') return;
            const d = await _fetchActive();
            if (d) { _data = d; _render(); }
        }, 30000);
    }

    function close() {
        const modal = document.getElementById('rafflesModal');
        if (modal) modal.style.display = 'none';
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        _data = null;
        _picker = null;
        const pm = document.getElementById('rafflesPickerModal');
        if (pm) pm.style.display = 'none';
    }

    // ====== PICKER (sub-modal) ======
    function _renderPicker() {
        if (!_picker) return;
        const r = (_data && _data.raffles || []).find(x => x.id === _picker.raffleId);
        if (!r) return;
        const taken = new Set((r.claimedNumbers || []).map(n => Number(n)));
        const myNums = new Set((r.myTicketNumbers || []).map(n => Number(n)));
        const total = r.totalTickets || 100;
        const cost = _picker.picked.size * (r.entryCost || 0);

        let html = '';
        html += '<button type="button" onclick="VIP.raffles.closePicker()" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#aaa;font-size:24px;cursor:pointer;line-height:1;">✕</button>';
        html += '<h3 style="color:#ffd700;margin:0 0 4px;font-size:18px;">' + (r.emoji || '🎁') + ' ' + _esc(r.name) + '</h3>';
        html += '<div style="color:#aaa;font-size:11px;margin-bottom:8px;">Premio $' + _fmt(r.prizeValueARS) + ' · $' + _fmt(r.entryCost) + ' por número</div>';
        html += '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:8px 10px;font-size:11.5px;color:#ddd;margin-bottom:10px;line-height:1.4;">';
        html += '🎯 Tocá los números que querés (<strong style="color:#ffd700;">verde</strong> = libres, <strong style="color:#ff6b6b;">rojo</strong> = tomados, <strong style="color:#ffd700;">dorado</strong> = los que vas a comprar). Hasta 50 por compra.';
        html += '</div>';

        // Grid 10x10
        html += '<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin-bottom:10px;">';
        for (let n = 1; n <= total; n++) {
            const isTaken = taken.has(n);
            const isMine = myNums.has(n);
            const isPicked = _picker.picked.has(n);
            let bg, color, cursor;
            if (isMine) { bg = 'rgba(102,255,102,0.40)'; color = '#fff'; cursor = 'not-allowed'; }
            else if (isTaken) { bg = 'rgba(255,107,107,0.30)'; color = '#888'; cursor = 'not-allowed'; }
            else if (isPicked) { bg = 'linear-gradient(135deg,#ffd700,#f7931e)'; color = '#000'; cursor = 'pointer'; }
            else { bg = 'rgba(102,255,102,0.10)'; color = '#cfe9cf'; cursor = 'pointer'; }
            const onclick = (!isTaken && !isMine) ? 'onclick="VIP.raffles.togglePick(' + n + ')"' : '';
            const tdec = (isTaken || isMine) ? 'text-decoration:line-through;' : '';
            html += '<button type="button" ' + onclick + ' style="background:' + bg + ';color:' + color + ';border:none;padding:6px 0;border-radius:4px;font-size:12px;font-weight:700;cursor:' + cursor + ';' + tdec + '">' + n + '</button>';
        }
        html += '</div>';

        // Resumen + acciones
        const pickedArr = Array.from(_picker.picked).sort((a, b) => a - b);
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;margin-bottom:8px;">';
        html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin-bottom:4px;">SELECCIÓN (' + pickedArr.length + ')</div>';
        html += '<div style="color:#ffd700;font-size:14px;font-weight:900;word-break:break-word;">' + (pickedArr.length ? pickedArr.map(n => '#' + n).join(', ') : '— ninguno —') + '</div>';
        html += '<div style="color:#fff;font-size:13px;font-weight:700;margin-top:6px;">Total: <strong style="color:#ffd700;">$' + _fmt(cost) + '</strong></div>';
        html += '</div>';

        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<button type="button" onclick="VIP.raffles.pickRandom()" style="flex:1;min-width:100px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">🎲 Aleatorio (5)</button>';
        html += '<button type="button" onclick="VIP.raffles.clearPick()" style="background:rgba(255,107,107,0.10);color:#ff6b6b;border:1px solid rgba(255,107,107,0.30);padding:10px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">Limpiar</button>';
        html += '<button type="button" id="raffle_pick_buy" onclick="VIP.raffles.confirmPickerBuy()" ' + (pickedArr.length === 0 ? 'disabled' : '') + ' style="flex:2;min-width:160px;background:' + (pickedArr.length ? 'linear-gradient(135deg,#d4af37,#f7931e)' : 'rgba(120,120,120,0.40)') + ';color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:' + (pickedArr.length ? 'pointer' : 'not-allowed') + ';letter-spacing:0.5px;">🎫 COMPRAR ' + pickedArr.length + ' POR $' + _fmt(cost) + '</button>';
        html += '</div>';

        const pickerBody = document.getElementById('rafflesPickerBody');
        if (pickerBody) pickerBody.innerHTML = html;
    }

    function openPicker(raffleId) {
        const r = (_data && _data.raffles || []).find(x => x.id === raffleId);
        if (!r) return;
        if (r.isFree) return;
        _picker = { raffleId, picked: new Set() };
        let modal = document.getElementById('rafflesPickerModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'rafflesPickerModal';
            modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:30000;align-items:flex-start;justify-content:center;padding:8px;overflow-y:auto;';
            modal.onclick = function (e) { if (e.target === modal) closePicker(); };
            modal.innerHTML = '<div style="background:linear-gradient(135deg,#1a0033,#2d0052);border:2px solid #d4af37;border-radius:14px;max-width:520px;width:100%;margin:8px auto;padding:18px 14px 16px;position:relative;"><div id="rafflesPickerBody"></div></div>';
            document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
        _renderPicker();
    }

    function closePicker() {
        const modal = document.getElementById('rafflesPickerModal');
        if (modal) modal.style.display = 'none';
        _picker = null;
    }

    function togglePick(n) {
        if (!_picker) return;
        if (_picker.picked.has(n)) _picker.picked.delete(n);
        else {
            if (_picker.picked.size >= 50) {
                VIP.ui.showToast('⚠️ Tope 50 números por compra', 'warning');
                return;
            }
            _picker.picked.add(n);
        }
        _renderPicker();
    }

    function pickRandom() {
        if (!_picker) return;
        const r = (_data && _data.raffles || []).find(x => x.id === _picker.raffleId);
        if (!r) return;
        const taken = new Set((r.claimedNumbers || []).map(n => Number(n)));
        const mine = new Set((r.myTicketNumbers || []).map(n => Number(n)));
        const total = r.totalTickets || 100;
        const available = [];
        for (let n = 1; n <= total; n++) if (!taken.has(n) && !mine.has(n) && !_picker.picked.has(n)) available.push(n);
        // Mezclar y tomar 5 (o lo que quede).
        for (let i = available.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [available[i], available[j]] = [available[j], available[i]];
        }
        const want = Math.min(5, available.length, 50 - _picker.picked.size);
        for (let i = 0; i < want; i++) _picker.picked.add(available[i]);
        _renderPicker();
    }

    function clearPick() {
        if (!_picker) return;
        _picker.picked.clear();
        _renderPicker();
    }

    async function confirmPickerBuy() {
        if (!_picker || _buying) return;
        const arr = Array.from(_picker.picked).sort((a, b) => a - b);
        if (arr.length === 0) return;
        const r = (_data && _data.raffles || []).find(x => x.id === _picker.raffleId);
        if (!r) return;
        const cost = arr.length * (r.entryCost || 0);
        if (!confirm('¿Comprar ' + arr.length + ' número' + (arr.length > 1 ? 's' : '') + ' (' + arr.map(n => '#' + n).join(', ') + ') del ' + r.name + ' por $' + _fmt(cost) + '?')) return;
        _buying = true;
        const btn = document.getElementById('raffle_pick_buy');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando…'; }
        try {
            const resp = await fetch(`${VIP.config.API_URL}/api/raffles/${_picker.raffleId}/buy`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pickedNumbers: arr, quantity: arr.length })
            });
            const data = await resp.json();
            if (data && data.success) {
                _showBoughtModal(data.ticketNumbers || arr, r);
                closePicker();
                const d = await _fetchActive();
                if (d) { _data = d; _render(); }
            } else {
                const msg = (data && data.error) || 'No se pudo comprar';
                if (data && data.takenNumber) {
                    VIP.ui.showToast('⚠️ El número #' + data.takenNumber + ' lo tomó otro. Probá con otro.', 'error');
                    // Refresh para ver el grid actualizado
                    const d = await _fetchActive();
                    if (d) { _data = d; _render(); _renderPicker(); }
                } else {
                    VIP.ui.showToast('⚠️ ' + msg, 'error');
                }
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🎫 COMPRAR ' + arr.length + ' POR $' + _fmt(cost);
                }
            }
        } catch (e) {
            console.error('confirmPickerBuy error:', e);
            VIP.ui.showToast('Error de conexión', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🎫 COMPRAR ' + arr.length + ' POR $' + _fmt(cost);
            }
        } finally {
            _buying = false;
        }
    }

    function _showBoughtModal(numbers, raffle) {
        const arr = numbers.slice().sort((a, b) => a - b);
        let modal = document.getElementById('rafflesBoughtModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'rafflesBoughtModal';
            modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:35000;align-items:center;justify-content:center;padding:14px;';
            modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
            modal.innerHTML = '<div style="background:linear-gradient(135deg,#0f4c00,#1a8200);border:3px solid #66ff66;border-radius:18px;max-width:440px;width:100%;padding:24px 20px;text-align:center;"><div id="rafflesBoughtBody"></div></div>';
            document.body.appendChild(modal);
        }
        const body = document.getElementById('rafflesBoughtBody');
        if (body) {
            const numStr = arr.length === 1
                ? '<div style="font-size:64px;font-weight:900;color:#ffd700;margin:14px 0;line-height:1;">#' + arr[0] + '</div>'
                : '<div style="font-size:18px;font-weight:900;color:#ffd700;margin:14px 0;word-break:break-word;line-height:1.5;">' + arr.map(n => '#' + n).join(' · ') + '</div>';
            body.innerHTML = '<div style="font-size:48px;margin-bottom:8px;">🎫</div>' +
                '<div style="color:#66ff66;font-size:14px;font-weight:900;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">¡Compra confirmada!</div>' +
                '<div style="color:#fff;font-size:13px;margin-bottom:6px;">Tu/s número/s para <strong>' + _esc(raffle.name) + '</strong>:</div>' +
                numStr +
                '<div style="color:#dde9d4;font-size:12px;line-height:1.5;margin-bottom:14px;">Sorteo el lunes en la Lotería Nacional Nocturna. Si tu número gana, te <strong>acreditamos el premio automáticamente</strong> a tu saldo.</div>' +
                '<button type="button" onclick="document.getElementById(\'rafflesBoughtModal\').style.display=\'none\'" style="width:100%;background:#ffd700;color:#000;border:none;padding:12px;border-radius:10px;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:1px;">¡PERFECTO!</button>';
        }
        modal.style.display = 'flex';
    }

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

    return { open, close, openPicker, closePicker, togglePick, pickRandom, clearPick, confirmPickerBuy, claimPrize };
})();
