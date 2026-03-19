// ============================================
// SERVICIOS DE BASE DE DATOS - MONGODB
// ============================================

const {
  User, Message, ChatStatus, Command, Config,
  Refund, FireReward, Transaction, UserActivity, ExternalUser,
  generateId, generateAccountNumber
} = require('../models');

// ============================================
// VARIABLES GLOBALES
// ============================================
let useMongoDB = false;

function setUseMongoDB(value) {
  useMongoDB = value;
}

function isUsingMongoDB() {
  return useMongoDB;
}

// ============================================
// SERVICIOS DE USUARIOS
// ============================================

async function getAllUsers() {
  if (useMongoDB) {
    return await User.find({}).sort({ createdAt: -1 }).lean();
  }
  // Fallback a JSON
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function getUserById(id) {
  if (useMongoDB) {
    return await User.findOne({ id }).lean();
  }
  const users = await getAllUsers();
  return users.find(u => u.id === id);
}

async function getUserByUsername(username) {
  if (useMongoDB) {
    return await User.findOne({ username: username.toLowerCase() }).lean();
  }
  const users = await getAllUsers();
  return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

async function createUser(userData) {
  if (useMongoDB) {
    const user = new User({
      id: generateId(),
      accountNumber: generateAccountNumber(),
      createdAt: new Date(),
      ...userData
    });
    return await user.save();
  }
  // Fallback JSON
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  const users = await getAllUsers();
  const newUser = {
    id: generateId(),
    accountNumber: generateAccountNumber(),
    createdAt: new Date().toISOString(),
    ...userData
  };
  users.push(newUser);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return newUser;
}

async function updateUser(id, updates) {
  if (useMongoDB) {
    return await User.findOneAndUpdate(
      { id },
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  const users = await getAllUsers();
  const index = users.findIndex(u => u.id === id);
  if (index === -1) return null;
  users[index] = { ...users[index], ...updates };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return users[index];
}

async function deleteUser(id) {
  if (useMongoDB) {
    return await User.findOneAndDelete({ id });
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  const users = await getAllUsers();
  const filtered = users.filter(u => u.id !== id);
  fs.writeFileSync(USERS_FILE, JSON.stringify(filtered, null, 2));
  return true;
}

async function countUsers() {
  if (useMongoDB) {
    return await User.countDocuments();
  }
  const users = await getAllUsers();
  return users.length;
}

// ============================================
// SERVICIOS DE MENSAJES (CHAT)
// ============================================

async function getMessagesByUser(userId, limit = 100) {
  if (useMongoDB) {
    return await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }]
    })
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    return messages
      .filter(m => m.senderId === userId || m.receiverId === userId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-limit);
  } catch {
    return [];
  }
}

async function saveMessage(messageData) {
  if (useMongoDB) {
    const message = new Message({
      id: generateId(),
      timestamp: new Date(),
      read: false,
      ...messageData
    });
    return await message.save();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    messages.push({
      id: generateId(),
      timestamp: new Date().toISOString(),
      read: false,
      ...messageData
    });
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    return messages[messages.length - 1];
  } catch (error) {
    console.error('Error saving message:', error);
    return null;
  }
}

async function markMessagesAsRead(userId) {
  if (useMongoDB) {
    return await Message.updateMany(
      { senderId: userId, receiverRole: 'admin', read: false },
      { read: true }
    );
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    messages.forEach(msg => {
      if (msg.senderId === userId && msg.receiverRole === 'admin') {
        msg.read = true;
      }
    });
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error('Error marking messages as read:', error);
  }
}

async function getUnreadMessageCount() {
  if (useMongoDB) {
    return await Message.countDocuments({ receiverRole: 'admin', read: false });
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    return messages.filter(m => m.receiverRole === 'admin' && !m.read).length;
  } catch {
    return 0;
  }
}

async function getConversations() {
  if (useMongoDB) {
    const messages = await Message.find({}).sort({ timestamp: -1 }).lean();
    const users = await getAllUsers();
    
    const conversations = {};
    messages.forEach(msg => {
      let userId = null;
      if (msg.senderRole === 'user') userId = msg.senderId;
      else if (msg.receiverRole === 'user') userId = msg.receiverId;
      
      if (!userId) return;
      
      if (!conversations[userId]) {
        const user = users.find(u => u.id === userId);
        conversations[userId] = {
          userId,
          username: user?.username || 'Desconocido',
          accountNumber: user?.accountNumber || '',
          lastMessage: msg,
          unreadCount: (msg.receiverRole === 'admin' && !msg.read) ? 1 : 0
        };
      } else {
        if (msg.receiverRole === 'admin' && !msg.read) {
          conversations[userId].unreadCount++;
        }
      }
    });
    
    return Object.values(conversations);
  }
  // Fallback JSON
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    const users = await getAllUsers();
    
    const conversations = {};
    messages.forEach(msg => {
      let userId = null;
      if (msg.senderRole === 'user') userId = msg.senderId;
      else if (msg.receiverRole === 'user') userId = msg.receiverId;
      
      if (!userId) return;
      
      if (!conversations[userId]) {
        const user = users.find(u => u.id === userId);
        conversations[userId] = {
          userId,
          username: user?.username || 'Desconocido',
          accountNumber: user?.accountNumber || '',
          lastMessage: msg,
          unreadCount: (msg.receiverRole === 'admin' && !msg.read) ? 1 : 0
        };
      } else {
        if (new Date(msg.timestamp) > new Date(conversations[userId].lastMessage.timestamp)) {
          conversations[userId].lastMessage = msg;
        }
        if (msg.receiverRole === 'admin' && !msg.read) {
          conversations[userId].unreadCount++;
        }
      }
    });
    
    return Object.values(conversations);
  } catch {
    return [];
  }
}

// ============================================
// SERVICIOS DE ESTADO DE CHATS
// ============================================

async function getChatStatus(userId) {
  if (useMongoDB) {
    let status = await ChatStatus.findOne({ userId }).lean();
    if (!status) {
      const user = await getUserById(userId);
      status = {
        userId,
        username: user?.username || 'Desconocido',
        status: 'open',
        category: 'cargas',
        assignedTo: null,
        closedAt: null,
        closedBy: null,
        unreadCount: 0
      };
    }
    return status;
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const CHAT_STATUS_FILE = path.join(DATA_DIR, 'chat-status.json');
  try {
    const status = JSON.parse(fs.readFileSync(CHAT_STATUS_FILE, 'utf8'));
    return status[userId] || { status: 'open', assignedTo: null, closedAt: null, closedBy: null, category: 'cargas' };
  } catch {
    return { status: 'open', assignedTo: null, closedAt: null, closedBy: null, category: 'cargas' };
  }
}

async function updateChatStatus(userId, updates) {
  if (useMongoDB) {
    const user = await getUserById(userId);
    return await ChatStatus.findOneAndUpdate(
      { userId },
      { 
        ...updates, 
        username: user?.username || 'Desconocido',
        updatedAt: new Date() 
      },
      { upsert: true, new: true }
    ).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const CHAT_STATUS_FILE = path.join(DATA_DIR, 'chat-status.json');
  try {
    const status = JSON.parse(fs.readFileSync(CHAT_STATUS_FILE, 'utf8'));
    const current = status[userId] || { status: 'open', assignedTo: null, closedAt: null, closedBy: null, category: 'cargas' };
    status[userId] = { ...current, ...updates };
    fs.writeFileSync(CHAT_STATUS_FILE, JSON.stringify(status, null, 2));
    return status[userId];
  } catch (error) {
    console.error('Error updating chat status:', error);
    return null;
  }
}

async function getChatsByStatus(status) {
  if (useMongoDB) {
    const chats = await ChatStatus.find({ status }).lean();
    const messages = await Message.find({}).sort({ timestamp: -1 }).lean();
    
    return chats.map(chat => {
      const chatMessages = messages.filter(m => 
        m.senderId === chat.userId || m.receiverId === chat.userId
      );
      const lastMessage = chatMessages[0];
      const unreadCount = chatMessages.filter(m => 
        m.receiverRole === 'admin' && !m.read
      ).length;
      
      return {
        ...chat,
        lastMessage,
        unreadCount
      };
    });
  }
  // Fallback JSON
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
  const CHAT_STATUS_FILE = path.join(DATA_DIR, 'chat-status.json');
  try {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    const chatStatus = JSON.parse(fs.readFileSync(CHAT_STATUS_FILE, 'utf8'));
    const users = await getAllUsers();
    
    const userMessages = {};
    messages.forEach(msg => {
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) userMessages[msg.senderId] = [];
        userMessages[msg.senderId].push(msg);
      }
      if (msg.receiverRole === 'user' && msg.senderRole !== 'user') {
        if (!userMessages[msg.receiverId]) userMessages[msg.receiverId] = [];
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    const filteredChats = [];
    Object.keys(userMessages).forEach(userId => {
      const user = users.find(u => u.id === userId);
      if (!user) return;
      
      const statusInfo = chatStatus[userId] || { status: 'open', category: 'cargas', assignedTo: null };
      
      if (statusInfo.status === status && statusInfo.category !== 'pagos') {
        const msgs = userMessages[userId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const lastMsg = msgs[msgs.length - 1];
        const unreadCount = msgs.filter(m => m.receiverRole === 'admin' && !m.read).length;
        
        filteredChats.push({
          userId,
          username: user.username,
          lastMessage: lastMsg,
          unreadCount,
          assignedTo: statusInfo.assignedTo,
          closedAt: statusInfo.closedAt,
          closedBy: statusInfo.closedBy
        });
      }
    });
    
    filteredChats.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
    return filteredChats;
  } catch {
    return [];
  }
}

// ============================================
// SERVICIOS DE COMANDOS PERSONALIZADOS
// ============================================

async function getAllCommands() {
  if (useMongoDB) {
    return await Command.find({ isActive: true }).sort({ name: 1 }).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const CUSTOM_COMMANDS_FILE = path.join(DATA_DIR, 'custom-commands.json');
  try {
    return JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function getCommandByName(name) {
  if (useMongoDB) {
    return await Command.findOne({ name, isActive: true }).lean();
  }
  const commands = await getAllCommands();
  return commands[name];
}

async function createCommand(commandData) {
  if (useMongoDB) {
    const command = new Command({
      ...commandData,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return await command.save();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const CUSTOM_COMMANDS_FILE = path.join(DATA_DIR, 'custom-commands.json');
  try {
    const commands = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
    commands[commandData.name] = {
      ...commandData,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify(commands, null, 2));
    return commands[commandData.name];
  } catch (error) {
    console.error('Error creating command:', error);
    return null;
  }
}

async function updateCommand(name, updates) {
  if (useMongoDB) {
    return await Command.findOneAndUpdate(
      { name },
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const CUSTOM_COMMANDS_FILE = path.join(DATA_DIR, 'custom-commands.json');
  try {
    const commands = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
    if (commands[name]) {
      commands[name] = { ...commands[name], ...updates };
      fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify(commands, null, 2));
      return commands[name];
    }
    return null;
  } catch {
    return null;
  }
}

async function deleteCommand(name) {
  if (useMongoDB) {
    return await Command.findOneAndDelete({ name });
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const CUSTOM_COMMANDS_FILE = path.join(DATA_DIR, 'custom-commands.json');
  try {
    const commands = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
    delete commands[name];
    fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify(commands, null, 2));
    return true;
  } catch {
    return false;
  }
}

async function incrementCommandUsage(name) {
  if (useMongoDB) {
    return await Command.findOneAndUpdate(
      { name },
      { $inc: { usageCount: 1 } }
    );
  }
  // No implementado para JSON
}

// ============================================
// SERVICIOS DE CONFIGURACIÓN (CBU, etc)
// ============================================

async function getConfig(key) {
  if (useMongoDB) {
    const config = await Config.findOne({ key }).lean();
    return config ? config.value : null;
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const SYSTEM_CONFIG_FILE = path.join(DATA_DIR, 'system-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(SYSTEM_CONFIG_FILE, 'utf8'));
    return config[key];
  } catch {
    return null;
  }
}

async function setConfig(key, value, updatedBy = null) {
  if (useMongoDB) {
    return await Config.findOneAndUpdate(
      { key },
      { key, value, updatedBy, updatedAt: new Date() },
      { upsert: true, new: true }
    ).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const SYSTEM_CONFIG_FILE = path.join(DATA_DIR, 'system-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(SYSTEM_CONFIG_FILE, 'utf8'));
    config[key] = value;
    fs.writeFileSync(SYSTEM_CONFIG_FILE, JSON.stringify(config, null, 2));
    return { key, value };
  } catch (error) {
    console.error('Error setting config:', error);
    return null;
  }
}

async function getCBUConfig() {
  return await getConfig('cbu') || {
    number: '',
    alias: '',
    bank: '',
    titular: '',
    message: ''
  };
}

async function setCBUConfig(cbuData, updatedBy = null) {
  return await setConfig('cbu', cbuData, updatedBy);
}

async function getWelcomeMessage() {
  return await getConfig('welcomeMessage') || '🎉 ¡Bienvenido a la Sala de Juegos!';
}

async function setWelcomeMessage(message, updatedBy = null) {
  return await setConfig('welcomeMessage', message, updatedBy);
}

async function getDepositMessage() {
  return await getConfig('depositMessage') || '💰 ¡Fichas cargadas! ${amount}. ¡Ya tenés tu carga!';
}

async function setDepositMessage(message, updatedBy = null) {
  return await setConfig('depositMessage', message, updatedBy);
}

// ============================================
// SERVICIOS DE REEMBOLSOS
// ============================================

async function getUserRefunds(userId) {
  if (useMongoDB) {
    return await Refund.find({ userId }).sort({ claimedAt: -1 }).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const REFUNDS_FILE = path.join(DATA_DIR, 'refunds.json');
  try {
    const refunds = JSON.parse(fs.readFileSync(REFUNDS_FILE, 'utf8'));
    return refunds.filter(r => r.userId === userId).sort((a, b) => new Date(b.claimedAt) - new Date(a.claimedAt));
  } catch {
    return [];
  }
}

async function getLastRefund(userId, type) {
  if (useMongoDB) {
    return await Refund.findOne({ userId, type }).sort({ claimedAt: -1 }).lean();
  }
  const refunds = await getUserRefunds(userId);
  return refunds.find(r => r.type === type);
}

async function createRefund(refundData) {
  if (useMongoDB) {
    const refund = new Refund({
      id: generateId(),
      claimedAt: new Date(),
      status: 'completed',
      ...refundData
    });
    return await refund.save();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const REFUNDS_FILE = path.join(DATA_DIR, 'refunds.json');
  try {
    const refunds = JSON.parse(fs.readFileSync(REFUNDS_FILE, 'utf8'));
    refunds.push({
      id: generateId(),
      claimedAt: new Date().toISOString(),
      status: 'completed',
      ...refundData
    });
    fs.writeFileSync(REFUNDS_FILE, JSON.stringify(refunds, null, 2));
    return refunds[refunds.length - 1];
  } catch (error) {
    console.error('Error creating refund:', error);
    return null;
  }
}

async function getAllRefunds() {
  if (useMongoDB) {
    return await Refund.find({}).sort({ claimedAt: -1 }).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const REFUNDS_FILE = path.join(DATA_DIR, 'refunds.json');
  try {
    return JSON.parse(fs.readFileSync(REFUNDS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function getRefundStats() {
  if (useMongoDB) {
    const stats = await Refund.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);
    
    const result = { dailyCount: 0, weeklyCount: 0, monthlyCount: 0, totalAmount: 0 };
    stats.forEach(s => {
      result[s._id + 'Count'] = s.count;
      result.totalAmount += s.totalAmount;
    });
    return result;
  }
  const refunds = await getAllRefunds();
  const result = { dailyCount: 0, weeklyCount: 0, monthlyCount: 0, totalAmount: 0 };
  refunds.forEach(r => {
    result.totalAmount += r.amount || 0;
    if (r.type === 'daily') result.dailyCount++;
    else if (r.type === 'weekly') result.weeklyCount++;
    else if (r.type === 'monthly') result.monthlyCount++;
  });
  return result;
}

// ============================================
// SERVICIOS DE FUEGUITOS (RACHA DIARIA)
// ============================================

async function getFireReward(userId) {
  if (useMongoDB) {
    let reward = await FireReward.findOne({ userId }).lean();
    if (!reward) {
      const user = await getUserById(userId);
      reward = {
        userId,
        username: user?.username || 'Desconocido',
        streak: 0,
        lastClaim: null,
        totalClaimed: 0,
        history: []
      };
    }
    return reward;
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const FIRE_REWARDS_FILE = path.join(DATA_DIR, 'fire-rewards.json');
  try {
    const rewards = JSON.parse(fs.readFileSync(FIRE_REWARDS_FILE, 'utf8'));
    return rewards[userId] || { streak: 0, lastClaim: null, totalClaimed: 0, history: [] };
  } catch {
    return { streak: 0, lastClaim: null, totalClaimed: 0, history: [] };
  }
}

async function updateFireReward(userId, updates) {
  if (useMongoDB) {
    const user = await getUserById(userId);
    return await FireReward.findOneAndUpdate(
      { userId },
      { 
        ...updates, 
        username: user?.username || 'Desconocido',
        updatedAt: new Date() 
      },
      { upsert: true, new: true }
    ).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const FIRE_REWARDS_FILE = path.join(DATA_DIR, 'fire-rewards.json');
  try {
    const rewards = JSON.parse(fs.readFileSync(FIRE_REWARDS_FILE, 'utf8'));
    const current = rewards[userId] || { streak: 0, lastClaim: null, totalClaimed: 0, history: [] };
    rewards[userId] = { ...current, ...updates };
    fs.writeFileSync(FIRE_REWARDS_FILE, JSON.stringify(rewards, null, 2));
    return rewards[userId];
  } catch (error) {
    console.error('Error updating fire reward:', error);
    return null;
  }
}

async function addFireRewardHistory(userId, entry) {
  if (useMongoDB) {
    return await FireReward.findOneAndUpdate(
      { userId },
      { $push: { history: entry } }
    );
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const FIRE_REWARDS_FILE = path.join(DATA_DIR, 'fire-rewards.json');
  try {
    const rewards = JSON.parse(fs.readFileSync(FIRE_REWARDS_FILE, 'utf8'));
    if (!rewards[userId]) rewards[userId] = { streak: 0, lastClaim: null, totalClaimed: 0, history: [] };
    if (!rewards[userId].history) rewards[userId].history = [];
    rewards[userId].history.push(entry);
    fs.writeFileSync(FIRE_REWARDS_FILE, JSON.stringify(rewards, null, 2));
  } catch (error) {
    console.error('Error adding fire reward history:', error);
  }
}

// ============================================
// SERVICIOS DE TRANSACCIONES
// ============================================

async function createTransaction(transactionData) {
  if (useMongoDB) {
    const transaction = new Transaction({
      id: generateId(),
      timestamp: new Date(),
      status: 'completed',
      ...transactionData
    });
    return await transaction.save();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
  try {
    const transactions = JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
    transactions.push({
      id: generateId(),
      timestamp: new Date().toISOString(),
      status: 'completed',
      ...transactionData
    });
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
    return transactions[transactions.length - 1];
  } catch (error) {
    console.error('Error creating transaction:', error);
    return null;
  }
}

async function getTransactions(filters = {}) {
  if (useMongoDB) {
    const query = {};
    if (filters.type && filters.type !== 'all') query.type = filters.type;
    if (filters.username) query.username = filters.username;
    if (filters.from || filters.to) {
      query.timestamp = {};
      if (filters.from) query.timestamp.$gte = new Date(filters.from);
      if (filters.to) query.timestamp.$lte = new Date(filters.to);
    }
    
    return await Transaction.find(query)
      .sort({ timestamp: -1 })
      .limit(filters.limit || 100)
      .lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
  try {
    let transactions = JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
    
    if (filters.from) {
      const fromDate = new Date(filters.from);
      transactions = transactions.filter(t => new Date(t.timestamp) >= fromDate);
    }
    if (filters.to) {
      const toDate = new Date(filters.to);
      toDate.setHours(23, 59, 59, 999);
      transactions = transactions.filter(t => new Date(t.timestamp) <= toDate);
    }
    if (filters.type && filters.type !== 'all') {
      transactions = transactions.filter(t => t.type === filters.type);
    }
    
    transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return transactions.slice(0, filters.limit || 100);
  } catch {
    return [];
  }
}

async function getTransactionStats() {
  if (useMongoDB) {
    const stats = await Transaction.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);
    
    const result = { deposits: 0, withdrawals: 0, bonuses: 0, refunds: 0 };
    stats.forEach(s => {
      result[s._id + 's'] = s.totalAmount;
    });
    return result;
  }
  const transactions = await getTransactions();
  const result = { deposits: 0, withdrawals: 0, bonuses: 0, refunds: 0 };
  transactions.forEach(t => {
    const key = t.type + 's';
    if (result.hasOwnProperty(key)) result[key] += t.amount || 0;
  });
  return result;
}

// ============================================
// SERVICIOS DE ACTIVIDAD DE USUARIOS
// ============================================

async function recordActivity(userId, type, amount) {
  if (useMongoDB) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const user = await getUserById(userId);
    const updateField = type === 'deposit' ? 'deposits' : 'withdrawals';
    
    await UserActivity.findOneAndUpdate(
      { userId, date: today },
      { 
        $inc: { [updateField]: amount },
        $set: { username: user?.username || 'Desconocido', lastActivity: new Date() }
      },
      { upsert: true }
    );
  }
  // JSON fallback en el archivo original
}

// ============================================
// SERVICIOS DE USUARIOS EXTERNOS
// ============================================

async function addExternalUser(userData) {
  if (useMongoDB) {
    const existing = await ExternalUser.findOne({ username: userData.username });
    if (!existing) {
      const externalUser = new ExternalUser({
        id: generateId(),
        ...userData,
        firstContact: new Date(),
        lastContact: new Date()
      });
      return await externalUser.save();
    } else {
      return await ExternalUser.findOneAndUpdate(
        { username: userData.username },
        { lastContact: new Date(), $inc: { messageCount: 1 } }
      );
    }
  }
  // JSON fallback
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const EXTERNAL_USERS_FILE = path.join(DATA_DIR, 'external-users.json');
  try {
    const users = JSON.parse(fs.readFileSync(EXTERNAL_USERS_FILE, 'utf8'));
    if (!users.find(u => u.username === userData.username)) {
      users.push({ id: generateId(), ...userData, addedAt: new Date().toISOString() });
      fs.writeFileSync(EXTERNAL_USERS_FILE, JSON.stringify(users, null, 2));
    }
  } catch (error) {
    console.error('Error adding external user:', error);
  }
}

async function getExternalUsers() {
  if (useMongoDB) {
    return await ExternalUser.find({}).sort({ lastContact: -1 }).lean();
  }
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.VERCEL ? '/tmp/data' : './data';
  const EXTERNAL_USERS_FILE = path.join(DATA_DIR, 'external-users.json');
  try {
    return JSON.parse(fs.readFileSync(EXTERNAL_USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

// ============================================
// EXPORTAR
// ============================================
module.exports = {
  setUseMongoDB,
  isUsingMongoDB,
  
  // Usuarios
  getAllUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  countUsers,
  
  // Mensajes
  getMessagesByUser,
  saveMessage,
  markMessagesAsRead,
  getUnreadMessageCount,
  getConversations,
  
  // Chat Status
  getChatStatus,
  updateChatStatus,
  getChatsByStatus,
  
  // Comandos
  getAllCommands,
  getCommandByName,
  createCommand,
  updateCommand,
  deleteCommand,
  incrementCommandUsage,
  
  // Config
  getConfig,
  setConfig,
  getCBUConfig,
  setCBUConfig,
  getWelcomeMessage,
  setWelcomeMessage,
  getDepositMessage,
  setDepositMessage,
  
  // Reembolsos
  getUserRefunds,
  getLastRefund,
  createRefund,
  getAllRefunds,
  getRefundStats,
  
  // Fueguitos
  getFireReward,
  updateFireReward,
  addFireRewardHistory,
  
  // Transacciones
  createTransaction,
  getTransactions,
  getTransactionStats,
  
  // Actividad
  recordActivity,
  
  // Usuarios externos
  addExternalUser,
  getExternalUsers,
  
  // Utils
  generateId,
  generateAccountNumber
};
