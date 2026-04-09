// ========================================
// APP - Main entry point
// Wires up all VIP modules and event listeners.
// Load order in HTML must be:
//   config.js → notifications.js → ui.js → chat.js →
//   socket.js → auth.js → refunds.js → fire.js → app.js
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    if (VIP.state.currentToken) {
        VIP.auth.verifyToken();
    }
    setupEventListeners();

    // Auto-fill referral code from URL ?ref=CODE
    const urlParams = new URLSearchParams(window.location.search);
    const refCode   = urlParams.get('ref');
    if (refCode) {
        const refInput = document.getElementById('registerReferralCode');
        if (refInput) refInput.value = refCode.toUpperCase();
        const registerBtn = document.getElementById('registerBtn');
        if (registerBtn) {
            registerBtn.style.background = 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)';
            registerBtn.textContent = '🤝 Registrarse con código de referido';
        }
    }

    VIP.notifications.registerUserServiceWorker();

    VIP.ui.adjustLayout();
});

window.addEventListener('load', VIP.ui.adjustLayout);
window.addEventListener('resize', VIP.ui.adjustLayout);
window.addEventListener('orientationchange', () => setTimeout(VIP.ui.adjustLayout, 150));

// Escape key: close lightbox (if no mandatory password change pending)
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (VIP.state.passwordChangePending) {
            e.preventDefault();
            return;
        }
        const lightbox = document.getElementById('lightbox');
        if (lightbox && lightbox.classList.contains('active')) {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
});

function setupEventListeners() {
    // Login / logout
    document.getElementById('loginForm').addEventListener('submit', VIP.auth.handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', VIP.auth.handleLogout);
    document.getElementById('helpBtn').addEventListener('click', () => {
        window.open('https://wa.link/metawin2026', '_blank');
    });
    document.getElementById('installBtn').addEventListener('click', VIP.ui.installApp);

    const headerInstallBtn = document.getElementById('headerInstallBtn');
    if (headerInstallBtn) headerInstallBtn.addEventListener('click', VIP.ui.installApp);

    const appInstallBtn = document.getElementById('appInstallBtn');
    if (appInstallBtn) appInstallBtn.addEventListener('click', VIP.ui.installApp);

    // Register modal
    document.getElementById('registerBtn').addEventListener('click', () => VIP.ui.showModal('registerModal'));
    document.getElementById('closeRegisterModal').addEventListener('click', () => VIP.ui.hideModal('registerModal'));
    document.getElementById('registerForm').addEventListener('submit', VIP.auth.handleRegister);

    // Chat send
    document.getElementById('sendBtn').addEventListener('click', VIP.chat.sendMessage);

    const messageInput = document.getElementById('messageInput');
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            VIP.chat.sendMessage();
        }
    });

    // Typing indicator
    let typingTimeout;
    messageInput.addEventListener('input', function () {
        if (VIP.state.socket) {
            VIP.state.socket.emit('typing', { isTyping: true });
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                VIP.state.socket.emit('stop_typing', {});
            }, 2000);
        }
    });

    // File attach & paste
    document.getElementById('attachBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', VIP.chat.handleFileSelect);
    document.getElementById('messageInput').addEventListener('paste', VIP.chat.handlePaste);

    // Auto-resize textarea
    const textarea = document.getElementById('messageInput');
    textarea.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    // Refund buttons
    document.getElementById('dailyRefundBtn').addEventListener('click', () => VIP.refunds.showRefundModal('daily'));
    document.getElementById('weeklyRefundBtn').addEventListener('click', () => VIP.refunds.showRefundModal('weekly'));
    document.getElementById('monthlyRefundBtn').addEventListener('click', () => VIP.refunds.showRefundModal('monthly'));
    document.getElementById('closeRefundModal').addEventListener('click', () => VIP.ui.hideModal('refundModal'));

    // Fire (Fueguito)
    const fireBtn = document.getElementById('fireBtn');
    if (fireBtn) {
        fireBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('🔥 Fueguito clickeado');
            VIP.fire.showFireModal();
        });
    }
    document.getElementById('closeFireModal').addEventListener('click', () => VIP.ui.hideModal('fireModal'));
    document.getElementById('claimFireBtn').addEventListener('click', VIP.fire.claimFire);

    // Referrals
    document.getElementById('referralBtn').addEventListener('click', () => VIP.ui.openReferralModal());

    // Info modal
    document.getElementById('infoBtn').addEventListener('click', () => VIP.ui.showModal('infoModal'));
    document.getElementById('closeInfoModal').addEventListener('click', () => VIP.ui.hideModal('infoModal'));

    // CBU
    document.getElementById('cbuChatBtn').addEventListener('click', VIP.ui.loadAndShowCBU);

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => VIP.ui.showModal('settingsModal'));
    document.getElementById('closeSettingsModal').addEventListener('click', () => VIP.ui.hideModal('settingsModal'));
    document.getElementById('changePasswordSettingsBtn').addEventListener('click', () => {
        VIP.ui.hideModal('settingsModal');
        VIP.auth.updateChangePasswordWhatsAppField();
        VIP.ui.showModal('changePasswordModal');
    });

    // Find user by phone
    document.getElementById('findUserBtn').addEventListener('click', () => VIP.ui.showModal('findUserModal'));
    document.getElementById('findUserForm').addEventListener('submit', VIP.auth.handleFindUserByPhone);

    // Forgot password (on login screen)
    const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
    if (forgotPasswordBtn) {
        forgotPasswordBtn.addEventListener('click', () => VIP.ui.showModal('resetPassModal'));
    }

    // Reset password by phone
    document.getElementById('resetPassForm').addEventListener('submit', VIP.auth.handleResetPasswordByPhone);

    // Change password
    document.getElementById('changePasswordForm').addEventListener('submit', VIP.auth.handleChangePassword);
}
