const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function findUserByPhone(User, ExternalUser, phone) {
  const user = await User.findOne({ $or: [{ phone }, { whatsapp: phone }] }).lean();
  if (user) return { username: user.username, phone: user.phone, source: 'main' };

  const externalUser = await ExternalUser.findOne({ $or: [{ phone }, { whatsapp: phone }] }).lean();
  if (externalUser) return { username: externalUser.username, phone: externalUser.phone, source: 'external' };

  return null;
}

async function changePasswordByPhone(User, phone, newPassword) {
  const user = await User.findOne({ $or: [{ phone }, { whatsapp: phone }] });
  if (!user) return { success: false, error: 'Usuario no encontrado con ese número de teléfono' };

  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordChangedAt = new Date();
  await user.save();
  return { success: true, username: user.username };
}

async function addExternalUser(ExternalUser, userData) {
  try {
    await ExternalUser.findOneAndUpdate(
      { username: userData.username },
      {
        username: userData.username,
        phone: userData.phone || null,
        whatsapp: userData.whatsapp || null,
        lastSeen: new Date(),
        $inc: { messageCount: 1 },
        $setOnInsert: { id: uuidv4(), firstSeen: new Date() }
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error agregando usuario externo:', error);
  }
}

module.exports = { findUserByPhone, changePasswordByPhone, addExternalUser };
