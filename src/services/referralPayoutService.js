/**
 * Servicio de Pagos de Referidos
 * Fase B: agrupa comisiones calculadas, acredita fichas y marca como pagado
 */
const { v4: uuidv4 } = require('uuid');
const { User, Transaction, Message, ReferralCommission, ReferralPayout } = require('../models');
const jugayganaService = require('./jugayganaService');
const logger = require('../utils/logger');
const { getPeriodLabel } = require('../utils/periodKey');

/**
 * Ejecutar el pago mensual para un período
 * @param {string} periodKey - e.g. "2026-04"
 * @param {Object} [options]
 * @param {string} [options.referrerUserId] - pagar solo para un referidor
 * @param {string} [options.adminId]
 * @param {string} [options.adminUsername]
 * @returns {Object} resultado del pago
 */
async function executePayoutsForPeriod(periodKey, options = {}) {
  const { referrerUserId = null, adminId = null, adminUsername = null } = options;

  logger.info(`[ReferralPayout] Iniciando pagos para período ${periodKey}`);

  const results = {
    periodKey,
    payoutsCreated: 0,
    payoutsFailed: 0,
    payoutsSkipped: 0,
    errors: [],
    details: []
  };

  const commissionQuery = { periodKey, status: 'calculated' };
  if (referrerUserId) commissionQuery.referrerUserId = referrerUserId;

  const commissions = await ReferralCommission.find(commissionQuery).lean();

  if (commissions.length === 0) {
    logger.info(`[ReferralPayout] No hay comisiones calculadas para ${periodKey}`);
    return results;
  }

  // Agrupar comisiones por referidor
  const byReferrer = new Map();
  for (const commission of commissions) {
    if (!byReferrer.has(commission.referrerUserId)) {
      byReferrer.set(commission.referrerUserId, {
        referrerUserId: commission.referrerUserId,
        referrerUsername: commission.referrerUsername,
        commissions: []
      });
    }
    byReferrer.get(commission.referrerUserId).commissions.push(commission);
  }

  for (const [refId, group] of byReferrer) {
    const totalAmount = group.commissions.reduce((sum, c) => sum + c.commissionAmount, 0);

    if (totalAmount <= 0) {
      logger.info(`[ReferralPayout] Total $0 para ${group.referrerUsername} - skipping`);
      results.payoutsSkipped++;
      continue;
    }

    // Verificar si ya existe un payout pagado para este período
    const existingPayout = await ReferralPayout.findOne({
      periodKey,
      referrerUserId: refId
    }).lean();

    if (existingPayout && existingPayout.status === 'paid') {
      logger.warn(`[ReferralPayout] Payout ya pagado para ${group.referrerUsername} período ${periodKey}`);
      results.payoutsSkipped++;
      continue;
    }

    const periodLabel = getPeriodLabel(periodKey);
    const description = `Ganancias por referidos - ${periodLabel}`;

    let payoutDoc;

    try {
      // Crear o actualizar documento de payout
      if (existingPayout) {
        payoutDoc = await ReferralPayout.findOneAndUpdate(
          { _id: existingPayout._id },
          {
            $set: {
              totalCommissionAmount: totalAmount,
              referralCount: group.commissions.length,
              status: 'pending',
              errorMessage: null
            }
          },
          { new: true }
        );
      } else {
        payoutDoc = await ReferralPayout.create({
          id: uuidv4(),
          periodKey,
          referrerUserId: refId,
          referrerUsername: group.referrerUsername,
          currency: 'ARS',
          totalCommissionAmount: totalAmount,
          referralCount: group.commissions.length,
          status: 'pending',
          details: { commissionIds: group.commissions.map(c => c.id) }
        });
      }

      // Acreditar fichas en JUGAYGANA usando bonus (individual_bonus)
      const referrer = await User.findOne({ id: refId }).lean();
      if (!referrer) {
        throw new Error(`Referidor ${refId} no encontrado en DB local`);
      }

      const jugayganaUsername = referrer.jugayganaUsername || referrer.username;

      const creditResult = await jugayganaService.bonus(
        jugayganaUsername,
        totalAmount,
        description
      );

      if (!creditResult.success) {
        throw new Error(creditResult.error || 'Error al acreditar en JUGAYGANA');
      }

      // Registrar transacción local
      const tx = await Transaction.create({
        id: uuidv4(),
        type: 'referral_commission',
        amount: totalAmount,
        username: referrer.username,
        userId: refId,
        description,
        adminId: adminId || 'system',
        adminUsername: adminUsername || 'system',
        adminRole: 'admin',
        transactionId: creditResult.data?.transfer_id || null,
        externalId: payoutDoc.id,
        status: 'completed',
        metadata: {
          periodKey,
          referralCount: group.commissions.length,
          payoutId: payoutDoc.id
        }
      });

      // Marcar payout como pagado
      await ReferralPayout.updateOne(
        { _id: payoutDoc._id },
        {
          $set: {
            status: 'paid',
            creditedAt: new Date(),
            transactionId: tx.id,
            externalTransactionId: creditResult.data?.transfer_id || null
          }
        }
      );

      // Marcar comisiones como pagadas
      await ReferralCommission.updateMany(
        { periodKey, referrerUserId: refId, status: 'calculated' },
        {
          $set: {
            status: 'paid',
            paidAt: new Date(),
            payoutId: payoutDoc.id
          }
        }
      );

      // Enviar mensaje automático al usuario
      await sendReferralCreditMessage(referrer, totalAmount, periodLabel);

      logger.info(
        `[ReferralPayout] Pagado $${totalAmount.toFixed(2)} a ${group.referrerUsername} para ${periodKey}`
      );

      results.payoutsCreated++;
      results.details.push({
        referrerUsername: group.referrerUsername,
        amount: totalAmount,
        referralCount: group.commissions.length,
        status: 'paid'
      });
    } catch (err) {
      logger.error(
        `[ReferralPayout] Error pagando a ${group.referrerUsername}: ${err.message}`
      );

      // Marcar payout como fallido pero no eliminar
      if (payoutDoc) {
        await ReferralPayout.updateOne(
          { _id: payoutDoc._id },
          { $set: { status: 'failed', errorMessage: err.message } }
        ).catch(() => {});
      }

      results.payoutsFailed++;
      results.errors.push({
        referrerUsername: group.referrerUsername,
        error: err.message
      });
    }
  }

  logger.info(
    `[ReferralPayout] Período ${periodKey}: ` +
    `${results.payoutsCreated} pagados, ` +
    `${results.payoutsFailed} fallidos, ` +
    `${results.payoutsSkipped} sin cambios`
  );

  return results;
}

/**
 * Enviar mensaje automático al usuario sobre el crédito de referidos
 */
async function sendReferralCreditMessage(user, amount, periodLabel) {
  try {
    const amountFormatted = new Intl.NumberFormat('es-AR').format(Math.round(amount));
    const content = `🎁 Se acreditaron $${amountFormatted} en fichas por ganancias de referidos correspondientes a ${periodLabel}.`;

    await Message.create({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'system',
      receiverId: user.id,
      receiverRole: 'user',
      content,
      type: 'system',
      read: false,
      timestamp: new Date()
    });

    logger.info(`[ReferralPayout] Mensaje de crédito enviado a ${user.username}`);
  } catch (err) {
    logger.error(`[ReferralPayout] Error enviando mensaje a ${user.username}:`, err.message);
    // No interrumpir el flujo si el mensaje falla
  }
}

module.exports = {
  executePayoutsForPeriod
};
