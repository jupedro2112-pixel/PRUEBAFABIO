// ========================================
// PANEL DE ADMINISTRACIÓN - SALA DE JUEGOS
// ========================================

const API_URL = '';
let currentAdmin = null;
let currentToken = localStorage.getItem('adminToken');
let selectedUserId = null;
let conversations = [];
let users = [];
let messagePollingInterval = null;

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
        });
    }
    
    const viewUserBtn = document.getElementById('viewUserBtn');
    if (viewUserBtn) {
        viewUserBtn.addEventListener('click', function() {
            if (selectedUserId) {
                viewUserDetails(selectedUserId);
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
                showModal('adminDepositModal');
            } else {
                showToast('Selecciona un usuario primero', 'error');
            }
        });
    }
    
    const withdrawUserBtn = document.getElementById('withdrawUserBtn');
    if (withdrawUserBtn) {
        withdrawUserBtn.addEventListener('click', function() {
            if (selectedUserId) {
                showModal('adminWithdrawModal');
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
        });
    });
    
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
            if (data.user.role !== 'admin') {
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
            if (data.user.role === 'admin') {
                currentAdmin = data.user;
                showDashboard();
                loadData();
                startMessagePolling();
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
    showLogin();
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
}

function showSection(section) {
    // Ocultar TODAS las secciones de contenido
    document.querySelectorAll('.content-section').forEach(function(s) {
        s.classList.add('hidden');
    });
    
    // Mostrar la sección seleccionada
    const sectionEl = document.getElementById(section + 'Section');
    if (sectionEl) {
        sectionEl.classList.remove('hidden');
    }
    
    // Actualizar navegación activa
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.classList.remove('active');
    });
    
    const navItem = document.querySelector('.nav-item[data-section="' + section + '"]');
    if (navItem) navItem.classList.add('active');
    
    // Cargar datos según la sección
    if (section === 'users') {
        loadUsers();
    } else if (section === 'chats') {
        loadConversations();
    } else if (section === 'stats') {
        loadStats();
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
            '</div>';
    }
    
    showModal('viewUserModal');
}

function openCreateUserModal() {
    const form = document.getElementById('createUserForm');
    if (form) form.reset();
    showModal('createUserModal');
}

async function handleCreateUser(e) {
    e.preventDefault();
    
    const data = {
        username: document.getElementById('createUsername').value,
        email: document.getElementById('createEmail').value,
        phone: document.getElementById('createPhone').value,
        password: document.getElementById('createPassword').value,
        role: document.getElementById('createRole').value
    };
    
    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Usuario creado exitosamente', 'success');
            hideModal('createUserModal');
            loadUsers();
        } else {
            const error = await response.json();
            showToast(error.error || 'Error al crear usuario', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

function openEditUserModal(userId) {
    const user = users.find(function(u) { return u.id === userId; });
    if (!user) return;
    
    const editUserId = document.getElementById('editUserId');
    const editUsername = document.getElementById('editUsername');
    const editEmail = document.getElementById('editEmail');
    const editPhone = document.getElementById('editPhone');
    const editRole = document.getElementById('editRole');
    const editStatus = document.getElementById('editStatus');
    const editPassword = document.getElementById('editPassword');
    
    if (editUserId) editUserId.value = user.id;
    if (editUsername) editUsername.value = user.username;
    if (editEmail) editEmail.value = user.email || '';
    if (editPhone) editPhone.value = user.phone || '';
    if (editRole) editRole.value = user.role;
    if (editStatus) editStatus.value = user.isActive ? 'true' : 'false';
    if (editPassword) editPassword.value = '';
    
    showModal('editUserModal');
}

async function handleEditUser(e) {
    e.preventDefault();
    
    const userId = document.getElementById('editUserId').value;
    const data = {
        email: document.getElementById('editEmail').value,
        phone: document.getElementById('editPhone').value,
        role: document.getElementById('editRole').value,
        isActive: document.getElementById('editStatus').value === 'true'
    };
    
    const newPassword = document.getElementById('editPassword').value;
    if (newPassword) {
        data.password = newPassword;
    }
    
    try {
        const response = await fetch('/api/admin/users/' + userId, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Usuario actualizado exitosamente', 'success');
            hideModal('editUserModal');
            loadUsers();
        } else {
            const error = await response.json();
            showToast(error.error || 'Error al actualizar usuario', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

// ========================================
// CHATS
// ========================================

async function loadConversations() {
    try {
        const response = await fetch('/api/conversations', {
            headers: { 'Authorization': 'Bearer ' + currentToken }
        });
        
        if (response.ok) {
            conversations = await response.json();
            renderConversations(conversations);
            
            // Actualizar contador de mensajes sin leer en el badge
            const totalUnread = conversations.reduce(function(sum, conv) {
                return sum + (conv.unreadCount || conv.unread || 0);
            }, 0);
            
            const unreadBadge = document.getElementById('unreadBadge');
            if (unreadBadge) {
                unreadBadge.textContent = totalUnread;
                unreadBadge.classList.toggle('hidden', totalUnread === 0);
            }
            
            // Actualizar estadística de mensajes
            const statMessages = document.getElementById('statMessages');
            if (statMessages) {
                statMessages.textContent = conversations.length;
            }
            
            // Actualizar estadística de sin leer
            const statUnread = document.getElementById('statUnread');
            if (statUnread) {
                statUnread.textContent = totalUnread;
            }
        } else {
            console.error('Error en respuesta de conversaciones:', response.status);
        }
    } catch (error) {
        console.error('Error cargando conversaciones:', error);
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
            // Actualizar la lista de conversaciones para quitar el badge de no leídos
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

async function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input || !selectedUserId) return;
    
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
        showToast('Error al enviar mensaje', 'error');
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
            showToast('Depósito realizado: $' + amount.toLocaleString(), 'success');
            hideModal('adminDepositModal');
            document.getElementById('adminDepositForm').reset();
            // Recargar datos del usuario
            loadUsers();
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
            showToast('Retiro realizado: $' + amount.toLocaleString(), 'success');
            hideModal('adminWithdrawModal');
            document.getElementById('adminWithdrawForm').reset();
            // Recargar datos del usuario
            loadUsers();
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
// CHAT EN TIEMPO REAL - POLLING
// ========================================

function startMessagePolling() {
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
    }
    
    messagePollingInterval = setInterval(function() {
        if (selectedUserId) {
            loadMessages(selectedUserId);
        }
        loadConversations();
    }, 3000);
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
