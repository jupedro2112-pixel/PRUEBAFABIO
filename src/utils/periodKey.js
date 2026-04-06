/**
 * Utilidad: clave de período mensual
 * Convierte fechas en claves tipo "2026-04"
 */

/**
 * Obtener clave del período actual (mes actual)
 * @returns {string} e.g. "2026-04"
 */
function getCurrentPeriodKey() {
  const now = new Date();
  return formatPeriodKey(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Obtener clave del período anterior
 * @returns {string} e.g. "2026-03"
 */
function getPreviousPeriodKey() {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-based: current month - 1
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return formatPeriodKey(year, month);
}

/**
 * Formatear clave de período
 * @param {number} year
 * @param {number} month 1-based
 * @returns {string}
 */
function formatPeriodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Obtener rango de fechas (epoch ms) para un periodKey
 * @param {string} periodKey e.g. "2026-04"
 * @returns {{ fromEpoch: number, toEpoch: number, fromDate: Date, toDate: Date }}
 */
function getPeriodRange(periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  const fromDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const toDate = new Date(year, month, 0, 23, 59, 59, 999); // last day of month
  return {
    fromEpoch: Math.floor(fromDate.getTime() / 1000),
    toEpoch: Math.floor(toDate.getTime() / 1000),
    fromDate,
    toDate
  };
}

/**
 * Nombre legible de un period key en español
 * @param {string} periodKey
 * @returns {string} e.g. "abril 2026"
 */
function getPeriodLabel(periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  const months = [
    '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  return `${months[month]} ${year}`;
}

/**
 * Obtener clave del período siguiente a un periodKey dado
 * @param {string} periodKey e.g. "2026-04"
 * @returns {string} e.g. "2026-05"
 */
function getNextPeriodKey(periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  if (month === 12) {
    return formatPeriodKey(year + 1, 1);
  }
  return formatPeriodKey(year, month + 1);
}

/**
 * Nombre legible del período siguiente en español
 * @param {string} periodKey
 * @returns {string} e.g. "mayo 2026"
 */
function getNextPeriodLabel(periodKey) {
  return getPeriodLabel(getNextPeriodKey(periodKey));
}

module.exports = {
  getCurrentPeriodKey,
  getPreviousPeriodKey,
  formatPeriodKey,
  getPeriodRange,
  getPeriodLabel,
  getNextPeriodKey,
  getNextPeriodLabel
};
