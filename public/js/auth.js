// ========================================
// AUTH - Authentication module
// ========================================

window.VIP = window.VIP || {};

VIP.auth = (function () {

    function escapeHtml(text) {
        if (!text && text !== 0) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    async function checkUsernameAvailability(username) {
        const resultSpan = document.getElementById('usernameCheckResult');
        try {
            const response = await fetch(
                `${VIP.config.API_URL}/api/auth/check-username?username=${encodeURIComponent(username)}`
            );
            const data = await response.json();
            if (data.available) {
                resultSpan.textContent = '✅ Usuario disponible';
                resultSpan.style.color = '#00ff88';
            } else {
                resultSpan.textContent = '❌ ' + (data.message || 'Usuario no disponible');
                resultSpan.style.color = '#ff4444';
            }
        } catch (error) {
            resultSpan.textContent = '';
        }
    }

    // Estado temporal del registro OTP (compartido con app.js global via window)
    let _vipRegisterOtpPhone = null;

    async function handleRegister(e) {
        if (e) e.preventDefault();
        // El registro ahora usa flujo OTP: handleRegisterSendOtp y handleRegisterWithOtp
        // Esta función se mantiene por compatibilidad
    }

    async function handleRegisterSendOtp() {
        const username = document.getElementById('registerUsername').value.trim();
        const password = document.getElementById('registerPassword').value;
        const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
        const phonePrefix = document.getElementById('registerPhonePrefix').value;
        const phoneNumber = document.getElementById('registerPhone').value.trim();
        const errorDiv = document.getElementById('registerError');

        errorDiv.classList.remove('show');

        if (password !== passwordConfirm) {
            errorDiv.textContent = 'Las contraseñas no coinciden';
            errorDiv.classList.add('show');
            return;
        }
        if (password.length < 6) {
            errorDiv.textContent = 'La contraseña debe tener al menos 6 caracteres';
            errorDiv.classList.add('show');
            return;
        }
        if (username.length < 3) {
            errorDiv.textContent = 'El usuario debe tener al menos 3 caracteres';
            errorDiv.classList.add('show');
            return;
        }
        if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 8) {
            errorDiv.textContent = 'Ingresá un número de teléfono válido (mínimo 8 dígitos)';
            errorDiv.classList.add('show');
            return;
        }

        const fullPhone = phonePrefix + phoneNumber.replace(/[\s\-().]/g, '');
        const btn = document.getElementById('registerSendOtpBtn');
        if (btn) { btn.textContent = 'Enviando...'; btn.disabled = true; }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/send-register-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: fullPhone, username })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                _vipRegisterOtpPhone = fullPhone;
                // Sync con variable global si existe (app.js)
                if (typeof window !== 'undefined') window._registerOtpPhone = fullPhone;
                document.getElementById('registerStep1').style.display = 'none';
                document.getElementById('registerStep2').style.display = '';
                document.getElementById('registerOtpMsg').textContent = `✅ ${data.message} (${data.phone})`;
                document.getElementById('registerOtpCode').value = '';
                document.getElementById('registerOtpError').classList.remove('show');
            } else {
                errorDiv.textContent = data.error || 'Error al enviar el código SMS';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            errorDiv.textContent = 'Error de conexión. Intenta más tarde.';
            errorDiv.classList.add('show');
        } finally {
            if (btn) { btn.textContent = '📱 Enviar código SMS'; btn.disabled = false; }
        }
    }

    async function handleRegisterWithOtp() {
        const username = document.getElementById('registerUsername').value.trim();
        const password = document.getElementById('registerPassword').value;
        const email = document.getElementById('registerEmail').value.trim();
        const referralCodeInput = document.getElementById('registerReferralCode');
        const referralCode = referralCodeInput ? referralCodeInput.value.trim().toUpperCase() : null;
        const otpCode = document.getElementById('registerOtpCode').value.trim();
        const errorDiv = document.getElementById('registerOtpError');
        const submitBtn = document.getElementById('registerSubmitBtn');

        errorDiv.classList.remove('show');

        if (!otpCode || otpCode.length < 6) {
            errorDiv.textContent = 'Ingresá el código de 6 dígitos';
            errorDiv.classList.add('show');
            return;
        }

        const phone = _vipRegisterOtpPhone || (typeof window !== 'undefined' ? window._registerOtpPhone : null);
        if (!phone) {
            errorDiv.textContent = 'Error: teléfono no encontrado. Volvé al paso anterior.';
            errorDiv.classList.add('show');
            return;
        }

        if (submitBtn) { submitBtn.textContent = 'Creando cuenta...'; submitBtn.disabled = true; }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    password,
                    email: email || null,
                    phone,
                    referralCode: referralCode || undefined,
                    otpCode
                })
            });
            const data = await response.json();

            if (response.ok) {
                _vipRegisterOtpPhone = null;
                if (typeof window !== 'undefined') window._registerOtpPhone = null;
                VIP.state.currentToken = data.token;
                VIP.state.currentUser = { ...data.user, id: data.user.id, userId: data.user.id };
                localStorage.setItem('userToken', VIP.state.currentToken);

                VIP.ui.hideModal('registerModal');
                document.getElementById('registerForm').reset();
                document.getElementById('usernameCheckResult').textContent = '';
                document.getElementById('registerStep1').style.display = '';
                document.getElementById('registerStep2').style.display = 'none';

                await initializeSession(true);
                console.log('[FCM] Registro exitoso, enviando token FCM...');
                await VIP.notifications.sendFcmTokenAfterLogin();
                VIP.ui.showToast('✅ ¡Cuenta creada exitosamente!', 'success');
            } else {
                errorDiv.textContent = data.error || 'Error al crear cuenta';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            errorDiv.textContent = 'Error de conexión';
            errorDiv.classList.add('show');
        } finally {
            if (submitBtn) { submitBtn.textContent = '📝 Crear Cuenta'; submitBtn.disabled = false; }
        }
    }

    // Refunds-only login: solo username, sin contraseña.
    async function handleLogin(e) {
        if (e) e.preventDefault();

        const usernameEl = document.getElementById('username');
        const username = (usernameEl?.value || '').trim();
        const errorDiv = document.getElementById('errorMessage');
        const loginBtn = document.querySelector('#loginForm button[type="submit"]');

        errorDiv.classList.remove('show');

        if (!username) {
            errorDiv.textContent = 'Ingresá tu usuario';
            errorDiv.classList.add('show');
            return;
        }

        if (loginBtn) { loginBtn.textContent = 'Ingresando...'; loginBtn.disabled = true; }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);

            const response = await fetch(`${VIP.config.API_URL}/api/auth/login-username-only`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            let data = {};
            let rawText = '';
            try {
                rawText = await response.text();
                data = rawText ? JSON.parse(rawText) : {};
            } catch (_) { data = {}; }

            if (response.status === 404) {
                errorDiv.textContent = data.error || 'Usuario no disponible';
                errorDiv.classList.add('show');
                return;
            }
            if (!response.ok) {
                const detail = data.error
                    ? data.error
                    : (rawText ? rawText.slice(0, 120) : 'sin respuesta del servidor');
                errorDiv.textContent = `Error ${response.status}: ${detail}`;
                errorDiv.classList.add('show');
                return;
            }

            VIP.state.currentToken = data.token;
            VIP.state.currentUser = { ...data.user, id: data.user.id, userId: data.user.id };
            VIP.state.linePhone = data.linePhone || null;
            localStorage.setItem('userToken', VIP.state.currentToken);

            // Si en el celular hay un FCM token de un user anterior (ej: el
            // dueño cambió de cuenta sin logout), reasignarlo al user
            // actual. El backend además limpia el token de otros users.
            try {
                if (VIP.notifications && typeof VIP.notifications.sendFcmTokenAfterLogin === 'function') {
                    VIP.notifications.sendFcmTokenAfterLogin();
                }
            } catch (_) { /* best-effort */ }

            renderRefundsHomeUI();

            VIP.ui.showChatScreen();
            VIP.refunds.loadRefundStatus();
        } catch (error) {
            if (error.name === 'AbortError') {
                errorDiv.textContent = 'La conexión tardó demasiado. Intenta nuevamente.';
            } else {
                errorDiv.textContent = 'Error de conexión';
            }
            errorDiv.classList.add('show');
        } finally {
            if (loginBtn) {
                loginBtn.textContent = 'Ingresar';
                loginBtn.disabled = false;
            }
        }
    }

    // Renderiza el bloque "Bienvenido [user]" + "Número principal vigente"
    function renderRefundsHomeUI() {
        const user = VIP.state.currentUser || {};
        // El "Bienvenido <user>" del bloque grande se reemplazo por
        // "Reclama tu reembolso disponible". El username ahora va chico al
        // lado del boton de Salir.
        const welcomeEl = document.getElementById('refundsWelcomeUser');
        if (welcomeEl) welcomeEl.textContent = user.username || '';
        const logoutUserEl = document.getElementById('refundsLogoutUsername');
        if (logoutUserEl) logoutUserEl.textContent = user.username || '';

        const phoneEl = document.getElementById('userLinePhone');
        const phone = VIP.state.linePhone || null;

        const waIcon =
            '<svg viewBox="0 0 24 24" aria-hidden="true">' +
              '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>' +
            '</svg>';

        // Siempre se renderiza el boton verde con icono + "QUIERO CARGAR". Si hay
        // numero configurado para el usuario, el href abre WhatsApp; si no, el
        // boton se renderiza sin link funcional pero mantiene el aspecto.
        if (phoneEl) {
            if (phone) {
                const waNumber = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
                const safePhone = phone
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                phoneEl.innerHTML =
                    '<a href="https://wa.me/' + waNumber + '" target="_blank" rel="noopener noreferrer" ' +
                      'aria-label="Abrir WhatsApp con el número ' + safePhone + '">' +
                        waIcon +
                        '<span>QUIERO CARGAR</span>' +
                    '</a>';
            } else {
                phoneEl.innerHTML =
                    '<a href="javascript:void(0)" role="button" aria-disabled="true" ' +
                      'aria-label="Linea de WhatsApp no configurada">' +
                        waIcon +
                        '<span>QUIERO CARGAR</span>' +
                    '</a>';
            }
        }

        // Bloque "Unite a la comunidad". Mismo patron: si hay link, abre el link
        // (presumiblemente un wa.me/chat o link de comunidad WhatsApp); si no,
        // se renderiza el boton sin destino para mantener el aspecto.
        const communityEl = document.getElementById('userCommunityLink');
        const communityLink = VIP.state.communityLink || null;
        if (communityEl) {
            if (communityLink) {
                const safeLink = communityLink
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                communityEl.innerHTML =
                    '<a href="' + safeLink + '" target="_blank" rel="noopener noreferrer" ' +
                      'aria-label="Abrir link de comunidad">' +
                        waIcon +
                        '<span>LINK COMUNIDAD</span>' +
                    '</a>';
            } else {
                communityEl.innerHTML =
                    '<a href="javascript:void(0)" role="button" aria-disabled="true" ' +
                      'aria-label="Link de comunidad no configurado">' +
                        waIcon +
                        '<span>LINK COMUNIDAD</span>' +
                    '</a>';
            }
        }

        // Pintar el card del bono de bienvenida de inmediato (con texto por
        // defecto), asi el boton queda atado antes de que loadRefundStatus
        // termine el fetch del estado real.
        try {
            if (VIP.refunds && typeof VIP.refunds.renderWelcomeBonusCard === 'function') {
                VIP.refunds.renderWelcomeBonusCard();
            }
        } catch (_) { /* ignore */ }

        // Chequear si hay promo activa: si la hay, el card #userLinePhone
        // pasa a mostrar el cartel de RECLAMÁ con codigo y contador en vez
        // del boton QUIERO CARGAR.
        try { applyPromoAlertIfActive(); } catch (_) { /* ignore */ }
    }

    // ===== Promo temporal en boton QUIERO CARGAR =====
    let _promoTimerId = null;
    let _promoCountdownId = null;
    let _promoRefetchId = null;

    // Defensa-en-profundidad: trackeamos en localStorage que promos
    // ya tocó este user. Una vez tocada, no se vuelve a mostrar aunque
    // siga activa server-side. Clave por username + promo.id.
    function _promoUsedKey(promoId) {
        const u = (VIP.state.currentUser && VIP.state.currentUser.username) || '';
        return 'vipPromoUsed:' + u.toLowerCase() + ':' + promoId;
    }
    function _isPromoLocallyUsed(promoId) {
        try { return localStorage.getItem(_promoUsedKey(promoId)) === '1'; }
        catch (_) { return false; }
    }
    function _markPromoLocallyUsed(promoId) {
        try { localStorage.setItem(_promoUsedKey(promoId), '1'); } catch (_) {}
    }

    async function applyPromoAlertIfActive() {
        try {
            if (!VIP.state.currentToken) return;
            const r = await fetch(`${VIP.config.API_URL}/api/promo-alert/active`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return;
            const data = await r.json();
            if (!data || !data.active) {
                // No hay promo o ya vencio: si teniamos overlay, restauramos
                // el boton normal re-renderizando el home.
                clearPromoTimers();
                return;
            }
            // Si este user ya tocó esta promo, no la mostramos (vuelve al
            // estado original con boton QUIERO CARGAR).
            if (data.id && _isPromoLocallyUsed(data.id)) {
                clearPromoTimers();
                return;
            }
            renderPromoOverlay(data);
        } catch (err) {
            console.warn('applyPromoAlertIfActive error:', err);
        }
    }

    function clearPromoTimers() {
        if (_promoTimerId) { clearTimeout(_promoTimerId); _promoTimerId = null; }
        if (_promoCountdownId) { clearInterval(_promoCountdownId); _promoCountdownId = null; }
    }

    function _waLinkForCharge(extraText) {
        const phone = (VIP.state.linePhone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
        if (!phone) return null;
        const msg = encodeURIComponent(extraText || '');
        return 'https://wa.me/' + phone + (msg ? '?text=' + msg : '');
    }

    function renderPromoOverlay(promo) {
        const phoneEl = document.getElementById('userLinePhone');
        if (!phoneEl) return;
        clearPromoTimers();

        const expiresMs = new Date(promo.expiresAt).getTime();
        const remainingMs = expiresMs - Date.now();
        if (remainingMs <= 0) { applyPromoAlertIfActive(); return; }

        const safeMsg = String(promo.message || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeCode = String(promo.code || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Mensaje de WhatsApp pre-cargado con el codigo. El user toca y
        // ya abre WA con el texto listo, solo le da Enviar.
        const waText = `Hola! Quiero usar el código ${promo.code} (${promo.message})`;
        const waLink = _waLinkForCharge(waText);

        const linkAttr = waLink
            ? 'href="' + waLink + '" target="_blank" rel="noopener noreferrer"'
            : 'href="javascript:void(0)" role="button" aria-disabled="true"';

        phoneEl.innerHTML =
            '<a ' + linkAttr + ' class="promo-cta" id="promoCtaAnchor" aria-label="Reclamar promo ' + safeCode + '">' +
                '<div class="promo-cta-flag">🎁 RECLAMÁ</div>' +
                '<div class="promo-cta-msg">' + safeMsg + '</div>' +
                '<div class="promo-cta-code">Código: <strong>' + safeCode + '</strong></div>' +
                '<div class="promo-cta-timer" id="promoCtaTimer">⏰ vence en —</div>' +
            '</a>';

        // Track click → server suma waClicks en el row de NotificationHistory
        // asociado a esta promo (si lo hay). Best-effort: si falla no
        // bloqueamos la apertura de WhatsApp.
        // Ademas: marcamos la promo como "usada" en localStorage y volvemos
        // al boton normal QUIERO CARGAR — el user ya la usó, no le seguimos
        // mostrando el cartel aunque la promo siga activa server-side.
        const ctaAnchor = document.getElementById('promoCtaAnchor');
        if (ctaAnchor) {
            ctaAnchor.addEventListener('click', () => {
                try {
                    fetch(`${VIP.config.API_URL}/api/promo-alert/track-click`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` },
                        keepalive: true
                    }).catch(() => {});
                } catch (_) {}
                if (promo && promo.id) {
                    _markPromoLocallyUsed(promo.id);
                }
                // Pequeño delay para que el wa.me alcance a abrirse antes
                // de que rerenderemos.
                setTimeout(() => {
                    clearPromoTimers();
                    renderRefundsHomeUI();
                }, 300);
            }, { once: false });
        }

        // Contador en vivo cada 1s (visualmente actualiza min/seg).
        const updateCountdown = () => {
            const left = expiresMs - Date.now();
            const t = document.getElementById('promoCtaTimer');
            if (!t) return;
            if (left <= 0) {
                t.textContent = '⏰ vencida';
                clearPromoTimers();
                // Re-render normal del home para volver a poner QUIERO CARGAR.
                setTimeout(() => renderRefundsHomeUI(), 250);
                return;
            }
            const totalSec = Math.floor(left / 1000);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            let str;
            if (h > 0) str = h + 'h ' + String(m).padStart(2, '0') + 'm';
            else if (m > 0) str = m + 'm ' + String(s).padStart(2, '0') + 's';
            else str = s + 's';
            t.textContent = '⏰ vence en ' + str;
        };
        updateCountdown();
        _promoCountdownId = setInterval(updateCountdown, 1000);

        // Programar el re-render exacto al vencimiento.
        _promoTimerId = setTimeout(() => {
            clearPromoTimers();
            renderRefundsHomeUI();
        }, Math.min(remainingMs + 500, 2147483000));
    }

    // Polling defensivo cada 60s para recoger promos creadas mientras la
    // pagina esta abierta (sin recargar). Idle-friendly: solo si la
    // pestaña esta visible.
    if (!_promoRefetchId) {
        _promoRefetchId = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            applyPromoAlertIfActive();
        }, 60 * 1000);
    }

    // Refrescar línea vigente + link de comunidad con el token actual (sirve tras reload).
    async function refreshLinePhone() {
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/user-lines/me`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (r.ok) {
                const d = await r.json();
                const newPhone = d.phone || null;
                VIP.state.linePhone = newPhone;
                VIP.state.communityLink = d.communityLink || null;
                renderRefundsHomeUI();
                checkLineChange(newPhone);
            }
        } catch (_) { /* ignore */ }
    }

    // Compara el número que devolvió el server con el que vimos por última
    // vez (localStorage). Si cambió, muestra el banner rojo grande para
    // que el usuario sepa que tiene que agendar el nuevo y borrar el viejo.
    // En el primer login (no hay valor previo) NO mostramos el banner —
    // solo guardamos para futuras comparaciones.
    function checkLineChange(currentPhone) {
        const banner = document.getElementById('lineChangedAlert');
        if (!banner) return;
        if (!currentPhone) {
            banner.style.display = 'none';
            return;
        }
        // Clave por usuario para que el "último visto" sea per-cuenta
        const username = (VIP.state.currentUser && VIP.state.currentUser.username) || '_anon';
        const key = 'lastSeenLinePhone:' + username;
        let prev = null;
        try { prev = localStorage.getItem(key); } catch (_) { /* ignore */ }

        if (!prev) {
            // Primer login: no hay nada con qué comparar, solo guardamos.
            try { localStorage.setItem(key, currentPhone); } catch (_) {}
            banner.style.display = 'none';
            return;
        }
        if (prev !== currentPhone) {
            // ¡Cambió!
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }
    }

    // Wire-up del botón "Entendido, ya lo agendé" del banner de cambio de línea.
    // Además del dismiss, abre WhatsApp directo al nuevo número con un mensaje
    // pre-cargado para confirmar que el usuario agendó el número nuevo.
    function wireLineChangedDismiss() {
        const btn = document.getElementById('lineChangedDismiss');
        if (!btn) return;
        btn.addEventListener('click', function () {
            const banner = document.getElementById('lineChangedAlert');
            if (banner) banner.style.display = 'none';

            const username = (VIP.state.currentUser && VIP.state.currentUser.username) || '_anon';
            const key = 'lastSeenLinePhone:' + username;
            const phone = VIP.state.linePhone;
            if (phone) {
                try { localStorage.setItem(key, phone); } catch (_) {}
            }

            // Derivar al nuevo WhatsApp con mensaje pre-cargado
            if (phone) {
                const waNumber = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
                const msg = encodeURIComponent(
                    'Hola! Soy ' + ((VIP.state.currentUser && VIP.state.currentUser.username) || '') +
                    '. Ya agendé el nuevo número.'
                );
                const url = 'https://wa.me/' + waNumber + '?text=' + msg;
                window.open(url, '_blank');
            }
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireLineChangedDismiss);
    } else {
        wireLineChangedDismiss();
    }

    // Cuando la app vuelve al foreground (ej: el user tocó la notif push
    // "NUEVA LINEA"), refrescar la línea para detectar cambios y mostrar
    // el banner si corresponde, sin esperar a un refresh manual.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && VIP.state.currentToken) {
            refreshLinePhone();
        }
    });

    async function verifyToken() {
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/verify`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });

            if (response.ok) {
                const data = await response.json();

                if (!data.user || !data.user.username) {
                    console.log('Token válido pero falta información de usuario, recargando...');
                    const userResponse = await fetch(`${VIP.config.API_URL}/api/users/me`, {
                        headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
                    });
                    if (userResponse.ok) {
                        const userData = await userResponse.json();
                        VIP.state.currentUser = {
                            ...userData,
                            id: userData.id || userData.userId,
                            userId: userData.userId || userData.id
                        };
                    } else {
                        VIP.state.currentUser = {
                            ...data.user,
                            id: data.user.id || data.user.userId,
                            userId: data.user.userId || data.user.id
                        };
                    }
                } else {
                    VIP.state.currentUser = {
                        ...data.user,
                        id: data.user.id || data.user.userId,
                        userId: data.user.userId || data.user.id
                    };
                }

                VIP.ui.showChatScreen();
                VIP.refunds.loadRefundStatus();

                // Refunds-only: pintar bienvenida + refrescar línea vigente
                try { renderRefundsHomeUI(); } catch (_) { /* ignore */ }
                refreshLinePhone();
            } else {
                localStorage.removeItem('userToken');
            }
        } catch (error) {
            console.error('Error verificando token:', error);
            localStorage.removeItem('userToken');
        }
    }

    function handleLogout() {
        // Avisar al backend para limpiar el token FCM de este dispositivo, así
        // las notificaciones del próximo user no se entregan a la sesión cerrada.
        // Best-effort: no bloqueamos el logout si la llamada falla (offline, etc.).
        try {
            const fcmToken = localStorage.getItem('fcmToken');
            const authToken = VIP.state.currentToken || localStorage.getItem('userToken');
            if (fcmToken) {
                const headers = { 'Content-Type': 'application/json' };
                if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
                fetch(VIP.config.API_URL + '/api/auth/logout', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ fcmToken: fcmToken }),
                    keepalive: true
                }).catch(function () { /* ignore */ });
            }
        } catch (e) { /* ignore */ }

        VIP.socket.stopMessagePolling();
        VIP.ui.stopBalancePolling();
        VIP.state.currentToken = null;
        VIP.state.currentUser = null;
        VIP.state.sessionPassword = '';
        localStorage.removeItem('userToken');
        // El fcmToken local también se borra para que la sesión siguiente
        // (otro usuario en el mismo dispositivo) registre uno fresco asociado
        // a su cuenta y no herede el del usuario anterior.
        localStorage.removeItem('fcmToken');
        localStorage.removeItem('fcmTokenContext');
        localStorage.removeItem('fcmTokenUserId');
        sessionStorage.removeItem('sessionPassword');
        VIP.ui.showLoginScreen();
    }

    async function ensureUserLoaded(retries = 3) {
        if (VIP.state.currentUser && VIP.state.currentUser.id && VIP.state.currentUser.username) {
            console.log('✅ Usuario ya cargado completamente:', VIP.state.currentUser.username);
            return true;
        }

        console.log('🔄 Cargando usuario automáticamente...');

        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(`${VIP.config.API_URL}/api/users/me`, {
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
                });

                if (response.ok) {
                    const userData = await response.json();
                    if (userData && userData.username) {
                        VIP.state.currentUser = {
                            ...userData,
                            id: userData.id || userData._id,
                            userId: userData.id || userData._id
                        };
                        console.log('✅ Usuario cargado exitosamente:', VIP.state.currentUser.username);
                        return true;
                    }
                } else if (response.status === 404) {
                    console.log(`⏳ Intento ${i + 1}/${retries}: Usuario no encontrado, reintentando...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    console.error('Error cargando usuario:', response.status);
                }
            } catch (error) {
                console.error('Error en ensureUserLoaded:', error);
            }
        }

        console.error('❌ No se pudo cargar el usuario después de', retries, 'intentos');
        return false;
    }

    async function initializeSession(afterRegister = false) {
        console.log('🚀 Inicializando sesión...');

        const userLoaded = await ensureUserLoaded(afterRegister ? 5 : 3);

        if (!userLoaded) {
            console.warn('⚠️ No se pudo cargar el usuario completamente, pero continuando...');
        }

        // Server-side enforcement of mandatory password change.
        // If `/api/users/me` reported `mustChangePassword: true`, re-open the
        // mandatory change modal automatically. This handles the page-reload
        // bypass: the flag lives on the server and is detected here on every
        // session bootstrap.
        if (VIP.state.currentUser && VIP.state.currentUser.mustChangePassword === true) {
            VIP.state.passwordChangePending = true;
            try { prepareChangePasswordModal(); } catch (e) { /* DOM not ready yet */ }
            try { VIP.ui.showModal('changePasswordModal'); } catch (e) { /* ignore */ }
        }

        VIP.ui.showChatScreen();
        VIP.socket.startMessagePolling();
        VIP.refunds.loadRefundStatus();
        VIP.fire.loadFireStatus();
        VIP.ui.loadCanalInformativoUrl();

        return userLoaded;
    }

    function prepareChangePasswordModal() {
        const whatsappGroup = document.getElementById('changePasswordWhatsAppGroup');
        const whatsappInfo = document.getElementById('changePasswordWhatsAppInfo');
        const whatsappInput = document.getElementById('changePasswordWhatsApp');
        // Por requerimiento de Problema 2: el campo de teléfono se oculta SOLO si el usuario
        // ya tiene un teléfono verificado vía OTP. El campo `whatsapp` (no verificado) NO cuenta
        // como teléfono válido para saltarse la verificación, porque históricamente se guardó sin OTP.
        const verifiedPhone = VIP.state.currentUser
            && VIP.state.currentUser.phoneVerified === true
            && VIP.state.currentUser.phone
            ? VIP.state.currentUser.phone
            : null;

        if (whatsappGroup) {
            if (verifiedPhone) {
                whatsappGroup.style.display = 'none';
                if (whatsappInput) whatsappInput.removeAttribute('required');
            } else {
                whatsappGroup.style.display = '';
                if (whatsappInput) whatsappInput.setAttribute('required', '');
            }
        }
        if (whatsappInfo) {
            whatsappInfo.style.display = verifiedPhone ? 'block' : 'none';
            whatsappInfo.textContent = verifiedPhone ? `✅ Teléfono verificado: ${verifiedPhone}` : '';
        }

        // Reset del paso OTP: siempre arranca en paso 1 al abrir el modal.
        const otpStep = document.getElementById('changePasswordOtpStep');
        const form = document.getElementById('changePasswordForm');
        if (otpStep) otpStep.style.display = 'none';
        if (form) form.style.display = '';
        const otpCodeInput = document.getElementById('changePasswordOtpCode');
        if (otpCodeInput) otpCodeInput.value = '';
        const otpErr = document.getElementById('changePasswordOtpError');
        if (otpErr) { otpErr.textContent = ''; otpErr.classList.remove('show'); }
        _vipChangePwdPending = null;
        _stopChangePwdResendCooldown();

        // Actualizar título, subtítulo y botón de cierre según si el cambio es obligatorio
        const closeBtn = document.getElementById('changePasswordCloseBtn');
        const title = document.getElementById('changePasswordTitle');
        const subtitle = document.getElementById('changePasswordSubtitle');
        const currentPwdGroup = document.getElementById('currentPasswordGroup');
        const currentPwdInput = document.getElementById('currentPasswordInput');
        if (VIP.state.passwordChangePending) {
            if (closeBtn) closeBtn.style.display = 'none';
            if (title) title.textContent = '🔐 Cambio de Contraseña Obligatorio';
            if (subtitle) subtitle.innerHTML = 'Por seguridad, <strong>debés cambiar tu contraseña</strong> antes de continuar. No podés omitir este paso.';
            // En el flujo obligatorio el usuario fue importado/reseteado y no necesita
            // ingresar su contrasena actual.
            if (currentPwdGroup) currentPwdGroup.style.display = 'none';
            if (currentPwdInput) { currentPwdInput.value = ''; currentPwdInput.required = false; }
        } else {
            if (closeBtn) closeBtn.style.display = '';
            if (title) title.textContent = '🔐 Cambiar Contraseña';
            if (subtitle) subtitle.textContent = 'Ingresá tu nueva contraseña para actualizarla.';
            if (currentPwdGroup) currentPwdGroup.style.display = '';
            if (currentPwdInput) { currentPwdInput.value = ''; currentPwdInput.required = true; }
        }
    }

    // Estado pendiente del cambio de contraseña con OTP:
    // se guarda entre el paso 1 (datos) y el paso 2 (verificación OTP) para no perder
    // la nueva contraseña ni el teléfono mientras el usuario espera el SMS.
    let _vipChangePwdPending = null;
    let _vipChangePwdResendTimer = null;

    function _stopChangePwdResendCooldown() {
        if (_vipChangePwdResendTimer) {
            clearInterval(_vipChangePwdResendTimer);
            _vipChangePwdResendTimer = null;
        }
        const cooldownLabel = document.getElementById('changePasswordOtpResendCooldown');
        const resendBtn = document.getElementById('changePasswordOtpResendBtn');
        if (cooldownLabel) { cooldownLabel.style.display = 'none'; cooldownLabel.textContent = ''; }
        if (resendBtn) { resendBtn.style.display = ''; resendBtn.disabled = false; }
    }

    function _startChangePwdResendCooldown(seconds) {
        const cooldownLabel = document.getElementById('changePasswordOtpResendCooldown');
        const resendBtn = document.getElementById('changePasswordOtpResendBtn');
        let remaining = seconds;
        if (resendBtn) { resendBtn.style.display = 'none'; resendBtn.disabled = true; }
        if (cooldownLabel) {
            cooldownLabel.style.display = '';
            cooldownLabel.textContent = `Podés reenviar en ${remaining}s`;
        }
        if (_vipChangePwdResendTimer) clearInterval(_vipChangePwdResendTimer);
        _vipChangePwdResendTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                _stopChangePwdResendCooldown();
            } else if (cooldownLabel) {
                cooldownLabel.textContent = `Podés reenviar en ${remaining}s`;
            }
        }, 1000);
    }

    async function handleChangePassword(e) {
        if (e) e.preventDefault();

        const currentPassword = document.getElementById('currentPasswordInput')?.value || '';
        const newPassword = document.getElementById('newPasswordInput').value;
        const confirmPassword = document.getElementById('confirmPasswordInput').value;
        const whatsappRaw = (document.getElementById('changePasswordWhatsApp')?.value || '').trim();
        const whatsappPrefix = (document.getElementById('changePasswordWhatsAppPrefix')?.value || '+54').trim();
        const errorDiv = document.getElementById('passwordError');

        // Si no es cambio obligatorio, exigir contrasena actual.
        if (!VIP.state.passwordChangePending && !currentPassword) {
            errorDiv.textContent = 'Ingresá tu contraseña actual';
            errorDiv.classList.add('show');
            return;
        }

        // Solo consideramos teléfono válido si está VERIFICADO vía OTP.
        const verifiedPhone = VIP.state.currentUser
            && VIP.state.currentUser.phoneVerified === true
            && VIP.state.currentUser.phone
            ? VIP.state.currentUser.phone
            : null;
        // Construir número completo solo si se ingresó uno nuevo
        const whatsappFull = whatsappRaw ? (whatsappPrefix + whatsappRaw.replace(/^0+/, '')) : '';

        errorDiv.textContent = '';
        errorDiv.classList.remove('show');

        if (newPassword !== confirmPassword) {
            errorDiv.textContent = 'Las contraseñas no coinciden';
            errorDiv.classList.add('show');
            return;
        }
        if (newPassword.length < 6) {
            errorDiv.textContent = 'La contraseña debe tener al menos 6 caracteres';
            errorDiv.classList.add('show');
            return;
        }

        const closeAllSessions = document.getElementById('closeAllSessions').checked;

        // CASO A: el usuario ya tiene un teléfono verificado y NO está cambiándolo.
        // No se requiere OTP. Solo se cambia la contraseña.
        if (verifiedPhone && !whatsappFull) {
            return _commitPasswordChange({
                currentPassword,
                newPassword,
                closeAllSessions,
                phone: null,
                otpCode: null,
                errorDiv
            });
        }

        // CASO B: se está agregando o cambiando teléfono → OTP obligatorio.
        if (!whatsappFull) {
            errorDiv.textContent = 'El número de WhatsApp es obligatorio (más de 10 dígitos con prefijo internacional)';
            errorDiv.classList.add('show');
            return;
        }
        const digits = whatsappFull.replace(/\D/g, '');
        if (digits.length <= 10) {
            errorDiv.textContent = 'El número de WhatsApp es obligatorio (más de 10 dígitos con prefijo internacional)';
            errorDiv.classList.add('show');
            return;
        }
        // Si el usuario solo está cambiando contraseña pero también escribió su mismo teléfono ya verificado,
        // tratar como CASO A (sin OTP).
        if (verifiedPhone && whatsappFull === verifiedPhone) {
            return _commitPasswordChange({
                currentPassword,
                newPassword,
                closeAllSessions,
                phone: null,
                otpCode: null,
                errorDiv
            });
        }

        // Pedir OTP al backend y mostrar paso 2.
        const submitBtn = document.getElementById('changePasswordSubmitBtn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '📱 Enviando código...'; }
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/change-password/send-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ phone: whatsappFull })
            });
            const data = await response.json();
            if (!response.ok) {
                errorDiv.textContent = data.error || 'No se pudo enviar el código SMS';
                errorDiv.classList.add('show');
                return;
            }
            // Guardar contexto pendiente y mostrar paso 2.
            _vipChangePwdPending = {
                currentPassword,
                newPassword,
                phone: whatsappFull,
                closeAllSessions
            };
            const form = document.getElementById('changePasswordForm');
            const otpStep = document.getElementById('changePasswordOtpStep');
            const otpMsg = document.getElementById('changePasswordOtpMsg');
            if (form) form.style.display = 'none';
            if (otpStep) otpStep.style.display = '';
            if (otpMsg) otpMsg.textContent = `Te enviamos un código SMS al ${data.phone || whatsappFull}. Ingresálo para confirmar el cambio.`;
            const otpErr = document.getElementById('changePasswordOtpError');
            if (otpErr) { otpErr.textContent = ''; otpErr.classList.remove('show'); }
            const otpCodeInput = document.getElementById('changePasswordOtpCode');
            if (otpCodeInput) { otpCodeInput.value = ''; setTimeout(() => otpCodeInput.focus(), 50); }
            _startChangePwdResendCooldown(60);
        } catch (err) {
            errorDiv.textContent = 'Error de conexión';
            errorDiv.classList.add('show');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Guardar Cambios'; }
        }
    }

    async function _commitPasswordChange({ currentPassword, newPassword, closeAllSessions, phone, otpCode, errorDiv }) {
        try {
            const body = { newPassword, closeAllSessions };
            if (currentPassword) body.currentPassword = currentPassword;
            if (phone) {
                body.phone = phone;
                // Mantener `whatsapp` por compatibilidad con código existente.
                body.whatsapp = phone;
                body.otpCode = otpCode;
            }
            const response = await fetch(`${VIP.config.API_URL}/api/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));

            if (response.ok) {
                VIP.state.passwordChangePending = false;
                // Actualizar contraseña en memoria de sesión para el modal de plataforma
                VIP.state.sessionPassword = newPassword;
                // Reflejar el teléfono verificado en el estado local para no volver a pedirlo.
                if (data && data.phoneVerified && data.phone && VIP.state.currentUser) {
                    VIP.state.currentUser.phone = data.phone;
                    VIP.state.currentUser.phoneVerified = true;
                    VIP.state.currentUser.whatsapp = data.phone;
                }
                _vipChangePwdPending = null;
                _stopChangePwdResendCooldown();

                VIP.ui.hideModal('changePasswordModal');
                VIP.ui.showToast('✅ Contraseña guardada exitosamente', 'success');
                document.getElementById('newPasswordInput').value = '';
                document.getElementById('confirmPasswordInput').value = '';
                const wpInput = document.getElementById('changePasswordWhatsApp');
                if (wpInput) wpInput.value = '';
                const wpPrefix = document.getElementById('changePasswordWhatsAppPrefix');
                if (wpPrefix) wpPrefix.value = '+54';
                document.getElementById('closeAllSessions').checked = false;

                if (closeAllSessions) {
                    VIP.ui.showToast('🔒 Todas las sesiones han sido cerradas. Por favor, vuelve a iniciar sesión.', 'info');
                    setTimeout(() => {
                        localStorage.removeItem('userToken');
                        location.reload();
                    }, 2000);
                }
                return true;
            }

            const target = errorDiv || document.getElementById('changePasswordOtpError') || document.getElementById('passwordError');
            if (target) {
                target.textContent = (data && data.error) || 'Error al cambiar contraseña';
                target.classList.add('show');
            }
            return false;
        } catch (error) {
            const target = errorDiv || document.getElementById('changePasswordOtpError') || document.getElementById('passwordError');
            if (target) {
                target.textContent = 'Error de conexión';
                target.classList.add('show');
            }
            return false;
        }
    }

    async function handleChangePasswordOtpVerify() {
        const otpErr = document.getElementById('changePasswordOtpError');
        const verifyBtn = document.getElementById('changePasswordOtpVerifyBtn');
        if (otpErr) { otpErr.textContent = ''; otpErr.classList.remove('show'); }

        if (!_vipChangePwdPending) {
            if (otpErr) {
                otpErr.textContent = 'Sesión de verificación expirada. Volvé a iniciar el cambio.';
                otpErr.classList.add('show');
            }
            return;
        }
        const code = (document.getElementById('changePasswordOtpCode')?.value || '').trim();
        if (!code || code.length < 6) {
            if (otpErr) {
                otpErr.textContent = 'Ingresá el código de 6 dígitos';
                otpErr.classList.add('show');
            }
            return;
        }
        if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Verificando...'; }
        const ok = await _commitPasswordChange({
            currentPassword: _vipChangePwdPending.currentPassword,
            newPassword: _vipChangePwdPending.newPassword,
            closeAllSessions: _vipChangePwdPending.closeAllSessions,
            phone: _vipChangePwdPending.phone,
            otpCode: code,
            errorDiv: otpErr
        });
        if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = '✅ Verificar y Guardar'; }
        // Si falló (p. ej. OTP incorrecto), el backend ya gestiona los 3 intentos vía OtpCode.
        // El usuario puede reintentar o pedir un nuevo código con el botón de reenvío.
        if (!ok) {
            const codeInput = document.getElementById('changePasswordOtpCode');
            if (codeInput) { codeInput.value = ''; codeInput.focus(); }
        }
    }

    async function handleChangePasswordOtpResend() {
        const otpErr = document.getElementById('changePasswordOtpError');
        if (!_vipChangePwdPending) {
            if (otpErr) {
                otpErr.textContent = 'Sesión de verificación expirada. Volvé a iniciar el cambio.';
                otpErr.classList.add('show');
            }
            return;
        }
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/change-password/send-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ phone: _vipChangePwdPending.phone })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (otpErr) {
                    otpErr.textContent = (data && data.error) || 'No se pudo reenviar el código';
                    otpErr.classList.add('show');
                }
                return;
            }
            const otpMsg = document.getElementById('changePasswordOtpMsg');
            if (otpMsg) otpMsg.textContent = `Te reenviamos el código SMS al ${data.phone || _vipChangePwdPending.phone}.`;
            _startChangePwdResendCooldown(60);
        } catch (err) {
            if (otpErr) {
                otpErr.textContent = 'Error de conexión';
                otpErr.classList.add('show');
            }
        }
    }

    function handleChangePasswordOtpBack() {
        _vipChangePwdPending = null;
        _stopChangePwdResendCooldown();
        const otpStep = document.getElementById('changePasswordOtpStep');
        const form = document.getElementById('changePasswordForm');
        if (otpStep) otpStep.style.display = 'none';
        if (form) form.style.display = '';
        const otpErr = document.getElementById('changePasswordOtpError');
        if (otpErr) { otpErr.textContent = ''; otpErr.classList.remove('show'); }
    }

    // Estado temporal del reset OTP
    let _vipResetOtpPhone = null;
    let _vipResetToken = null;

    async function handleFindUserByPhone(e) {
        // ELIMINADO: Este endpoint permitía enumerar usuarios.
        // El reset de contraseña ahora usa flujo OTP seguro (anti-enumeration).
        if (e) e.preventDefault();
    }

    async function handleRequestPasswordReset() {
        const phonePrefix = document.getElementById('resetPhonePrefix').value;
        const phoneNumber = document.getElementById('resetPassPhone').value.trim();
        const resultDiv = document.getElementById('resetStep1Result');

        if (resultDiv) resultDiv.style.display = 'none';

        if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 8) {
            if (resultDiv) {
                resultDiv.textContent = 'Ingresá un número de teléfono válido (mínimo 8 dígitos)';
                resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
                resultDiv.style.color = '#ff4444';
                resultDiv.style.display = 'block';
            }
            return;
        }

        const fullPhone = phonePrefix + phoneNumber.replace(/[\s\-().]/g, '');
        _vipResetOtpPhone = fullPhone;

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: fullPhone })
            });
            const data = await response.json();

            document.getElementById('resetStep1').style.display = 'none';
            document.getElementById('resetStep2').style.display = '';
            document.getElementById('resetStep2Msg').textContent = data.message || 'Si este número está vinculado a una cuenta, recibirás un código SMS.';
            document.getElementById('resetOtpCode').value = '';
            const errDiv = document.getElementById('resetStep2Error');
            if (errDiv) errDiv.style.display = 'none';
        } catch (error) {
            if (resultDiv) {
                resultDiv.textContent = 'Error de conexión. Intenta más tarde.';
                resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
                resultDiv.style.color = '#ff4444';
                resultDiv.style.display = 'block';
            }
        }
    }

    async function handleVerifyResetOtp() {
        const code = document.getElementById('resetOtpCode').value.trim();
        const errDiv = document.getElementById('resetStep2Error');

        if (errDiv) errDiv.style.display = 'none';

        if (!code || code.length < 6) {
            if (errDiv) { errDiv.textContent = 'Ingresá el código de 6 dígitos'; errDiv.style.display = 'block'; }
            return;
        }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/verify-reset-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: _vipResetOtpPhone, code })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                _vipResetToken = data.resetToken;
                document.getElementById('resetStep2').style.display = 'none';
                document.getElementById('resetStep3').style.display = '';
                document.getElementById('resetStep3Username').textContent = `👤 Usuario: ${escapeHtml(data.username)}`;
                document.getElementById('resetPassNew').value = '';
                document.getElementById('resetPassConfirm').value = '';
                const errDiv3 = document.getElementById('resetStep3Error');
                if (errDiv3) errDiv3.style.display = 'none';
            } else {
                if (errDiv) { errDiv.textContent = data.error || 'Código incorrecto o expirado'; errDiv.style.display = 'block'; }
            }
        } catch (error) {
            if (errDiv) { errDiv.textContent = 'Error de conexión. Intenta más tarde.'; errDiv.style.display = 'block'; }
        }
    }

    async function handleResetPasswordByPhone(e) {
        // MANTENIDO por compatibilidad con HTML (resetPassForm) - redirige al nuevo flujo OTP
        if (e) e.preventDefault();
        // El nuevo flujo usa handleRequestPasswordReset, handleVerifyResetOtp, handleCompletePasswordReset
    }

    async function handleCompletePasswordReset() {
        const newPassword = document.getElementById('resetPassNew').value;
        const confirmPassword = document.getElementById('resetPassConfirm').value;
        const resultDiv = document.getElementById('resetPassResult');
        const errDiv = document.getElementById('resetStep3Error');

        if (errDiv) errDiv.style.display = 'none';
        if (resultDiv) resultDiv.style.display = 'none';

        if (newPassword.length < 6) {
            if (errDiv) { errDiv.textContent = 'La contraseña debe tener al menos 6 caracteres'; errDiv.style.display = 'block'; }
            return;
        }
        if (newPassword !== confirmPassword) {
            if (errDiv) { errDiv.textContent = 'Las contraseñas no coinciden'; errDiv.style.display = 'block'; }
            return;
        }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/complete-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: _vipResetToken, newPassword })
            });
            const data = await response.json();

            if (data.success) {
                _vipResetToken = null;
                _vipResetOtpPhone = null;
                if (resultDiv) {
                    resultDiv.innerHTML = `<p style="color: #00ff88; font-size: 16px; font-weight: bold; text-align:center;">✅ Contraseña cambiada exitosamente</p><p style="color: #888; font-size: 12px; text-align:center;">Ya puedes iniciar sesión con tu nueva contraseña</p>`;
                    resultDiv.style.background = 'rgba(0, 255, 136, 0.2)';
                    resultDiv.style.display = 'block';
                }
                document.getElementById('resetStep3').style.display = 'none';
            } else {
                if (errDiv) { errDiv.textContent = data.error || 'Error al cambiar contraseña'; errDiv.style.display = 'block'; }
            }
        } catch (error) {
            if (errDiv) { errDiv.textContent = 'Error de conexión. Intenta más tarde.'; errDiv.style.display = 'block'; }
        }
    }

    function switchLoginMode(mode) {
        window._loginMode = mode;
        const usernameGroup = document.getElementById('loginUsernameGroup');
        const phoneGroup = document.getElementById('loginPhoneGroup');
        const usernameBtn = document.getElementById('loginByUsernameBtn');
        const phoneBtn = document.getElementById('loginByPhoneBtn');
        const usernameInput = document.getElementById('username');
        const phoneLoginModeToggle = document.getElementById('phoneLoginModeToggle');
        const phoneOtpStep = document.getElementById('phoneOtpStep');
        // iOS Safari < 15.4 no soporta `:has()` y tira SyntaxError en querySelector — eso abortaba
        // el handler y dejaba el toggle "Celular" sin responder al tap. Resolvemos el grupo
        // navegando desde el input por id hasta su `.input-group` ancestro (compatible siempre).
        const passwordInputEl = document.getElementById('password');
        const passwordGroup = passwordInputEl ? passwordInputEl.closest('.input-group') : null;
        const submitBtn = document.querySelector('#loginForm button[type="submit"]');

        if (mode === 'phone') {
            if (usernameGroup) usernameGroup.classList.add('hidden');
            if (phoneGroup) phoneGroup.classList.remove('hidden');
            if (usernameInput) usernameInput.removeAttribute('required');
            if (usernameBtn) { usernameBtn.style.background = 'transparent'; usernameBtn.style.color = '#888'; usernameBtn.style.fontWeight = 'normal'; }
            if (phoneBtn) { phoneBtn.style.background = 'rgba(212,175,55,0.2)'; phoneBtn.style.color = '#d4af37'; phoneBtn.style.fontWeight = '600'; }
            if (phoneLoginModeToggle) phoneLoginModeToggle.classList.remove('hidden');
        } else {
            if (usernameGroup) usernameGroup.classList.remove('hidden');
            if (phoneGroup) phoneGroup.classList.add('hidden');
            if (usernameInput) usernameInput.setAttribute('required', '');
            if (usernameBtn) { usernameBtn.style.background = 'rgba(212,175,55,0.2)'; usernameBtn.style.color = '#d4af37'; usernameBtn.style.fontWeight = '600'; }
            if (phoneBtn) { phoneBtn.style.background = 'transparent'; phoneBtn.style.color = '#888'; phoneBtn.style.fontWeight = 'normal'; }
            if (phoneLoginModeToggle) phoneLoginModeToggle.classList.add('hidden');
            if (phoneOtpStep) phoneOtpStep.classList.add('hidden');
            // Reset phone login mode to password
            window._phoneLoginMode = 'password';
            if (passwordGroup) passwordGroup.style.display = '';
            if (submitBtn) submitBtn.textContent = 'Ingresar a la Sala';
            if (submitBtn) submitBtn.style.display = '';
        }
    }

    return {
        checkUsernameAvailability,
        handleRegister,
        handleRegisterSendOtp,
        handleRegisterWithOtp,
        handleLogin,
        verifyToken,
        handleLogout,
        ensureUserLoaded,
        initializeSession,
        handleChangePassword,
        handleChangePasswordOtpVerify,
        handleChangePasswordOtpResend,
        handleChangePasswordOtpBack,
        handleFindUserByPhone,
        handleResetPasswordByPhone,
        handleRequestPasswordReset,
        handleVerifyResetOtp,
        handleCompletePasswordReset,
        prepareChangePasswordModal,
        switchLoginMode,
        renderRefundsHomeUI,
        refreshLinePhone,
        applyPromoAlertIfActive
    };

})();

// Window aliases for any HTML onclick / external callers
window.applyPromoAlertIfActive = VIP.auth.applyPromoAlertIfActive;
window.checkUsernameAvailability = VIP.auth.checkUsernameAvailability;
window.handleRegisterSendOtp = VIP.auth.handleRegisterSendOtp;
window.handleRegisterWithOtp = VIP.auth.handleRegisterWithOtp;
window.handleRequestPasswordReset = VIP.auth.handleRequestPasswordReset;
window.handleVerifyResetOtp = VIP.auth.handleVerifyResetOtp;
window.handleCompletePasswordReset = VIP.auth.handleCompletePasswordReset;
window.switchLoginMode = VIP.auth.switchLoginMode;

// Phone login OTP mode functions (global scope for onclick handlers)
window._phoneLoginMode = 'password';
window._phoneOtpFullPhone = null;

window.switchPhoneLoginMode = function(mode) {
    window._phoneLoginMode = mode;
    // iOS Safari < 15.4 no soporta `:has()` — usar closest desde el input por id (ver fix en switchLoginMode).
    var passwordInputEl = document.getElementById('password');
    var passwordGroup = passwordInputEl ? passwordInputEl.closest('.input-group') : null;
    var submitBtn = document.querySelector('#loginForm button[type="submit"]');
    var otpStep = document.getElementById('phoneOtpStep');
    var passwordBtn = document.getElementById('phoneLoginByPassword');
    var otpBtn = document.getElementById('phoneLoginByOtp');

    if (mode === 'otp') {
        if (passwordGroup) passwordGroup.style.display = 'none';
        if (submitBtn) submitBtn.textContent = '📱 Enviar código SMS';
        if (otpStep) otpStep.classList.add('hidden');
        if (passwordBtn) { passwordBtn.style.background = 'transparent'; passwordBtn.style.color = '#888'; passwordBtn.style.fontWeight = 'normal'; }
        if (otpBtn) { otpBtn.style.background = 'rgba(212,175,55,0.2)'; otpBtn.style.color = '#d4af37'; otpBtn.style.fontWeight = '600'; }
    } else {
        if (passwordGroup) passwordGroup.style.display = '';
        if (submitBtn) submitBtn.textContent = 'Ingresar a la Sala';
        if (otpStep) otpStep.classList.add('hidden');
        if (passwordBtn) { passwordBtn.style.background = 'rgba(212,175,55,0.2)'; passwordBtn.style.color = '#d4af37'; passwordBtn.style.fontWeight = '600'; }
        if (otpBtn) { otpBtn.style.background = 'transparent'; otpBtn.style.color = '#888'; otpBtn.style.fontWeight = 'normal'; }
    }
};

window.handlePhoneOtpVerify = async function() {
    var code = document.getElementById('phoneOtpCode').value.trim();
    var errorDiv = document.getElementById('errorMessage');
    var verifyBtn = document.getElementById('phoneOtpVerifyBtn');

    if (!code || code.length < 6) {
        errorDiv.textContent = 'Ingresá el código de 6 dígitos';
        errorDiv.classList.add('show');
        return;
    }

    if (verifyBtn) { verifyBtn.textContent = 'Verificando...'; verifyBtn.disabled = true; }

    try {
        var response = await fetch((VIP.config.API_URL || '') + '/api/auth/login-otp-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: window._phoneOtpFullPhone, code: code })
        });
        var data = await response.json();

        if (response.ok && data.token) {
            VIP.state.currentToken = data.token;
            VIP.state.currentUser = { ...data.user, id: data.user.id, userId: data.user.id };
            localStorage.setItem('userToken', VIP.state.currentToken);
            await VIP.auth.initializeSession(false);
            VIP.notifications.sendFcmTokenAfterLogin();
        } else {
            errorDiv.textContent = data.error || 'Código incorrecto o expirado';
            errorDiv.classList.add('show');
        }
    } catch (error) {
        errorDiv.textContent = 'Error de conexión';
        errorDiv.classList.add('show');
    } finally {
        if (verifyBtn) { verifyBtn.textContent = '✅ Verificar código'; verifyBtn.disabled = false; }
    }
};

// ============================================================
// Global fetch interceptor: detect server-side enforcement of
// mandatory password change (HTTP 403 with `code: MUST_CHANGE_PASSWORD`).
//
// This covers the "reload bypass" attack: even if the user reloads the page
// or tries to call any authenticated API directly, the server returns 403
// for non-allow-listed endpoints while `user.mustChangePassword === true`.
// We catch that response globally, flip the in-memory flag, and re-open
// the mandatory change modal.
// ============================================================
(function installMustChangePasswordInterceptor() {
    if (typeof window === 'undefined' || !window.fetch || window.__vipMustChangePasswordInterceptorInstalled) {
        return;
    }
    window.__vipMustChangePasswordInterceptorInstalled = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (...args) {
        const response = await originalFetch(...args);
        try {
            if (response && response.status === 403) {
                // Clone so the original consumer can still read the body.
                const clone = response.clone();
                const contentType = clone.headers.get('content-type') || '';
                if (contentType.indexOf('application/json') !== -1) {
                    const body = await clone.json().catch(() => null);
                    if (body && body.code === 'MUST_CHANGE_PASSWORD') {
                        // Only re-prepare the modal the first time we see the
                        // server-side enforcement. Otherwise repeated background
                        // requests (balance polling, fire status, etc.) would
                        // keep resetting the OTP step while the user types it.
                        if (!VIP.state.passwordChangePending) {
                            VIP.state.passwordChangePending = true;
                            try {
                                if (VIP.auth && typeof VIP.auth.prepareChangePasswordModal === 'function') {
                                    VIP.auth.prepareChangePasswordModal();
                                }
                            } catch (e) { /* ignore */ }
                            try {
                                if (VIP.ui && typeof VIP.ui.showModal === 'function') {
                                    VIP.ui.showModal('changePasswordModal');
                                }
                            } catch (e) { /* ignore */ }
                        }
                    }
                }
            }
        } catch (e) {
            // Never let the interceptor break the original request flow.
        }
        return response;
    };
})();
