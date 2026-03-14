// ========================================
// PANEL DE ADMINISTRACIÓN - SALA DE JUEGOS
// ========================================

const API_URL = ''; // Mismo dominio
let socket = null;
let currentAdmin = null;
let currentToken = localStorage.getItem('adminToken');
let selectedUserId = null;
let conversations = [];
let users = [];
let messages = [];

// ========================================
// INICIALIZACIÓN
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    if (currentToken) {
        verifyToken();
    } else {
        showLoginScreen();
    }
    
    setupEventListeners();
});

function setupEventListeners() {
    // Login - usar botón en lugar de submit del formulario
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }
    
    // También permitir Enter en los inputs
    document.getElementById('username').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin(e);
    });
    document.getElementById('password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin(e);
    });
    
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    
    // Navegación
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            showSection(section);
        });
    });
    
    // Chats
    document.getElementById('refreshChats').addEventListener('click', loadConversations);
    document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById('viewUserBtn').addEventListener('click', () => {
        if (selectedUserId) {
            viewUserDetails(selectedUserId);
        }
    });
    
    // Adjuntar archivo
    document.getElementById('attachFileBtn').addEventListener('click', () => {
        document.getElementById('adminFileInput').click();
    });
    document.getElementById('adminFileInput').addEventListener('change', handleFileUpload);
    
    // Depósito/Retiro desde admin
    document.getElementById('depositUserBtn').addEventListener('click', () => {
        if (selectedUserId) {
            showModal('adminDepositModal');
        } else {
            showToast('Selecciona un usuario primero', 'error');
        }
    });
    document.getElementById('withdrawUserBtn').addEventListener('click', () => {
        if (selectedUserId) {
            showModal('adminWithdrawModal');
        } else {
            showToast('Selecciona un usuario primero', 'error');
        }
    });
    document.getElementById('closeAdminDepositModal').addEventListener('click', () => hideModal('adminDepositModal'));
    document.getElementById('cancelAdminDeposit').addEventListener('click', () => hideModal('adminDepositModal'));
    document.getElementById('adminDepositForm').addEventListener('submit', handleAdminDeposit);
    document.getElementById('closeAdminWithdrawModal').addEventListener('click', () => hideModal('adminWithdrawModal'));
    document.getElementById('cancelAdminWithdraw').addEventListener('click', () => hideModal('adminWithdrawModal'));
    document.getElementById('adminWithdrawForm').addEventListener('submit', handleAdminWithdraw);
    
    // Buscador de chats
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterConversations(e.target.value);
        });
    }
    
    // Usuarios
    document.getElementById('createUserBtn').addEventListener('click', () => {
        showModal('createUserModal');
    });
    document.getElementById('closeCreateModal').addEventListener('click', () => {
        hideModal('createUserModal');
    });
    document.getElementById('cancelCreate').addEventListener('click', () => {
        hideModal('createUserModal');
    });
    document.getElementById('createUserForm').addEventListener('submit', handleCreateUser);
    
    // View User Modal
    document.getElementById('closeViewModal').addEventListener('click', () => {
        hideModal('viewUserModal');
    });
    document.getElementById('closeViewBtn').addEventListener('click', () => {
        hideModal('viewUserModal');
    });
    document.getElementById('editUserBtn').addEventListener('click', () => {
        hideModal('viewUserModal');
        openEditUserModal();
    });
    
    // Edit User Modal
    document.getElementById('closeEditModal').addEventListener('click', () => {
        hideModal('editUserModal');
    });
    document.getElementById('cancelEdit').addEventListener('click', () => {
        hideModal('editUserModal');
    });
    document.getElementById('editUserForm').addEventListener('submit', handleEditUser);
    
    // Sincronización JUGAYGANA
    document.getElementById('syncAllBtn')?.addEventListener('click', startFullSync);
    document.getElementById('syncRecentBtn')?.addEventListener('click', syncRecentUsers);
    document.getElementById('refreshSyncStatusBtn')?.addEventListener('click', loadSyncStatus);
}

// ========================================
// AUTENTICACIÓN
// ========================================

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('loginError');
    
    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (data.user.role !== 'admin') {
                errorDiv.textContent = 'Acceso denegado. Solo administradores.';
                errorDiv.classList.add('show');
                return;
            }
            
            currentToken = data.token;
            currentAdmin = data.user;
            localStorage.setItem('adminToken', currentToken);
            
            showDashboard();
            initializeSocket();
            loadInitialData();
            startMessagePolling(); // Iniciar polling de mensajes
        } else {
            errorDiv.textContent = data.error || 'Error de autenticación';
            errorDiv.classList.add('show');
        }
    } catch (error) {
        errorDiv.textContent = 'Error de conexión';
        errorDiv.classList.add('show');
    }
}

async function verifyToken() {
    try {
        const response = await fetch(`${API_URL}/api/auth/verify`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            // Verificar que sea admin
            if (data.user.role !== 'admin') {
                localStorage.removeItem('adminToken');
                showLoginScreen();
                return;
            }
            currentAdmin = data.user;
            showDashboard();
            initializeSocket();
            loadInitialData();
            startMessagePolling(); // Iniciar polling de mensajes
        } else {
            localStorage.removeItem('adminToken');
            showLoginScreen();
        }
    } catch (error) {
        localStorage.removeItem('adminToken');
        showLoginScreen();
    }
}

function handleLogout() {
    if (socket) {
        socket.disconnect();
    }
    currentToken = null;
    currentAdmin = null;
    localStorage.removeItem('adminToken');
    showLoginScreen();
}

// ========================================
// SOCKET.IO
// ========================================

function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('✅ Conectado al servidor');
        socket.emit('authenticate', currentToken);
    });
    
    socket.on('authenticated', (data) => {
        if (data.success) {
            console.log('✅ Autenticado como:', data.role);
        }
    });
    
    socket.on('new_message', (data) => {
        const { message, userId, username } = data;
        
        // Si estamos en la conversación actual, agregar el mensaje
        if (selectedUserId === userId) {
            addMessageToChat(message);
            scrollToBottom();
        } else {
            // Incrementar contador de no leídos
            updateUnreadCount(userId);
        }
        
        // Actualizar la lista de conversaciones
        updateConversationPreview(userId, message);
        
        // Mostrar notificación
        showToast(`💬 Nuevo mensaje de ${username}`, 'success');
    });
    
    socket.on('message_sent', (message) => {
        addMessageToChat(message);
        scrollToBottom();
    });
    
    socket.on('user_connected', (data) => {
        updateUserStatus(data.userId, true);
        showToast(`👤 ${data.username} se conectó`, 'success');
    });
    
    socket.on('user_disconnected', (data) => {
        updateUserStatus(data.userId, false);
    });
    
    socket.on('stats', (stats) => {
        updateStats(stats);
    });
    
    socket.on('error', (error) => {
        showToast(error.message, 'error');
    });
}

// ========================================
// NAVEGACIÓN
// ========================================

function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

function showDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('adminName').textContent = currentAdmin?.username || 'Admin';
}

function showSection(section) {
    // Actualizar navegación
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === section) {
            item.classList.add('active');
        }
    });
    
    // Mostrar sección
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.add('hidden');
    });
    document.getElementById(`${section}Section`).classList.remove('hidden');
    
    // Cargar datos específicos
    if (section === 'chats') {
        loadConversations();
    } else if (section === 'users') {
        loadUsers();
    } else if (section === 'stats') {
        loadStats();
    }
}

// ========================================
// CHATS
// ========================================

async function loadConversations() {
    try {
        const response = await fetch(`${API_URL}/api/conversations`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            conversations = await response.json();
            renderConversations();
            updateStatsBar();
        }
    } catch (error) {
        showToast('Error cargando conversaciones', 'error');
    }
}

function renderConversations() {
    const container = document.getElementById('conversationsList');
    container.innerHTML = '';
    
    if (conversations.length === 0) {
        container.innerHTML = `
            <div class="chat-placeholder" style="padding: 40px;">
                <p>No hay conversaciones aún</p>
            </div>
        `;
        return;
    }
    
    conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = `conversation-item ${conv.unreadCount > 0 ? 'unread' : ''} ${conv.userId === selectedUserId ? 'active' : ''}`;
        item.onclick = () => selectConversation(conv.userId);
        
        const time = formatTime(conv.lastMessage?.timestamp);
        const preview = conv.lastMessage?.content?.substring(0, 30) + '...' || 'Sin mensajes';
        
        item.innerHTML = `
            <div class="conversation-avatar">👤</div>
            <div class="conversation-info">
                <div class="conversation-name">${conv.username}</div>
                <div class="conversation-preview">${preview}</div>
            </div>
            <div class="conversation-meta">
                <div class="conversation-time">${time}</div>
                ${conv.unreadCount > 0 ? `<span class="unread-count">${conv.unreadCount}</span>` : ''}
            </div>
        `;
        
        container.appendChild(item);
    });
}

async function selectConversation(userId) {
    selectedUserId = userId;
    
    // Actualizar UI
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget?.classList.add('active');
    
    // Cargar mensajes
    await loadMessages(userId);
    
    // Mostrar área de chat
    document.getElementById('chatPlaceholder').classList.add('hidden');
    document.getElementById('chatContent').classList.remove('hidden');
    
    // Iniciar polling de mensajes y balance en tiempo real
    const user = users.find(u => u.id === userId);
    if (user) {
        startMessagePolling();
        startBalanceUpdates(user.username);
    }
    
    // Actualizar info del usuario
    const user = users.find(u => u.id === userId);
    if (user) {
        document.getElementById('chatUserName').textContent = user.username;
    }
    
    // Marcar como leídos
    await fetch(`${API_URL}/api/messages/read/${userId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    
    // Actualizar contador
    const conv = conversations.find(c => c.userId === userId);
    if (conv) {
        conv.unreadCount = 0;
        renderConversations();
        updateStatsBar();
    }
}

async function loadMessages(userId) {
    try {
        const response = await fetch(`${API_URL}/api/messages/${userId}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            messages = await response.json();
            renderMessages();
        }
    } catch (error) {
        showToast('Error cargando mensajes', 'error');
    }
}

function renderMessages() {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        addMessageToChat(msg);
    });
    
    scrollToBottom();
}

function addMessageToChat(message) {
    const container = document.getElementById('messagesContainer');
    const isSent = message.senderRole === 'admin';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
    const time = formatTime(message.timestamp);
    
    let contentHtml = '';
    if (message.type === 'image') {
        // Mostrar imagen
        contentHtml = `<img src="${message.content}" alt="Imagen" style="max-width: 200px; max-height: 200px; border-radius: 8px; cursor: pointer;" onclick="window.open('${message.content}', '_blank')">`;
    } else {
        // Texto normal
        contentHtml = `<div>${escapeHtml(message.content)}</div>`;
    }
    
    msgDiv.innerHTML = `
        ${contentHtml}
        <span class="message-time">${time}</span>
    `;
    
    container.appendChild(msgDiv);
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    
    if (!content || !selectedUserId) {
        console.log('No content or no user selected');
        return;
    }
    
    console.log('Sending message to:', selectedUserId, 'Content:', content);
    
    try {
        const response = await fetch(`${API_URL}/api/messages/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                content,
                receiverId: selectedUserId,
                type: 'text'
            })
        });
        
        if (response.ok) {
            const message = await response.json();
            console.log('Message sent:', message);
            addMessageToChat(message);
            scrollToBottom();
            input.value = '';
            // Actualizar preview de conversación
            updateConversationPreview(selectedUserId, message);
        } else {
            const error = await response.json();
            console.error('Error sending message:', error);
            showToast('Error al enviar mensaje: ' + (error.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showToast('Error de conexión al enviar mensaje', 'error');
    }
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

// ========================================
// ENVÍO DE ARCHIVOS
// ========================================

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
    reader.onload = async (event) => {
        try {
            const response = await fetch(`${API_URL}/api/messages/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({
                    content: event.target.result,
                    receiverId: selectedUserId,
                    type: 'image'
                })
            });
            
            if (response.ok) {
                const message = await response.json();
                addMessageToChat(message);
                scrollToBottom();
                showToast('📸 Imagen enviada', 'success');
                // Actualizar preview de conversación
                updateConversationPreview(selectedUserId, message);
            } else {
                const error = await response.json();
                showToast('Error al enviar imagen: ' + (error.error || 'Error desconocido'), 'error');
            }
        } catch (error) {
            console.error('Error enviando imagen:', error);
            showToast('Error de conexión al enviar imagen', 'error');
        }
    };
    reader.readAsDataURL(file);
    
    // Limpiar input para permitir seleccionar el mismo archivo nuevamente
    e.target.value = '';
}

function updateConversationPreview(userId, message) {
    const conv = conversations.find(c => c.userId === userId);
    if (conv) {
        conv.lastMessage = message;
        renderConversations();
    }
}

function updateUnreadCount(userId) {
    const conv = conversations.find(c => c.userId === userId);
    if (conv) {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
        renderConversations();
        updateStatsBar();
    }
}

function updateUserStatus(userId, online) {
    if (selectedUserId === userId) {
        const statusEl = document.getElementById('chatUserStatus');
        statusEl.textContent = online ? 'En línea' : 'Desconectado';
        statusEl.className = `user-status ${online ? 'online' : ''}`;
    }
}

// ========================================
// USUARIOS
// ========================================

async function loadUsers() {
    try {
        const response = await fetch(`${API_URL}/api/users`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            users = await response.json();
            renderUsers();
        }
    } catch (error) {
        showToast('Error cargando usuarios', 'error');
    }
}

function renderUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    users.filter(u => u.role === 'user').forEach(user => {
        const tr = document.createElement('tr');
        
        const lastLogin = user.lastLogin ? formatDate(user.lastLogin) : 'Nunca';
        const statusClass = user.isActive ? 'active' : 'inactive';
        const statusText = user.isActive ? 'Activo' : 'Inactivo';
        
        // Estado de sincronización con JUGAYGANA
        let jugayganaStatus = '⏳';
        let jugayganaTitle = 'Pendiente';
        if (user.jugayganaSyncStatus === 'synced' || user.jugayganaSyncStatus === 'linked') {
            jugayganaStatus = '✅';
            jugayganaTitle = 'Sincronizado';
        } else if (user.jugayganaSyncStatus === 'pending') {
            jugayganaStatus = '⏳';
            jugayganaTitle = 'Pendiente';
        }
        
        tr.innerHTML = `
            <td><strong>${user.username}</strong></td>
            <td><code>${user.accountNumber}</code></td>
            <td>${user.email || '-'}</td>
            <td>${user.phone || '-'}</td>
            <td><span title="${jugayganaTitle}">${jugayganaStatus}</span></td>
            <td>$${user.balance?.toFixed(2) || '0.00'}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${lastLogin}</td>
            <td class="actions">
                <button class="btn btn-small btn-secondary" onclick="viewUserDetails('${user.id}')">👁️</button>
                <button class="btn btn-small btn-secondary" onclick="editUser('${user.id}')">✏️</button>
                ${user.jugayganaSyncStatus !== 'synced' && user.jugayganaSyncStatus !== 'linked' ? 
                    `<button class="btn btn-small btn-primary" onclick="syncUserToJugaygana('${user.id}')">🔄</button>` : ''}
                <button class="btn btn-small btn-danger" onclick="deleteUser('${user.id}')">🗑️</button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

// Sincronizar usuario con JUGAYGANA
async function syncUserToJugaygana(userId) {
    try {
        const response = await fetch(`${API_URL}/api/users/${userId}/sync-jugaygana`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast('✅ ' + data.message, 'success');
            loadUsers();
        } else {
            const error = await response.json();
            showToast(error.error || 'Error sincronizando', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

async function handleCreateUser(e) {
    e.preventDefault();
    
    const userData = {
        username: document.getElementById('newUsername').value,
        password: document.getElementById('newPassword').value,
        email: document.getElementById('newEmail').value,
        phone: document.getElementById('newPhone').value,
        role: document.getElementById('newRole').value,
        balance: parseFloat(document.getElementById('newBalance').value) || 0
    };
    
    try {
        const response = await fetch(`${API_URL}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify(userData)
        });
        
        if (response.ok) {
            showToast('✅ Usuario creado exitosamente', 'success');
            hideModal('createUserModal');
            document.getElementById('createUserForm').reset();
            loadUsers();
        } else {
            const data = await response.json();
            showToast(data.error || 'Error creando usuario', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

function viewUserDetails(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    const detailsDiv = document.getElementById('userDetails');
    detailsDiv.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">ID:</span>
            <span class="detail-value">${user.id}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Usuario:</span>
            <span class="detail-value">${user.username}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Email:</span>
            <span class="detail-value">${user.email || '-'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Teléfono:</span>
            <span class="detail-value">${user.phone || '-'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Número de Cuenta:</span>
            <span class="detail-value"><code>${user.accountNumber}</code></span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Balance:</span>
            <span class="detail-value">$${user.balance?.toFixed(2) || '0.00'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Rol:</span>
            <span class="detail-value">${user.role}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Estado:</span>
            <span class="detail-value">${user.isActive ? 'Activo' : 'Inactivo'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Creado:</span>
            <span class="detail-value">${formatDate(user.createdAt)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Último Login:</span>
            <span class="detail-value">${user.lastLogin ? formatDate(user.lastLogin) : 'Nunca'}</span>
        </div>
    `;
    
    showModal('viewUserModal');
}

async function editUser(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    const newBalance = prompt('Nuevo balance:', user.balance || 0);
    if (newBalance === null) return;
    
    try {
        const response = await fetch(`${API_URL}/api/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ balance: parseFloat(newBalance) })
        });
        
        if (response.ok) {
            showToast('✅ Usuario actualizado', 'success');
            loadUsers();
        } else {
            showToast('Error actualizando usuario', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            showToast('✅ Usuario eliminado', 'success');
            loadUsers();
        } else {
            showToast('Error eliminando usuario', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

// ========================================
// ESTADÍSTICAS
// ========================================

async function loadStats() {
    try {
        const [usersRes, messagesRes] = await Promise.all([
            fetch(`${API_URL}/api/users`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            }),
            fetch(`${API_URL}/api/conversations`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            })
        ]);
        
        if (usersRes.ok && messagesRes.ok) {
            const usersData = await usersRes.json();
            const convData = await messagesRes.json();
            
            const allMessages = await fetch(`${API_URL}/api/messages/all`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            }).then(r => r.json()).catch(() => []);
            
            const today = new Date().toDateString();
            const todayMessages = allMessages.filter(m => 
                new Date(m.timestamp).toDateString() === today
            );
            
            document.getElementById('totalUsers').textContent = usersData.filter(u => u.role === 'user').length;
            document.getElementById('activeUsers').textContent = usersData.filter(u => u.role === 'user' && u.isActive).length;
            document.getElementById('totalMessages').textContent = allMessages.length;
            document.getElementById('todayMessages').textContent = todayMessages.length;
        }
    } catch (error) {
        showToast('Error cargando estadísticas', 'error');
    }
}

function updateStats(stats) {
    document.getElementById('statOnline').textContent = stats.connectedUsers;
}

function updateStatsBar() {
    const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    document.getElementById('statUnread').textContent = totalUnread;
    
    const badge = document.getElementById('unreadBadge');
    if (totalUnread > 0) {
        badge.textContent = totalUnread;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function loadInitialData() {
    loadConversations();
    loadUsers();
}

// ========================================
// UTILIDADES
// ========================================

function showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-AR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// SINCRONIZACIÓN JUGAYGANA
// ========================================

async function loadSyncStatus() {
    try {
        const response = await fetch(`${API_URL}/api/admin/sync-status`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            document.getElementById('syncLocalUsers').textContent = data.localUsers || 0;
            document.getElementById('syncJugayganaUsers').textContent = data.jugayganaUsers || 0;
            document.getElementById('syncPendingUsers').textContent = data.pendingUsers || 0;
            document.getElementById('syncLastSync').textContent = data.lastSync 
                ? new Date(data.lastSync).toLocaleString('es-AR') 
                : 'Nunca';
            
            // Mostrar/ocultar progreso si está en curso
            const progressDiv = document.getElementById('syncProgress');
            if (data.inProgress) {
                progressDiv.classList.remove('hidden');
                document.getElementById('syncAllBtn').disabled = true;
                document.getElementById('syncAllBtn').textContent = '⏳ Sincronizando...';
            } else {
                progressDiv.classList.add('hidden');
                document.getElementById('syncAllBtn').disabled = false;
                document.getElementById('syncAllBtn').textContent = '🔄 Sincronizar TODOS los usuarios';
            }
            
            return data;
        }
    } catch (error) {
        console.error('Error cargando estado de sincronización:', error);
    }
}

async function startFullSync() {
    if (!confirm('⚠️ Esto sincronizará TODOS los usuarios de JUGAYGANA.\n\nPuede tardar 30-60 minutos para 100,000+ usuarios.\n\n¿Continuar?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/sync-all-jugaygana`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast('✅ ' + data.message, 'success');
            
            // Mostrar progreso
            document.getElementById('syncProgress').classList.remove('hidden');
            document.getElementById('syncAllBtn').disabled = true;
            document.getElementById('syncAllBtn').textContent = '⏳ Sincronizando...';
            
            // Iniciar polling de estado
            startSyncPolling();
        } else if (response.status === 409) {
            const data = await response.json();
            showToast('⏳ ' + data.error, 'warning');
            startSyncPolling();
        } else {
            showToast('❌ Error iniciando sincronización', 'error');
        }
    } catch (error) {
        showToast('❌ Error de conexión', 'error');
    }
}

async function syncRecentUsers() {
    try {
        const response = await fetch(`${API_URL}/api/admin/sync-recent-jugaygana`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            showToast(`✅ Sincronizados ${data.created} usuarios recientes`, 'success');
            loadSyncStatus();
            loadUsers();
        } else {
            showToast('❌ Error sincronizando usuarios recientes', 'error');
        }
    } catch (error) {
        showToast('❌ Error de conexión', 'error');
    }
}

let syncPollInterval = null;

function startSyncPolling() {
    if (syncPollInterval) clearInterval(syncPollInterval);
    
    syncPollInterval = setInterval(async () => {
        const status = await loadSyncStatus();
        
        if (status && !status.inProgress) {
            clearInterval(syncPollInterval);
            syncPollInterval = null;
            showToast('✅ Sincronización completada', 'success');
            loadUsers(); // Recargar lista de usuarios
        }
    }, 5000); // Verificar cada 5 segundos
}

// Cargar estado al iniciar
if (document.getElementById('syncStatus')) {
    loadSyncStatus();
}

// Exponer funciones globales para los onclick
window.viewUserDetails = viewUserDetails;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.syncUserToJugaygana = syncUserToJugaygana;

// ========================================
// BÚSQUEDA DE CHATS
// ========================================

function filterConversations(searchTerm) {
    const container = document.getElementById('conversationsList');
    const items = container.querySelectorAll('.conversation-item');
    
    const term = searchTerm.toLowerCase().trim();
    
    items.forEach(item => {
        const userName = item.querySelector('.conversation-name')?.textContent?.toLowerCase() || '';
        const preview = item.querySelector('.conversation-preview')?.textContent?.toLowerCase() || '';
        
        if (userName.includes(term) || preview.includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// ========================================
// EDICIÓN DE USUARIO (MODAL COMPLETO)
// ========================================

let editingUserId = null;

function openEditUserModal() {
    const user = users.find(u => u.id === selectedUserId);
    if (!user) return;
    
    editingUserId = user.id;
    
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editEmail').value = user.email || '';
    document.getElementById('editPhone').value = user.phone || '';
    document.getElementById('editBalance').value = user.balance || 0;
    document.getElementById('editStatus').value = user.isActive ? 'true' : 'false';
    
    showModal('editUserModal');
}

async function handleEditUser(e) {
    e.preventDefault();
    
    if (!editingUserId) return;
    
    const userData = {
        email: document.getElementById('editEmail').value,
        phone: document.getElementById('editPhone').value,
        balance: parseFloat(document.getElementById('editBalance').value) || 0,
        isActive: document.getElementById('editStatus').value === 'true'
    };
    
    // Agregar contraseña solo si se ingresó una nueva
    const password = document.getElementById('editPassword').value;
    if (password && password.trim() !== '') {
        userData.password = password;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/users/${editingUserId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify(userData)
        });
        
        if (response.ok) {
            showToast('✅ Usuario actualizado exitosamente', 'success');
            hideModal('editUserModal');
            loadUsers();
            // Actualizar datos locales
            const userIndex = users.findIndex(u => u.id === editingUserId);
            if (userIndex !== -1) {
                users[userIndex] = { ...users[userIndex], ...userData };
            }
        } else {
            const data = await response.json();
            showToast(data.error || 'Error actualizando usuario', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexión', 'error');
    }
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
    
    const user = users.find(u => u.id === selectedUserId);
    if (!user) {
        showToast('Usuario no encontrado', 'error');
        return;
    }
    
    const amount = parseFloat(document.getElementById('adminDepositAmount').value);
    const description = document.getElementById('adminDepositDesc').value || 'Depósito desde admin';
    
    if (!amount || amount < 100) {
        showToast('El monto mínimo es $100', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/deposit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                username: user.username,
                amount: amount,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`✅ Depósito de $${amount.toLocaleString()} realizado a ${user.username}`, 'success');
            hideModal('adminDepositModal');
            document.getElementById('adminDepositForm').reset();
            // Actualizar balance mostrado
            updateUserBalance(user.username);
            // Enviar mensaje al chat
            await sendSystemMessageToUser(selectedUserId, `💰 Depósito recibido: $${amount.toLocaleString()}`);
        } else {
            showToast(data.error || 'Error al realizar depósito', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexión', 'error');
    }
}

async function handleAdminWithdraw(e) {
    e.preventDefault();
    
    if (!selectedUserId) {
        showToast('Selecciona un usuario primero', 'error');
        return;
    }
    
    const user = users.find(u => u.id === selectedUserId);
    if (!user) {
        showToast('Usuario no encontrado', 'error');
        return;
    }
    
    const amount = parseFloat(document.getElementById('adminWithdrawAmount').value);
    const description = document.getElementById('adminWithdrawDesc').value || 'Retiro desde admin';
    
    if (!amount || amount < 100) {
        showToast('El monto mínimo es $100', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/withdrawal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                username: user.username,
                amount: amount,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`✅ Retiro de $${amount.toLocaleString()} realizado de ${user.username}`, 'success');
            hideModal('adminWithdrawModal');
            document.getElementById('adminWithdrawForm').reset();
            // Actualizar balance mostrado
            updateUserBalance(user.username);
            // Enviar mensaje al chat
            await sendSystemMessageToUser(selectedUserId, `💸 Retiro realizado: $${amount.toLocaleString()}`);
        } else {
            showToast(data.error || 'Error al realizar retiro', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexión', 'error');
    }
}

async function sendSystemMessageToUser(userId, content) {
    try {
        await fetch(`${API_URL}/api/messages/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                content: content,
                receiverId: userId,
                type: 'text'
            })
        });
        // Recargar mensajes
        if (selectedUserId === userId) {
            loadMessages(userId);
        }
    } catch (error) {
        console.error('Error enviando mensaje de sistema:', error);
    }
}

// ========================================
// BALANCE EN TIEMPO REAL
// ========================================

let balanceUpdateInterval = null;

function startBalanceUpdates(username) {
    // Actualizar inmediatamente
    updateUserBalance(username);
    
    // Actualizar cada 10 segundos
    if (balanceUpdateInterval) {
        clearInterval(balanceUpdateInterval);
    }
    
    balanceUpdateInterval = setInterval(() => {
        if (selectedUserId) {
            const user = users.find(u => u.id === selectedUserId);
            if (user) {
                updateUserBalance(user.username);
            }
        }
    }, 10000);
}

function stopBalanceUpdates() {
    if (balanceUpdateInterval) {
        clearInterval(balanceUpdateInterval);
        balanceUpdateInterval = null;
    }
}

async function updateUserBalance(username) {
    try {
        const response = await fetch(`${API_URL}/api/admin/balance/${username}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const balanceEl = document.getElementById('chatUserBalance');
            if (balanceEl) {
                balanceEl.textContent = `Balance: $${data.balance.toLocaleString()}`;
            }
        }
    } catch (error) {
        console.error('Error actualizando balance:', error);
    }
}

// ========================================
// CHAT EN TIEMPO REAL - POLLING RÁPIDO
// ========================================

let messagePollingInterval = null;

function startMessagePolling() {
    // Polling cada 1 segundo para tiempo real
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
    }
    
    messagePollingInterval = setInterval(() => {
        if (selectedUserId) {
            loadMessages(selectedUserId);
        }
        loadConversations(); // Actualizar lista de conversaciones
    }, 1000);
}

function stopMessagePolling() {
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
        messagePollingInterval = null;
    }
}
