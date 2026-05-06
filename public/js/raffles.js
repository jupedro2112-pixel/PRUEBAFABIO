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
    // _data se mantiene entre aperturas: la primera vez que el user abre el
    // modal, hay un fetch (~200-500ms). En las aperturas siguientes mostramos
    // instantaneo lo que tenemos y refresheamos en background. Despues de
    // cerrar y abrir el modal, NO hay flash de "Cargando…".
    let _data = null;
    let _dataFetchedAt = 0;
    const _DATA_FRESHNESS_MS = 30 * 1000; // 30s = render directo, mas viejo refresca y muestra
    let _refreshTimer = null;
    let _buying = false;
    let _claiming = false;
    let _picker = null; // { raffleId, picked: Set<number> }
    let _inflightFetch = null;

    async function _fetchActive() {
        // Coalesce: si ya hay un fetch en vuelo, devolvemos esa promesa para
        // no duplicar trabajo cuando _render se dispara varias veces seguidas.
        if (_inflightFetch) return _inflightFetch;
        _inflightFetch = (async () => {
            try {
                const r = await fetch(`${VIP.config.API_URL}/api/raffles/active`, {
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
                });
                if (!r.ok) return null;
                return await r.json();
            } catch (e) {
                console.error('raffles fetch error:', e);
                return null;
            } finally {
                // Liberamos el slot en el siguiente tick para que callers que
                // esperaban la misma promesa terminen de leerla antes.
                setTimeout(() => { _inflightFetch = null; }, 0);
            }
        })();
        return _inflightFetch;
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

    // "Faltan X días/horas para el sorteo". Si la fecha ya paso, dice
    // "El sorteo es HOY" (lunes mismo) o "Sorteado".
    function _countdownText(drawDateStr) {
        if (!drawDateStr) return 'Esperando fecha';
        const ms = new Date(drawDateStr).getTime() - Date.now();
        if (!Number.isFinite(ms)) return 'Esperando fecha';
        if (ms <= 0) return 'Sorteándose ahora · revisá en un rato';
        const days = Math.floor(ms / (24 * 3600 * 1000));
        const hours = Math.floor((ms % (24 * 3600 * 1000)) / (3600 * 1000));
        if (days >= 1) return 'Faltan ' + days + (days === 1 ? ' día' : ' días') + (hours > 0 ? ' y ' + hours + 'h' : '');
        if (hours >= 1) return 'Faltan ' + hours + 'h';
        const mins = Math.max(1, Math.floor(ms / 60000));
        return 'Faltan ' + mins + ' min';
    }

    // Bloque "PENDIENTE de sorteo" para sorteos cerrados (cupo lleno).
    // Mas visible que el aviso chiquito anterior — la gente ve que ya
    // estan en carrera y cuando se sortea.
    function _renderPendingBlock(r, accentColor, totalParticipantsLabel) {
        const drawStr = r.drawDate
            ? new Date(r.drawDate).toLocaleString('es-AR', { weekday:'long', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
            : '—';
        const countdown = _countdownText(r.drawDate);
        let html = '';
        html += '<div style="background:linear-gradient(135deg,rgba(255,170,102,0.10),rgba(255,170,102,0.04));border:2px solid #ffaa66;border-radius:10px;padding:12px;text-align:center;">';
        html += '  <div style="display:inline-block;background:#ffaa66;color:#000;font-weight:900;font-size:10px;letter-spacing:2px;padding:3px 10px;border-radius:12px;margin-bottom:6px;">⏳ COMPLETADO · PENDIENTE</div>';
        html += '  <div style="color:#fff;font-size:13px;font-weight:800;line-height:1.4;margin-bottom:4px;">Cupo lleno. Estás en carrera 🎯</div>';
        html += '  <div style="color:#ffaa66;font-size:12px;font-weight:800;letter-spacing:0.5px;margin-bottom:6px;">' + countdown + '</div>';
        html += '  <div style="color:#ddd;font-size:11px;line-height:1.5;">📅 ' + drawStr + '<br>1° premio Lotería Nocturna' + (totalParticipantsLabel ? ' · ' + totalParticipantsLabel : '') + '</div>';
        html += '</div>';
        return html;
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
                html += '<button type="button" data-raffle-action="claim" data-raffle-id="' + _esc(c.id) + '" style="width:100%;background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:13px;border-radius:10px;font-weight:900;font-size:15px;cursor:pointer;letter-spacing:1px;box-shadow:0 4px 10px rgba(255,215,0,0.30);">🎁 RECLAMAR $' + _fmt(c.prizeValueARS) + '</button>';
                html += '<div style="color:#ffe699;font-size:10px;text-align:center;margin-top:6px;">⚠️ La acreditación automática falló — tocá el botón para acreditar manualmente.</div>';
            } else {
                html += '<div style="background:rgba(255,170,102,0.15);border:1px solid rgba(255,170,102,0.40);border-radius:8px;padding:10px;text-align:center;">';
                html += '<div style="color:#ffaa66;font-size:12px;font-weight:700;">⏳ Estamos acreditando tu premio…</div>';
                html += '</div>';
            }
            // Countdown: si ya cobro, ventana de 30 min con timer en mm:ss.
            // Si no cobro, sigue mostrando ~Xh restantes como antes.
            if (credited && typeof c.secondsRemaining === 'number' && c.secondsRemaining > 0) {
                const expiresAt = new Date(Date.now() + c.secondsRemaining * 1000).getTime();
                html += '<div data-claim-countdown="' + expiresAt + '" style="color:#ffe699;font-size:11px;text-align:center;margin-top:8px;font-weight:700;">⏱ Esta felicitación queda <span class="claim-countdown-text">30:00</span> más</div>';
            } else if (c.hoursRemaining > 0) {
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
            html += '<button type="button" data-raffle-action="claim" data-raffle-id="' + _esc(c.id) + '" style="width:100%;background:#ffd700;color:#000;border:none;padding:11px;border-radius:8px;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:1px;">🎁 RECLAMAR $' + _fmt(c.prizeValueARS) + '</button>';
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
            const myCount = myNums.length;
            const partLabel = myCount > 0 ? 'Tenés ' + myCount + (myCount === 1 ? ' número en juego' : ' números en juego') : (sold + ' jugadores anotados');
            html += _renderPendingBlock(r, '#ffaa66', partLabel);
        } else {
            html += '<div style="background:rgba(212,175,55,0.05);border:1px dashed rgba(212,175,55,0.30);border-radius:6px;padding:8px;margin:6px 0 8px;font-size:11px;color:#ddd;line-height:1.5;">';
            html += '💡 <strong style="color:#ffd700;">Tip:</strong> tocá <strong>"Elegir números"</strong> y elegí los que quieras del 1 al 100. Si no querés elegir, podés pedir aleatorio. Hasta 50 números por compra.';
            html += '</div>';
            html += '<button type="button" data-raffle-action="open-picker" data-raffle-id="' + _esc(r.id) + '" ' + (canAfford ? '' : 'disabled') + ' style="width:100%;background:' + (canAfford ? 'linear-gradient(135deg,#d4af37,#f7931e)' : 'rgba(120,120,120,0.40)') + ';color:#000;border:none;padding:11px;border-radius:8px;font-weight:900;font-size:13px;cursor:' + (canAfford ? 'pointer' : 'not-allowed') + ';letter-spacing:0.5px;">' + (canAfford ? '🎫 ELEGIR NÚMEROS' : '🔒 SIN SALDO ($' + _fmt(r.entryCost) + ' por número)') + '</button>';
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

        // Caja "estas anotado" cuando aplica (independiente del estado del sorteo).
        if (enrolled) {
            html += '<div style="background:rgba(77,171,255,0.15);border:1px solid #4dabff;border-radius:8px;padding:10px;text-align:center;margin-bottom:8px;">';
            html += '<div style="color:#4dabff;font-size:11px;font-weight:800;letter-spacing:1px;margin-bottom:4px;">✅ ESTÁS ANOTADO</div>';
            html += '<div style="color:#fff;font-size:18px;font-weight:900;">Número <strong>#' + myNums[0] + '</strong></div>';
            html += '</div>';
        }

        if (drawn) {
            html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;font-size:12px;color:#aaa;">🎲 Sorteado · ganó @' + _esc(r.winnerUsername || '') + ' con #' + r.winningTicketNumber + '</div>';
        } else if (closed) {
            const partLabel = enrolled ? 'Tu #' + myNums[0] + ' está en carrera' : (sold + ' personas en carrera');
            html += _renderPendingBlock(r, '#4dabff', partLabel);
        } else if (!enrolled) {
            // El boton "ELEGIR" se muestra SIEMPRE — el server valida el
            // threshold de cargas en /buy y rechaza con un error claro si
            // el user no llego. Antes el front gateaba el boton, lo que
            // confundia a los users que pensaban "no me deja elegir el
            // numero" cuando en realidad les faltaban cargas. Mostrar el
            // boton + aviso lateral es mas transparente.
            const wd = (_data && Number(_data.weeklyDeposits)) || 0;
            const threshold = r.minCargasARS || 0;
            const reached = threshold > 0 ? wd >= threshold : true;
            const shortfall = Math.max(0, threshold - wd);
            if (reached) {
                html += '<div style="background:rgba(102,255,102,0.08);border:1px dashed rgba(102,255,102,0.40);border-radius:6px;padding:8px;margin:6px 0 8px;font-size:11px;color:#ddd;line-height:1.5;">';
                html += '✅ <strong style="color:#66ff66;">¡Calificás!</strong> Llegaste al mínimo de cargas. Tocá <strong>"Elegir mi número"</strong> y reservá tu cupo (1 por persona).';
                html += '</div>';
            } else {
                html += '<div style="background:rgba(255,170,102,0.10);border:1px solid rgba(255,170,102,0.30);border-radius:6px;padding:8px;margin:6px 0 8px;font-size:11px;color:#ffaa66;line-height:1.5;">';
                html += '⚠️ <strong>Te faltan $' + _fmt(shortfall) + '</strong> de cargas esta semana (lun-dom).<br>';
                html += '<span style="color:#ddd;">Llevás <strong style="color:#fff;">$' + _fmt(wd) + '</strong> de $' + _fmt(threshold) + '. Podés intentar elegir, pero el sistema rechaza si no llegaste.</span>';
                html += '</div>';
            }
            const ctaBg = reached
                ? 'linear-gradient(135deg,#66ff66,#4dabff)'
                : 'linear-gradient(135deg,#888,#aaa)';
            html += '<button type="button" data-raffle-action="open-picker" data-raffle-id="' + _esc(r.id) + '" style="width:100%;background:' + ctaBg + ';color:#000;border:none;padding:11px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;letter-spacing:0.5px;">🎁 ELEGIR MI NÚMERO (GRATIS)</button>';
        }

        html += '</div>';
        return html;
    }

    // Renderiza el bloque "SORTEADOS RECIENTES" arriba del modal. Por
    // defecto muestra los 2 mas recientes y un boton "Ver todos (N)" que
    // expande el resto. Estado expandido vive en _drawnExpanded.
    let _drawnExpanded = false;
    function _renderDrawnSummary(drawnList) {
        const totalCount = drawnList.length;
        const visibleN = _drawnExpanded ? totalCount : Math.min(2, totalCount);
        const visible = drawnList.slice(0, visibleN);
        const hidden = totalCount - visibleN;
        const myWins = drawnList.filter(r => r.iAmWinner).length;

        let html = '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:10px 12px;margin-bottom:14px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<div style="color:#aaa;font-size:10.5px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">🎲 Sorteados recientes' + (myWins > 0 ? ' · <span style="color:#66ff66;">' + myWins + ' ganaste</span>' : '') + '</div>';
        html += '<div style="color:#666;font-size:10px;">' + totalCount + ' sorteo' + (totalCount === 1 ? '' : 's') + '</div>';
        html += '</div>';
        for (const r of visible) html += _renderDrawnLine(r);
        if (hidden > 0) {
            html += '<button type="button" data-raffle-action="toggle-drawn" style="width:100%;background:rgba(0,212,255,0.08);color:#00d4ff;border:1px dashed rgba(0,212,255,0.40);padding:7px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer;margin-top:4px;">▼ Ver todos (' + hidden + ' más)</button>';
        } else if (_drawnExpanded && totalCount > 2) {
            html += '<button type="button" data-raffle-action="toggle-drawn" style="width:100%;background:rgba(255,255,255,0.04);color:#aaa;border:1px dashed rgba(255,255,255,0.20);padding:7px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer;margin-top:4px;">▲ Mostrar solo los más recientes</button>';
        }
        html += '</div>';
        return html;
    }

    // Linea compacta para sorteos ya sorteados ('drawn'). Antes ocupaban
    // una card entera al lado de los activos y se mezclaban; ahora van
    // al final del modal en una sola linea ("ganaste/cerrado") para no
    // robar atencion a los sorteos vivos.
    function _renderDrawnLine(r) {
        const youWon = !!r.iAmWinner;
        const credited = !!r.prizeClaimedAt;
        const claimable = !!r.prizeClaimable;
        const accent = youWon ? '#66ff66' : '#888';
        const bg = youWon ? 'rgba(102,255,102,0.08)' : 'rgba(255,255,255,0.03)';
        let right;
        if (youWon && claimable && !credited) {
            right = '<button type="button" data-raffle-action="claim" data-raffle-id="' + _esc(r.id) + '" style="background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:5px 10px;border-radius:6px;font-weight:900;font-size:11px;cursor:pointer;letter-spacing:0.5px;">🎁 RECLAMAR $' + _fmt(r.prizeValueARS) + '</button>';
        } else if (youWon && credited) {
            right = '<span style="color:#66ff66;font-size:11px;font-weight:800;">✅ Acreditado</span>';
        } else if (youWon) {
            right = '<span style="color:#ffaa66;font-size:11px;font-weight:800;">⏳ Acreditando…</span>';
        } else {
            right = '<span style="color:#aaa;font-size:11px;">@' + _esc(r.winnerUsername || '—') + '</span>';
        }
        const label = youWon ? '🏆 GANASTE' : 'Cerrado';
        return '<div style="background:' + bg + ';border:1px solid ' + accent + ';border-radius:8px;padding:7px 10px;margin-bottom:6px;display:flex;align-items:center;gap:8px;font-size:12px;">' +
            '<span style="font-size:14px;flex-shrink:0;">' + (r.emoji || '🎁') + '</span>' +
            '<span style="color:' + accent + ';font-weight:900;letter-spacing:0.5px;flex-shrink:0;">' + label + '</span>' +
            '<span style="color:#fff;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.name) + ' · #' + r.winningTicketNumber + '</span>' +
            right +
            '</div>';
    }

    // Hero card del RELAMPAGO. Va arriba de todo con gradiente electrico
    // y mensaje "ENTRA Y MIRÁ". Si el user ya esta inscripto, muestra su
    // numero asignado en lugar del CTA.
    function _renderLightningHero(r, balance) {
        const sold = r.cuposSold || 0;
        const total = r.totalTickets || 0;
        const fillPct = total ? Math.round((sold / total) * 100) : 0;
        const myNums = r.myTicketNumbers || [];
        const enrolled = myNums.length > 0;
        const closed = r.status !== 'active';
        const drawn = r.status === 'drawn';
        const entryCost = Number(r.entryCost) || 0;
        const isPaid = entryCost > 0;
        const canAfford = !isPaid || (Number(balance) || 0) >= entryCost;

        let html = '<div style="background:linear-gradient(135deg,#001a40 0%,#003f7a 35%,#ffeb3b 100%);background-size:200% 200%;border:3px solid #ffeb3b;border-radius:18px;padding:18px 16px;margin-bottom:18px;box-shadow:0 0 30px rgba(255,235,59,0.40),0 4px 24px rgba(0,150,255,0.30);position:relative;overflow:hidden;">';
        html += '<div style="position:absolute;top:-15px;right:-15px;font-size:120px;opacity:0.10;line-height:1;">⚡</div>';
        const exclusive = !!r.requiresPaidTicket;
        const minCharges = Number(r.requiresMinChargesLastWeek) || 0;
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">';
        html += '<span style="background:#ffeb3b;color:#001a40;padding:3px 9px;border-radius:6px;font-size:10px;font-weight:900;letter-spacing:2px;">⚡ RELÁMPAGO' + (isPaid ? ' PAGO' : '') + '</span>';
        html += '<span style="color:#fff;font-size:10px;font-weight:800;letter-spacing:1px;">' + (isPaid ? '$' + _fmt(entryCost) + ' POR NÚMERO · 1 POR PERSONA' : 'GRATIS · 1 POR PERSONA') + '</span>';
        if (exclusive) {
            html += '<span style="background:rgba(255,107,107,0.30);color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:900;letter-spacing:1px;border:1px solid #ff8080;">SOLO CON PAGO PREVIO</span>';
        }
        if (minCharges > 0) {
            html += '<span style="background:rgba(102,255,102,0.20);color:#aaffaa;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:900;letter-spacing:1px;border:1px solid #66ff66;">' + minCharges + '+ CARGAS ÚLT. SEMANA</span>';
        }
        html += '</div>';
        html += '<div style="color:#fff;font-size:24px;font-weight:900;line-height:1.1;text-shadow:0 2px 6px rgba(0,0,0,0.50);margin-bottom:8px;">Premio $' + _fmt(r.prizeValueARS) + '</div>';
        let subtext;
        if (minCharges > 0) {
            subtext = '🎯 Exclusivo para jugadores con <strong>' + minCharges + '+ cargas reales</strong> en los últimos 7 días · ' + total + ' lugares';
        } else if (exclusive) {
            subtext = '🎫 Exclusivo para clientes con al menos 1 número en sorteos pagos · ' + total + ' lugares';
        } else {
            subtext = '¡Entrá y mirá! Inscripción gratuita · 1 cupo por persona · ' + total + ' lugares';
        }
        html += '<div style="color:#fff;font-size:12.5px;line-height:1.4;margin-bottom:10px;font-weight:600;">' + subtext + '</div>';

        // Barra de progreso
        html += '<div style="height:10px;background:rgba(0,0,0,0.40);border-radius:5px;overflow:hidden;margin:8px 0 4px;">';
        html += '<div style="height:100%;width:' + fillPct + '%;background:linear-gradient(90deg,#ffeb3b,#fff);box-shadow:0 0 10px rgba(255,235,59,0.80);"></div></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#fff;margin-bottom:10px;font-weight:700;">';
        html += '<span>' + sold + '/' + total + ' anotados (' + fillPct + '%)</span>';
        html += '<span>Sorteo el lunes</span></div>';

        if (drawn) {
            const youWon = !!r.iAmWinner;
            html += '<div style="background:rgba(0,0,0,0.45);border-radius:10px;padding:10px;font-size:12px;color:#fff;text-align:center;font-weight:700;">' +
                (youWon ? '🏆 ¡GANASTE EL RELÁMPAGO! Número #' + r.winningTicketNumber : '🎲 Sorteado · ganó @' + _esc(r.winnerUsername || '') + ' con #' + r.winningTicketNumber) +
                '</div>';
        } else if (enrolled) {
            html += '<div style="background:rgba(255,235,59,0.20);border:2px solid #ffeb3b;border-radius:10px;padding:11px;text-align:center;">';
            html += '<div style="color:#ffeb3b;font-size:11px;font-weight:900;letter-spacing:1.5px;margin-bottom:3px;">✅ ESTÁS ANOTADO</div>';
            html += '<div style="color:#fff;font-size:22px;font-weight:900;text-shadow:0 1px 2px rgba(0,0,0,0.60);">Número #' + myNums[0] + '</div>';
            html += '</div>';
        } else if (closed) {
            // Cupo lleno: aviso + upsell (proximo gratis requiere haber
            // jugado paid). Es la idea del owner: convertir el relampago
            // en gancho hacia los sorteos pagos.
            html += '<div style="background:rgba(0,0,0,0.45);border-radius:10px;padding:11px;text-align:center;">';
            html += '<div style="color:#fff;font-size:14px;font-weight:900;margin-bottom:6px;">⏳ SORTEO LLENO · esperá el próximo</div>';
            html += '<div style="color:#ffeb3b;font-size:11.5px;font-weight:700;line-height:1.45;">Para participar del próximo sorteo <strong>GRATIS</strong> tenés que tener al menos <strong>1 número en algún sorteo pago</strong>.</div>';
            html += '</div>';
        } else if (isPaid && !canAfford) {
            // Relampago PAGO sin saldo: redirige a WhatsApp en vez del picker.
            // Asi el user que entra sin plata sale derecho al WP a cargar
            // (en lugar de toparse con un error de "saldo insuficiente"
            // despues de tap el grid).
            html += _renderLightningCargarBtn();
        } else {
            // Boton para abrir el picker. Reutiliza el mismo flujo de buy
            // que los pagos. Para gratis: entryCost=0, salta saldo. Para
            // pago: descuenta saldo en /buy.
            const btnLabel = isPaid
                ? '⚡ ELEGIR MI NÚMERO ($' + _fmt(entryCost) + ')'
                : '⚡ ELEGIR MI NÚMERO GRATIS';
            html += '<button type="button" data-raffle-action="open-picker" data-raffle-id="' + _esc(r.id) + '" style="width:100%;background:linear-gradient(135deg,#ffeb3b,#ffd700);color:#001a40;border:none;padding:14px;border-radius:10px;font-weight:900;font-size:15px;cursor:pointer;letter-spacing:1.5px;text-shadow:none;box-shadow:0 4px 12px rgba(255,235,59,0.40);">' + btnLabel + '</button>';
        }
        html += '</div>';
        return html;
    }

    // Boton verde "QUIERO CARGAR" que abre WhatsApp. Reusa la linea principal
    // del user (VIP.state.linePhone) — si no hay, fallback al wa.link de
    // soporte. Mismo estilo que el QUIERO CARGAR del home (auth.js) para
    // consistencia visual y para que el user lo identifique al toque.
    function _renderLightningCargarBtn() {
        const linePhone = (VIP && VIP.state && VIP.state.linePhone) || '';
        const waNum = String(linePhone).replace(/[^\d+]/g, '').replace(/^\+/, '');
        const href = waNum ? 'https://wa.me/' + waNum : 'https://wa.link/metawin2026';
        return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" style="display:block;width:100%;background:linear-gradient(135deg,#0f4c00,#1a8200);color:#fff;text-decoration:none;text-align:center;border:2px solid #66ff66;padding:13px;border-radius:10px;font-weight:900;font-size:14.5px;letter-spacing:1px;box-shadow:0 4px 12px rgba(102,255,102,0.30);box-sizing:border-box;">' +
            '<div style="font-size:12px;font-weight:700;color:#aaffaa;margin-bottom:3px;">No tenés saldo suficiente</div>' +
            '<div>💬 QUIERO CARGAR</div>' +
        '</a>';
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
        // Separamos sorteados vs activos/cerrados-en-espera. Los drawn van al
        // final como linea compacta para no opacar los vivos. El relampago va
        // separado en hero arriba de todo.
        const drawn = allRaffles.filter(r => r.status === 'drawn');
        const liveRaffles = allRaffles.filter(r => r.status !== 'drawn');
        const lightning = liveRaffles.find(r => r.raffleType === 'relampago');
        // Tambien mostrar el relampago drawn en el hero (no en la lista de drawn)
        const lightningDrawn = drawn.find(r => r.raffleType === 'relampago');
        const heroLightning = lightning || lightningDrawn || null;
        const otherDrawn = drawn.filter(r => r.raffleType !== 'relampago');
        const paid = liveRaffles.filter(r => !r.isFree && r.raffleType !== 'relampago');
        const free = liveRaffles.filter(r => r.isFree && r.raffleType !== 'relampago');

        let html = '';
        const recentWins = _data.recentWins || [];
        html += _renderRecentWinsBanner(recentWins);
        html += _renderClaimableBanner(_data.claimable || [], recentWins.map(w => w.id));
        html += _renderAutoEnrolledBanner(_data.autoEnrolled || []);

        // === HERO RELAMPAGO === (arriba de todo)
        if (heroLightning) {
            html += _renderLightningHero(heroLightning, balance);
        }

        // === SORTEADOS RECIENTES (compacto, arriba) ===
        // Ordena mas reciente primero. Mostramos los ultimos 2 expandidos y
        // el resto colapsado tras un toggle "Ver todos (N)". Asi le damos
        // visibilidad al historial sin que invada los sorteos vivos.
        if (otherDrawn.length > 0) {
            otherDrawn.sort((a, b) => new Date(b.drawnAt || 0) - new Date(a.drawnAt || 0));
            html += _renderDrawnSummary(otherDrawn);
        }

        // Header con saldo + boton refrescar. El boton es util cuando el
        // user creo cuenta nueva o cargo plata y quiere ver el sorteo
        // actualizado sin esperar el polling de 20s.
        html += '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.25);border-radius:10px;padding:10px 14px;margin-bottom:14px;gap:10px;">';
        html += '<div><div style="color:#aaa;font-size:11px;font-weight:700;letter-spacing:1px;">SALDO DISPONIBLE</div><div style="color:#ffd700;font-size:20px;font-weight:900;">$' + _fmt(balance) + '</div></div>';
        html += '<button type="button" data-raffle-action="refresh" id="rafflesRefreshBtn" style="background:rgba(0,212,255,0.10);color:#00d4ff;border:1px solid rgba(0,212,255,0.40);padding:8px 12px;border-radius:8px;font-weight:800;font-size:11.5px;cursor:pointer;letter-spacing:0.5px;flex-shrink:0;" title="Forzar actualización">🔄 Refrescar</button>';
        html += '</div>';

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
            html += '<strong style="color:#4dabff;">💎 Exclusivo para clientes activos.</strong> Si llegás al mínimo de cargas <strong>de esta semana (lunes a domingo)</strong>, te anotamos <strong>automáticamente</strong>. 1 número por persona, máximo 100 personas por sorteo.';
            html += '</div>';
            for (const r of free) html += _renderFreeCard(r);
        }

        if (paid.length === 0 && free.length === 0 && otherDrawn.length === 0 && !heroLightning) {
            html += '<div style="text-align:center;color:#aaa;padding:30px 0;">No hay sorteos disponibles en este momento.</div>';
        } else if (paid.length === 0 && free.length === 0 && !lightning) {
            // Hay drawn pero no hay activos: mensaje claro de "vuelve pronto"
            html += '<div style="text-align:center;color:#aaa;padding:18px 0;font-size:12px;">Los próximos sorteos arrancan en breve. Volvé en unos minutos 🎲</div>';
        }

        body.innerHTML = html;
    }

    // Listener delegado: en lugar de inline onclick="" (que se rompe cuando
    // el id contiene comillas o caracteres reservados), interceptamos clicks
    // sobre [data-raffle-action] y disparamos la accion correspondiente.
    // Esto se monta UNA sola vez la primera vez que se abre el modal.
    let _delegationMounted = false;
    function _mountDelegation() {
        if (_delegationMounted) return;
        _delegationMounted = true;
        document.body.addEventListener('click', function (ev) {
            const btn = ev.target.closest && ev.target.closest('[data-raffle-action]');
            if (!btn) return;
            if (btn.disabled) return;
            const action = btn.getAttribute('data-raffle-action');
            const id = btn.getAttribute('data-raffle-id') || '';
            if (action === 'open-picker') return openPicker(id);
            if (action === 'close-picker') return closePicker();
            if (action === 'pick-random') return pickRandom();
            if (action === 'clear-pick') return clearPick();
            if (action === 'confirm-buy') return confirmPickerBuy();
            if (action === 'claim') return claimPrize(id);
            if (action === 'toggle-pick') {
                const n = parseInt(btn.getAttribute('data-num'), 10);
                if (Number.isFinite(n)) togglePick(n);
                return;
            }
            if (action === 'close-bought') {
                const m = document.getElementById('rafflesBoughtModal');
                if (m) m.style.display = 'none';
                return;
            }
            if (action === 'toggle-drawn') {
                _drawnExpanded = !_drawnExpanded;
                _render();
                return;
            }
            if (action === 'refresh') {
                // Forzar refetch saltando cualquier cache. Mostramos feedback
                // visual cambiando el texto del boton mientras esta en vuelo.
                const refreshBtn = document.getElementById('rafflesRefreshBtn');
                if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '⏳ Buscando...'; }
                _fetchActive().then(d => {
                    if (d) { _data = d; _dataFetchedAt = Date.now(); _render(); }
                    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Refrescar'; }
                });
                return;
            }
        }, false);
    }

    async function open() {
        const modal = document.getElementById('rafflesModal');
        if (!modal) return;
        _mountDelegation();
        modal.style.display = 'flex';

        // Render INSTANTANEO: si ya tenemos data en cache, la mostramos
        // mientras pedimos la fresca en background. El user no ve flash
        // de "Cargando…" en aperturas posteriores. Tampoco prefetchamos
        // inutilmente si la data es muy reciente.
        const haveCache = !!_data;
        const isFresh = haveCache && (Date.now() - _dataFetchedAt) < _DATA_FRESHNESS_MS;
        _render();

        if (!haveCache) {
            // Primera vez: hacemos fetch y bloqueamos al loader.
            const data = await _fetchActive();
            if (data) { _data = data; _dataFetchedAt = Date.now(); _render(); }
        } else if (!isFresh) {
            // Cache vieja (>30s): refresh en background sin bloquear UI.
            _fetchActive().then(d => {
                if (d && modal.style.display === 'flex') {
                    _data = d;
                    _dataFetchedAt = Date.now();
                    _render();
                }
            });
        }
        // Si isFresh: ya tenemos data nueva, no pedimos nada extra.

        if (_refreshTimer) clearInterval(_refreshTimer);
        // Auto-refresh cada 20s mientras el modal este visible. Antes era
        // 30s pero el dueno noto que a veces los sorteos nuevos tardaban
        // demasiado en aparecer — bajar a 20s mejora la sensacion de
        // "se actualiza solo" sin sumar carga al server (cache 60s).
        _refreshTimer = setInterval(async () => {
            if (modal.style.display !== 'flex') return;
            const d = await _fetchActive();
            if (d) { _data = d; _dataFetchedAt = Date.now(); _render(); }
        }, 20000);
    }

    // Prefetch oportunista: cuando arranca la app y el user esta autenticado,
    // disparamos un fetch tibio en background para que la primera apertura
    // del modal ya tenga data. No bloquea nada, no muestra UI.
    function prefetch() {
        if (_data) return; // ya tenemos
        if (!VIP || !VIP.state || !VIP.state.currentToken) return;
        _fetchActive().then(d => {
            if (d) { _data = d; _dataFetchedAt = Date.now(); }
        });
    }

    function close() {
        const modal = document.getElementById('rafflesModal');
        if (modal) modal.style.display = 'none';
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        // Mantenemos _data en memoria para que la PROXIMA apertura sea
        // instantanea. Solo limpiamos el picker y la cache se mantiene fresca
        // por _DATA_FRESHNESS_MS antes de re-fetch.
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
        const isLightning = r.raffleType === 'relampago';
        // Sorteos gratis (free_p100/p500/p1m/p2m) tambien son 1 cupo max y
        // entryCost=0 — comparten el flow del lightning excepto por el copy.
        const isFreeWeekly = !isLightning && r.isFree;
        const isOneCupo = isLightning || isFreeWeekly;
        const cost = _picker.picked.size * (r.entryCost || 0);

        // RELAMPAGO + FREE usan la MISMA UI que los pagos (mismo color dorado,
        // mismo texto base) pero con costo $0 visible. El dueno quiere que la
        // gente se familiarice con el flujo de "elegir y comprar" gratis antes
        // de animarse a uno pago. La unica diferencia es la nota de
        // "1 numero por persona" abajo.
        let html = '';
        html += '<button type="button" data-raffle-action="close-picker" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#aaa;font-size:24px;cursor:pointer;line-height:1;">✕</button>';
        html += '<h3 style="color:#ffd700;margin:0 0 4px;font-size:18px;">' + (r.emoji || '🎁') + ' ' + _esc(r.name) + '</h3>';
        html += '<div style="color:#aaa;font-size:11px;margin-bottom:8px;">Premio $' + _fmt(r.prizeValueARS) + ' · <strong style="color:' + (isOneCupo ? '#66ff66' : '#ffd700') + ';">$' + _fmt(r.entryCost) + '</strong> por número' + (isOneCupo ? ' · 1 por persona' : '') + '</div>';
        html += '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:8px 10px;font-size:11.5px;color:#ddd;margin-bottom:10px;line-height:1.4;">';
        html += '🎯 Tocá ' + (isOneCupo ? '<strong>el número</strong> que quieras' : 'los números que querés') + ' (<strong style="color:#66ff66;">verde</strong> = libres, <strong style="color:#ff6b6b;">rojo</strong> = tomados, <strong style="color:#ffd700;">dorado</strong> = el que vas a comprar).' + (isOneCupo ? '' : ' Hasta 50 por compra.');
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
            const dataAttrs = (!isTaken && !isMine) ? 'data-raffle-action="toggle-pick" data-num="' + n + '"' : '';
            const tdec = (isTaken || isMine) ? 'text-decoration:line-through;' : '';
            html += '<button type="button" ' + dataAttrs + ' style="background:' + bg + ';color:' + color + ';border:none;padding:6px 0;border-radius:4px;font-size:12px;font-weight:700;cursor:' + cursor + ';' + tdec + '">' + n + '</button>';
        }
        html += '</div>';

        // Resumen + acciones
        const pickedArr = Array.from(_picker.picked).sort((a, b) => a - b);
        html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:10px;margin-bottom:8px;">';
        html += '<div style="color:#aaa;font-size:11px;font-weight:700;margin-bottom:4px;">SELECCIÓN (' + pickedArr.length + ')</div>';
        html += '<div style="color:' + (isOneCupo ? '#ffeb3b' : '#ffd700') + ';font-size:14px;font-weight:900;word-break:break-word;">' + (pickedArr.length ? pickedArr.map(n => '#' + n).join(', ') : '— ninguno —') + '</div>';
        if (!isOneCupo) {
            html += '<div style="color:#fff;font-size:13px;font-weight:700;margin-top:6px;">Total: <strong style="color:#ffd700;">$' + _fmt(cost) + '</strong></div>';
        }
        html += '</div>';

        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        if (!isOneCupo) {
            html += '<button type="button" data-raffle-action="pick-random" style="flex:1;min-width:100px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:10px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">🎲 Aleatorio (5)</button>';
        }
        html += '<button type="button" data-raffle-action="clear-pick" style="background:rgba(255,107,107,0.10);color:#ff6b6b;border:1px solid rgba(255,107,107,0.30);padding:10px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">Limpiar</button>';
        const ctaText = isOneCupo
            ? (isLightning ? '⚡ INSCRIBIRME GRATIS' : '🎁 INSCRIBIRME GRATIS') + (pickedArr.length ? ' (#' + pickedArr[0] + ')' : '')
            : '🎫 COMPRAR ' + pickedArr.length + ' POR $' + _fmt(cost);
        const ctaBg = isOneCupo
            ? (pickedArr.length ? 'linear-gradient(135deg,#ffeb3b,#ffd700)' : 'rgba(120,120,120,0.40)')
            : (pickedArr.length ? 'linear-gradient(135deg,#d4af37,#f7931e)' : 'rgba(120,120,120,0.40)');
        html += '<button type="button" id="raffle_pick_buy" data-raffle-action="confirm-buy" ' + (pickedArr.length === 0 ? 'disabled' : '') + ' style="flex:2;min-width:160px;background:' + ctaBg + ';color:#000;border:none;padding:10px;border-radius:8px;font-weight:900;font-size:13px;cursor:' + (pickedArr.length ? 'pointer' : 'not-allowed') + ';letter-spacing:0.5px;">' + ctaText + '</button>';
        html += '</div>';

        const pickerBody = document.getElementById('rafflesPickerBody');
        if (pickerBody) pickerBody.innerHTML = html;
    }

    function openPicker(raffleId) {
        const r = (_data && _data.raffles || []).find(x => x.id === raffleId);
        if (!r) return;
        // Todos los sorteos usan picker ahora (paid, relampago y free clasicos).
        // El owner pidio que la gente elija su numero en TODOS los sorteos
        // gratis para hacer la UX consistente y mantener el FOMO de ver el
        // cupo llenarse en tiempo real.
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
        const r = (_data && _data.raffles || []).find(x => x.id === _picker.raffleId);
        // Lightning + free clasicos = 1 cupo max. Solo paid permite multi-pick.
        const isOneCupo = r && (r.raffleType === 'relampago' || r.isFree);
        if (_picker.picked.has(n)) _picker.picked.delete(n);
        else {
            if (isOneCupo) {
                // Solo 1 cupo: si toca otro numero, reemplaza la seleccion.
                _picker.picked.clear();
                _picker.picked.add(n);
            } else {
                if (_picker.picked.size >= 50) {
                    VIP.ui.showToast('⚠️ Tope 50 números por compra', 'warning');
                    return;
                }
                _picker.picked.add(n);
            }
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

    // Modal de confirmacion in-page (en lugar de confirm() nativo, que en
    // algunos WebViews / PWAs no se muestra). Devuelve una promesa con true
    // si el user confirma, false si cancela.
    function _showCustomConfirm(html) {
        return new Promise((resolve) => {
            let modal = document.getElementById('rafflesConfirmModal');
            if (modal) modal.remove();
            modal = document.createElement('div');
            modal.id = 'rafflesConfirmModal';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:40000;display:flex;align-items:center;justify-content:center;padding:14px;';
            modal.innerHTML = '<div style="background:linear-gradient(135deg,#1a0033,#2d0052);border:2px solid #d4af37;border-radius:14px;max-width:420px;width:100%;padding:18px 16px;text-align:center;">' + html +
                '<div style="display:flex;gap:8px;margin-top:14px;">' +
                '<button type="button" id="raffleConfirmNo" style="flex:1;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.20);padding:11px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Cancelar</button>' +
                '<button type="button" id="raffleConfirmYes" style="flex:2;background:linear-gradient(135deg,#d4af37,#f7931e);color:#000;border:none;padding:11px;border-radius:8px;font-weight:900;font-size:13px;cursor:pointer;letter-spacing:0.5px;">CONFIRMAR</button>' +
                '</div></div>';
            document.body.appendChild(modal);
            const cleanup = (val) => { try { modal.remove(); } catch (_) {} resolve(val); };
            modal.querySelector('#raffleConfirmYes').onclick = () => cleanup(true);
            modal.querySelector('#raffleConfirmNo').onclick = () => cleanup(false);
            modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
        });
    }

    async function confirmPickerBuy() {
        if (!_picker || _buying) return;
        const arr = Array.from(_picker.picked).sort((a, b) => a - b);
        if (arr.length === 0) return;
        const r = (_data && _data.raffles || []).find(x => x.id === _picker.raffleId);
        if (!r) return;
        const cost = arr.length * (r.entryCost || 0);

        const confirmHtml =
            '<div style="font-size:38px;margin-bottom:6px;">🎫</div>' +
            '<div style="color:#ffd700;font-size:14px;font-weight:900;letter-spacing:1px;margin-bottom:8px;">CONFIRMAR COMPRA</div>' +
            '<div style="color:#fff;font-size:12.5px;line-height:1.6;margin-bottom:8px;">' +
                '<div>' + _esc(r.name) + '</div>' +
                '<div style="color:#d4af37;font-size:13px;font-weight:700;margin-top:4px;">' + arr.length + ' número' + (arr.length > 1 ? 's' : '') + '</div>' +
                '<div style="color:#fff;font-size:11px;margin-top:4px;word-break:break-word;">' + arr.map(n => '#' + n).join(', ') + '</div>' +
            '</div>' +
            '<div style="background:rgba(212,175,55,0.10);border:1px solid rgba(212,175,55,0.30);border-radius:8px;padding:10px;font-size:12px;color:#fff;">' +
                'Se descontarán <strong style="color:#ffd700;font-size:14px;">$' + _fmt(cost) + '</strong> de tu saldo en JUGAYGANA' +
            '</div>';
        const ok = await _showCustomConfirm(confirmHtml);
        if (!ok) return;

        _buying = true;
        const btn = document.getElementById('raffle_pick_buy');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando…'; }
        try {
            const resp = await fetch(`${VIP.config.API_URL}/api/raffles/${_picker.raffleId}/buy`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ pickedNumbers: arr, quantity: arr.length })
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok && data && data.success) {
                _showBoughtModal(data.ticketNumbers || arr, r);
                closePicker();
                const d = await _fetchActive();
                if (d) { _data = d; _render(); }
            } else {
                const msg = (data && data.error) || ('No se pudo comprar (HTTP ' + resp.status + ')');
                if (data && data.takenNumber) {
                    VIP.ui.showToast('⚠️ El número #' + data.takenNumber + ' lo tomó otro. Probá con otro.', 'error');
                    const d = await _fetchActive();
                    if (d) { _data = d; _render(); _renderPicker(); }
                } else if (resp.status === 503 && data.retry) {
                    VIP.ui.showToast('⏳ ' + msg, 'warning');
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
            VIP.ui.showToast('Error de conexión: ' + (e && e.message ? e.message : 'reintentá'), 'error');
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
        const isLightning = raffle && raffle.raffleType === 'relampago';
        const isFreeWeekly = raffle && !isLightning && raffle.isFree;
        const isOneCupo = isLightning || isFreeWeekly;
        if (body) {
            const numStr = arr.length === 1
                ? '<div style="font-size:64px;font-weight:900;color:#ffd700;margin:14px 0;line-height:1;">#' + arr[0] + '</div>'
                : '<div style="font-size:18px;font-weight:900;color:#ffd700;margin:14px 0;word-break:break-word;line-height:1.5;">' + arr.map(n => '#' + n).join(' · ') + '</div>';
            // Para gratis (lightning + free) mostramos un mensaje educativo:
            // "asi de facil es participar — los pagos funcionan igual". El owner
            // quiere usar los gratis como onboarding al sistema de sorteos pagos.
            const headerLabel = isOneCupo ? '¡Inscripción confirmada!' : '¡Compra confirmada!';
            const intro = isOneCupo
                ? 'Tu número en <strong>' + _esc(raffle.name) + '</strong>:'
                : 'Tu/s número/s para <strong>' + _esc(raffle.name) + '</strong>:';
            const tutorialMsg = isOneCupo
                ? '<div style="background:rgba(255,215,0,0.15);border:1px dashed #ffd700;border-radius:10px;padding:11px;margin-bottom:14px;color:#fff;font-size:12.5px;line-height:1.5;">' +
                    '<div style="color:#ffd700;font-weight:900;font-size:13px;margin-bottom:4px;">💡 ¡Así de fácil es participar!</div>' +
                    'Los <strong style="color:#ffd700;">sorteos pagos</strong> funcionan igual: elegís tu número del 1 al 100, lo pagás con tu saldo y si sale, <strong>cobrás el premio en el acto</strong> en tu cuenta.' +
                  '</div>'
                : '<div style="color:#dde9d4;font-size:12px;line-height:1.5;margin-bottom:14px;">Sorteo el lunes en la Lotería Nacional Nocturna. Si tu número gana, te <strong>acreditamos el premio automáticamente</strong> a tu saldo.</div>';
            body.innerHTML = '<div style="font-size:48px;margin-bottom:8px;">' + (isLightning ? '⚡' : (isFreeWeekly ? '🎁' : '🎫')) + '</div>' +
                '<div style="color:#66ff66;font-size:14px;font-weight:900;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">' + headerLabel + '</div>' +
                '<div style="color:#fff;font-size:13px;margin-bottom:6px;">' + intro + '</div>' +
                numStr +
                tutorialMsg +
                '<button type="button" data-raffle-action="close-bought" style="width:100%;background:#ffd700;color:#000;border:none;padding:12px;border-radius:10px;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:1px;">' + (isOneCupo ? '🎫 VER SORTEOS PAGOS' : '¡PERFECTO!') + '</button>';
        }
        modal.style.display = 'flex';
    }

    async function claimPrize(raffleId) {
        if (_claiming) return;
        const ok = await _showCustomConfirm(
            '<div style="font-size:38px;margin-bottom:6px;">🏆</div>' +
            '<div style="color:#ffd700;font-size:14px;font-weight:900;letter-spacing:1px;margin-bottom:8px;">RECLAMAR PREMIO</div>' +
            '<div style="color:#fff;font-size:12.5px;line-height:1.6;">¿Acreditar el premio a tu saldo de JUGAYGANA?</div>'
        );
        if (!ok) return;
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

    // ============================================================
    // Banner de ganador reciente en el home (fuera del modal)
    // ============================================================
    // Pinta en #raffleWinnerHomeBanner el ganador mas reciente de las
    // ultimas 6h. Si el user actual es el ganador, mostramos un banner
    // personalizado de "FELICITACIONES" con CTA para abrir el modal y
    // reclamar (si auto-credit fallo). Si el ganador es otro, mostramos
    // un banner mas chico con "ultimo ganador: @user $X" para social proof.
    async function loadHomeWinnerBanner() {
        const container = document.getElementById('raffleWinnerHomeBanner');
        if (!container) return;
        let winners = [], lightning = null, homeBalance = null;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/raffles/recent-winners?hours=6', {
                headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken }
            });
            if (r.ok) {
                const j = await r.json();
                winners = (j && j.winners) || [];
                lightning = j && j.lightning;
                homeBalance = j && (j.balance != null ? j.balance : null);
            }
        } catch (e) { /* fallback al CTA default */ }

        // Decidimos que mostrar (ordenado por prioridad):
        //   1. Si gane algo en las ultimas 6h -> banner FELICITACIONES
        //   2. Si hay sorteo RELAMPAGO activo -> hero electrico
        //   3. Si gano otra persona en 6h -> banner social proof
        //   4. Default -> CTA verde "SORTEOS SEMANALES PARA CLIENTES Y PAGOS"
        const myWin = winners.find(w => w.isMe);
        let html;
        if (myWin) {
            html = _renderHomeWinnerMine(myWin);
        } else if (lightning) {
            // Si hay relampago activo, mostramos el hero electrico ARRIBA y
            // el CTA verde de sorteos semanales ABAJO. Antes solo se veia el
            // relampago y el user perdia acceso visual a los sorteos pagos /
            // gratis semanales desde el home.
            html = _renderHomeLightningHero(lightning, homeBalance) + _renderHomeDefaultCta();
        } else if (winners.length > 0) {
            html = _renderHomeWinnerOthers(winners[0]);
        } else {
            html = _renderHomeDefaultCta();
        }
        container.innerHTML = html;
        container.style.display = 'block';
    }

    // CTA por defecto cuando no hay ganador reciente ni relampago activo.
    // Mismo gradient verde dorado que el felicitaciones para que sea el
    // foco visual del home. Todo el card es clickeable -> abre el modal.
    function _renderHomeDefaultCta() {
        return '<div onclick="VIP.raffles && VIP.raffles.open()" style="cursor:pointer;background:linear-gradient(135deg,#0f4c00,#1a8200,#ffd700);background-size:200% 200%;border:3px solid #ffd700;border-radius:14px;padding:14px;margin:10px auto;max-width:560px;box-shadow:0 0 24px rgba(255,215,0,0.40);position:relative;overflow:hidden;">' +
            '<div style="position:absolute;top:-12px;right:-12px;font-size:90px;opacity:0.10;">🎁</div>' +
            '<div style="color:#ffd700;font-weight:900;font-size:13px;letter-spacing:2px;text-transform:uppercase;text-shadow:0 1px 2px rgba(0,0,0,0.50);">🎁 SORTEOS SEMANALES PARA CLIENTES Y PAGOS</div>' +
            '<div style="color:#fff;font-size:14px;font-weight:700;margin:4px 0 10px;line-height:1.4;text-shadow:0 1px 2px rgba(0,0,0,0.40);">$2M · $1M · $500k · $100k · ⚡ relámpago gratis</div>' +
            '<div style="background:rgba(255,215,0,0.20);border:2px solid #ffd700;border-radius:10px;padding:11px;text-align:center;color:#fff;font-weight:900;font-size:14px;letter-spacing:1px;text-shadow:0 1px 2px rgba(0,0,0,0.50);">👉 ENTRÁ ACÁ</div>' +
            '</div>';
    }

    // Hero del RELAMPAGO en el HOME (no en el modal). Mas pequenio y
    // clickeable -> abre el modal donde la card grande tiene mas detalle.
    function _renderHomeLightningHero(l, balance) {
        const sold = l.cuposSold || 0;
        const total = l.totalTickets || 0;
        const fillPct = total ? Math.round((sold / total) * 100) : 0;
        const enrolled = l.myTicket != null;
        const entryCost = Number(l.entryCost) || 0;
        const isPaid = entryCost > 0 && !l.isFree;
        const canAfford = !isPaid || (Number(balance) || 0) >= entryCost;
        // Si es PAGO y no alcanza el saldo, el card NO abre el picker:
        // redirige al WhatsApp de carga (igual que el card del modal).
        const linePhone = (VIP && VIP.state && VIP.state.linePhone) || '';
        const waNum = String(linePhone).replace(/[^\d+]/g, '').replace(/^\+/, '');
        const cargarHref = waNum ? 'https://wa.me/' + waNum : 'https://wa.link/metawin2026';
        const showCargar = isPaid && !canAfford && l.status === 'active' && !enrolled;
        // El click abre el picker DIRECTO sobre este sorteo en vez del modal
        // generico (que mostraba todos los demas sorteos y mareaba al user).
        // openAndPickRaffle hace open() para cargar data + openPicker(id) para
        // saltar derecho al grid 1-100. Si esta cerrado/sorteado, solo abre
        // el modal (no hay picker que mostrar).
        const clickAction = showCargar
            ? "window.open(" + JSON.stringify(cargarHref) + ",'_blank')"
            : ((l.status === 'active' && !enrolled)
                ? 'VIP.raffles && VIP.raffles.openAndPickRaffle(' + JSON.stringify(l.id) + ')'
                : 'VIP.raffles && VIP.raffles.open()');
        const badgeTxt = isPaid
            ? ('$' + _fmt(entryCost) + ' POR NÚMERO · MÁXIMO 1 POR PERSONA')
            : 'SIN CARGO · MÁXIMO 1 POR PERSONA';
        const ctaLabel = isPaid
            ? '⚡ ELEGIR MI NÚMERO ($' + _fmt(entryCost) + ')'
            : '⚡ ELEGIR MI NÚMERO GRATIS';
        return '<div onclick="' + clickAction + '" style="cursor:pointer;background:linear-gradient(135deg,#001a40 0%,#003f7a 35%,#ffeb3b 100%);background-size:200% 200%;border:3px solid #ffeb3b;border-radius:14px;padding:14px;margin:10px auto;max-width:560px;box-shadow:0 0 24px rgba(255,235,59,0.50),0 4px 18px rgba(0,150,255,0.30);position:relative;overflow:hidden;">' +
            '<div style="position:absolute;top:-12px;right:-12px;font-size:90px;opacity:0.10;line-height:1;">⚡</div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">' +
                '<span style="background:#ffeb3b;color:#001a40;padding:3px 9px;border-radius:6px;font-size:10px;font-weight:900;letter-spacing:2px;">⚡ RELÁMPAGO' + (isPaid ? ' PAGO' : '') + '</span>' +
                '<span style="color:#fff;font-size:10px;font-weight:800;letter-spacing:1px;">' + badgeTxt + '</span>' +
            '</div>' +
            '<div style="color:#fff;font-size:20px;font-weight:900;line-height:1.1;text-shadow:0 2px 6px rgba(0,0,0,0.50);margin:4px 0 6px;">Premio $' + _fmt(l.prizeValueARS) + '</div>' +
            (enrolled
                ? '<div style="background:rgba(255,235,59,0.20);border:2px solid #ffeb3b;border-radius:8px;padding:8px;text-align:center;color:#fff;font-size:13px;font-weight:900;text-shadow:0 1px 2px rgba(0,0,0,0.60);">✅ Estás anotado · Número #' + l.myTicket + '</div>'
                : (l.status !== 'active'
                    ? '<div style="background:rgba(0,0,0,0.45);border-radius:8px;padding:9px;text-align:center;">' +
                        '<div style="color:#fff;font-size:13px;font-weight:900;margin-bottom:4px;">⏳ SORTEO LLENO</div>' +
                        '<div style="color:#ffeb3b;font-size:10.5px;font-weight:700;line-height:1.4;">Para el próximo: necesitás al menos 1 número en sorteos pagos.</div>' +
                      '</div>'
                    : '<div style="height:8px;background:rgba(0,0,0,0.40);border-radius:4px;overflow:hidden;margin:4px 0;">' +
                        '<div style="height:100%;width:' + fillPct + '%;background:linear-gradient(90deg,#ffeb3b,#fff);box-shadow:0 0 10px rgba(255,235,59,0.80);"></div></div>' +
                      '<div style="display:flex;justify-content:space-between;font-size:11px;color:#fff;font-weight:700;margin-bottom:6px;">' +
                        '<span>' + sold + '/' + total + ' anotados</span>' +
                        '<span>' + (showCargar ? '💬 CARGÁ Y ENTRÁ' : '👉 ENTRÁ Y ELEGÍ TU NÚMERO') + '</span>' +
                      '</div>' +
                      (showCargar
                        ? '<div style="background:linear-gradient(135deg,#0f4c00,#1a8200);color:#fff;border:2px solid #66ff66;border-radius:8px;padding:9px;text-align:center;font-weight:900;font-size:13px;letter-spacing:1px;margin-top:4px;box-shadow:0 2px 8px rgba(102,255,102,0.40);">' +
                            '<div style="font-size:10.5px;color:#aaffaa;font-weight:700;margin-bottom:2px;">No tenés saldo suficiente</div>' +
                            '<div>💬 QUIERO CARGAR</div>' +
                          '</div>'
                        : '<div style="background:#ffeb3b;color:#001a40;border-radius:8px;padding:9px;text-align:center;font-weight:900;font-size:13px;letter-spacing:1px;margin-top:4px;box-shadow:0 2px 8px rgba(255,235,59,0.40);">' + ctaLabel + '</div>')
                  )
            ) +
        '</div>';
    }

    function _renderHomeWinnerMine(w) {
        const credited = !!w.prizeClaimedAt;
        const needsClaim = !credited && w.prizeClaimable;
        const ago = w.minutesAgo < 60 ? (w.minutesAgo + ' min') : (w.hoursAgo + ' h');
        let body;
        if (credited) {
            body = '<div style="background:rgba(102,255,102,0.18);border:1px solid #66ff66;border-radius:8px;padding:8px 10px;font-size:12px;color:#fff;text-align:center;font-weight:800;">✅ Premio acreditado a tu saldo · hace ' + ago + '</div>';
        } else if (needsClaim) {
            body = '<button type="button" onclick="VIP.raffles && VIP.raffles.open()" style="width:100%;background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:11px;border-radius:9px;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:0.5px;box-shadow:0 3px 10px rgba(255,215,0,0.40);">🎁 RECLAMAR $' + _fmt(w.prizeValueARS) + '</button>';
        } else {
            body = '<div style="background:rgba(255,170,102,0.18);border:1px solid rgba(255,170,102,0.50);border-radius:8px;padding:8px 10px;font-size:12px;color:#fff;text-align:center;font-weight:800;">⏳ Estamos acreditando tu premio…</div>';
        }
        // Countdown post-cobro: 30 min con timer mm:ss desde que cobro.
        let timer = '';
        if (credited && typeof w.secondsRemaining === 'number' && w.secondsRemaining > 0) {
            const expiresAt = Date.now() + w.secondsRemaining * 1000;
            timer = '<div data-claim-countdown="' + expiresAt + '" style="color:#fff;font-size:11px;text-align:center;margin-top:8px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.50);">⏱ Esta felicitación queda <span class="claim-countdown-text">30:00</span> más</div>';
        }
        return '<div onclick="VIP.raffles && VIP.raffles.open()" style="cursor:pointer;background:linear-gradient(135deg,#0f4c00,#1a8200,#ffd700);background-size:200% 200%;border:3px solid #ffd700;border-radius:14px;padding:14px;margin:10px auto;max-width:560px;box-shadow:0 0 24px rgba(255,215,0,0.50);position:relative;overflow:hidden;">' +
            '<div style="position:absolute;top:-12px;right:-12px;font-size:90px;opacity:0.10;">🏆</div>' +
            '<div style="color:#ffd700;font-weight:900;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-shadow:0 1px 2px rgba(0,0,0,0.50);">🎉 ¡FELICITACIONES, GANASTE!</div>' +
            '<div style="color:#fff;font-size:18px;font-weight:900;margin:4px 0 8px;">' + (w.emoji || '🏆') + ' ' + _esc(w.name) + ' — $' + _fmt(w.prizeValueARS) + '</div>' +
            body +
            timer +
            '</div>';
    }

    function _renderHomeWinnerOthers(w) {
        const ago = w.minutesAgo < 60 ? (w.minutesAgo + ' min') : (w.hoursAgo + ' h');
        return '<div onclick="VIP.raffles && VIP.raffles.open()" style="cursor:pointer;background:linear-gradient(135deg,#1a0033 0%,#2d0052 50%,#1a0033 100%);border:1px solid #d4af37;border-radius:12px;padding:10px 14px;margin:10px auto;max-width:560px;box-shadow:0 2px 12px rgba(212,175,55,0.20);display:flex;align-items:center;gap:10px;">' +
            '<div style="font-size:28px;flex-shrink:0;">🏆</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="color:#d4af37;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;">Último ganador · hace ' + ago + '</div>' +
                '<div style="color:#fff;font-size:13px;font-weight:800;line-height:1.3;margin-top:2px;"><span style="color:#ffd700;">@' + _esc(w.winnerUsername || '') + '</span> se llevó <span style="color:#66ff66;">$' + _fmt(w.prizeValueARS) + '</span></div>' +
                '<div style="color:#aaa;font-size:10.5px;margin-top:1px;">' + (w.emoji || '🏆') + ' ' + _esc(w.name) + ' · ¡vos podés ser el próximo!</div>' +
            '</div>' +
            '<div style="color:#d4af37;font-size:18px;flex-shrink:0;">›</div>' +
            '</div>';
    }

    // Ticker global que actualiza todos los countdown post-cobro cada segundo.
    // Cada elemento marcado con data-claim-countdown="<expiresAtMs>" muestra
    // mm:ss restantes y se auto-oculta cuando llega a 0 (recargamos el banner
    // para que el server confirme que ya paso). Lo arrancamos una sola vez.
    if (!window.__VIP_CLAIM_TICKER_STARTED) {
        window.__VIP_CLAIM_TICKER_STARTED = true;
        setInterval(function () {
            const els = document.querySelectorAll('[data-claim-countdown]');
            if (els.length === 0) return;
            const now = Date.now();
            let expiredAny = false;
            els.forEach(function (el) {
                const expiresAt = parseInt(el.getAttribute('data-claim-countdown'), 10);
                if (!Number.isFinite(expiresAt)) return;
                const remMs = expiresAt - now;
                const span = el.querySelector('.claim-countdown-text');
                if (!span) return;
                if (remMs <= 0) {
                    span.textContent = '0:00';
                    el.style.opacity = '0.5';
                    expiredAny = true;
                    return;
                }
                const totalSec = Math.floor(remMs / 1000);
                const m = Math.floor(totalSec / 60);
                const s = totalSec % 60;
                span.textContent = m + ':' + (s < 10 ? '0' + s : s);
            });
            // Si algun countdown llego a 0, refrescamos el banner del home
            // (el server ya no lo va a devolver -> desaparece).
            if (expiredAny && VIP.raffles && typeof VIP.raffles.loadHomeWinnerBanner === 'function') {
                VIP.raffles.loadHomeWinnerBanner();
            }
        }, 1000);
    }

    // Helper para el banner del home: abre el modal Y el picker del sorteo
    // especifico en una sola accion. Asi el user que toca el banner del
    // relampago en el home cae directo sobre el grid 1-100 de ese sorteo,
    // sin tener que pasar por el modal generico ni buscarlo.
    async function openAndPickRaffle(raffleId) {
        await open();
        // Verificamos que el sorteo este en _data antes de abrir el picker
        // (el await de open() garantiza que _data este populado en el primer
        // load). Si no esta, fallback al modal generico.
        const r = (_data && _data.raffles || []).find(x => x.id === raffleId);
        if (r && r.status === 'active') {
            openPicker(raffleId);
        }
    }

    return { open, close, prefetch, openPicker, openAndPickRaffle, closePicker, togglePick, pickRandom, clearPick, confirmPickerBuy, claimPrize, loadHomeWinnerBanner };
})();
