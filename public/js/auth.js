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

    async function handleLogin(e) {
        e.preventDefault();

        const loginMode = window._loginMode || 'username';
        const username = loginMode === 'username' ? document.getElementById('username').value : null;
        const phonePrefix = loginMode === 'phone' ? (document.getElementById('loginPhonePrefix')?.value || '+54') : null;
        const phoneNumber = loginMode === 'phone' ? document.getElementById('loginPhone')?.value?.trim() : null;
        const phone = loginMode === 'phone' ? (phonePrefix + (phoneNumber || '').replace(/\D/g, '')) : null;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('errorMessage');
        const loginBtn = document.querySelector('#loginForm button[type="submit"]');

        if (loginMode === 'phone' && (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 7)) {
            errorDiv.textContent = 'Ingresá un número de celular válido';
            errorDiv.classList.add('show');
            return;
        }

        if (loginMode === 'username' && !username) {
            errorDiv.textContent = 'Ingresá tu usuario';
            errorDiv.classList.add('show');
            return;
        }

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

            const loginPayload = loginMode === 'phone'
                ? { phone, password }
                : { username, password };

            const response = await fetch(`${VIP.config.API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(loginPayload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            clearTimeout(loginTimeout);

            const data = await response.json();

            if (response.ok) {
                VIP.state.currentToken = data.token;
                VIP.state.currentUser = { ...data.user, id: data.user.id, userId: data.user.id };
                localStorage.setItem('userToken', VIP.state.currentToken);

                // Guardar contraseña en memoria de sesión para mostrarla en el modal de plataforma
                VIP.state.sessionPassword = password;

                // Guardar token de JUGAYGANA en sessionStorage (expira al cerrar el navegador)
                if (data.jugayganaToken) {
                    VIP.state.jugayganaToken = data.jugayganaToken;
                    sessionStorage.setItem('jugayganaToken', data.jugayganaToken);
                } else {
                    VIP.state.jugayganaToken = null;
                    sessionStorage.removeItem('jugayganaToken');
                }

                try {
                    await initializeSession(false);
                } catch (initError) {
                    console.error('Error inicializando sesión:', initError);
                }

                if (data.user.needsPasswordChange) {
                    VIP.state.passwordChangePending = true;
                    prepareChangePasswordModal();
                    VIP.ui.showModal('changePasswordModal');
                }

                VIP.notifications.requestNotificationPermission();
                VIP.notifications.sendFcmTokenAfterLogin();
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
        VIP.state.sessionPassword = '';
        localStorage.removeItem('userToken');
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
        // Solo consideramos teléfono válido si está verificado
        const existingPhone = VIP.state.currentUser && VIP.state.currentUser.phoneVerified && VIP.state.currentUser.phone
            ? VIP.state.currentUser.phone
            : (VIP.state.currentUser && VIP.state.currentUser.whatsapp) || null;

        if (whatsappGroup) {
            if (existingPhone) {
                whatsappGroup.style.display = 'none';
                if (whatsappInput) whatsappInput.removeAttribute('required');
            } else {
                whatsappGroup.style.display = '';
                if (whatsappInput) whatsappInput.setAttribute('required', '');
            }
        }
        if (whatsappInfo) {
            whatsappInfo.style.display = existingPhone ? 'block' : 'none';
            whatsappInfo.textContent = existingPhone ? `✅ Teléfono ya registrado: ${existingPhone}` : '';
        }

        // Actualizar título, subtítulo y botón de cierre según si el cambio es obligatorio
        const closeBtn = document.getElementById('changePasswordCloseBtn');
        const title = document.getElementById('changePasswordTitle');
        const subtitle = document.getElementById('changePasswordSubtitle');
        if (VIP.state.passwordChangePending) {
            if (closeBtn) closeBtn.style.display = 'none';
            if (title) title.textContent = '🔐 Cambio de Contraseña Obligatorio';
            if (subtitle) subtitle.innerHTML = 'Por seguridad, <strong>debés cambiar tu contraseña</strong> antes de continuar. No podés omitir este paso.';
        } else {
            if (closeBtn) closeBtn.style.display = '';
            if (title) title.textContent = '🔐 Cambiar Contraseña';
            if (subtitle) subtitle.textContent = 'Ingresá tu nueva contraseña para actualizarla.';
        }
    }

    async function handleChangePassword(e) {
        e.preventDefault();

        const newPassword = document.getElementById('newPasswordInput').value;
        const confirmPassword = document.getElementById('confirmPasswordInput').value;
        const whatsappRaw = (document.getElementById('changePasswordWhatsApp')?.value || '').trim();
        const whatsappPrefix = (document.getElementById('changePasswordWhatsAppPrefix')?.value || '+54').trim();
        const errorDiv = document.getElementById('passwordError');

        // Solo consideramos teléfono válido si está verificado
        const existingPhone = VIP.state.currentUser && VIP.state.currentUser.phoneVerified && VIP.state.currentUser.phone
            ? VIP.state.currentUser.phone
            : (VIP.state.currentUser && VIP.state.currentUser.whatsapp) || null;
        // Construir número completo solo si se ingresó uno nuevo
        const whatsappFull = whatsappRaw ? (whatsappPrefix + whatsappRaw.replace(/^0+/, '')) : '';
        const whatsapp = whatsappFull || existingPhone || '';

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
        if (!existingPhone) {
            const digits = (whatsappFull || '').replace(/\D/g, '');
            if (!whatsappRaw || digits.length <= 10) {
                errorDiv.textContent = 'El número de WhatsApp es obligatorio (más de 10 dígitos con prefijo internacional)';
                errorDiv.classList.add('show');
                return;
            }
        }

        const closeAllSessions = document.getElementById('closeAllSessions').checked;

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ newPassword, whatsapp, closeAllSessions })
            });

            if (response.ok) {
                VIP.state.passwordChangePending = false;
                // Actualizar contraseña en memoria de sesión para el modal de plataforma
                VIP.state.sessionPassword = newPassword;
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

        if (mode === 'phone') {
            if (usernameGroup) usernameGroup.classList.add('hidden');
            if (phoneGroup) phoneGroup.classList.remove('hidden');
            if (usernameInput) usernameInput.removeAttribute('required');
            if (usernameBtn) { usernameBtn.style.background = 'transparent'; usernameBtn.style.color = '#888'; usernameBtn.style.fontWeight = 'normal'; }
            if (phoneBtn) { phoneBtn.style.background = 'rgba(212,175,55,0.2)'; phoneBtn.style.color = '#d4af37'; phoneBtn.style.fontWeight = '600'; }
        } else {
            if (usernameGroup) usernameGroup.classList.remove('hidden');
            if (phoneGroup) phoneGroup.classList.add('hidden');
            if (usernameInput) usernameInput.setAttribute('required', '');
            if (usernameBtn) { usernameBtn.style.background = 'rgba(212,175,55,0.2)'; usernameBtn.style.color = '#d4af37'; usernameBtn.style.fontWeight = '600'; }
            if (phoneBtn) { phoneBtn.style.background = 'transparent'; phoneBtn.style.color = '#888'; phoneBtn.style.fontWeight = 'normal'; }
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
        handleFindUserByPhone,
        handleResetPasswordByPhone,
        handleRequestPasswordReset,
        handleVerifyResetOtp,
        handleCompletePasswordReset,
        prepareChangePasswordModal,
        switchLoginMode
    };

})();

// Window aliases for any HTML onclick / external callers
window.checkUsernameAvailability = VIP.auth.checkUsernameAvailability;
window.handleRegisterSendOtp = VIP.auth.handleRegisterSendOtp;
window.handleRegisterWithOtp = VIP.auth.handleRegisterWithOtp;
window.handleRequestPasswordReset = VIP.auth.handleRequestPasswordReset;
window.handleVerifyResetOtp = VIP.auth.handleVerifyResetOtp;
window.handleCompletePasswordReset = VIP.auth.handleCompletePasswordReset;
window.switchLoginMode = VIP.auth.switchLoginMode;
