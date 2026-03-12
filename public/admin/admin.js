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
    // Login
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
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
            currentAdmin = data.user;
            showDashboard();
            initializeSocket();
            loadInitialData();
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
    
    msgDiv.innerHTML = `
        <div>${escapeHtml(message.content)}</div>
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
        
        tr.innerHTML = `
            <td><strong>${user.username}</strong></td>
            <td><code>${user.accountNumber}</code></td>
            <td>${user.email || '-'}</td>
            <td>$${user.balance?.toFixed(2) || '0.00'}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${lastLogin}</td>
            <td class="actions">
                <button class="btn btn-small btn-secondary" onclick="viewUserDetails('${user.id}')">👁️</button>
                <button class="btn btn-small btn-secondary" onclick="editUser('${user.id}')">✏️</button>
                <button class="btn btn-small btn-danger" onclick="deleteUser('${user.id}')">🗑️</button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
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

// Exponer funciones globales para los onclick
window.viewUserDetails = viewUserDetails;
window.editUser = editUser;
window.deleteUser = deleteUser;

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
