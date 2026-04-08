async function recordUserActivity(UserActivity, userId, type, amount) {
  try {
    const today = new Date().toDateString();
    await UserActivity.findOneAndUpdate(
      { userId, date: today },
      {
        $inc: { [type === 'deposit' ? 'deposits' : 'withdrawals']: amount },
        lastActivity: new Date()
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error registrando actividad:', error);
  }
}

async function hasActivityToday(UserActivity, userId) {
  try {
    const today = new Date().toDateString();
    const activity = await UserActivity.findOne({ userId, date: today });
    if (!activity) return false;
    return (activity.deposits > 0 || activity.withdrawals > 0);
  } catch (error) {
    console.error('Error verificando actividad:', error);
    return false;
  }
}

module.exports = { recordUserActivity, hasActivityToday };
