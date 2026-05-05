// =====================================================================
// RAFFLES — Sorteos mensuales (cliente)
// =====================================================================
// Modelo simplificado: 12 sorteos exclusivos GRATIS para clientes activos.
//   - 10 iPhones 17 secuenciales: solo se ve 1 activo, cuando se completa
//                                  aparece el siguiente.
//   -  1 Viaje al Caribe x2
//   -  1 Auto $10.000.000
//
// Cada sorteo: 100 cupos, 1 cupo por persona POR CATEGORÍA. El user elige
// su numero de la grilla 1..100. Tomados se muestran tachados. Ganador
// se determina por la Lotería Nacional Nocturna del primer lunes del mes
// próximo (resultado oficial).
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
        const h = height || 130;
        if (r.imageUrl) {
            return '<div style="width:100%;height:' + h + 'px;background-image:url(\'' + _esc(r.imageUrl) + '\');background-size:cover;background-position:center;border-radius:10px;"></div>';
        }
        return '<div style="width:100%;height:' + h + 'px;background:linear-gradient(135deg,#3d1f6e,#1a0033);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:' + Math.round(h/2.3) + 'px;">' + (r.emoji || '🎁') + '</div>';
    }

    // -----------------------------------------------------------------
    // Card del sorteo activo de cada categoría (con grilla picker).
    // -----------------------------------------------------------------
    function _renderCategoryCard(r, monthlyDeposit, completedCount, totalInCategory, userHasInCategory, userOtherInstanceName) {
        const userClaimed = (r.userTicketNumbers && r.userTicketNumbers[0]) || null;
        const meets = !!r.userMeetsThreshold;
        const drawDateStr = r.drawDate
            ? new Date(r.drawDate).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const claimedMap = r.claimedNumbers || {};
        const headerName = _esc(r.prizeName);
        const isAuto = r.raffleType === 'auto';
        const isCaribe = r.raffleType === 'caribe';
        const isIphone = r.raffleType === 'iphone';
        const showSequential = totalInCategory > 1;

        // Header con progreso si hay multiples instancias.
        let progressHeader = '';
        if (showSequential) {
            progressHeader = '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:8px 12px;text-align:center;">' +
                '  <div style="color:#d4af37;font-weight:900;font-size:13px;text-transform:uppercase;letter-spacing:1px;">📱 Sorteo ' + (r.instanceNumber || 1) + ' de ' + totalInCategory + '</div>' +
                '  <small style="color:#aaa;font-size:11px;">' + completedCount + ' iPhone' + (completedCount===1?'':'s') + ' ya se completaron este mes 🎉</small>' +
                '</div>';
        }

        // Banner threshold / estado del user.
        const progress = Math.min(100, Math.round(((monthlyDeposit||0) / Math.max(1, r.wageredThreshold||1)) * 100));
        let thresholdBlock;
        if (userHasInCategory && !userClaimed) {
            // User tiene cupo en otra instancia de esta categoria.
            thresholdBlock = '<div style="background:rgba(255,200,80,0.10);border:1px solid rgba(255,200,80,0.40);border-radius:8px;padding:10px;text-align:center;">' +
                '<div style="color:#ffc850;font-size:12px;font-weight:800;">ℹ️ Ya tenés tu número en ' + _esc(userOtherInstanceName || 'otro sorteo de esta categoría') + '</div>' +
                '<small style="color:#888;display:block;margin-top:4px;">1 número por persona por categoría — esperá al próximo mes para el siguiente.</small>' +
                '</div>';
        } else if (userClaimed) {
            thresholdBlock = '<div style="background:rgba(37,211,102,0.10);border:1px solid rgba(37,211,102,0.40);border-radius:8px;padding:10px;text-align:center;">' +
                '<div style="color:#25d366;font-size:13px;font-weight:900;">✅ Tu número: <span style="color:#ffd700;font-size:20px;">#' + userClaimed + '</span></div>' +
                '<small style="color:#888;display:block;margin-top:3px;">Si la Lotería Nacional Nocturna del primer lunes saca este número, ganás 🏆</small>' +
                '</div>';
        } else if (meets) {
            thresholdBlock = '<div style="background:rgba(255,200,80,0.10);border:1px solid rgba(255,200,80,0.40);border-radius:8px;padding:10px;text-align:center;">' +
                '<div style="color:#ffc850;font-size:13px;font-weight:800;">🎉 ¡HABILITADO! Apostaste $' + (monthlyDeposit||0).toLocaleString('es-AR') + ' este mes</div>' +
                '<small style="color:#aaa;display:block;margin-top:3px;">Elegí UN número de los libres ↓ (es GRATIS)</small>' +
                '</div>';
        } else {
            const need = Math.max(0, (r.wageredThreshold||0) - (monthlyDeposit||0));
            thresholdBlock = '<div style="background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.30);border-radius:8px;padding:10px;">' +
                '<div style="color:#ff8080;font-size:12px;font-weight:800;text-align:center;">🔒 Apostá $' + need.toLocaleString('es-AR') + ' más este mes para participar</div>' +
                '<div style="background:rgba(0,0,0,0.40);border-radius:8px;height:8px;overflow:hidden;margin-top:8px;">' +
                '  <div style="height:100%;width:' + progress + '%;background:linear-gradient(90deg,#d4af37,#f7931e);"></div>' +
                '</div>' +
                '<small style="color:#888;display:block;margin-top:4px;text-align:center;">Llevás $' + (monthlyDeposit||0).toLocaleString('es-AR') + ' / $' + (r.wageredThreshold||0).toLocaleString('es-AR') + ' (' + progress + '%)</small>' +
                '</div>';
        }

        // Grilla de numeros 1..totalTickets.
        let grid = '<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:4px;font-family:monospace;font-size:11px;">';
        const canClaim = meets && !userClaimed && !userHasInCategory && r.status === 'active';
        for (let n = 1; n <= r.totalTickets; n++) {
            const owner = claimedMap[n];
            if (n === userClaimed) {
                grid += '<button disabled style="background:#25d366;color:#000;font-weight:900;border:none;border-radius:4px;padding:6px 0;cursor:default;" title="TU NÚMERO">' + n + ' ✓</button>';
            } else if (owner) {
                grid += '<button disabled title="Tomado por @' + _esc(owner) + '" style="background:rgba(255,255,255,0.04);color:#555;border:none;border-radius:4px;padding:6px 0;text-decoration:line-through;cursor:not-allowed;">' + n + '</button>';
            } else if (canClaim) {
                grid += '<button onclick="VIP.raffles.claimNumber(\'' + r.id + '\', ' + n + ')" style="background:rgba(212,175,55,0.20);color:#ffd700;border:1px solid rgba(212,175,55,0.40);border-radius:4px;padding:6px 0;cursor:pointer;font-weight:700;" onmouseover="this.style.background=\'#d4af37\';this.style.color=\'#000\';" onmouseout="this.style.background=\'rgba(212,175,55,0.20)\';this.style.color=\'#ffd700\';">' + n + '</button>';
            } else {
                grid += '<button disabled style="background:rgba(255,255,255,0.03);color:#666;border:none;border-radius:4px;padding:6px 0;cursor:not-allowed;">' + n + '</button>';
            }
        }
        grid += '</div>';

        const lotteryRuleBlock = r.lotteryRule
            ? '<div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.30);border-radius:8px;padding:8px 10px;">' +
              '  <div style="color:#00d4ff;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:center;">🎯 Cómo se sortea (transparente)</div>' +
              '  <div style="color:#ddd;font-size:11px;margin-top:3px;line-height:1.4;text-align:center;">' + _esc(r.lotteryRule) + '</div>' +
              '</div>'
            : '';

        return '<div style="background:rgba(212,175,55,0.05);border:2px solid rgba(212,175,55,0.40);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">' +
               progressHeader +
               _renderImage(r, 130) +
               '<div>' +
               '  <h3 style="color:#ffd700;margin:0 0 4px;font-size:18px;font-weight:800;">' + (r.emoji || '🎁') + ' ' + headerName + '</h3>' +
               '  <p style="color:#aaa;margin:0;font-size:12px;line-height:1.5;">' + _esc(r.description || '') + '</p>' +
               '</div>' +
               '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:8px 12px;text-align:center;">' +
               '  <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">💎 Premio</div>' +
               '  <div style="color:#ffd700;font-weight:900;font-size:20px;">$' + (r.prizeValueARS||0).toLocaleString('es-AR') + '</div>' +
               '  <small style="color:#aaa;font-size:10px;">Sorteo el ' + drawDateStr + '</small>' +
               '</div>' +
               lotteryRuleBlock +
               thresholdBlock +
               '<div style="margin-top:6px;">' +
               '  <div style="color:#aaa;font-size:11px;text-align:center;margin-bottom:6px;">' + (r.totalCuposSold||0) + ' / ' + r.totalTickets + ' números reclamados</div>' +
                grid +
               '</div>' +
               '</div>';
    }

    // Mini card de un iPhone completado/sorteado.
    function _renderMiniInstance(r) {
        const drawnInfo = r.status === 'drawn' && r.winnerUsername
            ? '<div style="color:#b39dff;font-size:11px;font-weight:700;">🏆 Ganador: @' + _esc(r.winnerUsername) + ' (#' + r.winningTicketNumber + ')</div>'
            : '';
        let badge;
        if (r.status === 'drawn') badge = '<span style="background:rgba(120,80,255,0.20);color:#b39dff;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;">SORTEADO</span>';
        else if (r.status === 'cancelled') badge = '<span style="background:rgba(255,80,80,0.20);color:#ff5050;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;">CANCELADO</span>';
        else badge = '<span style="background:rgba(37,211,102,0.20);color:#25d366;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;">✅ COMPLETADO</span>';
        return '<div style="background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
               '  <div style="font-size:18px;flex-shrink:0;">' + (r.emoji || '🎁') + '</div>' +
               '  <div style="flex:1;min-width:0;">' +
               '    <div style="color:#ddd;font-size:12px;font-weight:700;">' + _esc(r.prizeName) + (r.instanceNumber > 1 ? ' #' + r.instanceNumber : '') + '</div>' +
               '    <div style="color:#888;font-size:10px;">' + (r.totalCuposSold||0) + '/' + r.totalTickets + ' cupos</div>' +
               drawnInfo +
               '  </div>' +
               '  <div style="flex-shrink:0;">' + badge + '</div>' +
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
        // Budget bar — saldo + cargado del mes.
        const bar = document.getElementById('rafflesBudgetBar');
        const av = document.getElementById('rafflesBudgetAvailable');
        const detail = document.getElementById('rafflesBudgetDetail');
        if (_data.budget && av && detail) {
            const carga = _data.budget.monthlyDeposit || 0;
            av.textContent = '$' + carga.toLocaleString('es-AR');
            detail.innerHTML = '📊 Apostado/cargado este mes — más apostás, más sorteos te habilitás';
            if (bar) bar.style.display = 'block';
        }
        const raffles = _data.raffles || [];
        const wagered = raffles.filter(r => r.entryMode === 'wagered');
        if (wagered.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#888;">No hay sorteos activos este mes.</div>';
            return;
        }

        // Agrupar por raffleType. Auto, Caribe, iPhone (orden visual).
        const groupOrder = ['auto', 'caribe', 'iphone'];
        const grouped = {};
        for (const r of wagered) {
            const t = r.raffleType || 'other';
            if (!grouped[t]) grouped[t] = [];
            grouped[t].push(r);
        }

        const monthlyDeposit = (_data.budget && _data.budget.monthlyDeposit) || 0;

        let html = '';
        // Banner principal del modelo.
        html += '<div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.30);border-radius:10px;padding:12px;margin-bottom:10px;text-align:center;">';
        html += '  <div style="color:#d4af37;font-weight:900;font-size:13px;text-transform:uppercase;letter-spacing:1px;">🎁 SORTEOS GRATIS PARA CLIENTES ACTIVOS</div>';
        html += '  <div style="color:#aaa;font-size:11px;margin-top:4px;line-height:1.5;">Apostá con nosotros este mes y desbloqueá UN número GRATIS en cada categoría (📱 1 iPhone · 🏖️ 1 Caribe · 🚗 1 Auto). Se sortean por la <strong style="color:#fff;">Lotería Nacional NOCTURNA del primer lunes del mes próximo</strong> (resultado oficial — verificable por todos).</div>';
        html += '</div>';
        // Reglas + anti-fraude.
        html += '<div style="background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.30);border-radius:10px;padding:12px;margin-bottom:10px;">';
        html += '  <div style="color:#ff8080;font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:1px;text-align:center;margin-bottom:6px;">⚠️ REGLAS IMPORTANTES — LEER ANTES DE PARTICIPAR</div>';
        html += '  <ul style="margin:0;padding-left:18px;color:#ddd;font-size:11px;line-height:1.6;">';
        html += '    <li><strong style="color:#fff;">Tope 1 número por cliente por categoría.</strong> No podés tener 2 iPhones, ni mezclar instancias.</li>';
        html += '    <li><strong style="color:#ff8080;">Vamos a analizar el juego de cada uno.</strong> Si cargás y retirás todo sin jugar (wash-trading) para entrar gratis al sorteo, te bloqueamos el cupo y queda registrado. <span style="color:#fff;">No hagan nada raro.</span></li>';
        html += '    <li><strong style="color:#25d366;">Para reclamar el premio: ser parte de la COMUNIDAD.</strong> Unirse al grupo es REQUISITO obligatorio para retirar el premio si ganás 🤝</li>';
        html += '    <li>Cuando alcanzás el monto de cada categoría podés elegir tu número de la grilla. Tomados se ven tachados.</li>';
        html += '  </ul>';
        html += '</div>';

        for (const t of groupOrder) {
            const group = grouped[t];
            if (!group || group.length === 0) continue;
            group.sort((a, b) => (a.instanceNumber||0) - (b.instanceNumber||0));

            // Activo: primera instancia con status='active' y no llena.
            const activeOne = group.find(r => r.status === 'active' && (r.totalCuposSold||0) < r.totalTickets);
            const completedOnes = group.filter(r => r !== activeOne && (r.status !== 'active' || (r.totalCuposSold||0) >= r.totalTickets));

            // ¿El user tiene cupo en alguna instancia de esta categoría?
            const userInstanceWithCupo = group.find(r => (r.userTicketNumbers || []).length > 0);
            const userHasInCategory = !!userInstanceWithCupo && userInstanceWithCupo !== activeOne;
            const userOtherInstanceName = userInstanceWithCupo
                ? (userInstanceWithCupo.prizeName + (userInstanceWithCupo.instanceNumber > 1 ? ' #' + userInstanceWithCupo.instanceNumber : ''))
                : null;

            if (activeOne) {
                html += _renderCategoryCard(
                    activeOne,
                    monthlyDeposit,
                    completedOnes.length,
                    group.length,
                    userHasInCategory,
                    userOtherInstanceName
                );
            } else {
                html += '<div style="background:rgba(37,211,102,0.05);border:1px dashed rgba(37,211,102,0.40);border-radius:10px;padding:14px;text-align:center;color:#25d366;font-weight:700;margin-bottom:14px;">✅ Todos los sorteos de esta categoría están completos · esperando draw</div>';
            }
            if (completedOnes.length > 0) {
                html += '<details style="margin-top:-10px;margin-bottom:18px;">';
                html += '  <summary style="cursor:pointer;color:#888;font-size:11px;padding:6px 0;text-transform:uppercase;letter-spacing:1px;">▾ Sorteos completados/sorteados (' + completedOnes.length + ')</summary>';
                html += '  <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">';
                completedOnes.forEach(r => { html += _renderMiniInstance(r); });
                html += '  </div>';
                html += '</details>';
            }
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
        if (!confirm(
            '¿Reclamar el número ' + number + '?\n\n' +
            '🎁 Es GRATIS — ya pagaste apostando este mes.\n' +
            '🎫 Solo 1 número por persona en esta categoría.\n' +
            '🏆 Si la Lotería Nacional NOCTURNA del primer lunes saca tu número, ganás.\n' +
            '🤝 Para retirar el premio tenés que estar EN LA COMUNIDAD (es requisito).\n' +
            '⚠️ Vamos a analizar el juego de cada uno: cargas/retiros sospechosos → cupo bloqueado.'
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
