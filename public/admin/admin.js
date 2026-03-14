// ========================================
// PANEL DE ADMINISTRACIÓN - SALA DE JUEGOS
// ========================================

const API_URL = '';
let currentAdmin = null;
let currentToken = localStorage.getItem('adminToken');
let selectedUserId = null;

// ========================================
// INICIALIZACIÓN
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin JS cargado');
    
    // Setup login
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.onclick = function() {
            console.log('Botón login clickeado');
            doLogin();
        };
    }
    
    // Enter en password
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.onkeydown = function(e) {
            if (e.key === 'Enter') {
                doLogin();
            }
        };
    }
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = doLogout;
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
                return;
            }
            
            currentToken = data.token;
            currentAdmin = data.user;
            localStorage.setItem('adminToken', currentToken);
            
            showDashboard();
            loadData();
        } else {
            errorDiv.textContent = data.error || 'Usuario o contraseña incorrectos';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Error login:', error);
        errorDiv.textContent = 'Error de conexión';
        errorDiv.style.display = 'block';
    }
}

async function verifyToken() {
    try {
        const response = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.user.role === 'admin') {
                currentAdmin = data.user;
                showDashboard();
                loadData();
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
}

function showDashboard() {
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    const adminName = document.getElementById('adminName');
    
    if (loginScreen) loginScreen.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');
    if (adminName && currentAdmin) adminName.textContent = currentAdmin.username;
}

// ========================================
// DATOS
// ========================================

async function loadData() {
    loadUsers();
    loadConversations();
}

async function loadUsers() {
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const users = await response.json();
            renderUsers(users);
        }
    } catch (error) {
        console.error('Error cargando usuarios:', error);
    }
}

function renderUsers(users) {
    const container = document.getElementById('usersTableBody');
    if (!container) return;
    
    container.innerHTML = users.map(u => `
        <tr>
            <td>${u.username}</td>
            <td>${u.email || '-'}</td>
            <td>${u.role}</td>
            <td>${u.isActive ? '✅' : '❌'}</td>
        </tr>
    `).join('');
}

async function loadConversations() {
    try {
        const response = await fetch('/api/conversations', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        
        if (response.ok) {
            const conversations = await response.json();
            renderConversations(conversations);
        }
    } catch (error) {
        console.error('Error cargando conversaciones:', error);
    }
}

function renderConversations(conversations) {
    const container = document.getElementById('conversationsList');
    if (!container) return;
    
    if (conversations.length === 0) {
        container.innerHTML = '<div class="empty">No hay conversaciones</div>';
        return;
    }
    
    container.innerHTML = conversations.map(c => `
        <div class="conversation-item" onclick="selectConversation('${c.userId}', '${c.username}')">
            <span class="username">${c.username}</span>
            ${c.unread > 0 ? `<span class="badge">${c.unread}</span>` : ''}
        </div>
    `).join('');
}

async function selectConversation(userId, username) {
    selectedUserId = userId;
    document.getElementById('chatUserName').textContent = username;
    loadMessages(userId);
}

async function loadMessages(userId) {
    try {
        const response = await fetch(`/api/messages/${userId}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
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
    
    container.innerHTML = messages.map(m => `
        <div class="message ${m.senderRole === 'admin' ? 'sent' : 'received'}">
            <div>${m.type === 'image' ? '<img src="' + m.content + '" style="max-width:200px">' : escapeHtml(m.content)}</div>
            <span class="time">${new Date(m.timestamp).toLocaleTimeString()}</span>
        </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input || !selectedUserId) return;
    
    const content = input.value.trim();
    if (!content) return;
    
    try {
        await fetch('/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ content, receiverId: selectedUserId, type: 'text' })
        });
        
        input.value = '';
        loadMessages(selectedUserId);
    } catch (error) {
        console.error('Error enviando mensaje:', error);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
