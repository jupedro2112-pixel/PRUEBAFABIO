// ========================================
// AUTH - Authentication module
// ========================================

window.VIP = window.VIP || {};

VIP.auth = (function () {

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

    async function handleRegister(e) {
        e.preventDefault();

        const username = document.getElementById('registerUsername').value.trim();
        const password = document.getElementById('registerPassword').value;
        const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
        const email = document.getElementById('registerEmail').value.trim();
        const phone = document.getElementById('registerPhone').value.trim();
        const referralCodeInput = document.getElementById('registerReferralCode');
        const referralCode = referralCodeInput ? referralCodeInput.value.trim().toUpperCase() : null;
        const errorDiv = document.getElementById('registerError');
        const submitBtn = e.target.querySelector('button[type="submit"]');

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

        if (submitBtn) { submitBtn.textContent = 'Creando cuenta...'; submitBtn.disabled = true; }
        errorDiv.classList.remove('show');

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    password,
                    email: email || null,
                    phone: phone || null,
                    referralCode: referralCode || undefined
                })
            });

            const data = await response.json();

            if (response.ok) {
                VIP.state.currentToken = data.token;
                VIP.state.currentUser = { ...data.user, id: data.user.id, userId: data.user.id };
                localStorage.setItem('userToken', VIP.state.currentToken);

                VIP.ui.hideModal('registerModal');
                document.getElementById('registerForm').reset();
                document.getElementById('usernameCheckResult').textContent = '';

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

    async function handleLogin(e) {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('errorMessage');
        const loginBtn = document.querySelector('#loginForm button[type="submit"]');

        if (loginBtn) { loginBtn.textContent = 'Ingresando...'; loginBtn.disabled = true; }
        errorDiv.classList.remove('show');

        const loginTimeout = setTimeout(() => {
            errorDiv.textContent = 'Tiempo de espera agotado. Intenta nuevamente.';
            errorDiv.classList.add('show');
            if (loginBtn) { loginBtn.textContent = 'Ingresar a la Sala'; loginBtn.disabled = false; }
        }, 15000);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${VIP.config.API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            clearTimeout(loginTimeout);

            const data = await response.json();

            if (response.ok) {
                VIP.state.currentToken = data.token;
                VIP.state.currentUser = { ...data.user, id: data.user.id, userId: data.user.id };
                localStorage.setItem('userToken', VIP.state.currentToken);

                try {
                    await initializeSession(false);
                } catch (initError) {
                    console.error('Error inicializando sesión:', initError);
                }

                if (data.user.needsPasswordChange) {
                    VIP.state.passwordChangePending = true;
                    updateChangePasswordWhatsAppField();
                    VIP.ui.showModal('changePasswordModal');
                }

                VIP.notifications.requestNotificationPermission();
                VIP.notifications.sendFcmTokenAfterLogin();
                showNotificationBannerIfNeeded();
            } else {
                errorDiv.textContent = data.error || 'Error de autenticación';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            clearTimeout(loginTimeout);
            if (error.name === 'AbortError') {
                errorDiv.textContent = 'La conexión tardó demasiado. Intenta nuevamente.';
            } else {
                errorDiv.textContent = 'Error de conexión';
            }
            errorDiv.classList.add('show');
        } finally {
            if (loginBtn) { loginBtn.textContent = 'Ingresar a la Sala'; loginBtn.disabled = false; }
        }
    }

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
                VIP.socket.startMessagePolling();
                VIP.refunds.loadRefundStatus();
                VIP.fire.loadFireStatus();

                VIP.notifications.requestNotificationPermission();
                VIP.notifications.sendFcmTokenAfterLogin().catch(function (e) {
                    console.warn('[FCM] Error al re-sincronizar token en verifyToken:', e);
                });
                showNotificationBannerIfNeeded();
            } else {
                localStorage.removeItem('userToken');
            }
        } catch (error) {
            console.error('Error verificando token:', error);
            localStorage.removeItem('userToken');
        }
    }

    function handleLogout() {
        VIP.socket.stopMessagePolling();
        VIP.ui.stopBalancePolling();
        VIP.state.currentToken = null;
        VIP.state.currentUser = null;
        localStorage.removeItem('userToken');
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

        VIP.ui.showChatScreen();
        VIP.socket.startMessagePolling();
        VIP.refunds.loadRefundStatus();
        VIP.fire.loadFireStatus();
        VIP.ui.loadCanalInformativoUrl();

        return userLoaded;
    }

    async function handleChangePassword(e) {
        e.preventDefault();

        const currentPassword = document.getElementById('currentPasswordInput').value;
        const newPassword = document.getElementById('newPasswordInput').value;
        const confirmPassword = document.getElementById('confirmPasswordInput').value;
        const whatsappInput = document.getElementById('changePasswordWhatsApp');
        const whatsapp = whatsappInput ? whatsappInput.value.trim() : '';
        const errorDiv = document.getElementById('passwordError');

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

        // Solo pedir WhatsApp si el usuario no tiene uno ya vinculado
        const userHasPhone = !!(VIP.state.currentUser && (VIP.state.currentUser.whatsapp || VIP.state.currentUser.phone));
        if (!userHasPhone && (!whatsapp || whatsapp.length < 8)) {
            errorDiv.textContent = 'El número de WhatsApp es obligatorio (mínimo 8 dígitos)';
            errorDiv.classList.add('show');
            return;
        }

        const closeAllSessions = document.getElementById('closeAllSessions').checked;

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ currentPassword, newPassword, whatsapp, closeAllSessions })
            });

            if (response.ok) {
                VIP.state.passwordChangePending = false;
                VIP.ui.hideModal('changePasswordModal');
                VIP.ui.showToast('✅ Contraseña guardada exitosamente', 'success');
                document.getElementById('currentPasswordInput').value = '';
                document.getElementById('newPasswordInput').value = '';
                document.getElementById('confirmPasswordInput').value = '';
                if (whatsappInput) whatsappInput.value = '';
                document.getElementById('closeAllSessions').checked = false;

                if (closeAllSessions) {
                    VIP.ui.showToast('🔒 Todas las sesiones han sido cerradas. Por favor, vuelve a iniciar sesión.', 'info');
                    setTimeout(() => {
                        localStorage.removeItem('userToken');
                        location.reload();
                    }, 2000);
                }
            } else {
                const data = await response.json();
                errorDiv.textContent = data.error || 'Error al cambiar contraseña';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            errorDiv.textContent = 'Error de conexión';
            errorDiv.classList.add('show');
        }
    }

    async function handleFindUserByPhone(e) {
        e.preventDefault();

        const phone = document.getElementById('findUserPhone').value.trim();
        const resultDiv = document.getElementById('findUserResult');

        if (!phone || phone.length < 8) {
            resultDiv.textContent = 'Ingresa un número de teléfono válido (mínimo 8 dígitos)';
            resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
            resultDiv.style.color = '#ff4444';
            resultDiv.style.display = 'block';
            return;
        }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/find-user-by-phone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });

            const data = await response.json();

            if (data.found) {
                resultDiv.innerHTML = `
                    <div style="text-align: center;">
                        <p style="color: #00ff88; font-size: 18px; font-weight: bold; margin-bottom: 10px;">✅ Usuario encontrado!</p>
                        <p style="font-size: 24px; font-weight: bold; color: #d4af37; margin: 10px 0;">${data.username}</p>
                        <p style="color: #888; font-size: 12px;">Teléfono: ${data.phone || 'No registrado'}</p>
                    </div>
                `;
                resultDiv.style.background = 'rgba(0, 255, 136, 0.2)';
                resultDiv.style.color = '#00ff88';
            } else {
                resultDiv.innerHTML = `
                    <div style="text-align: center;">
                        <p style="color: #ff4444; font-size: 16px; font-weight: bold;">❌ ${data.message}</p>
                        <p style="color: #888; font-size: 12px; margin-top: 10px;">Verifica que el número sea correcto</p>
                    </div>
                `;
                resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
                resultDiv.style.color = '#ff4444';
            }
            resultDiv.style.display = 'block';
        } catch (error) {
            resultDiv.textContent = 'Error de conexión. Intenta más tarde.';
            resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
            resultDiv.style.color = '#ff4444';
            resultDiv.style.display = 'block';
        }
    }

    async function handleResetPasswordByPhone(e) {
        e.preventDefault();

        const phone = document.getElementById('resetPassPhone').value.trim();
        const newPassword = document.getElementById('resetPassNew').value;
        const confirmPassword = document.getElementById('resetPassConfirm').value;
        const resultDiv = document.getElementById('resetPassResult');

        if (!phone || phone.length < 8) {
            resultDiv.textContent = 'Ingresa un número de teléfono válido';
            resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
            resultDiv.style.color = '#ff4444';
            resultDiv.style.display = 'block';
            return;
        }
        if (newPassword.length < 6) {
            resultDiv.textContent = 'La contraseña debe tener al menos 6 caracteres';
            resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
            resultDiv.style.color = '#ff4444';
            resultDiv.style.display = 'block';
            return;
        }
        if (newPassword !== confirmPassword) {
            resultDiv.textContent = 'Las contraseñas no coinciden';
            resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
            resultDiv.style.color = '#ff4444';
            resultDiv.style.display = 'block';
            return;
        }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/reset-password-by-phone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, newPassword })
            });

            const data = await response.json();

            if (data.success) {
                resultDiv.innerHTML = `
                    <div style="text-align: center;">
                        <p style="color: #00ff88; font-size: 18px; font-weight: bold; margin-bottom: 10px;">✅ Contraseña cambiada!</p>
                        <p style="font-size: 16px; color: #d4af37; margin: 10px 0;">Usuario: ${data.username}</p>
                        <p style="color: #888; font-size: 12px;">Ya puedes iniciar sesión con tu nueva contraseña</p>
                    </div>
                `;
                resultDiv.style.background = 'rgba(0, 255, 136, 0.2)';
                resultDiv.style.color = '#00ff88';
                document.getElementById('resetPassPhone').value = '';
                document.getElementById('resetPassNew').value = '';
                document.getElementById('resetPassConfirm').value = '';
            } else {
                resultDiv.innerHTML = `
                    <div style="text-align: center;">
                        <p style="color: #ff4444; font-size: 16px; font-weight: bold;">❌ ${data.error}</p>
                    </div>
                `;
                resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
                resultDiv.style.color = '#ff4444';
            }
            resultDiv.style.display = 'block';
        } catch (error) {
            resultDiv.textContent = 'Error de conexión. Intenta más tarde.';
            resultDiv.style.background = 'rgba(255, 68, 68, 0.2)';
            resultDiv.style.color = '#ff4444';
            resultDiv.style.display = 'block';
        }
    }

    function updateChangePasswordWhatsAppField() {
        const group = document.getElementById('changePasswordWhatsAppGroup');
        if (!group) return;
        const user = VIP.state.currentUser;
        const userHasPhone = !!(user && (user.whatsapp || user.phone));
        group.style.display = userHasPhone ? 'none' : '';
    }

    function showNotificationBannerIfNeeded() {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') return;
        if (localStorage.getItem('notifBannerDismissed')) return;

        const existing = document.getElementById('notifBanner');
        if (existing) return;

        const banner = document.createElement('div');
        banner.id = 'notifBanner';
        banner.style.cssText = [
            'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
            'background:linear-gradient(135deg,#1a0033 0%,#2d0052 100%)',
            'border:2px solid #d4af37', 'border-radius:16px', 'padding:16px 20px',
            'max-width:360px', 'width:90%', 'z-index:99999',
            'box-shadow:0 0 30px rgba(212,175,55,0.5)', 'text-align:center',
            'animation:notifBannerIn 0.4s ease'
        ].join(';');
        banner.innerHTML = `
            <style>
                @keyframes notifBannerIn {
                    from { opacity:0; transform:translateX(-50%) translateY(30px); }
                    to   { opacity:1; transform:translateX(-50%) translateY(0); }
                }
            </style>
            <div style="font-size:28px;margin-bottom:6px;">🔔</div>
            <p style="color:#d4af37;font-weight:bold;font-size:15px;margin:0 0 6px;">¡Activa las notificaciones!</p>
            <p style="color:#ccc;font-size:13px;margin:0 0 14px;">Recibe regalos y promociones exclusivas al instante.</p>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="notifBannerActivate" style="background:linear-gradient(135deg,#d4af37 0%,#f7931e 100%);color:#000;border:none;padding:9px 18px;border-radius:20px;font-weight:700;font-size:13px;cursor:pointer;">🔔 Activar</button>
                <button id="notifBannerClose" style="background:rgba(255,255,255,0.1);color:#888;border:1px solid #444;padding:9px 14px;border-radius:20px;font-size:13px;cursor:pointer;">Ahora no</button>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('notifBannerActivate').addEventListener('click', () => {
            VIP.notifications.requestNotificationPermission();
            banner.remove();
        });
        document.getElementById('notifBannerClose').addEventListener('click', () => {
            localStorage.setItem('notifBannerDismissed', '1');
            banner.remove();
        });
    }

    return {
        checkUsernameAvailability,
        handleRegister,
        handleLogin,
        verifyToken,
        handleLogout,
        ensureUserLoaded,
        initializeSession,
        handleChangePassword,
        handleFindUserByPhone,
        handleResetPasswordByPhone,
        updateChangePasswordWhatsAppField
    };

})();

// Window aliases for any HTML onclick / external callers
window.checkUsernameAvailability = VIP.auth.checkUsernameAvailability;
