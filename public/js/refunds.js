// ========================================
// REFUNDS - Reembolsos module
// ========================================

window.VIP = window.VIP || {};

VIP.refunds = (function () {

    // ---- Requisitos para reclamar: PWA instalada + notificaciones permitidas ----
    function isStandalone() {
        try {
            return window.matchMedia('(display-mode: standalone)').matches ||
                   window.navigator.standalone === true;
        } catch (_) { return false; }
    }

    function isNotifGranted() {
        try {
            return ('Notification' in window) && Notification.permission === 'granted';
        } catch (_) { return false; }
    }

    function canClaim() {
        return isStandalone() && isNotifGranted();
    }

    // Estado pendiente: si el user intenta reclamar sin cumplir, recordamos el
    // tipo para retomar automáticamente cuando los requisitos se cumplan.
    let _pendingClaimType = null;

    function refreshRequirementsModal() {
        const installOk = isStandalone();
        const notifOk = isNotifGranted();

        const installBadge = document.getElementById('reqInstallBadge');
        const notifBadge   = document.getElementById('reqNotifBadge');
        const installBtn   = document.getElementById('reqInstallBtn');
        const notifBtn     = document.getElementById('reqNotifBtn');

        if (installBadge) installBadge.textContent = installOk ? '✅' : '⏳';
        if (notifBadge)   notifBadge.textContent   = notifOk ? '✅' : '⏳';

        if (installBtn) {
            installBtn.disabled = installOk;
            installBtn.textContent = installOk ? '✅ App instalada' : '📱 Instalar la app';
            installBtn.style.opacity = installOk ? '0.6' : '1';
        }
        if (notifBtn) {
            notifBtn.disabled = notifOk;
            notifBtn.textContent = notifOk ? '✅ Notificaciones activas' : '🔔 Activar notificaciones';
            notifBtn.style.opacity = notifOk ? '0.6' : '1';
        }

        return installOk && notifOk;
    }

    function openRequirementsModal(claimType) {
        _pendingClaimType = claimType || null;
        refreshRequirementsModal();
        VIP.ui.showModal('refundRequirementsModal');
    }

    async function handleRequirementInstall() {
        try {
            if (VIP.ui && typeof VIP.ui.installApp === 'function') {
                await VIP.ui.installApp();
            } else {
                VIP.ui.showToast('Buscá "Instalar app" en el menú de tu navegador.', 'info');
            }
        } catch (err) {
            console.error('installApp error:', err);
        }
        // Esperar un poco a que el sistema haga el cambio de display-mode
        setTimeout(() => {
            const ready = refreshRequirementsModal();
            if (ready) tryResumePendingClaim();
        }, 800);
    }

    async function handleRequirementNotif() {
        try {
            if (typeof window.enableNotifications === 'function') {
                await window.enableNotifications();
            } else if (VIP.notifications && typeof VIP.notifications.requestNotificationPermission === 'function') {
                VIP.notifications.requestNotificationPermission();
            } else if ('Notification' in window) {
                await Notification.requestPermission();
            }
        } catch (err) {
            console.error('enableNotifications error:', err);
        }
        setTimeout(() => {
            const ready = refreshRequirementsModal();
            if (ready) tryResumePendingClaim();
        }, 600);
    }

    function tryResumePendingClaim() {
        if (!_pendingClaimType) return;
        if (!canClaim()) return;
        const type = _pendingClaimType;
        _pendingClaimType = null;
        VIP.ui.showToast('✅ Listo. Continuamos con tu reembolso…', 'success');
        VIP.ui.hideModal('refundRequirementsModal');
        // Pequeño delay para que el toast sea visible antes de abrir el modal del reembolso.
        setTimeout(() => showRefundModal(type), 250);
    }

    async function loadRefundStatus() {
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/refunds/status`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (response.ok) {
                VIP.state.refundStatus = await response.json();
                updateRefundButtons();
                updateUserBalance();
            }
        } catch (error) {
            console.error('Error cargando reembolsos:', error);
        }
    }

    // Pinta el saldo del usuario en la plataforma JUGAYGANA en el card del home.
    function updateUserBalance() {
        const el = document.getElementById('userBalanceAmount');
        if (!el) return;
        const bal = (VIP.state.refundStatus && VIP.state.refundStatus.user && VIP.state.refundStatus.user.currentBalance) || 0;
        el.textContent = '$' + Number(bal).toLocaleString('es-AR');
    }

    function updateRefundButtons() {
        if (!VIP.state.refundStatus) return;
        updateRefundButton('daily', VIP.state.refundStatus.daily);
        updateRefundButton('weekly', VIP.state.refundStatus.weekly);
        updateRefundButton('monthly', VIP.state.refundStatus.monthly);
    }

    function updateRefundButton(type, data) {
        const btn    = document.getElementById(`${type}RefundBtn`);
        const amount = document.getElementById(`${type}RefundAmount`);
        const timer  = document.getElementById(`${type}RefundTimer`);

        btn.disabled = false;
        btn.classList.remove('claimed');

        // Caso "ya reclamado este período": mostramos el monto reclamado en gris
        // y el countdown al próximo, sin sugerir que se puede volver a reclamar.
        if (data.claimed) {
            const claimedAmt = Number(data.lastClaimAmount || 0);
            amount.textContent = `$${claimedAmt.toLocaleString()}`;
            btn.classList.add('claimed');
            btn.style.opacity = '0.55';
            if (data.nextClaim) {
                startCountdown(type, data.nextClaim);
            } else {
                timer.textContent = '✓ Reclamado';
            }
            return;
        }

        amount.textContent = `$${(data.potentialAmount || 0).toLocaleString()}`;

        if (data.canClaim && data.potentialAmount > 0) {
            timer.textContent = '¡Listo!';
            btn.style.opacity = '1';
        } else {
            btn.style.opacity = '0.7';
            if (data.nextClaim) {
                startCountdown(type, data.nextClaim);
            } else {
                timer.textContent = 'Ver info';
            }
        }
    }

    function startCountdown(type, targetDate) {
        const timerElement = document.getElementById(`${type}RefundTimer`);

        function update() {
            const now    = getArgentinaDate();
            const target = new Date(targetDate);
            const diff   = target - now;

            if (diff <= 0) {
                timerElement.textContent = '¡Listo!';
                loadRefundStatus();
                return;
            }

            const hours   = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

            if (hours > 24) {
                timerElement.textContent = `${Math.floor(hours / 24)}d`;
            } else {
                timerElement.textContent = `${hours}h ${minutes}m`;
            }
        }

        update();
        if (VIP.state.refundTimers[type]) clearInterval(VIP.state.refundTimers[type]);
        VIP.state.refundTimers[type] = setInterval(update, 60000);
    }

    async function showRefundModal(type) {
        console.log('🎁 Abriendo modal de reembolso:', type);

        if (!VIP.state.refundStatus) {
            VIP.ui.showToast('Cargando información de reembolsos...', 'info');
            await loadRefundStatus();
            if (!VIP.state.refundStatus) {
                VIP.ui.showToast('Error: No se pudo cargar la información de reembolsos. Intenta recargar la página.', 'error');
                return;
            }
        }

        const typeData = VIP.state.refundStatus[type];
        const titles = {
            daily:   '📅 Reembolso Diario (8%)',
            weekly:  '📆 Reembolso Semanal (5%)',
            monthly: '🗓️ Reembolso Mensual (3%)'
        };
        const periodLabels = {
            daily:   '📊 PÉRDIDAS DE AYER',
            weekly:  '📊 PÉRDIDAS DE LA SEMANA PASADA (Lun-Dom)',
            monthly: '📊 PÉRDIDAS DEL MES PASADO'
        };

        document.getElementById('refundModalTitle').textContent = titles[type];
        document.getElementById('refundMovementsTitle').textContent = periodLabels[type];

        const currentBalance = VIP.state.refundStatus.user?.currentBalance || 0;
        document.getElementById('refundCurrentBalance').textContent = `$${currentBalance.toLocaleString()}`;
        document.getElementById('refundPeriod').textContent = typeData.period || '-';
        document.getElementById('refundNetAmount').textContent = `$${(typeData.netAmount || 0).toLocaleString()}`;
        document.getElementById('refundAmount').textContent = `$${(typeData.potentialAmount || 0).toLocaleString()}`;
        const depEl = document.getElementById('refundDeposits');
        const witEl = document.getElementById('refundWithdrawals');
        const srcEl = document.getElementById('refundDebugSource');
        if (depEl) depEl.textContent = `$${(typeData.deposits || 0).toLocaleString()}`;
        if (witEl) witEl.textContent = `$${(typeData.withdrawals || 0).toLocaleString()}`;
        if (srcEl) srcEl.textContent = 'Gracias por confiar en nosotros.';

        const availabilityInfo = document.getElementById('refundAvailabilityInfo');
        availabilityInfo.style.display = 'none';
        availabilityInfo.innerHTML = '';

        if (type === 'weekly') {
            const today = new Date().getDay();
            const isClaimableDay = today === 1 || today === 2;
            if (!isClaimableDay) {
                availabilityInfo.style.display = 'block';
                availabilityInfo.style.background = 'rgba(255,165,0,0.1)';
                availabilityInfo.style.border = '1px solid rgba(255,165,0,0.3)';
                availabilityInfo.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 20px;">ℹ️</span>
                        <div>
                            <p style="color: #ffa500; font-weight: bold; margin: 0; font-size: 12px;">Reembolso Semanal</p>
                            <p style="color: #ccc; margin: 0; font-size: 11px;">Solo reclamable los días <strong>LUNES y MARTES</strong></p>
                            <p style="color: #aaa; margin: 0; font-size: 10px;">Corresponde a la semana anterior (Lunes a Domingo)</p>
                        </div>
                    </div>
                `;
            }
        } else if (type === 'monthly') {
            const today = new Date().getDate();
            const isClaimableDay = today >= 7 && today <= 15;
            if (!isClaimableDay) {
                availabilityInfo.style.display = 'block';
                availabilityInfo.style.background = 'rgba(255,165,0,0.1)';
                availabilityInfo.style.border = '1px solid rgba(255,165,0,0.3)';
                availabilityInfo.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 20px;">ℹ️</span>
                        <div>
                            <p style="color: #ffa500; font-weight: bold; margin: 0; font-size: 12px;">Reembolso Mensual</p>
                            <p style="color: #ccc; margin: 0; font-size: 11px;">Solo reclamable entre los <strong>días 7 y 15</strong> de cada mes</p>
                            <p style="color: #aaa; margin: 0; font-size: 10px;">Corresponde al mes anterior completo</p>
                        </div>
                    </div>
                `;
            }
        }

        const extraInfo = document.getElementById('refundExtraInfo');
        const claimBtn  = document.getElementById('claimRefundBtn');
        // El backend ahora devuelve `claimed` y `nextClaim` ya calculados en
        // TZ Argentina, así que no recalculamos en el front (evita drift por
        // desfase horario y bugs como dejar reclamar cuando ya se reclamó).
        const isClaimed = !!typeData.claimed;
        let timeRemaining = '';
        if (isClaimed && typeData.nextClaim) {
            const diff = new Date(typeData.nextClaim) - new Date();
            if (diff > 0) {
                const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                timeRemaining = days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins}m`;
            }
        }

        if (isClaimed) {
            const claimedAmt = Number(typeData.lastClaimAmount || 0);
            extraInfo.innerHTML = `<span style="color: #ffaa44;">✓ Ya reclamaste <strong>$${claimedAmt.toLocaleString()}</strong> en este período. Disponible en: <strong>${timeRemaining || 'pronto'}</strong></span>`;
            claimBtn.disabled = true;
            claimBtn.textContent = timeRemaining ? `✓ Reclamado — disponible en ${timeRemaining}` : '✓ Reclamado';
            claimBtn.style.background = 'linear-gradient(135deg, #666 0%, #444 100%)';
            claimBtn.onclick = null;
        } else if (typeData.potentialAmount <= 0) {
            extraInfo.innerHTML = '<span style="color: #ff8888;">⚠️ No tienes saldo neto positivo para reclamar reembolso</span>';
            claimBtn.disabled = true;
            claimBtn.textContent = '❌ Sin saldo para reembolso';
            claimBtn.style.background = 'linear-gradient(135deg, #666 0%, #444 100%)';
            claimBtn.onclick = null;
        } else if (!typeData.canClaim) {
            extraInfo.innerHTML = '<span style="color: #ffaa44;">⏳ No puedes reclamar este reembolso en este momento.</span>';
            claimBtn.disabled = true;
            claimBtn.textContent = '⏳ No disponible';
            claimBtn.style.background = 'linear-gradient(135deg, #666 0%, #444 100%)';
            claimBtn.onclick = null;
        } else if (!canClaim()) {
            // Reclamable en tiempo, pero sin app instalada o sin notificaciones.
            // Mostramos el bloque embebido de "Condición para reclamar" + el
            // botón principal cambia a "Activar para reclamar".
            extraInfo.innerHTML = '';
            claimBtn.disabled = false;
            claimBtn.textContent = '🔒 Activar para reclamar';
            claimBtn.style.background = 'linear-gradient(135deg, #6a0dad 0%, #9d4edd 100%)';
            claimBtn.onclick = () => {
                // Reintentar canClaim por si el user activó algo desde los
                // botones embebidos mientras tenía el modal abierto.
                if (canClaim()) return claimRefund(type);
                VIP.ui.hideModal('refundModal');
                openRequirementsModal(type);
            };
        } else {
            extraInfo.innerHTML = '<span style="color: #00ff88;">✅ ¡Puedes reclamar este reembolso!</span>';
            claimBtn.disabled = false;
            claimBtn.textContent = '🎁 Reclamar Reembolso';
            claimBtn.style.background = '';
            claimBtn.onclick = () => claimRefund(type);
        }

        // Render del bloque de requisitos embebido en el detalle.
        renderRefundRequirementsBlock(type);

        VIP.ui.showModal('refundModal');
    }

    // Pinta el bloque de requisitos dentro del refundModal según el estado actual.
    // Si el user ya cumple ambas condiciones, se oculta.
    function renderRefundRequirementsBlock(claimType) {
        const block = document.getElementById('refundRequirementsBlock');
        if (!block) return;
        if (canClaim()) {
            block.style.display = 'none';
            return;
        }
        block.style.display = 'block';

        const installOk = isStandalone();
        const notifOk = isNotifGranted();

        const installBadge = document.getElementById('refundReqInstallBadge');
        const notifBadge   = document.getElementById('refundReqNotifBadge');
        const installBtn   = document.getElementById('refundReqInstallBtn');
        const notifBtn     = document.getElementById('refundReqNotifBtn');

        if (installBadge) installBadge.textContent = installOk ? '✅' : '⏳';
        if (notifBadge)   notifBadge.textContent   = notifOk ? '✅' : '⏳';

        if (installBtn) {
            installBtn.disabled = installOk;
            installBtn.textContent = installOk ? '✅ App instalada' : '📱 Instalar la app';
            installBtn.style.opacity = installOk ? '0.6' : '1';
            installBtn.onclick = async () => {
                _pendingClaimType = claimType || null;
                await handleRequirementInstall();
                renderRefundRequirementsBlock(claimType);
                refreshClaimButtonState(claimType);
            };
        }
        if (notifBtn) {
            notifBtn.disabled = notifOk;
            notifBtn.textContent = notifOk ? '✅ Notificaciones activas' : '🔔 Activar notificaciones';
            notifBtn.style.opacity = notifOk ? '0.6' : '1';
            notifBtn.onclick = async () => {
                _pendingClaimType = claimType || null;
                await handleRequirementNotif();
                renderRefundRequirementsBlock(claimType);
                refreshClaimButtonState(claimType);
            };
        }
    }

    // Refresca el botón "Reclamar" del refundModal cuando cambia el estado.
    function refreshClaimButtonState(claimType) {
        const claimBtn = document.getElementById('claimRefundBtn');
        if (!claimBtn) return;
        if (canClaim()) {
            claimBtn.textContent = '🎁 Reclamar Reembolso';
            claimBtn.style.background = '';
            claimBtn.onclick = () => claimRefund(claimType);
            VIP.ui.showToast('✅ Listo, ya podés reclamar', 'success');
        }
    }

    async function claimRefund(type) {
        // Guardia de requisitos: app instalada + notificaciones activas.
        if (!canClaim()) {
            VIP.ui.hideModal('refundModal');
            openRequirementsModal(type);
            return;
        }
        const claimBtn = document.getElementById('claimRefundBtn');
        if (claimBtn) {
            if (claimBtn.disabled) return;
            claimBtn.disabled = true;
            claimBtn.textContent = '⏳ Procesando...';
        }
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/refunds/claim/${type}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });

            const data = await response.json();

            if (data.success) {
                VIP.ui.showToast(`✅ ${data.message}`, 'success');
                VIP.ui.hideModal('refundModal');
                loadRefundStatus();
                try { VIP.chat && VIP.chat.sendSystemMessage && VIP.chat.sendSystemMessage(`🎁 Reembolso ${type} reclamado: $${data.amount.toLocaleString()}`); } catch (_) { /* refunds-only: chat may be hidden */ }
            } else {
                VIP.ui.showToast(`ℹ️ ${data.message}`, 'info');
                VIP.ui.hideModal('refundModal');
                loadRefundStatus();
            }
        } catch (error) {
            VIP.ui.showToast('Error de conexión', 'error');
        } finally {
            if (claimBtn) {
                claimBtn.disabled = false;
                claimBtn.textContent = '🎁 Reclamar Reembolso';
            }
        }
    }

    async function showUnifiedRefundModal() {
        // Req 3: Precargar el estado de reembolsos ANTES de mostrar el modal unificado,
        // para que al presionar una opción funcione de inmediato sin depender de cargas previas.
        if (!VIP.state.refundStatus) {
            await loadRefundStatus();
        }
        VIP.ui.showModal('unifiedRefundModal');
    }

    // Botón "🎰 Abrir plataforma" del card de saldo: mismo tab/ventana
    // (window.location.href en vez de window.open con _blank). En PWA
    // standalone esto mantiene la app activa en lugar de abrir el browser.
    function wireGoToPlatform() {
        const btn = document.getElementById('goToPlatformBtn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            window.location.href = 'https://www.jugaygana44.bet';
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireGoToPlatform);
    } else {
        wireGoToPlatform();
    }

    // Wire-up de los botones del modal de requisitos (después de DOM ready).
    function wireRequirementsModal() {
        const installBtn = document.getElementById('reqInstallBtn');
        const notifBtn   = document.getElementById('reqNotifBtn');
        const retryBtn   = document.getElementById('reqRetryBtn');
        if (installBtn) installBtn.addEventListener('click', handleRequirementInstall);
        if (notifBtn)   notifBtn.addEventListener('click', handleRequirementNotif);
        if (retryBtn)   retryBtn.addEventListener('click', () => {
            const ok = refreshRequirementsModal();
            if (ok) {
                tryResumePendingClaim();
            } else {
                VIP.ui.showToast('Todavía falta algún paso. Revisalos arriba.', 'info');
            }
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireRequirementsModal);
    } else {
        wireRequirementsModal();
    }

    // Si el user instala la app o cambia el permiso de notificaciones mientras
    // algún modal está abierto (ej: vuelve de Settings), refrescamos los badges.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;

        // 1) Modal de requisitos standalone
        const reqModal = document.getElementById('refundRequirementsModal');
        if (reqModal && !reqModal.classList.contains('hidden')) {
            const ok = refreshRequirementsModal();
            if (ok) tryResumePendingClaim();
        }

        // 2) Bloque embebido dentro del refundModal (detalle del reembolso)
        const refundModal = document.getElementById('refundModal');
        if (refundModal && !refundModal.classList.contains('hidden')) {
            renderRefundRequirementsBlock(_pendingClaimType);
            refreshClaimButtonState(_pendingClaimType);
        }
    });

    return {
        loadRefundStatus,
        updateRefundButtons,
        updateRefundButton,
        startCountdown,
        showRefundModal,
        claimRefund,
        showUnifiedRefundModal,
        canClaim,
        openRequirementsModal
    };

})();

// Window aliases
window.showRefundModal = VIP.refunds.showRefundModal;
window.claimRefund     = VIP.refunds.claimRefund;
