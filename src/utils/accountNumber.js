function generateAccountNumber() {
  return 'ACC' + Date.now().toString().slice(-8) + Math.random().toString(36).substr(2, 4).toUpperCase();
}

module.exports = { generateAccountNumber };
