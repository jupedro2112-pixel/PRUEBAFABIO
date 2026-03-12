/**
 * ========================================
 * SALA DE JUEGOS - APLICACIÓN DE CHAT
 * ========================================
 * Funcionalidades principales:
 * - Manejo de login
 * - Envío de mensajes
 * - Copiar texto al portapapeles
 * - Scroll automático
 * - Manejo de imágenes
 */

// ========================================
// VARIABLES GLOBALES
// ========================================
let currentUser = localStorage.getItem('chatUsername') || 'Usuario' + Math.floor(Math.random() * 1000);
let messages = [];
let isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';

// ========================================
// INICIALIZACIÓN
// ========================================
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // Detectar página actual
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    if (currentPage === 'chat.html' || currentPage === '') {
        // Verificar si está logueado
        if (!isLoggedIn && !localStorage.getItem('chatUsername')) {
            // Redirigir a login si no está autenticado
            // window.location.href = 'index.html';
        }
        
        // Inicializar chat
        initChat();
    } else {
        // Inicializar login
        initLogin();
    }
    
    // Configurar eventos globales
    setupGlobalEvents();
}

// ========================================
// LOGIN - FUNCIONALIDADES
// ========================================
function initLogin() {
    const loginForm = document.getElementById('loginForm');
    const createUserForm = document.getElementById('createUserForm');
    
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    if (createUserForm) {
        createUserForm.addEventListener('submit', handleCreateUser);
    }
}

function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!username || !password) {
        showToast('⚠️ Por favor completa todos los campos', 'error');
        return;
    }
    
    // Simular autenticación
    localStorage.setItem('chatUsername', username);
    localStorage.setItem('isLoggedIn', 'true');
    currentUser = username;
    
    showToast('✅ ¡Bienvenido ' + username + '!');
    
    // Redirigir al chat
    setTimeout(() => {
        window.location.href = 'chat.html';
    }, 1000);
}

function handleCreateUser(e) {
    e.preventDefault();
    
    const newUsername = document.getElementById('newUsername').value.trim();
    const newEmail = document.getElementById('newEmail').value.trim();
    const newPassword = document.getElementById('newPassword').value.trim();
    
    if (!newUsername || !newEmail || !newPassword) {
        showToast('⚠️ Por favor completa todos los campos', 'error');
        return;
    }
    
    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        showToast('⚠️ Por favor ingresa un email válido', 'error');
        return;
    }
    
    // Simular creación de usuario
    localStorage.setItem('chatUsername', newUsername);
    localStorage.setItem('isLoggedIn', 'true');
    currentUser = newUsername;
    
    showToast('✅ ¡Usuario creado exitosamente!');
    closeModal('createUserModal');
    
    // Redirigir al chat
    setTimeout(() => {
        window.location.href = 'chat.html';
    }, 1000);
}

function createUser() {
    openModal('createUserModal');
}

function showHelp() {
    openModal('helpModal');
}

// ========================================
// CHAT - FUNCIONALIDADES
// ========================================
function initChat() {
    // Mostrar nombre de usuario
    const userNameElement = document.getElementById('currentUser');
    if (userNameElement) {
        userNameElement.textContent = currentUser;
    }
    
    // Configurar input de mensajes
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Focus automático en el input
        messageInput.focus();
    }
    
    // Configurar input de imágenes
    const imageInput = document.getElementById('imageInput');
    if (imageInput) {
        imageInput.addEventListener('change', handleImageUpload);
    }
    
    // Scroll al último mensaje
    scrollToBottom();
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message) {
        return;
    }
    
    // Crear mensaje
    const messageData = {
        id: Date.now(),
        author: currentUser,
        content: message,
        timestamp: new Date(),
        type: 'sent'
    };
    
    // Agregar a la lista de mensajes
    messages.push(messageData);
    
    // Renderizar mensaje
    renderMessage(messageData);
    
    // Limpiar input
    messageInput.value = '';
    messageInput.focus();
    
    // Scroll al final
    scrollToBottom();
    
    // Simular respuesta automática (opcional)
    simulateResponse();
}

function renderMessage(messageData) {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageData.type}-message`;
    messageElement.dataset.id = messageData.id;
    
    const timeString = formatTime(messageData.timestamp);
    
    if (messageData.type === 'sent') {
        messageElement.innerHTML = `
            <div class="message-content">
                <p>${escapeHtml(messageData.content)}</p>
                <p class="message-time">${timeString}</p>
            </div>
            <button class="copy-btn" onclick="copyMessage(this)" title="Copiar mensaje">
                📋 Copiar
            </button>
        `;
    } else if (messageData.type === 'received') {
        messageElement.innerHTML = `
            <div class="message-avatar">👤</div>
            <div class="message-content">
                <p class="message-author">${escapeHtml(messageData.author)}</p>
                <p>${escapeHtml(messageData.content)}</p>
                <p class="message-time">${timeString}</p>
            </div>
            <button class="copy-btn" onclick="copyMessage(this)" title="Copiar mensaje">
                📋 Copiar
            </button>
        `;
    } else if (messageData.type === 'image') {
        messageElement.className = 'message sent-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <img src="${messageData.imageUrl}" alt="Imagen" class="message-image" onclick="viewImage('${messageData.imageUrl}')">
                <p class="message-time">${timeString}</p>
            </div>
            <button class="copy-btn" onclick="copyMessage(this)" title="Copiar mensaje">
                📋 Copiar
            </button>
        `;
    }
    
    chatArea.appendChild(messageElement);
}

function renderSystemMessage(content) {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message system-message';
    messageElement.innerHTML = `
        <div class="message-content">
            <p>${content}</p>
            <p class="message-time">Sistema - justo ahora</p>
        </div>
    `;
    
    chatArea.appendChild(messageElement);
    scrollToBottom();
}

// ========================================
// MANEJO DE IMÁGENES
// ========================================
function selectImage() {
    const imageInput = document.getElementById('imageInput');
    if (imageInput) {
        imageInput.click();
    }
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
        showToast('⚠️ Por favor selecciona una imagen válida', 'error');
        return;
    }
    
    // Validar tamaño (máximo 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('⚠️ La imagen no debe superar los 5MB', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const imageUrl = event.target.result;
        
        // Crear mensaje de imagen
        const messageData = {
            id: Date.now(),
            author: currentUser,
            imageUrl: imageUrl,
            timestamp: new Date(),
            type: 'image'
        };
        
        messages.push(messageData);
        renderMessage(messageData);
        scrollToBottom();
        
        showToast('✅ Imagen enviada');
    };
    
    reader.readAsDataURL(file);
    
    // Limpiar input para permitir seleccionar la misma imagen
    e.target.value = '';
}

function viewImage(imageUrl) {
    // Crear modal para ver imagen
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 90%; max-height: 90%; padding: 10px;">
            <span class="close-btn" onclick="this.closest('.modal').remove()">&times;</span>
            <img src="${imageUrl}" style="max-width: 100%; max-height: 80vh; border-radius: 8px;">
        </div>
    `;
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    document.body.appendChild(modal);
}

// ========================================
// COPIAR AL PORTAPAPELES
// ========================================
function copyMessage(button) {
    const messageElement = button.closest('.message');
    const contentElement = messageElement.querySelector('.message-content p:not(.message-time):not(.message-author)');
    
    if (contentElement) {
        const textToCopy = contentElement.textContent;
        
        navigator.clipboard.writeText(textToCopy).then(function() {
            showToast('✅ Mensaje copiado');
            
            // Efecto visual en el botón
            const originalText = button.textContent;
            button.textContent = '✓ Copiado';
            button.style.background = 'rgba(34, 197, 94, 0.3)';
            button.style.color = '#22c55e';
            
            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = '';
                button.style.color = '';
            }, 2000);
        }).catch(function(err) {
            showToast('❌ Error al copiar', 'error');
            console.error('Error al copiar:', err);
        });
    }
}

// ========================================
// UTILIDADES
// ========================================
function scrollToBottom() {
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

function formatTime(date) {
    if (typeof date === 'string') {
        date = new Date(date);
    }
    
    return date.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function simulateResponse() {
    // Simular respuesta automática después de 2 segundos
    setTimeout(() => {
        const responses = [
            '¡Entendido! ¿En qué más puedo ayudarte?',
            'Gracias por tu mensaje. Te responderemos pronto.',
            '¡Perfecto! ¿Algo más en lo que pueda asistirte?',
            'Recibido. Un agente te contactará en breve.',
            '¡Gracias por escribirnos! 🎮'
        ];
        
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        
        const responseData = {
            id: Date.now(),
            author: 'Admin',
            content: randomResponse,
            timestamp: new Date(),
            type: 'received'
        };
        
        messages.push(responseData);
        renderMessage(responseData);
        scrollToBottom();
    }, 2000);
}

// ========================================
// MODALES
// ========================================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

// ========================================
// NAVEGACIÓN Y ACCIONES
// ========================================
function logout() {
    localStorage.removeItem('chatUsername');
    localStorage.removeItem('isLoggedIn');
    showToast('👋 ¡Hasta pronto!');
    
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

function contactSupport() {
    openModal('supportModal');
}

function installApp() {
    showToast('📱 Instalando aplicación...');
    
    // Simular instalación
    setTimeout(() => {
        showToast('✅ ¡App instalada correctamente!');
    }, 2000);
    
    // Intentar PWA install si está disponible
    if (window.deferredPrompt) {
        window.deferredPrompt.prompt();
        window.deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('Usuario aceptó instalar la app');
            }
            window.deferredPrompt = null;
        });
    }
}

// ========================================
// TOAST NOTIFICATIONS
// ========================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    
    // Cambiar color según tipo
    if (type === 'error') {
        toast.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        toast.style.color = '#ef4444';
    } else {
        toast.style.borderColor = 'rgba(255, 215, 0, 0.3)';
        toast.style.color = '#ffd700';
    }
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ========================================
// EVENTOS GLOBALES
// ========================================
function setupGlobalEvents() {
    // Capturar evento beforeinstallprompt para PWA
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.deferredPrompt = e;
    });
    
    // Cerrar modales al hacer click fuera
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('active');
            e.target.style.display = 'none';
        }
    });
    
    // Cerrar modales con tecla Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const activeModals = document.querySelectorAll('.modal.active');
            activeModals.forEach(modal => {
                modal.classList.remove('active');
                modal.style.display = 'none';
            });
        }
    });
    
    // Auto-scroll cuando se agregan nuevos mensajes
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        const observer = new MutationObserver(() => {
            scrollToBottom();
        });
        
        observer.observe(chatArea, {
            childList: true,
            subtree: true
        });
    }
}

// ========================================
// FUNCIONES ADICIONALES
// ========================================

// Limpiar chat (función para desarrollo)
function clearChat() {
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.innerHTML = '';
        messages = [];
        renderSystemMessage('🧹 Chat limpiado');
    }
}

// Exportar chat (funcionalidad extra)
function exportChat() {
    const chatText = messages.map(m => {
        const time = formatTime(m.timestamp);
        const author = m.author || 'Tú';
        return `[${time}] ${author}: ${m.content || '[Imagen]'}`;
    }).join('\n');
    
    const blob = new Blob([chatText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chat-sala-de-juegos.txt';
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('✅ Chat exportado');
}

// ========================================
// CONSOLE API (para desarrollo)
// ========================================
console.log('%c🎮 Sala de Juegos - Chat', 'color: #ffd700; font-size: 20px; font-weight: bold;');
console.log('%cComandos disponibles:', 'color: #8b5cf6; font-weight: bold;');
console.log('- clearChat(): Limpia el chat');
console.log('- exportChat(): Exporta el chat a archivo');
console.log('- sendMessage(): Envía un mensaje');
