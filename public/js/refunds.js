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

    // Solo el reembolso mensual y el bono de bienvenida exigen PWA instalada
    // + notificaciones activas. Daily y weekly se reclaman libremente, aunque
    // seguimos sugiriendo instalar la app y activar notificaciones para que
    // el usuario reciba los avisos de acreditacion.
    function claimRequirementsMet(type) {
        if (type === 'monthly' || type === 'welcome') return canClaim();
        return true;
    }

    // Estado pendiente: si el user intenta reclamar sin cumplir, recordamos el
    // tipo para retomar automáticamente cuando los requisitos se cumplan.
    let _pendingClaimType = null;

    // Detecta si la app ya fue instalada en este navegador. Combina dos señales:
    //  - el flag persistido en localStorage por el handler `appinstalled`,
    //  - el modo standalone actual (caso de instalaciones previas al flag).
    function isAppInstalled() {
        try {
            if (localStorage.getItem('vipAppInstalled') === '1') return true;
        } catch (_) {}
        return isStandalone();
    }

    function refreshRequirementsModal() {
        const inApp = isStandalone();
        const installed = isAppInstalled();
        const notifOk = isNotifGranted();
        const isWelcome = _pendingClaimType === 'welcome';

        const installBadge = document.getElementById('reqInstallBadge');
        const openAppBadge = document.getElementById('reqOpenAppBadge');
        const notifBadge   = document.getElementById('reqNotifBadge');
        const installBtn   = document.getElementById('reqInstallBtn');
        const notifBtn     = document.getElementById('reqNotifBtn');
        const introMsg     = document.getElementById('reqIntroMsg');
        const notifHelp    = document.getElementById('reqNotifHelp');
        const openAppHelp  = document.getElementById('reqOpenAppHelp');
        // Customizacion del titulo del modal segun el origen del trigger.
        const titleEl = document.querySelector('#refundRequirementsModal .modal-header h2');
        if (titleEl) {
            titleEl.textContent = isWelcome
                ? '🎁 Pasos para tu bono de $10.000'
                : '🔒 Para reclamar tu reembolso';
        }

        // 3 estados independientes: instalada, abierta-desde-app, notifs ok.
        if (installBadge) installBadge.textContent = installed ? '✅' : '⏳';
        if (openAppBadge) openAppBadge.textContent = inApp ? '✅' : '⏳';
        if (notifBadge)   notifBadge.textContent   = notifOk ? '✅' : '⏳';

        if (installBtn) {
            installBtn.disabled = installed;
            installBtn.textContent = installed ? '✅ App instalada' : '📱 Instalar la app';
            installBtn.style.opacity = installed ? '0.6' : '1';
        }

        // El paso 3 (notificaciones) solo tiene sentido cuando el user ya
        // esta dentro de la app. Si no, deshabilitamos el boton y avisamos.
        if (notifBtn) {
            const canRequestNotif = inApp && !notifOk;
            notifBtn.disabled = !canRequestNotif;
            if (notifOk) {
                notifBtn.textContent = '✅ Notificaciones activas';
                notifBtn.style.opacity = '0.6';
            } else if (!inApp) {
                notifBtn.textContent = '🔒 Primero abrí la app';
                notifBtn.style.opacity = '0.5';
            } else {
                notifBtn.textContent = '🔔 Activar notificaciones';
                notifBtn.style.opacity = '1';
            }
        }
        if (notifHelp) {
            notifHelp.innerHTML = inApp
                ? 'Cuando el sistema te lo pida, tocá <strong>Permitir</strong>. Sin notificaciones no podemos avisarte cuando tu bono se acredite.'
                : '<strong>Este paso solo se desbloquea desde la app.</strong> Abrí el ícono de la app en tu celular y volvé acá para activarlas.';
        }
        if (openAppHelp) {
            openAppHelp.innerHTML = inApp
                ? '✅ Estás dentro de la app. Andá al paso 3.'
                : 'Una vez instalada, salí del navegador y abrí la app desde el ícono que quedó en tu celular. Después volvé a este botón para completar el último paso.';
        }

        // Mensaje introductorio: cambia segun en que paso esta el user.
        const subjectClaim = isWelcome ? 'tu bono de $10.000' : 'tu reembolso';
        if (introMsg) {
            if (!installed) {
                introMsg.innerHTML = 'Para desbloquear ' + subjectClaim + ' tenés que completar 3 pasos. <strong>Empezá instalando la app.</strong>';
            } else if (!inApp) {
                introMsg.innerHTML = '✅ App instalada. Ahora <strong>abrí la app desde el ícono</strong> de tu celular para continuar.';
            } else if (!notifOk) {
                introMsg.innerHTML = '✅ Estás dentro de la app. Último paso: <strong>activá las notificaciones</strong> para reclamar ' + subjectClaim + '.';
            } else {
                introMsg.innerHTML = '🎉 ¡Listo! Cumpliste todos los pasos. Cerrá este aviso y reclamá ' + subjectClaim + '.';
            }
        }

        // Sincronizar tambien el subtitulo del card del bono de bienvenida
        // (refleja el estado actual de instalacion + notifs).
        try { renderWelcomeBonusCard(); } catch (_) {}

        return inApp && notifOk;
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
        if (!claimRequirementsMet(_pendingClaimType)) return;
        const type = _pendingClaimType;
        _pendingClaimType = null;
        VIP.ui.hideModal('refundRequirementsModal');
        if (type === 'welcome') {
            VIP.ui.showToast('✅ Listo. Reclamando tu bono de bienvenida…', 'success');
            setTimeout(() => claimWelcomeBonus(), 250);
            return;
        }
        VIP.ui.showToast('✅ Listo. Continuamos con tu reembolso…', 'success');
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
        // Cargar estado del bono de bienvenida en paralelo (no bloqueante).
        loadWelcomeBonusStatus();
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
        } else if (!claimRequirementsMet(type)) {
            // Solo aplica al reembolso mensual: si no tiene app instalada o no
            // tiene notificaciones, mostramos el bloque embebido de "Condición
            // para reclamar" + el botón principal cambia a "Activar para reclamar".
            extraInfo.innerHTML = '';
            claimBtn.disabled = false;
            claimBtn.textContent = '🔒 Activar para reclamar';
            claimBtn.style.background = 'linear-gradient(135deg, #6a0dad 0%, #9d4edd 100%)';
            claimBtn.onclick = () => {
                if (claimRequirementsMet(type)) return claimRefund(type);
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
    // Solo se muestra cuando el reembolso es 'monthly' y aun no estan cumplidos
    // los requisitos. Para daily/weekly nunca se muestra (no son obligatorios).
    function renderRefundRequirementsBlock(claimType) {
        const block = document.getElementById('refundRequirementsBlock');
        if (!block) return;
        if (claimType !== 'monthly' || canClaim()) {
            block.style.display = 'none';
            return;
        }
        block.style.display = 'block';

        const inApp = isStandalone();
        const installed = isAppInstalled();
        const notifOk = isNotifGranted();

        const installBadge = document.getElementById('refundReqInstallBadge');
        const notifBadge   = document.getElementById('refundReqNotifBadge');
        const installBtn   = document.getElementById('refundReqInstallBtn');
        const notifBtn     = document.getElementById('refundReqNotifBtn');
        const stepInstall  = document.getElementById('refundReqStepInstall');
        const introMsg     = document.getElementById('refundReqIntroMsg');

        if (installBadge) installBadge.textContent = inApp ? '✅' : '⏳';
        if (notifBadge)   notifBadge.textContent   = notifOk ? '✅' : '⏳';

        if (installBtn) {
            installBtn.disabled = inApp;
            installBtn.textContent = inApp ? '✅ App instalada' : '📱 Instalar la app';
            installBtn.style.opacity = inApp ? '0.6' : '1';
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

        // Mismo criterio que refreshRequirementsModal: si ya esta instalada
        // pero el user esta en navegador, ocultamos el paso 1 y reescribimos
        // el mensaje superior.
        if (installed && !inApp) {
            if (stepInstall) stepInstall.style.display = 'none';
            if (introMsg) {
                introMsg.innerHTML = '<strong>Ingresá desde la aplicación</strong> para reclamar tu reembolso. No olvides <strong>activar las notificaciones</strong> para que se active la opción de reclamar.';
            }
        } else {
            if (stepInstall) stepInstall.style.display = '';
            if (introMsg) {
                introMsg.innerHTML = 'Para reclamar este reembolso necesitás <strong>instalar la app</strong> y <strong>activar las notificaciones</strong>. Cuando completes los dos pasos vas a poder reclamarlo sin problemas.';
            }
        }
    }

    // Refresca el botón "Reclamar" del refundModal cuando cambia el estado.
    function refreshClaimButtonState(claimType) {
        const claimBtn = document.getElementById('claimRefundBtn');
        if (!claimBtn) return;
        if (claimRequirementsMet(claimType)) {
            claimBtn.textContent = '🎁 Reclamar Reembolso';
            claimBtn.style.background = '';
            claimBtn.onclick = () => claimRefund(claimType);
            VIP.ui.showToast('✅ Listo, ya podés reclamar', 'success');
        }
    }

    async function claimRefund(type) {
        // Guardia de requisitos: solo el monthly exige app instalada + notificaciones.
        if (!claimRequirementsMet(type)) {
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

    // =====================================================
    // BONO DE BIENVENIDA $10.000 (one-time, requiere PWA + notifs)
    // =====================================================
    let _welcomeStatus = null; // { amount, claimed, claimedAt, status }

    async function loadWelcomeBonusStatus() {
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/refunds/welcome/status`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return;
            _welcomeStatus = await r.json();
            renderWelcomeBonusCard();
        } catch (err) {
            console.error('loadWelcomeBonusStatus error:', err);
        }
    }

    function renderWelcomeBonusCard() {
        const card = document.getElementById('welcomeBonusCard');
        const amountEl = document.getElementById('welcomeBonusAmount');
        const subtitleEl = document.getElementById('welcomeBonusSubtitle');
        const btn = document.getElementById('welcomeBonusBtn');
        if (!card || !btn) return;

        // El card SIEMPRE es visible, aunque _welcomeStatus aun no haya cargado.
        // Hasta que cargue, asumimos no-reclamado y mostramos los pasos.
        card.style.display = '';
        const s = _welcomeStatus || { amount: 10000, claimed: false };
        const amountNum = Number(s.amount || 10000);
        if (amountEl) amountEl.textContent = '$' + amountNum.toLocaleString('es-AR') + ' GRATIS';

        if (s.claimed) {
            card.classList.add('claimed');
            if (subtitleEl) subtitleEl.textContent = '✅ Ya reclamaste tu bono de bienvenida.';
            btn.disabled = true;
            btn.textContent = '✅ Reclamado';
            btn.onclick = null;
            return;
        }

        card.classList.remove('claimed');
        // Subtitulo dinamico segun estado actual de instalacion + notifs.
        const inApp = isStandalone();
        const installed = isAppInstalled();
        const notifOk = isNotifGranted();
        if (!installed) {
            subtitleEl.textContent = 'Tocá el botón y empezá por instalar la app.';
            btn.textContent = '🎁 RECLAMAR $' + amountNum.toLocaleString('es-AR');
        } else if (!inApp) {
            subtitleEl.textContent = 'Abrí la app desde el ícono de tu celular para continuar.';
            btn.textContent = '📱 Continuar (abrir desde la app)';
        } else if (!notifOk) {
            subtitleEl.textContent = 'Último paso: activá las notificaciones.';
            btn.textContent = '🔔 Activar notificaciones';
        } else {
            subtitleEl.textContent = '🎉 ¡Listo! Tocá para acreditar tus $' + amountNum.toLocaleString('es-AR') + '.';
            btn.textContent = '🎁 RECLAMAR $' + amountNum.toLocaleString('es-AR');
        }
        btn.disabled = false;
        btn.onclick = handleWelcomeBonusClick;
    }

    function handleWelcomeBonusClick() {
        if (!claimRequirementsMet('welcome')) {
            // Reusamos el modal generico de requisitos. _pendingClaimType
            // dispara la customizacion de copy y el resume hacia welcome.
            openRequirementsModal('welcome');
            return;
        }
        claimWelcomeBonus();
    }

    async function claimWelcomeBonus() {
        const btn = document.getElementById('welcomeBonusBtn');
        if (btn) {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = '⏳ Procesando...';
        }
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/refunds/claim/welcome`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            const data = await response.json();
            if (data.success) {
                VIP.ui.showToast('✅ ' + data.message, 'success');
                _welcomeStatus = { ...(_welcomeStatus || {}), claimed: true, claimedAt: new Date().toISOString(), status: 'completed' };
                renderWelcomeBonusCard();
                // Refrescar saldo en pantalla.
                if (typeof loadRefundStatus === 'function') loadRefundStatus();
            } else {
                VIP.ui.showToast('⚠️ ' + (data.message || 'No se pudo reclamar'), 'error');
                if (data.canClaim === false) {
                    _welcomeStatus = { ...(_welcomeStatus || {}), claimed: true };
                    renderWelcomeBonusCard();
                } else if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🎁 Reclamar bono';
                }
            }
        } catch (err) {
            console.error('claimWelcomeBonus error:', err);
            VIP.ui.showToast('Error de conexión', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🎁 Reclamar bono';
            }
        }
    }

    return {
        loadRefundStatus,
        updateRefundButtons,
        updateRefundButton,
        startCountdown,
        showRefundModal,
        claimRefund,
        showUnifiedRefundModal,
        canClaim,
        openRequirementsModal,
        loadWelcomeBonusStatus,
        renderWelcomeBonusCard,
        claimWelcomeBonus
    };

})();

// Window aliases
window.showRefundModal = VIP.refunds.showRefundModal;
window.claimRefund     = VIP.refunds.claimRefund;
