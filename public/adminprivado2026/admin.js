// ========================================
// PANEL DE ADMINISTRACIÓN - SALA DE JUEGOS
// ========================================

const API_URL = '';

// ========================================
// SONIDO DE NOTIFICACIÓN
// ========================================

let notificationSound = null;
let lastMessageCount = 0;

// Inicializar sonido de notificación
function initNotificationSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            notificationSound = new AudioContext();
        }
    } catch (e) {
        console.log('AudioContext no soportado');
    }
}

// Reproducir sonido de notificación
function playNotificationSound() {
    if (!notificationSound) {
        initNotificationSound();
    }
    
    try {
        if (notificationSound) {
            const oscillator = notificationSound.createOscillator();
            const gainNode = notificationSound.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(notificationSound.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, notificationSound.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, notificationSound.currentTime + 0.5);
            
            oscillator.start(notificationSound.currentTime);
            oscillator.stop(notificationSound.currentTime + 0.5);
        }
    } catch (e) {
        console.log('Error reproduciendo sonido:', e);
    }
}

// ========================================
let currentAdmin = null;
let currentToken = localStorage.getItem('adminToken');
let selectedUserId = null;
let conversations = [];
let users = [];
let messagePollingInterval = null;
let selectedBonusPercent = 0; // Variable global para el porcentaje de bonus
let customCommands = {}; // Comandos personalizados cargados del servidor
let socket = null; // Socket.IO connection
let currentChatFilter = 'open'; // 'open' o 'closed'

// ========================================
// INICIALIZACIÓN
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin JS cargado');
    
    // Setup login button
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', doLogin);
    }
    
    // Enter en password también hace login
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                doLogin();
            }
        });
    }
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', doLogout);
    }
    
    // Navegación
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.dataset.section;
            showSection(section);
        });
    });
    
    // Chats
    const refreshChats = document.getElementById('refreshChats');
    if (refreshChats) {
        refreshChats.addEventListener('click', loadConversations);
    }
    
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', sendMessage);
    }
    
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
            // Navegación en autocompletado
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab' || e.key === 'Escape') {
                handleAutocompleteNavigation(e);
            }
        });
        
        // Autocompletado de comandos
        messageInput.addEventListener('input', handleCommandAutocomplete);
        
        // Indicador "Escribiendo..."
        let typingTimeout;
        messageInput.addEventListener('input', function() {
            if (selectedUserId && socket) {
                socket.emit('typing', { receiverId: selectedUserId, isTyping: true });
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    socket.emit('stop_typing', { receiverId: selectedUserId });
                }, 2000);
            }
        });
    }
    
    const viewUserBtn = document.getElementById('viewUserBtn');
    if (viewUserBtn) {
        viewUserBtn.addEventListener('click', function() {
            if (selectedUserId) {
                viewUserDetails(selectedUserId);
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Adjuntar archivo
    const attachFileBtn = document.getElementById('attachFileBtn');
    if (attachFileBtn) {
        attachFileBtn.addEventListener('click', function() {
            document.getElementById('adminFileInput').click();
        });
    }
    
    const adminFileInput = document.getElementById('adminFileInput');
    if (adminFileInput) {
        adminFileInput.addEventListener('change', handleFileUpload);
    }
    
    // Depósito/Retiro desde admin
    const depositUserBtn = document.getElementById('depositUserBtn');
    if (depositUserBtn) {
        depositUserBtn.addEventListener('click', function() {
            if (selectedUserId) {
                openAdminDepositModal();
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    const withdrawUserBtn = document.getElementById('withdrawUserBtn');
    if (withdrawUserBtn) {
        withdrawUserBtn.addEventListener('click', function() {
            if (selectedUserId) {
                openAdminWithdrawModal();
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Botón CBU
    const cbuBtn = document.getElementById('cbuBtn');
    if (cbuBtn) {
        cbuBtn.addEventListener('click', function() {
            if (selectedUserId) {
                sendCBU();
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Botón cerrar chat
    const closeChatBtn = document.getElementById('closeChatBtn');
    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', function() {
            if (selectedUserId) {
                closeChat(selectedUserId);
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Botón abrir chat
    const openChatBtn = document.getElementById('openChatBtn');
    if (openChatBtn) {
        openChatBtn.addEventListener('click', function() {
            if (selectedUserId) {
                reopenChat(selectedUserId);
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Botón cambiar contraseña desde el chat
    const changePasswordChatBtn = document.getElementById('changePasswordChatBtn');
    if (changePasswordChatBtn) {
        changePasswordChatBtn.addEventListener('click', function() {
            if (selectedUserId) {
                openChangePasswordModal(selectedUserId);
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Botón enviar a PAGOS
    const sendToPagosBtn = document.getElementById('sendToPagosBtn');
    if (sendToPagosBtn) {
        sendToPagosBtn.addEventListener('click', function() {
            if (selectedUserId) {
                sendToPagos(selectedUserId);
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Botón volver a CARGAS (para withdrawer)
    const backToCargasBtn = document.getElementById('backToCargasBtn');
    if (backToCargasBtn) {
        backToCargasBtn.addEventListener('click', function() {
            if (selectedUserId) {
                backToCargas(selectedUserId);
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Cerrar modales
    const closeAdminDepositModal = document.getElementById('closeAdminDepositModal');
    if (closeAdminDepositModal) {
        closeAdminDepositModal.addEventListener('click', function() { hideModal('adminDepositModal'); });
    }
    
    const cancelAdminDeposit = document.getElementById('cancelAdminDeposit');
    if (cancelAdminDeposit) {
        cancelAdminDeposit.addEventListener('click', function() { hideModal('adminDepositModal'); });
    }
    
    const adminDepositForm = document.getElementById('adminDepositForm');
    if (adminDepositForm) {
        adminDepositForm.addEventListener('submit', handleAdminDeposit);
    }
    
    const closeAdminWithdrawModal = document.getElementById('closeAdminWithdrawModal');
    if (closeAdminWithdrawModal) {
        closeAdminWithdrawModal.addEventListener('click', function() { hideModal('adminWithdrawModal'); });
    }
    
    const cancelAdminWithdraw = document.getElementById('cancelAdminWithdraw');
    if (cancelAdminWithdraw) {
        cancelAdminWithdraw.addEventListener('click', function() { hideModal('adminWithdrawModal'); });
    }
    
    const adminWithdrawForm = document.getElementById('adminWithdrawForm');
    if (adminWithdrawForm) {
        adminWithdrawForm.addEventListener('submit', handleAdminWithdraw);
    }
    
    // Botones de carga rápida - Depósito
    document.querySelectorAll('.quick-deposit').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const amount = this.dataset.amount;
            document.getElementById('adminDepositAmount').value = amount;
            // Recalcular bonus solo si hay un porcentaje seleccionado (> 0)
            if (selectedBonusPercent > 0) {
                calculateBonus();
            } else {
                // Limpiar el campo de bonus si no hay porcentaje seleccionado
                document.getElementById('adminBonusAmount').value = '';
                document.getElementById('bonusInfo').style.display = 'none';
            }
        });
    });
    
    // Botones de bonificación
    document.querySelectorAll('.bonus-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            selectedBonusPercent = parseInt(this.dataset.bonus);
            
            // Quitar selección de todos los botones
            document.querySelectorAll('.bonus-btn').forEach(function(b) {
                b.style.transform = 'scale(1)';
                b.style.boxShadow = 'none';
                b.classList.remove('bonus-selected');
            });
            
            // Marcar este como seleccionado
            this.style.transform = 'scale(1.1)';
            this.classList.add('bonus-selected');
            
            if (selectedBonusPercent === 0) {
                this.style.boxShadow = '0 0 10px rgba(255,255,255,0.3)';
            } else {
                this.style.boxShadow = '0 0 15px rgba(255, 215, 0, 0.6)';
            }
            
            calculateBonus();
        });
    });
    
    // Calcular bonus cuando cambia el monto
    const depositAmountInput = document.getElementById('adminDepositAmount');
    if (depositAmountInput) {
        depositAmountInput.addEventListener('input', calculateBonus);
    }
    
    function calculateBonus() {
        const amount = parseFloat(document.getElementById('adminDepositAmount').value) || 0;
        
        // Asegurar que selectedBonusPercent sea un número válido
        if (typeof selectedBonusPercent !== 'number' || isNaN(selectedBonusPercent)) {
            selectedBonusPercent = 0;
        }
        
        const bonusAmount = Math.round(amount * selectedBonusPercent / 100);
        
        // Solo mostrar bonus si es mayor a 0
        if (bonusAmount > 0) {
            document.getElementById('adminBonusAmount').value = bonusAmount;
            const bonusInfo = document.getElementById('bonusInfo');
            bonusInfo.textContent = `Se agregará $${bonusAmount.toLocaleString()} como BONIFICACIÓN (+${selectedBonusPercent}%)`;
            bonusInfo.style.display = 'block';
        } else {
            document.getElementById('adminBonusAmount').value = '';
            document.getElementById('bonusInfo').style.display = 'none';
        }
    }
    
    // Botones de carga rápida - Retiro
    document.querySelectorAll('.quick-withdraw').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const amount = this.dataset.amount;
            document.getElementById('adminWithdrawAmount').value = amount;
        });
    });
    
    // Buscador de chats
    const chatSearch = document.getElementById('chatSearch');
    if (chatSearch) {
        chatSearch.addEventListener('input', function(e) {
            filterConversations(e.target.value);
        });
    }
    
    // Crear usuario
    const createUserBtn = document.getElementById('createUserBtn');
    if (createUserBtn) {
        createUserBtn.addEventListener('click', openCreateUserModal);
    }
    
    const closeCreateModal = document.getElementById('closeCreateModal');
    if (closeCreateModal) {
        closeCreateModal.addEventListener('click', function() { hideModal('createUserModal'); });
    }
    
    const cancelCreate = document.getElementById('cancelCreate');
    if (cancelCreate) {
        cancelCreate.addEventListener('click', function() { hideModal('createUserModal'); });
    }
    
    const createUserForm = document.getElementById('createUserForm');
    if (createUserForm) {
        createUserForm.addEventListener('submit', handleCreateUser);
    }
    
    // Editar usuario
    const closeViewModal = document.getElementById('closeViewModal');
    if (closeViewModal) {
        closeViewModal.addEventListener('click', function() { hideModal('viewUserModal'); });
    }
    
    const closeViewBtn = document.getElementById('closeViewBtn');
    if (closeViewBtn) {
        closeViewBtn.addEventListener('click', function() { hideModal('viewUserModal'); });
    }
    
    const editUserBtn = document.getElementById('editUserBtn');
    if (editUserBtn) {
        editUserBtn.addEventListener('click', function() {
            hideModal('viewUserModal');
            openEditUserModal();
        });
    }
    
    const closeEditModal = document.getElementById('closeEditModal');
    if (closeEditModal) {
        closeEditModal.addEventListener('click', function() { hideModal('editUserModal'); });
    }
    
    const cancelEdit = document.getElementById('cancelEdit');
    if (cancelEdit) {
        cancelEdit.addEventListener('click', function() { hideModal('editUserModal'); });
    }
    
    const editUserForm = document.getElementById('editUserForm');
    if (editUserForm) {
        editUserForm.addEventListener('submit', handleEditUser);
    }
    
    // Verificar token existente
    if (currentToken) {
        verifyToken();
    } else {
        showLogin();
    }
});

// ========================================
// LOGIN
// ========================================

async function doLogin() {
    console.log('doLogin llamado');
    
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorDiv = document.getElementById('loginError');
    
    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    
    console.log('Intentando login con:', username);
    
    if (!username || !password) {
        errorDiv.textContent = 'Ingresa usuario y contraseña';
        errorDiv.style.display = 'block';
        return;
    }
    
    errorDiv.style.display = 'none';
    
    // Mostrar cargando
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.textContent = 'Ingresando...';
        loginBtn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        console.log('Respuesta login:', data);
        
        if (response.ok && data.token) {
            // Permitir admin, depositor y withdrawer
            const allowedRoles = ['admin', 'depositor', 'withdrawer'];
            if (!allowedRoles.includes(data.user.role)) {
                errorDiv.textContent = 'Acceso denegado. Solo administradores.';
                errorDiv.style.display = 'block';
                if (loginBtn) {
                    loginBtn.textContent = 'Ingresar';
                    loginBtn.disabled = false;
                }
                return;
            }
            
            currentToken = data.token;
            currentAdmin = data.user;
            localStorage.setItem('adminToken', currentToken);
            
            showDashboard();
            loadData();
            startMessagePolling();
            initSocket();
        } else {
            errorDiv.textContent = data.error || 'Usuario o contraseña incorrectos';
            errorDiv.style.display = 'block';
            if (loginBtn) {
                loginBtn.textContent = 'Ingresar';
                loginBtn.disabled = false;
            }
        }
    } catch (error) {
        console.error('Error login:', error);
        errorDiv.textContent = 'Error de conexión';
        errorDiv.style.display = 'block';
        if (loginBtn) {
            loginBtn.textContent = 'Ingresar';
            loginBtn.disabled = false;
        }
    }
}

async function verifyToken() {
    try {
        const response = await fetch('/api/auth/verify', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const data = await response.json();
            // Permitir admin, depositor y withdrawer
            const allowedRoles = ['admin', 'depositor', 'withdrawer'];
            if (allowedRoles.includes(data.user.role)) {
                currentAdmin = data.user;
                showDashboard();
                loadData();
                startMessagePolling();
                initSocket();
                return;
            }
        }
        
        localStorage.removeItem('adminToken');
        showLogin();
    } catch (error) {
        localStorage.removeItem('adminToken');
        showLogin();
    }
}

function doLogout() {
    currentToken = null;
    currentAdmin = null;
    localStorage.removeItem('adminToken');
    stopMessagePolling();
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    showLogin();
}

// ========================================
// SOCKET.IO - Conexión en tiempo real
// ========================================

function initSocket() {
    if (socket) return; // Ya inicializado
    
    socket = io();
    
    // Autenticar socket
    socket.emit('authenticate', currentToken);
    
    socket.on('authenticated', function(data) {
        if (data.success) {
            console.log('✅ Socket autenticado como:', data.role);
        } else {
            console.error('❌ Error autenticando socket:', data.error);
        }
    });
    
    // Escuchar cuando un usuario está escribiendo
    socket.on('user_typing', function(data) {
        if (data.userId === selectedUserId) {
            const typingIndicator = document.getElementById('typingIndicator');
            if (typingIndicator) {
                typingIndicator.style.display = 'inline';
                typingIndicator.textContent = '✍️ ' + data.username + ' está escribiendo...';
            }
        }
    });
    
    // Escuchar cuando un usuario deja de escribir
    socket.on('user_stop_typing', function(data) {
        if (data.userId === selectedUserId) {
            const typingIndicator = document.getElementById('typingIndicator');
            if (typingIndicator) {
                typingIndicator.style.display = 'none';
            }
        }
    });
    
    // Escuchar nuevos mensajes
    socket.on('new_message', function(data) {
        if (data.senderId === selectedUserId) {
            loadMessages(selectedUserId);
            playNotificationSound();
        }
        loadConversations();
    });
}

// ========================================
// UI
// ========================================

function showLogin() {
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    
    if (loginScreen) loginScreen.classList.remove('hidden');
    if (dashboard) dashboard.classList.add('hidden');
    
    // Resetear botón
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.textContent = 'Ingresar';
        loginBtn.disabled = false;
    }
}

function showDashboard() {
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    const adminName = document.getElementById('adminName');
    
    if (loginScreen) loginScreen.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');
    if (adminName && currentAdmin) adminName.textContent = currentAdmin.username;
    
    // Configurar UI según el rol
    configureUIBasedOnRole();
}

function showSection(section) {
    // Ocultar TODAS las secciones de contenido primero
    document.querySelectorAll('.content-section').forEach(function(s) {
        s.classList.add('hidden');
    });
    
    // Actualizar navegación activa
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.classList.remove('active');
    });
    
    const navItem = document.querySelector('.nav-item[data-section="' + section + '"]');
    if (navItem) navItem.classList.add('active');
    
    // Si es base de datos, mostrar la sección y el modal de contraseña
    if (section === 'database') {
        // Mostrar la sección de base de datos
        const sectionEl = document.getElementById('databaseSection');
        if (sectionEl) {
            sectionEl.classList.remove('hidden');
        }
        
        // Mostrar modal de contraseña
        const modal = document.getElementById('databasePasswordModal');
        if (modal) {
            modal.style.display = 'flex';
            // Limpiar input
            const input = document.getElementById('databasePasswordInput');
            if (input) input.value = '';
            // Ocultar error
            const error = document.getElementById('databasePasswordError');
            if (error) error.style.display = 'none';
            // Focus en el input
            setTimeout(function() { if (input) input.focus(); }, 100);
        }
        return;
    }
    
    // Mostrar la sección seleccionada
    const sectionEl = document.getElementById(section + 'Section');
    if (sectionEl) {
        sectionEl.classList.remove('hidden');
    }
    
    // Cargar datos según la sección
    if (section === 'users') {
        loadUsers();
    } else if (section === 'chats') {
        loadConversations();
    } else if (section === 'stats') {
        loadStats();
    } else if (section === 'transactions') {
        loadTransactions();
    } else if (section === 'commands') {
        loadCommandsFromServer();
    } else if (section === 'pagos') {
        loadPagosConversations();
    } else if (section === 'refunds') {
        loadRefunds();
    }
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(function() {
        toast.remove();
    }, 3000);
}

// ========================================
// DATOS
// ========================================

async function loadData() {
    loadStats();
    loadUsers();
    loadConversations();
}

async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const stats = await response.json();
            const statUsers = document.getElementById('statUsers');
            const statOnline = document.getElementById('statOnline');
            
            if (statUsers) statUsers.textContent = stats.totalUsers || 0;
            if (statOnline) statOnline.textContent = stats.onlineUsers || 0;
        }
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

async function loadUsers() {
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            users = await response.json();
            renderUsers(users);
        }
    } catch (error) {
        console.error('Error cargando usuarios:', error);
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: #888;">No hay usuarios</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(function(user) {
        return '<tr>' +
            '<td>' + user.username + '</td>' +
            '<td>' + (user.accountNumber || '-') + '</td>' +
            '<td>' + (user.email || '-') + '</td>' +
            '<td>' + (user.phone || '-') + '</td>' +
            '<td>' + (user.jugayganaUsername || user.jugayganaSyncStatus === 'synced' ? '✅' : user.jugayganaSyncStatus === 'linked' ? '✅' : '⏳') + '</td>' +
            '<td>$' + (user.balance || 0).toLocaleString() + '</td>' +
            '<td><span class="status-badge ' + (user.isActive ? 'active' : 'inactive') + '">' + (user.isActive ? 'Activo' : 'Inactivo') + '</span></td>' +
            '<td>' + (user.lastLogin ? new Date(user.lastLogin).toLocaleDateString('es-AR') : 'Nunca') + '</td>' +
            '<td>' +
                '<button class="btn btn-small" onclick="viewUserDetails(\'' + user.id + '\')" title="Ver detalles">👁️</button>' +
                '<button class="btn btn-small" onclick="openEditUserModal(\'' + user.id + '\')" title="Editar usuario" style="margin-left: 5px;">✏️</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

async function viewUserDetails(userId) {
    const user = users.find(function(u) { return u.id === userId; });
    if (!user) return;
    
    // Guardar el usuario seleccionado para edición
    selectedUserId = userId;
    
    const userDetails = document.getElementById('userDetails');
    if (userDetails) {
        userDetails.innerHTML = 
            '<div class="detail-row">' +
                '<span class="detail-label">Usuario:</span>' +
                '<span class="detail-value">' + user.username + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">Email:</span>' +
                '<span class="detail-value">' + (user.email || 'No especificado') + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">Teléfono:</span>' +
                '<span class="detail-value">' + (user.phone || 'No especificado') + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">Rol:</span>' +
                '<span class="detail-value">' + user.role + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">Estado:</span>' +
                '<span class="detail-value">' + (user.isActive ? 'Activo' : 'Inactivo') + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">Balance:</span>' +
                '<span class="detail-value">$' + (user.balance || 0).toLocaleString() + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">Cuenta:</span>' +
                '<span class="detail-value">' + (user.accountNumber || '-') + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">Fecha de creación:</span>' +
                '<span class="detail-value">' + new Date(user.createdAt).toLocaleString('es-AR') + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
                '<span class="detail-label">JUGAYGANA:</span>' +
                '<span class="detail-value">' + (user.jugayganaSyncStatus === 'synced' ? '✅ Sincronizado' : user.jugayganaSyncStatus === 'linked' ? '✅ Vinculado' : '⏳ Pendiente') + '</span>' +
            '</div>' +
            '<div class="detail-row" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(212, 175, 55, 0.3);">' +
                '<button class="btn btn-primary" onclick="openChangePasswordModal(\'' + userId + '\')" style="width: 100%;">🔑 Cambiar Contraseña</button>' +
            '</div>';
    }
    
    showModal('viewUserModal');
}

function openCreateUserModal() {
    const form = document.getElementById('createUserForm');
    if (form) form.reset();
    showModal('createUserModal');
}

function openAdminDepositModal() {
    // Limpiar todos los campos
    const form = document.getElementById('adminDepositForm');
    if (form) form.reset();
    
    document.getElementById('adminDepositAmount').value = '';
    document.getElementById('adminBonusAmount').value = '';
    document.getElementById('adminDepositDescription').value = '';
    document.getElementById('bonusInfo').style.display = 'none';
    
    // Resetear selección de bonus a SIN BONUS (0%)
    selectedBonusPercent = 0;
    document.querySelectorAll('.bonus-btn').forEach(function(b) {
        b.style.transform = 'scale(1)';
        b.style.boxShadow = 'none';
        b.classList.remove('bonus-selected');
        if (b.dataset.bonus === '0') {
            b.style.transform = 'scale(1.1)';
            b.style.boxShadow = '0 0 10px rgba(255,255,255,0.3)';
            b.classList.add('bonus-selected');
        }
    });
    
    showModal('adminDepositModal');
}

function openAdminWithdrawModal() {
    // Limpiar todos los campos
    const form = document.getElementById('adminWithdrawForm');
    if (form) form.reset();
    
    document.getElementById('adminWithdrawAmount').value = '';
    document.getElementById('adminWithdrawDescription').value = '';
    
    showModal('adminWithdrawModal');
}

async function handleCreateUser(e) {
    e.preventDefault();
    
    const data = {
        username: document.getElementById('newUsername').value.trim(),
        email: document.getElementById('newEmail').value.trim(),
        phone: document.getElementById('newPhone').value.trim(),
        password: document.getElementById('newPassword').value,
        role: document.getElementById('newRole').value,
        balance: parseFloat(document.getElementById('newBalance').value) || 0
    };
    
    // Mostrar estado de carga
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : 'Crear Usuario';
    if (submitBtn) {
        submitBtn.textContent = 'Creando...';
        submitBtn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast('Usuario creado exitosamente', 'success');
            hideModal('createUserModal');
            loadUsers();
        } else {
            showToast(result.error || 'Error al crear usuario', 'error');
        }
    } catch (error) {
        showToast('Error de conexión: ' + (error.message || ''), 'error');
    } finally {
        // Restaurar botón
        if (submitBtn) {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    }
}

function openEditUserModal(userId) {
    const user = users.find(function(u) { return u.id === userId; });
    if (!user) {
        showToast('Usuario no encontrado', 'error');
        return;
    }
    
    // Cerrar el modal de ver usuario si está abierto
    hideModal('viewUserModal');
    
    const editUserId = document.getElementById('editUserId');
    const editUsername = document.getElementById('editUsername');
    const editEmail = document.getElementById('editEmail');
    const editPhone = document.getElementById('editPhone');
    const editRole = document.getElementById('editRole');
    const editStatus = document.getElementById('editStatus');
    const editPassword = document.getElementById('editPassword');
    const editBalance = document.getElementById('editBalance');
    
    if (editUserId) editUserId.value = user.id;
    if (editUsername) editUsername.value = user.username;
    if (editEmail) editEmail.value = user.email || '';
    if (editPhone) editPhone.value = user.phone || '';
    if (editRole) editRole.value = user.role;
    if (editStatus) editStatus.value = user.isActive ? 'true' : 'false';
    if (editPassword) editPassword.value = '';
    if (editBalance) editBalance.value = user.balance || 0;
    
    showModal('editUserModal');
}

// Cambiar contraseña de usuario desde el modal de ver usuario
function openChangePasswordModal(userId) {
    const user = users.find(function(u) { return u.id === userId; });
    if (!user) {
        showToast('Usuario no encontrado', 'error');
        return;
    }
    
    // Cerrar el modal de ver usuario
    hideModal('viewUserModal');
    
    // Guardar el ID del usuario para cambiar contraseña
    window.changePasswordUserId = userId;
    
    // Limpiar campos
    const newPasswordInput = document.getElementById('changePasswordNew');
    const confirmPasswordInput = document.getElementById('changePasswordConfirm');
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    
    showModal('changePasswordModal');
}

async function handleChangePassword(e) {
    e.preventDefault();
    
    const userId = window.changePasswordUserId;
    if (!userId) {
        showToast('Error: No se seleccionó usuario', 'error');
        return;
    }
    
    const newPassword = document.getElementById('changePasswordNew').value;
    const confirmPassword = document.getElementById('changePasswordConfirm').value;
    
    if (!newPassword || newPassword.length < 6) {
        showToast('La contraseña debe tener al menos 6 caracteres', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showToast('Las contraseñas no coinciden', 'error');
        return;
    }
    
    // Mostrar estado de carga
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : 'Cambiar Contraseña';
    if (submitBtn) {
        submitBtn.textContent = 'Cambiando...';
        submitBtn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/users/' + userId, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({ password: newPassword })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast('Contraseña cambiada exitosamente', 'success');
            hideModal('changePasswordModal');
            window.changePasswordUserId = null;
        } else {
            showToast(result.error || 'Error al cambiar contraseña', 'error');
        }
    } catch (error) {
        showToast('Error de conexión: ' + (error.message || ''), 'error');
    } finally {
        // Restaurar botón
        if (submitBtn) {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    }
}

async function handleEditUser(e) {
    e.preventDefault();
    
    const userId = document.getElementById('editUserId').value;
    const data = {
        email: document.getElementById('editEmail').value,
        phone: document.getElementById('editPhone').value,
        isActive: document.getElementById('editStatus').value === 'true',
        balance: parseFloat(document.getElementById('editBalance').value) || 0
    };
    
    const newPassword = document.getElementById('editPassword').value;
    if (newPassword && newPassword.trim() !== '') {
        data.password = newPassword.trim();
    }
    
    // Mostrar estado de carga
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : 'Guardar Cambios';
    if (submitBtn) {
        submitBtn.textContent = 'Guardando...';
        submitBtn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/users/' + userId, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast('Usuario actualizado exitosamente', 'success');
            hideModal('editUserModal');
            loadUsers();
        } else {
            showToast(result.error || 'Error al actualizar usuario', 'error');
        }
    } catch (error) {
        showToast('Error de conexión: ' + (error.message || ''), 'error');
    } finally {
        // Restaurar botón
        if (submitBtn) {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    }
}

// ========================================
// CHATS
// ========================================

async function loadConversations() {
    try {
        // Si el filtro es pagos, usar el endpoint de categoría
        let endpoint = '/api/admin/chats/' + currentChatFilter;
        if (currentChatFilter === 'pagos') {
            endpoint = '/api/admin/chats/category/pagos';
        }
        
        const response = await fetch(endpoint, {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const newConversations = await response.json();
            
            // Detectar nuevos mensajes para reproducir sonido
            const currentTotalMessages = newConversations.reduce(function(sum, conv) {
                return sum + (conv.unreadCount || 0);
            }, 0);
            
            if (currentTotalMessages > lastMessageCount && lastMessageCount > 0) {
                playNotificationSound();
            }
            lastMessageCount = currentTotalMessages;
            
            // Solo actualizar DOM si hay cambios
            const hasChanges = JSON.stringify(newConversations) !== JSON.stringify(conversations);
            if (hasChanges || conversations.length === 0) {
                conversations = newConversations;
                renderConversations(conversations);
                
                // Actualizar contador de mensajes sin leer en el badge
                const unreadBadge = document.getElementById('unreadBadge');
                if (unreadBadge) {
                    unreadBadge.textContent = currentTotalMessages;
                    unreadBadge.classList.toggle('hidden', currentTotalMessages === 0);
                }
                
                // Actualizar estadísticas
                const statMessages = document.getElementById('statMessages');
                if (statMessages) {
                    statMessages.textContent = conversations.length;
                }
                
                const statUnread = document.getElementById('statUnread');
                if (statUnread) {
                    statUnread.textContent = currentTotalMessages;
                }
            }
        }
    } catch (error) {
        console.error('❌ Error cargando conversaciones:', error);
    }
}

function renderConversations(conversations) {
    const container = document.getElementById('conversationsList');
    if (!container) return;
    
    if (conversations.length === 0) {
        container.innerHTML = '<div class="empty" style="padding: 40px; text-align: center; color: #888;">No hay conversaciones</div>';
        return;
    }
    
    // Ordenar conversaciones por fecha del último mensaje (más reciente primero)
    conversations.sort(function(a, b) {
        const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp) : new Date(0);
        const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp) : new Date(0);
        return timeB - timeA;
    });
    
    container.innerHTML = conversations.map(function(conv) {
        const lastMsgContent = conv.lastMessage 
            ? (conv.lastMessage.type === 'image' ? '📷 Imagen' : conv.lastMessage.content)
            : 'Sin mensajes';
        const lastMsgTime = conv.lastMessage 
            ? new Date(conv.lastMessage.timestamp).toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'})
            : '';
        const unreadCount = conv.unreadCount || conv.unread || 0;
        
        return '<div class="conversation-item ' + (unreadCount > 0 ? 'unread' : '') + '" data-userid="' + conv.userId + '" style="padding: 15px; border-bottom: 1px solid rgba(212, 175, 55, 0.2); cursor: pointer; transition: all 0.3s;">' +
            '<div style="display: flex; justify-content: space-between; align-items: center;">' +
                '<div style="flex: 1; min-width: 0;">' +
                    '<div class="conv-username" style="font-weight: 600; color: #d4af37; margin-bottom: 4px;">' + conv.username + '</div>' +
                    '<div class="conv-preview" style="font-size: 13px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + lastMsgContent.substring(0, 35) + '</div>' +
                '</div>' +
                '<div style="text-align: right; margin-left: 10px;">' +
                    '<div style="font-size: 11px; color: #666; margin-bottom: 4px;">' + lastMsgTime + '</div>' +
                    (unreadCount > 0 ? '<span class="unread-badge" style="background: #ff4444; color: white; font-size: 11px; padding: 2px 8px; border-radius: 10px;">' + unreadCount + '</span>' : '') +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
    
    container.querySelectorAll('.conversation-item').forEach(function(item) {
        item.addEventListener('click', function() {
            const userId = this.dataset.userid;
            const username = this.querySelector('.conv-username').textContent;
            selectConversation(userId, username);
        });
    });
}

function filterConversations(query) {
    const filtered = conversations.filter(function(c) {
        return c.username.toLowerCase().includes(query.toLowerCase());
    });
    renderConversations(filtered);
}

async function selectConversation(userId, username) {
    selectedUserId = userId;
    
    document.querySelectorAll('.conversation-item').forEach(function(item) {
        item.classList.remove('active');
    });
    
    const activeItem = document.querySelector('.conversation-item[data-userid="' + userId + '"]');
    if (activeItem) activeItem.classList.add('active');
    
    await loadMessages(userId);
    
    // Marcar mensajes como leídos
    await markMessagesAsRead(userId);
    
    const chatPlaceholder = document.getElementById('chatPlaceholder');
    const chatContent = document.getElementById('chatContent');
    const chatUserName = document.getElementById('chatUserName');
    
    if (chatPlaceholder) chatPlaceholder.classList.add('hidden');
    if (chatContent) chatContent.classList.remove('hidden');
    if (chatUserName) chatUserName.textContent = username;
    
    const user = users.find(function(u) { return u.id === userId; });
    if (user) {
        const chatUserStatus = document.getElementById('chatUserStatus');
        if (chatUserStatus) {
            chatUserStatus.textContent = user.isActive ? 'Activo' : 'Inactivo';
            chatUserStatus.className = 'user-status ' + (user.isActive ? 'online' : 'offline');
        }
        // Actualizar balance en el header del chat
        const chatUserBalance = document.getElementById('chatUserBalance');
        if (chatUserBalance) {
            chatUserBalance.textContent = 'Balance: $' + (user.balance || 0).toLocaleString();
        }
    }
    
    // Mostrar/ocultar botones según el estado del chat
    const openChatBtn = document.getElementById('openChatBtn');
    const closeChatBtn = document.getElementById('closeChatBtn');
    
    if (openChatBtn && closeChatBtn) {
        if (currentChatFilter === 'closed') {
            openChatBtn.style.display = 'inline-block';
            closeChatBtn.style.display = 'none';
        } else {
            openChatBtn.style.display = 'none';
            closeChatBtn.style.display = 'inline-block';
        }
    }
    
    // Scroll al final de los mensajes
    scrollToBottom();
}

// Marcar mensajes como leídos
async function markMessagesAsRead(userId) {
    try {
        const response = await fetch('/api/messages/read/' + userId, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            // Actualizar UI inmediatamente - quitar badge de no leídos del chat seleccionado
            const conversationItem = document.querySelector('.conversation-item[data-userid="' + userId + '"]');
            if (conversationItem) {
                const unreadBadge = conversationItem.querySelector('.unread-badge');
                if (unreadBadge) unreadBadge.remove();
                conversationItem.classList.remove('unread');
            }
            
            // Actualizar contador global de no leídos
            const unreadBadge = document.getElementById('unreadBadge');
            if (unreadBadge) {
                const currentCount = parseInt(unreadBadge.textContent) || 0;
                const newCount = Math.max(0, currentCount - 1);
                unreadBadge.textContent = newCount;
                if (newCount === 0) {
                    unreadBadge.classList.add('hidden');
                }
            }
            
            // Actualizar la lista de conversaciones en segundo plano
            loadConversations();
        }
    } catch (error) {
        console.error('Error marcando mensajes como leídos:', error);
    }
}

async function loadMessages(userId) {
    try {
        const response = await fetch('/api/messages/' + userId + '?limit=50', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const messages = await response.json();
            renderMessages(messages);
        }
    } catch (error) {
        console.error('Error cargando mensajes:', error);
    }
}

function renderMessages(messages) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    container.innerHTML = messages.map(function(m) {
        return '<div class="message ' + (m.senderRole === 'admin' ? 'sent' : 'received') + '">' +
            (m.type === 'image' ? '<img src="' + m.content + '" alt="Imagen" onclick="window.open(\'' + m.content + '\', \'_blank\')">' : '<div>' + escapeHtml(m.content) + '</div>') +
            '<span class="message-time">' + new Date(m.timestamp).toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'}) + '</span>' +
        '</div>';
    }).join('');
    
    scrollToBottom();
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) container.scrollTop = container.scrollHeight;
}

// Comandos disponibles para el admin (vacío por defecto, se cargan del servidor)
const ADMIN_COMMANDS = {};

// Procesar comandos
async function processCommand(input) {
    const command = input.trim().split(' ')[0].toLowerCase();
    
    if (ADMIN_COMMANDS[command]) {
        try {
            const result = await ADMIN_COMMANDS[command].action();
            return { isCommand: true, result: result };
        } catch (error) {
            return { isCommand: true, result: '❌ Error ejecutando comando: ' + error.message };
        }
    }
    
    return { isCommand: false };
}

// Aplicar bonus
async function applyBonus(userId, percentage) {
    const user = users.find(function(u) { return u.id === userId; });
    if (!user) return '❌ Usuario no encontrado';
    
    // Aquí se implementaría la lógica de bonus
    return `🎁 Bonus del ${percentage}% aplicado a ${user.username}`;
}

// Bloquear/desbloquear usuario
async function toggleUserBlock(userId, isActive) {
    try {
        const response = await fetch('/api/users/' + userId, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({ isActive: isActive })
        });
        
        if (response.ok) {
            loadUsers();
            return true;
        }
    } catch (error) {
        console.error('Error cambiando estado:', error);
    }
    return false;
}

// ========================================
// AUTOCOMPLETADO DE COMANDOS
// ========================================

let selectedCommandIndex = -1;
let filteredCommands = [];

function handleCommandAutocomplete(e) {
    const input = e.target;
    const value = input.value;
    const autocomplete = document.getElementById('commandAutocomplete');
    
    // Solo mostrar autocompletado si empieza con /
    if (!value.startsWith('/')) {
        autocomplete.classList.add('hidden');
        return;
    }
    
    const query = value.toLowerCase();
    filteredCommands = Object.keys(ADMIN_COMMANDS).filter(cmd => 
        cmd.toLowerCase().includes(query)
    );
    
    if (filteredCommands.length === 0) {
        autocomplete.classList.add('hidden');
        return;
    }
    
    selectedCommandIndex = -1;
    renderCommandAutocomplete(filteredCommands);
}

function renderCommandAutocomplete(commands) {
    const autocomplete = document.getElementById('commandAutocomplete');
    
    autocomplete.innerHTML = commands.map((cmd, index) => {
        const command = ADMIN_COMMANDS[cmd];
        return `<div class="command-item" data-command="${cmd}" data-index="${index}">
            <div class="command-name">${cmd}</div>
            <div class="command-description">${command.description}</div>
        </div>`;
    }).join('');
    
    // Agregar click handlers
    autocomplete.querySelectorAll('.command-item').forEach(item => {
        item.addEventListener('click', function() {
            const command = this.dataset.command;
            document.getElementById('messageInput').value = command + ' ';
            autocomplete.classList.add('hidden');
            document.getElementById('messageInput').focus();
        });
    });
    
    autocomplete.classList.remove('hidden');
}

let pendingCommand = null;

function handleAutocompleteNavigation(e) {
    const autocomplete = document.getElementById('commandAutocomplete');
    if (autocomplete.classList.contains('hidden')) return;
    
    const items = autocomplete.querySelectorAll('.command-item');
    
    if (e.key === 'Escape') {
        autocomplete.classList.add('hidden');
        pendingCommand = null;
        return;
    }
    
    if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedCommandIndex >= 0 && selectedCommandIndex < items.length) {
            const selectedCmd = filteredCommands[selectedCommandIndex];
            document.getElementById('messageInput').value = selectedCmd + ' ';
            autocomplete.classList.add('hidden');
            document.getElementById('messageInput').focus();
            pendingCommand = selectedCmd;
            
            // Si es Enter, enviar el comando inmediatamente
            if (e.key === 'Enter') {
                setTimeout(() => {
                    sendMessage();
                    pendingCommand = null;
                }, 50);
            }
        }
        return;
    }
    
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedCommandIndex = Math.min(selectedCommandIndex + 1, items.length - 1);
        updateSelectedCommand(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedCommandIndex = Math.max(selectedCommandIndex - 1, 0);
        updateSelectedCommand(items);
    }
}

function updateSelectedCommand(items) {
    items.forEach((item, index) => {
        if (index === selectedCommandIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input || !selectedUserId) return;
    
    let content = input.value.trim();
    if (!content) return;
    
    // Permitir enviar mensajes incluso en chats cerrados (solo admin)
    // El chat permanecerá en la sección de cerrados
    
    // Si hay un comando pendiente del autocompletado, usarlo
    if (pendingCommand) {
        content = pendingCommand;
        pendingCommand = null;
    }
    
    // Ocultar autocompletado si está visible
    const autocomplete = document.getElementById('commandAutocomplete');
    if (autocomplete) autocomplete.classList.add('hidden');
    
    // Verificar si es un comando
    if (content.startsWith('/')) {
        const commandResult = await processCommand(content);
        if (commandResult.isCommand) {
            // Enviar el resultado del comando como mensaje del sistema
            try {
                const response = await fetch('/api/messages/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + currentToken
                    },
                    body: JSON.stringify({
                        content: commandResult.result,
                        receiverId: selectedUserId,
                        type: 'text'
                    })
                });
                
                if (response.ok) {
                    input.value = '';
                    loadMessages(selectedUserId);
                    loadConversations();
                }
            } catch (error) {
                showToast('Error enviando resultado del comando', 'error');
            }
            return;
        }
    }
    
    // Mostrar estado de carga en el botón
    const sendBtn = document.getElementById('sendMessageBtn');
    if (sendBtn) {
        sendBtn.textContent = 'Enviando...';
        sendBtn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({
                content: content,
                receiverId: selectedUserId,
                type: 'text'
            })
        });
        
        if (response.ok) {
            input.value = '';
            // Actualizar mensajes inmediatamente sin esperar el polling
            await loadMessages(selectedUserId);
            // No recargar todas las conversaciones para mantener fluidez
        }
    } catch (error) {
        showToast('Error al enviar mensaje', 'error');
    } finally {
        // Restaurar botón
        if (sendBtn) {
            sendBtn.textContent = '📤 Enviar';
            sendBtn.disabled = false;
        }
    }
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showToast('Solo se permiten imágenes', 'error');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showToast('La imagen es muy grande. Máximo 5MB', 'error');
        return;
    }
    
    if (!selectedUserId) {
        showToast('Selecciona una conversación primero', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const response = await fetch('/api/messages/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + currentToken
                },
                body: JSON.stringify({
                    content: event.target.result,
                    receiverId: selectedUserId,
                    type: 'image'
                })
            });
            
            if (response.ok) {
                loadMessages(selectedUserId);
                showToast('Imagen enviada', 'success');
            } else {
                showToast('Error al enviar imagen', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        }
    };
    reader.readAsDataURL(file);
    
    e.target.value = '';
}

// ========================================
// DEPÓSITO Y RETIRO DESDE ADMIN
// ========================================

async function handleAdminDeposit(e) {
    e.preventDefault();
    
    if (!selectedUserId) {
        showToast('Selecciona un usuario primero', 'error');
        return;
    }
    
    const user = users.find(function(u) { return u.id === selectedUserId; });
    if (!user) {
        showToast('Usuario no encontrado', 'error');
        return;
    }
    
    const amount = parseFloat(document.getElementById('adminDepositAmount').value);
    const bonusAmount = parseFloat(document.getElementById('adminBonusAmount').value) || 0;
    const description = document.getElementById('adminDepositDescription')?.value || '';
    
    if (!amount || amount < 100) {
        showToast('El monto mínimo es $100', 'error');
        return;
    }
    
    // Deshabilitar botón mientras procesa
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Procesando...';
    }
    
    try {
        // Primero hacer el depósito principal
        const response = await fetch('/api/admin/deposit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({
                username: user.username,
                amount: amount,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Actualizar saldo en tiempo real
            const newBalance = data.newBalance;
            if (newBalance !== undefined) {
                user.balance = newBalance;
                updateUserBalanceInUI(newBalance);
            }
            
            // Solo enviar bonus si hay un monto de bonus válido y el porcentaje seleccionado es > 0
            console.log('🎁 Verificando bonus:', { bonusAmount, selectedBonusPercent });
            if (bonusAmount > 0 && selectedBonusPercent > 0) {
                console.log('🎁 Enviando bonus:', { username: user.username, amount: bonusAmount });
                try {
                    const bonusResponse = await fetch('/api/admin/bonus', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + currentToken
                        },
                        body: JSON.stringify({
                            username: user.username,
                            amount: bonusAmount,
                            description: 'Bonificación extra - Sala de Juegos'
                        })
                    });
                    
                    const bonusData = await bonusResponse.json();
                    if (bonusResponse.ok && bonusData.success) {
                        showToast(`Depósito: $${amount.toLocaleString()} + Bonus: $${bonusAmount.toLocaleString()}`, 'success');
                        // Actualizar saldo después del bonus
                        if (bonusData.newBalance !== undefined) {
                            user.balance = bonusData.newBalance;
                            updateUserBalanceInUI(bonusData.newBalance);
                        }
                    } else {
                        showToast(`Depósito: $${amount.toLocaleString()} (Bonus falló: ${bonusData.error || 'Error'})`, 'warning');
                    }
                } catch (bonusError) {
                    showToast(`Depósito: $${amount.toLocaleString()} (Bonus no enviado)`, 'warning');
                }
            } else {
                showToast('Depósito realizado: $' + amount.toLocaleString(), 'success');
            }
            
            hideModal('adminDepositModal');
            document.getElementById('adminDepositForm').reset();
            document.getElementById('adminBonusAmount').value = '';
            document.getElementById('bonusInfo').style.display = 'none';
            // Reset bonus selection
            selectedBonusPercent = 0;
            document.querySelectorAll('.bonus-btn').forEach(function(b) {
                b.style.transform = 'scale(1)';
                b.style.boxShadow = 'none';
                b.classList.remove('bonus-selected');
                if (b.dataset.bonus === '0') {
                    b.style.transform = 'scale(1.1)';
                    b.classList.add('bonus-selected');
                }
            });
            // Recargar datos del usuario
            loadUsers();
            
            // Enviar mensaje profesional al chat del usuario
            const targetUser = users.find(u => u.id === selectedUserId);
            const depositMessage = `💰 ¡Fichas cargadas! $${amount.toLocaleString()}\n\n✅ ¡Ya tenés tu carga en la plataforma! 🍀\n\n👤 Tu usuario: ${targetUser?.username || ''}\n🌐 Plataforma: www.jugaygana.bet\n\n¡Mucha suerte! 🎰✨`;
            await sendSystemMessageToUser(selectedUserId, depositMessage);
        } else {
            // Manejar error correctamente - asegurar que sea string
            const errorMsg = typeof data.error === 'string' ? data.error : 
                            (data.error && typeof data.error === 'object') ? JSON.stringify(data.error) :
                            data.message || 'Error al realizar depósito';
            showToast(errorMsg, 'error');
        }
    } catch (error) {
        showToast('Error de conexión: ' + (error.message || ''), 'error');
    } finally {
        // Restaurar botón
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Depositar';
        }
    }
}

// Función para actualizar el saldo en la UI en tiempo real
function updateUserBalanceInUI(newBalance) {
    const chatUserBalance = document.getElementById('chatUserBalance');
    if (chatUserBalance) {
        chatUserBalance.textContent = 'Balance: $' + (newBalance || 0).toLocaleString();
    }
}

// Función para enviar mensaje de sistema a un usuario específico
async function sendSystemMessageToUser(userId, content) {
    try {
        await fetch('/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({
                content: content,
                receiverId: userId,
                type: 'text'
            })
        });
        if (selectedUserId === userId) {
            loadMessages(userId);
        }
    } catch (error) {
        console.error('Error enviando mensaje de sistema:', error);
    }
}

async function handleAdminWithdraw(e) {
    e.preventDefault();
    
    if (!selectedUserId) {
        showToast('Selecciona un usuario primero', 'error');
        return;
    }
    
    const user = users.find(function(u) { return u.id === selectedUserId; });
    if (!user) {
        showToast('Usuario no encontrado', 'error');
        return;
    }
    
    const amount = parseFloat(document.getElementById('adminWithdrawAmount').value);
    const description = document.getElementById('adminWithdrawDescription')?.value || '';
    
    if (!amount || amount < 100) {
        showToast('El monto mínimo es $100', 'error');
        return;
    }
    
    // Deshabilitar botón mientras procesa
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Procesando...';
    }
    
    try {
        const response = await fetch('/api/admin/withdrawal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({
                username: user.username,
                amount: amount,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Actualizar saldo en tiempo real
            const newBalance = data.newBalance;
            if (newBalance !== undefined) {
                user.balance = newBalance;
                updateUserBalanceInUI(newBalance);
            }
            
            showToast('Retiro realizado: $' + amount.toLocaleString(), 'success');
            hideModal('adminWithdrawModal');
            document.getElementById('adminWithdrawForm').reset();
            // Recargar datos del usuario
            loadUsers();
            
            // Enviar mensaje al chat del usuario
            await sendSystemMessageToUser(selectedUserId, `💸 Retiro realizado: $${amount.toLocaleString()}`);
        } else {
            // Manejar error correctamente - asegurar que sea string
            const errorMsg = typeof data.error === 'string' ? data.error : 
                            (data.error && typeof data.error === 'object') ? JSON.stringify(data.error) :
                            data.message || 'Error al realizar retiro';
            showToast(errorMsg, 'error');
        }
    } catch (error) {
        showToast('Error de conexión: ' + (error.message || ''), 'error');
    } finally {
        // Restaurar botón
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Retirar';
        }
    }
}

// ========================================
// CHAT EN TIEMPO REAL - POLLING OPTIMIZADO
// ========================================

let lastMessagesHash = '';

function startMessagePolling() {
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
    }
    
    // Polling más rápido (2 segundos) para mayor fluidez
    messagePollingInterval = setInterval(function() {
        loadConversations();
        // Solo cargar mensajes del chat activo para mejor rendimiento
        if (selectedUserId) {
            loadMessagesOptimized(selectedUserId);
        }
    }, 2000);
}

// Carga optimizada de mensajes - solo actualiza si hay cambios
async function loadMessagesOptimized(userId) {
    try {
        const response = await fetch('/api/messages/' + userId + '?limit=50', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const messages = await response.json();
            // Crear hash simple de los mensajes para detectar cambios
            const messagesHash = messages.map(m => m.id + m.read).join('');
            
            if (messagesHash !== lastMessagesHash) {
                lastMessagesHash = messagesHash;
                renderMessages(messages);
                
                // Reproducir sonido si hay mensajes nuevos no leídos del usuario
                const hasNewUserMessages = messages.some(m => 
                    m.senderRole === 'user' && !m.read
                );
                if (hasNewUserMessages) {
                    playNotificationSound();
                }
            }
        }
    } catch (error) {
        console.error('Error cargando mensajes:', error);
    }
}

function stopMessagePolling() {
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
        messagePollingInterval = null;
    }
}

// ========================================
// UTILIDADES
// ========================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// SISTEMA DE CHATS ABIERTOS/CERRADOS/PAGOS
// ========================================

function filterChats(status) {
    currentChatFilter = status;
    
    // Actualizar tabs
    const tabOpen = document.getElementById('tabOpenChats');
    const tabClosed = document.getElementById('tabClosedChats');
    const tabPagos = document.getElementById('tabPagosChats');
    
    if (tabOpen) {
        tabOpen.className = status === 'open' ? 'btn btn-primary' : 'btn btn-secondary';
    }
    if (tabClosed) {
        tabClosed.className = status === 'closed' ? 'btn btn-primary' : 'btn btn-secondary';
    }
    if (tabPagos) {
        tabPagos.className = status === 'pagos' ? 'btn btn-primary' : 'btn btn-secondary';
        // Mantener el estilo azul para pagos
        if (status !== 'pagos') {
            tabPagos.style.background = 'linear-gradient(135deg, #00a8ff 0%, #0066cc 100%)';
        }
    }
    
    // Si es pagos, cargar desde la API de categoría pagos
    if (status === 'pagos') {
        loadPagosChats();
    } else {
        loadConversations();
    }
}

async function closeChat(userId) {
    try {
        const response = await fetch('/api/admin/chats/' + userId + '/close', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            showToast('Chat cerrado', 'success');
            // NO limpiar selectedUserId - permitir seguir enviando mensajes
            // NO limpiar el chat - mantener visible
            loadConversations();
            // Mantener en la pestaña de chats abiertos (el chat se moverá a cerrados pero seguirá visible)
        }
    } catch (error) {
        showToast('Error cerrando chat', 'error');
    }
}

// Cerrar chat con tecla Escape
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && selectedUserId) {
        closeChat(selectedUserId);
    }
});

async function reopenChat(userId) {
    try {
        const response = await fetch('/api/admin/chats/' + userId + '/reopen', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            showToast('Chat reabierto', 'success');
            filterChats('open');
        }
    } catch (error) {
        showToast('Error reabriendo chat', 'error');
    }
}

// ========================================
// BOTÓN CBU
// ========================================

async function sendCBU() {
    if (!selectedUserId) {
        showToast('Selecciona un usuario primero', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/send-cbu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({ userId: selectedUserId })
        });
        
        if (response.ok) {
            showToast('CBU enviado', 'success');
            loadMessages(selectedUserId);
        } else {
            showToast('Error enviando CBU', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

async function loadCBUConfig() {
    try {
        const response = await fetch('/api/admin/config', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const config = await response.json();
            if (config.cbu) {
                document.getElementById('cbuNumber').value = config.cbu.number || '';
                document.getElementById('cbuAlias').value = config.cbu.alias || '';
                document.getElementById('cbuBank').value = config.cbu.bank || '';
                document.getElementById('cbuTitular').value = config.cbu.titular || '';
                document.getElementById('cbuMessage').value = config.cbu.message || '';
            }
        }
    } catch (error) {
        console.error('Error cargando config CBU:', error);
    }
}

async function saveCBUConfig(e) {
    e.preventDefault();
    
    const cbuData = {
        number: document.getElementById('cbuNumber').value.trim(),
        alias: document.getElementById('cbuAlias').value.trim(),
        bank: document.getElementById('cbuBank').value.trim(),
        titular: document.getElementById('cbuTitular').value.trim(),
        message: document.getElementById('cbuMessage').value.trim()
    };
    
    try {
        const response = await fetch('/api/admin/config/cbu', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify(cbuData)
        });
        
        if (response.ok) {
            showToast('CBU guardado correctamente', 'success');
        } else {
            showToast('Error guardando CBU', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

// ========================================
// INDICADOR DE ESCRIBIENDO
// ========================================

let typingTimeout = null;

function setupTypingIndicator() {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;
    
    messageInput.addEventListener('input', function() {
        // Enviar evento de escribiendo
        if (socket && selectedUserId) {
            socket.emit('typing', { receiverId: selectedUserId, isTyping: true });
        }
        
        // Limpiar timeout anterior
        if (typingTimeout) clearTimeout(typingTimeout);
        
        // Enviar evento de dejar de escribir después de 2 segundos
        typingTimeout = setTimeout(function() {
            if (socket && selectedUserId) {
                socket.emit('stop_typing', { receiverId: selectedUserId });
            }
        }, 2000);
    });
}

function showTypingIndicator(show) {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
        indicator.style.display = show ? 'block' : 'none';
    }
}

// ========================================
// SECCIÓN DE TRANSACCIONES
// ========================================

async function loadTransactions() {
    const dateFrom = document.getElementById('transDateFrom').value;
    const dateTo = document.getElementById('transDateTo').value;
    const typeFilter = document.getElementById('transTypeFilter').value;
    
    try {
        const response = await fetch('/api/admin/transactions?' + new URLSearchParams({
            from: dateFrom,
            to: dateTo,
            type: typeFilter
        }), {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const data = await response.json();
            renderTransactions(data.transactions);
            // Guardar summary para recalcular comisión
            window.lastTransactionSummary = data.summary;
            updateTransactionSummary(data.summary);
        }
    } catch (error) {
        console.error('Error cargando transacciones:', error);
    }
}

function renderTransactions(transactions) {
    const tbody = document.getElementById('transactionsTableBody');
    if (!tbody) return;
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 40px; text-align: center; color: #888;">No hay transacciones para mostrar</td></tr>';
        return;
    }
    
    tbody.innerHTML = transactions.map(function(t) {
        const typeColors = {
            deposit: '#00ff88',
            withdrawal: '#ff4444',
            bonus: '#ffd700',
            refund: '#9d4edd'
        };
        
        const typeLabels = {
            deposit: 'Depósito',
            withdrawal: 'Retiro',
            bonus: 'Bonificación',
            refund: 'Reembolso'
        };
        
        const date = new Date(t.timestamp).toLocaleString('es-AR');
        const color = typeColors[t.type] || '#fff';
        const label = typeLabels[t.type] || t.type;
        
        // Mostrar quién hizo la transacción con badge
        const adminBadge = t.adminUsername 
            ? `<span style="background: rgba(212, 175, 55, 0.2); color: #d4af37; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold;">${escapeHtml(t.adminUsername)}</span>` 
            : '<span style="color: #666; font-size: 10px;">-</span>';
        
        return '<tr style="border-bottom: 1px solid rgba(212, 175, 55, 0.1);">' +
            '<td style="padding: 12px; color: #888; font-size: 12px;">' + date + '</td>' +
            '<td style="padding: 12px; color: #fff; font-size: 13px;">' + escapeHtml(t.username) + '</td>' +
            '<td style="padding: 12px;"><span style="background: ' + color + '20; color: ' + color + '; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold;">' + label + '</span></td>' +
            '<td style="padding: 12px; text-align: right; color: ' + color + '; font-weight: bold;">$' + (t.amount || 0).toLocaleString() + '</td>' +
            '<td style="padding: 12px; color: #888; font-size: 12px;">' + escapeHtml(t.description || '-') + '</td>' +
            '<td style="padding: 12px; text-align: center;">' + adminBadge + '</td>' +
        '</tr>';
    }).join('');
}

function updateTransactionSummary(summary) {
    if (!summary) summary = {};
    
    const totalDeposits = document.getElementById('totalDeposits');
    const totalWithdrawals = document.getElementById('totalWithdrawals');
    const totalBonuses = document.getElementById('totalBonuses');
    const totalRefunds = document.getElementById('totalRefunds');
    const netBalance = document.getElementById('netBalance');
    const totalCommission = document.getElementById('totalCommission');
    
    // Obtener porcentaje de comisión
    const commissionPercent = parseFloat(document.getElementById('commissionPercent')?.value) || 0;
    const commissionAmount = (summary.deposits || 0) * (commissionPercent / 100);
    
    if (totalDeposits) totalDeposits.textContent = '$' + (summary.deposits || 0).toLocaleString();
    if (totalWithdrawals) totalWithdrawals.textContent = '$' + (summary.withdrawals || 0).toLocaleString();
    if (totalBonuses) totalBonuses.textContent = '$' + (summary.bonuses || 0).toLocaleString();
    if (totalRefunds) totalRefunds.textContent = '$' + (summary.refunds || 0).toLocaleString();
    if (totalCommission) totalCommission.textContent = '$' + commissionAmount.toLocaleString();
    if (netBalance) {
        // Neto = Depósitos - Comisión - Retiros - Bonificaciones - Reembolsos
        const net = (summary.deposits || 0) - commissionAmount - (summary.withdrawals || 0) - (summary.bonuses || 0) - (summary.refunds || 0);
        netBalance.textContent = '$' + net.toLocaleString();
        netBalance.style.color = net >= 0 ? '#00ff88' : '#ff4444';
    }
}

// ========================================
// REEMBOLSOS
// ========================================

async function loadRefunds() {
    try {
        const response = await fetch('/api/refunds/all', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const data = await response.json();
            renderRefunds(data.refunds || []);
            updateRefundsSummary(data.summary || {});
        } else {
            const tbody = document.getElementById('refundsTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="7" style="padding: 40px; text-align: center; color: #ff4444;">Error cargando reembolsos</td></tr>';
            }
        }
    } catch (error) {
        console.error('Error cargando reembolsos:', error);
        const tbody = document.getElementById('refundsTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding: 40px; text-align: center; color: #ff4444;">Error de conexión</td></tr>';
        }
    }
}

function renderRefunds(refunds) {
    const tbody = document.getElementById('refundsTableBody');
    if (!tbody) return;
    
    if (!refunds || refunds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding: 40px; text-align: center; color: #888;">No hay reembolsos registrados</td></tr>';
        return;
    }
    
    // Ordenar por fecha (más recientes primero)
    refunds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const typeLabels = {
        daily: 'Diario',
        weekly: 'Semanal',
        monthly: 'Mensual'
    };
    
    const typeColors = {
        daily: '#00ff88',
        weekly: '#00a8ff',
        monthly: '#ffd700'
    };
    
    tbody.innerHTML = refunds.map(function(r) {
        const date = new Date(r.timestamp).toLocaleString('es-AR');
        const typeLabel = typeLabels[r.type] || r.type;
        const typeColor = typeColors[r.type] || '#fff';
        
        return '<tr style="border-bottom: 1px solid rgba(212, 175, 55, 0.1);">' +
            '<td style="padding: 12px; color: #888; font-size: 12px;">' + date + '</td>' +
            '<td style="padding: 12px; color: #fff; font-size: 13px;">' + escapeHtml(r.username) + '</td>' +
            '<td style="padding: 12px;"><span style="background: ' + typeColor + '20; color: ' + typeColor + '; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold;">' + typeLabel + '</span></td>' +
            '<td style="padding: 12px; text-align: right; color: #00ff88; font-weight: bold;">$' + (r.amount || 0).toLocaleString() + '</td>' +
            '<td style="padding: 12px; text-align: right; color: #888;">$' + (r.netAmount || 0).toLocaleString() + '</td>' +
            '<td style="padding: 12px; text-align: right; color: #00a8ff;">$' + (r.deposits || 0).toLocaleString() + '</td>' +
            '<td style="padding: 12px; text-align: right; color: #ff4444;">$' + (r.withdrawals || 0).toLocaleString() + '</td>' +
        '</tr>';
    }).join('');
}

function updateRefundsSummary(summary) {
    if (!summary) summary = {};
    
    const dailyCount = document.getElementById('refundsDailyCount');
    const weeklyCount = document.getElementById('refundsWeeklyCount');
    const monthlyCount = document.getElementById('refundsMonthlyCount');
    const totalAmount = document.getElementById('refundsTotalAmount');
    
    if (dailyCount) dailyCount.textContent = summary.dailyCount || 0;
    if (weeklyCount) weeklyCount.textContent = summary.weeklyCount || 0;
    if (monthlyCount) monthlyCount.textContent = summary.monthlyCount || 0;
    if (totalAmount) totalAmount.textContent = '$' + (summary.totalAmount || 0).toLocaleString();
}

// ========================================
// SECCIÓN DE COMANDOS
// ========================================

async function loadCommandsFromServer() {
    try {
        const response = await fetch('/api/admin/commands', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            customCommands = await response.json();
            // Agregar comandos personalizados a ADMIN_COMMANDS
            Object.keys(customCommands).forEach(cmd => {
                ADMIN_COMMANDS[cmd] = {
                    description: customCommands[cmd].description,
                    action: async function() {
                        if (customCommands[cmd].type === 'bonus' && customCommands[cmd].bonusPercent > 0) {
                            return await applyBonus(selectedUserId, customCommands[cmd].bonusPercent);
                        }
                        return customCommands[cmd].response || '✅ Comando ejecutado';
                    }
                };
            });
            renderCommandsList();
        }
    } catch (error) {
        console.error('Error cargando comandos:', error);
    }
}

function renderCommandsList() {
    const commandsList = document.getElementById('commandsList');
    if (!commandsList) return;
    
    const allCommands = { ...ADMIN_COMMANDS, ...customCommands };
    
    if (Object.keys(allCommands).length === 0) {
        commandsList.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No hay comandos configurados</div>';
        return;
    }
    
    commandsList.innerHTML = Object.keys(allCommands).map(function(cmd) {
        const command = allCommands[cmd];
        const isCustom = customCommands.hasOwnProperty(cmd);
        
        return '<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid rgba(212, 175, 55, 0.3); margin-bottom: 8px;">' +
            '<div>' +
                '<div style="color: #d4af37; font-weight: bold; font-size: 14px;">' + cmd + '</div>' +
                '<div style="color: #888; font-size: 11px;">' + escapeHtml(command.description || customCommands[cmd]?.description) + '</div>' +
            '</div>' +
            (isCustom ? '<button class="btn btn-small btn-danger" onclick="deleteCommand(\'' + cmd + '\')" style="padding: 5px 10px; font-size: 11px;">🗑️</button>' : '<span style="color: #00ff88; font-size: 11px;">Sistema</span>') +
        '</div>';
    }).join('');
}

async function deleteCommand(command) {
    if (confirm('¿Eliminar el comando ' + command + '?')) {
        try {
            const response = await fetch('/api/admin/commands/' + encodeURIComponent(command), {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + currentToken }
            });
            
            if (response.ok) {
                delete customCommands[command];
                delete ADMIN_COMMANDS[command];
                renderCommandsList();
                showToast('Comando eliminado', 'success');
            }
        } catch (error) {
            showToast('Error eliminando comando', 'error');
        }
    }
}

// Inicializar formulario de agregar comando
document.addEventListener('DOMContentLoaded', function() {
    const addCommandForm = document.getElementById('addCommandForm');
    const newCommandType = document.getElementById('newCommandType');
    const bonusAmountGroup = document.getElementById('bonusAmountGroup');
    
    if (newCommandType) {
        newCommandType.addEventListener('change', function() {
            if (bonusAmountGroup) {
                bonusAmountGroup.style.display = this.value === 'bonus' ? 'block' : 'none';
            }
        });
    }
    
    if (addCommandForm) {
        addCommandForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const name = document.getElementById('newCommandName').value.trim();
            const desc = document.getElementById('newCommandDesc').value.trim();
            const type = document.getElementById('newCommandType').value;
            const bonusPercent = parseInt(document.getElementById('newCommandBonusPercent').value) || 0;
            const responseText = document.getElementById('newCommandResponse')?.value?.trim() || '✅ Comando ejecutado';
            
            if (!name.startsWith('/')) {
                showToast('El comando debe empezar con /', 'error');
                return;
            }
            
            try {
                const res = await fetch('/api/admin/commands', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + currentToken
                    },
                    body: JSON.stringify({
                        name,
                        description: desc,
                        type,
                        bonusPercent,
                        response: responseText
                    })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    customCommands = data.commands;
                    
                    // Agregar a ADMIN_COMMANDS para que funcione inmediatamente
                    ADMIN_COMMANDS[name] = {
                        description: desc,
                        action: async function() {
                            if (type === 'bonus' && bonusPercent > 0) {
                                return await applyBonus(selectedUserId, bonusPercent);
                            }
                            return responseText;
                        }
                    };
                    
                    addCommandForm.reset();
                    if (bonusAmountGroup) bonusAmountGroup.style.display = 'none';
                    renderCommandsList();
                    showToast('Comando agregado exitosamente', 'success');
                } else {
                    showToast('Error guardando comando', 'error');
                }
            } catch (error) {
                showToast('Error de conexión', 'error');
            }
        });
    }
    
    // Filtros de transacciones
    const applyTransFilters = document.getElementById('applyTransFilters');
    const resetTransFilters = document.getElementById('resetTransFilters');
    
    if (applyTransFilters) {
        applyTransFilters.addEventListener('click', loadTransactions);
    }
    
    if (resetTransFilters) {
        resetTransFilters.addEventListener('click', function() {
            document.getElementById('transDateFrom').value = '';
            document.getElementById('transDateTo').value = '';
            document.getElementById('transTypeFilter').value = 'all';
            document.getElementById('commissionPercent').value = '0';
            loadTransactions();
        });
    }
    
    // Comisión - recalcular al cambiar el porcentaje
    const commissionPercent = document.getElementById('commissionPercent');
    if (commissionPercent) {
        commissionPercent.addEventListener('input', function() {
            // Recalcular el resumen con el nuevo porcentaje
            const summary = window.lastTransactionSummary;
            if (summary) {
                updateTransactionSummary(summary);
            }
        });
    }
    
    // Establecer fechas por defecto (últimos 7 días)
    const dateFrom = document.getElementById('transDateFrom');
    const dateTo = document.getElementById('transDateTo');
    
    if (dateFrom && dateTo) {
        const today = new Date();
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);
        
        dateTo.value = today.toISOString().split('T')[0];
        dateFrom.value = lastWeek.toISOString().split('T')[0];
    }
    
    // Configuración CBU
    const cbuConfigForm = document.getElementById('cbuConfigForm');
    if (cbuConfigForm) {
        cbuConfigForm.addEventListener('submit', saveCBUConfig);
    }
    
    // Formulario de cambio de contraseña
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', handleChangePassword);
    }
    
    // Base de Datos - solo para admin principal
    const databaseNavItem = document.getElementById('databaseNavItem');
    const databasePasswordModal = document.getElementById('databasePasswordModal');
    const verifyDatabasePasswordBtn = document.getElementById('verifyDatabasePasswordBtn');
    const downloadDatabaseBtn = document.getElementById('downloadDatabaseBtn');
    const closeDatabasePasswordModal = document.getElementById('closeDatabasePasswordModal');
    
    if (databaseNavItem && currentAdmin?.role === 'admin') {
        databaseNavItem.classList.remove('hidden');
    }
    
    if (verifyDatabasePasswordBtn) {
        verifyDatabasePasswordBtn.addEventListener('click', verifyDatabasePassword);
    }
    
    if (closeDatabasePasswordModal) {
        closeDatabasePasswordModal.addEventListener('click', function() {
            // Ocultar el modal de contraseña
            const modal = document.getElementById('databasePasswordModal');
            if (modal) modal.style.display = 'none';
            
            // Limpiar el input de contraseña
            const input = document.getElementById('databasePasswordInput');
            if (input) input.value = '';
            
            // Ocultar mensaje de error si está visible
            const error = document.getElementById('databasePasswordError');
            if (error) error.style.display = 'none';
            
            // Quitar active de Base de Datos
            document.querySelectorAll('.nav-item').forEach(function(item) {
                item.classList.remove('active');
            });
            
            // Redirigir a la sección de Transacciones (diferente a Base de Datos)
            showSection('transactions');
        });
    }
    
    if (downloadDatabaseBtn) {
        downloadDatabaseBtn.addEventListener('click', downloadDatabaseExcel);
    }
    
    // Volver a CARGAS button (en PAGOS)
    const pagosBackToCargasBtn = document.getElementById('pagosBackToCargasBtn');
    if (pagosBackToCargasBtn) {
        pagosBackToCargasBtn.addEventListener('click', function() {
            if (selectedPagosUserId) {
                backToCargas(selectedPagosUserId);
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    // Enviar mensaje en PAGOS
    const pagosSendMessageBtn = document.getElementById('pagosSendMessageBtn');
    if (pagosSendMessageBtn) {
        pagosSendMessageBtn.addEventListener('click', sendPagosMessage);
    }
    
    // Tabs de PAGOS
    document.querySelectorAll('[data-pagos-filter]').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('[data-pagos-filter]').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            currentPagosFilter = this.dataset.pagosFilter;
            loadPagosConversations();
        });
    });
    
    // Indicador de escribiendo
    setupTypingIndicator();
    
    // Inicializar sonido de notificación
    initNotificationSound();
});

// ========================================
// SECCIÓN BASE DE DATOS
// ========================================

const DATABASE_PASSWORD = 'P4pelito2026';

function verifyDatabasePassword() {
    const input = document.getElementById('databasePasswordInput');
    const error = document.getElementById('databasePasswordError');
    const modal = document.getElementById('databasePasswordModal');
    
    if (input.value === DATABASE_PASSWORD) {
        // Ocultar modal de contraseña
        modal.style.display = 'none';
        
        // Ocultar TODAS las secciones primero
        document.querySelectorAll('.content-section').forEach(function(s) {
            s.classList.add('hidden');
        });
        
        // Mostrar la sección de base de datos
        const sectionEl = document.getElementById('databaseSection');
        if (sectionEl) {
            sectionEl.classList.remove('hidden');
        }
        
        // Cargar datos
        loadDatabaseData();
    } else {
        error.style.display = 'block';
        input.value = '';
    }
}

async function loadDatabaseData() {
    try {
        const response = await fetch('/api/admin/database', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const data = await response.json();
            renderDatabaseTable(data.users);
            document.getElementById('dbTotalUsers').textContent = data.totalUsers;
            document.getElementById('dbTotalAdmins').textContent = data.totalAdmins;
            document.getElementById('dbTotalMessages').textContent = data.totalMessages;
        }
    } catch (error) {
        console.error('Error cargando base de datos:', error);
    }
}

function renderDatabaseTable(users) {
    const tbody = document.getElementById('databaseTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = users.map(u => {
        const roleColors = {
            admin: '#d4af37',
            depositor: '#00ff88',
            withdrawer: '#00a8ff',
            user: '#888'
        };
        
        return '<tr style="border-bottom: 1px solid rgba(212, 175, 55, 0.1);">' +
            '<td style="padding: 12px; color: #fff; font-size: 13px;">' + escapeHtml(u.username) + '</td>' +
            '<td style="padding: 12px; color: #888; font-size: 12px;">' + escapeHtml(u.email || '-') + '</td>' +
            '<td style="padding: 12px; color: #888; font-size: 12px;">' + escapeHtml(u.phone || u.whatsapp || '-') + '</td>' +
            '<td style="padding: 12px;"><span style="color: ' + (roleColors[u.role] || '#888') + '; font-size: 12px; text-transform: capitalize;">' + u.role + '</span></td>' +
            '<td style="padding: 12px; text-align: right; color: #00ff88; font-weight: bold;">$' + (u.balance || 0).toLocaleString() + '</td>' +
            '<td style="padding: 12px; color: #888; font-size: 12px;">' + new Date(u.createdAt).toLocaleDateString('es-AR') + '</td>' +
        '</tr>';
    }).join('');
}

function downloadDatabaseExcel() {
    fetch('/api/admin/database', {
        headers: { 'Authorization': 'Bearer ' + currentToken }
    })
    .then(response => response.json())
    .then(data => {
        // Crear CSV
        let csv = 'Usuario,Email,Teléfono,Contraseña (encriptada),Rol,Balance,Fecha Creación\n';
        
        data.users.forEach(u => {
            csv += `"${u.username}","${u.email || ''}","${u.phone || u.whatsapp || ''}","${u.password}","${u.role}",${u.balance || 0},"${new Date(u.createdAt).toLocaleDateString('es-AR')}"\n`;
        });
        
        // Descargar
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `base_datos_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    })
    .catch(error => {
        console.error('Error descargando base de datos:', error);
        showToast('Error al descargar base de datos', 'error');
    });
}

// ========================================
// SECCIÓN PAGOS - Solo para withdrawer
// ========================================

let selectedPagosUserId = null;
let currentPagosFilter = 'open';

async function loadPagosChats() {
    try {
        const response = await fetch('/api/admin/chats/category/pagos', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const conversations = await response.json();
            renderConversations(conversations);
        }
    } catch (error) {
        console.error('Error cargando chats de pagos:', error);
    }
}

async function loadPagosConversations() {
    try {
        const response = await fetch('/api/admin/chats/category/pagos', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const conversations = await response.json();
            renderPagosConversations(conversations);
        }
    } catch (error) {
        console.error('Error cargando chats de pagos:', error);
    }
}

function renderPagosConversations(conversations) {
    const container = document.getElementById('pagosConversationsList');
    if (!container) return;
    
    if (conversations.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 30px; color: #888;">No hay chats de pagos</div>';
        return;
    }
    
    container.innerHTML = conversations.map(conv => {
        const lastMsg = conv.lastMessage;
        const isUnread = conv.unreadCount > 0;
        
        return '<div class="conversation-item" data-userid="' + conv.userId + '" onclick="selectPagosConversation(\'' + conv.userId + '\', \'' + conv.username + '\')" style="cursor: pointer; padding: 12px; border-radius: 10px; margin-bottom: 8px; background: ' + (isUnread ? 'rgba(0, 168, 255, 0.2)' : 'rgba(0,0,0,0.3)') + '; border: 1px solid ' + (isUnread ? '#00a8ff' : 'transparent') + ';">' +
            '<div style="display: flex; justify-content: space-between; align-items: center;">' +
                '<span style="font-weight: bold; color: #fff;">' + escapeHtml(conv.username) + '</span>' +
                (conv.unreadCount > 0 ? '<span style="background: #00a8ff; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px;">' + conv.unreadCount + '</span>' : '') +
            '</div>' +
            '<div style="font-size: 12px; color: #888; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' +
                (lastMsg ? escapeHtml(lastMsg.content.substring(0, 50)) : 'Sin mensajes') +
            '</div>' +
        '</div>';
    }).join('');
}

async function selectPagosConversation(userId, username) {
    selectedPagosUserId = userId;
    
    document.querySelectorAll('#pagosConversationsList .conversation-item').forEach(function(item) {
        item.classList.remove('active');
    });
    
    const activeItem = document.querySelector('#pagosConversationsList .conversation-item[data-userid="' + userId + '"]');
    if (activeItem) activeItem.classList.add('active');
    
    await loadPagosMessages(userId);
    
    const chatPlaceholder = document.getElementById('pagosChatPlaceholder');
    const chatContent = document.getElementById('pagosChatContent');
    const chatUserName = document.getElementById('pagosChatUserName');
    
    if (chatPlaceholder) chatPlaceholder.classList.add('hidden');
    if (chatContent) chatContent.classList.remove('hidden');
    if (chatUserName) chatUserName.textContent = username;
}

async function loadPagosMessages(userId) {
    try {
        const response = await fetch('/api/messages/' + userId + '?limit=50', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            const messages = await response.json();
            renderPagosMessages(messages);
        }
    } catch (error) {
        console.error('Error cargando mensajes de pagos:', error);
    }
}

function renderPagosMessages(messages) {
    const container = document.getElementById('pagosMessagesContainer');
    if (!container) return;
    
    container.innerHTML = messages.map(msg => {
        const isAdmin = msg.senderRole === 'admin';
        const align = isAdmin ? 'flex-end' : 'flex-start';
        const bg = isAdmin ? 'linear-gradient(135deg, #d4af37 0%, #b8941f 100%)' : 'rgba(255,255,255,0.1)';
        const color = isAdmin ? '#000' : '#fff';
        
        return '<div style="display: flex; justify-content: ' + align + '; margin-bottom: 10px;">' +
            '<div style="max-width: 70%; padding: 10px 15px; border-radius: 15px; background: ' + bg + '; color: ' + color + '; font-size: 14px;">' +
                '<div>' + escapeHtml(msg.content) + '</div>' +
                '<div style="font-size: 10px; opacity: 0.7; margin-top: 5px; text-align: right;">' + new Date(msg.timestamp).toLocaleTimeString('es-AR') + '</div>' +
            '</div>' +
        '</div>';
    }).join('');
    
    container.scrollTop = container.scrollHeight;
}

async function sendPagosMessage() {
    const input = document.getElementById('pagosMessageInput');
    if (!input || !selectedPagosUserId) return;
    
    const content = input.value.trim();
    if (!content) return;
    
    try {
        const response = await fetch('/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({
                content: content,
                receiverId: selectedPagosUserId,
                type: 'text'
            })
        });
        
        if (response.ok) {
            input.value = '';
            await loadPagosMessages(selectedPagosUserId);
        }
    } catch (error) {
        showToast('Error al enviar mensaje', 'error');
    }
}

async function sendToPagos(userId) {
    try {
        const response = await fetch('/api/admin/chats/' + userId + '/category', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({ category: 'pagos' })
        });
        
        if (response.ok) {
            showToast('Chat enviado a PAGOS', 'success');
            loadConversations();
        } else {
            showToast('Error enviando chat a PAGOS', 'error');
        }
    } catch (error) {
        showToast('Error enviando chat a PAGOS', 'error');
    }
}

async function backToCargas(userId) {
    try {
        const response = await fetch('/api/admin/chats/' + userId + '/category', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({ category: 'cargas' })
        });
        
        if (response.ok) {
            showToast('Chat enviado a CARGAS', 'success');
            loadPagosConversations();
        } else {
            showToast('Error enviando chat a CARGAS', 'error');
        }
    } catch (error) {
        showToast('Error enviando chat a CARGAS', 'error');
    }
}

// ========================================
// CONFIGURACIÓN DE UI POR ROL
// ========================================

function configureUIBasedOnRole() {
    if (!currentAdmin) return;
    
    const role = currentAdmin.role;
    
    // Mostrar/ocultar Base de Datos según rol
    if (databaseNavItem) {
        databaseNavItem.classList.toggle('hidden', role !== 'admin');
    }
    
    // Configurar tabs de chats según el rol
    const tabOpenChats = document.getElementById('tabOpenChats');
    const tabClosedChats = document.getElementById('tabClosedChats');
    const tabPagosChats = document.getElementById('tabPagosChats');
    
    // Depositer: solo puede depositar, ver Abiertos y Cerrados (NO Pagos), y pasar a Pagos
    if (role === 'depositor') {
        // Ocultar botón de retiro
        const withdrawBtn = document.getElementById('withdrawUserBtn');
        if (withdrawBtn) withdrawBtn.style.display = 'none';
        
        // MOSTRAR botón de enviar a PAGOS (el depositer puede pasar chats a Pagos)
        const sendToPagosBtn = document.getElementById('sendToPagosBtn');
        if (sendToPagosBtn) sendToPagosBtn.style.display = 'inline-block';
        
        // Ocultar botón de cambiar contraseña
        const changePasswordChatBtn = document.getElementById('changePasswordChatBtn');
        if (changePasswordChatBtn) changePasswordChatBtn.style.display = 'none';
        
        // Ocultar opción de crear admin
        const createUserRole = document.getElementById('newRole');
        if (createUserRole) {
            createUserRole.innerHTML = '<option value="user">Usuario</option>';
        }
        
        // Ocultar tab de Pagos completamente (el depositer no ve la pestaña Pagos)
        if (tabPagosChats) tabPagosChats.style.display = 'none';
        
        // Mostrar tabs de Abiertos y Cerrados
        if (tabOpenChats) tabOpenChats.style.display = 'inline-block';
        if (tabClosedChats) tabClosedChats.style.display = 'inline-block';
        
        // Asegurar que el filtro esté en 'open' por defecto
        currentChatFilter = 'open';
        
        // Mostrar botón de depositar
        const depositBtn = document.getElementById('depositUserBtn');
        if (depositBtn) depositBtn.style.display = 'inline-block';
    }
    
    // Withdrawer: solo puede retirar, ver Pagos (NO Abiertos ni Cerrados)
    if (role === 'withdrawer') {
        // Ocultar botón de depósito
        const depositBtn = document.getElementById('depositUserBtn');
        if (depositBtn) depositBtn.style.display = 'none';
        
        // Ocultar botón de enviar a PAGOS (el withdrawer ya está en Pagos)
        const sendToPagosBtn = document.getElementById('sendToPagosBtn');
        if (sendToPagosBtn) sendToPagosBtn.style.display = 'none';
        
        // MOSTRAR botón de Volver a CARGAS (el withdrawer puede devolver chats a Cargas)
        const backToCargasBtn = document.getElementById('backToCargasBtn');
        if (backToCargasBtn) backToCargasBtn.style.display = 'inline-block';
        
        // Ocultar botón de cambiar contraseña
        const changePasswordChatBtn = document.getElementById('changePasswordChatBtn');
        if (changePasswordChatBtn) changePasswordChatBtn.style.display = 'none';
        
        // Ocultar opción de crear admin
        const createUserRole = document.getElementById('newRole');
        if (createUserRole) {
            createUserRole.innerHTML = '<option value="user">Usuario</option>';
        }
        
        // Cambiar título de chats
        const chatsNavItem = document.getElementById('chatsNavItem');
        if (chatsNavItem) {
            chatsNavItem.querySelector('span:last-child').textContent = 'Chats Pagos';
        }
        
        // Ocultar tabs de Abiertos y Cerrados completamente
        if (tabOpenChats) tabOpenChats.style.display = 'none';
        if (tabClosedChats) tabClosedChats.style.display = 'none';
        
        // Mostrar tab de Pagos como única opción
        if (tabPagosChats) {
            tabPagosChats.style.display = 'inline-block';
            tabPagosChats.className = 'btn btn-primary';
            tabPagosChats.style.flex = '1';
            tabPagosChats.textContent = '💳 Chats Pagos';
        }
        
        // Cargar directamente chats de pagos
        currentChatFilter = 'pagos';
        
        // Mostrar botón de retirar
        const withdrawBtn = document.getElementById('withdrawUserBtn');
        if (withdrawBtn) withdrawBtn.style.display = 'inline-block';
    }
    
    // Admin: ver todo
    if (role === 'admin') {
        if (tabOpenChats) tabOpenChats.style.display = 'inline-block';
        if (tabClosedChats) tabClosedChats.style.display = 'inline-block';
        if (tabPagosChats) tabPagosChats.style.display = 'inline-block';
    }
    
    // Solo admin principal puede crear admins
    if (role !== 'admin') {
        const createUserRole = document.getElementById('newRole');
        if (createUserRole) {
            createUserRole.innerHTML = '<option value="user">Usuario</option>';
        }
    }
}
