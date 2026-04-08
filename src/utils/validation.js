function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[<>]/g, '').trim().substring(0, 1000);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const sanitized = username.trim();
  return /^[a-zA-Z0-9_.-]{3,30}$/.test(sanitized);
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 6 && password.length <= 100;
}

module.exports = { sanitizeInput, escapeRegex, validateUsername, validatePassword };
