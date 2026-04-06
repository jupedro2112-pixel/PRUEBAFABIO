/**
 * Utilidad: tasa de comisión de referido
 * Retorna la tasa aplicable para un usuario referidor.
 * Por defecto 7%. Preparado para tiers/overrides futuros.
 */

const DEFAULT_REFERRAL_RATE = 0.07;

/**
 * Obtener la tasa de comisión de referido para un usuario
 * @param {Object} user - documento de usuario del referidor
 * @returns {number} tasa decimal (e.g. 0.07)
 */
function getReferralRateForUser(user) {
  if (user && typeof user.referralRateOverride === 'number') {
    return user.referralRateOverride;
  }
  // Futura lógica de tiers:
  // if (user && user.referralTier === 'vip') return 0.10;
  return DEFAULT_REFERRAL_RATE;
}

module.exports = {
  DEFAULT_REFERRAL_RATE,
  getReferralRateForUser
};
