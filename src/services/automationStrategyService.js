/**
 * Automation Strategy Service
 *
 * Estrategia "smart" que orquesta la sección 🤖 Automatización del admin.
 *
 * Diferencias clave vs adhocStrategyService:
 *   1) Mix 70/30: la mayoria de los users recibe SOLO un push de engagement
 *      (sin plata) y un 30% recibe oferta concreta (regalo $ o bono %).
 *      El ratio se aplica per-segmento con porcentajes distintos:
 *        - big_loser_hot:   100% bono (siempre vale la pena)
 *        - medium_loser:    50% bono / 50% engagement
 *        - small_loser:     30% bono / 70% engagement
 *        - dormant_hot:     40% bono / 60% engagement
 *        - dormant_cold:    20% bono / 80% engagement
 *        - active_regular:  100% engagement (no le tirás plata si está jugando)
 *
 *   2) Rotación de copies: para los engagement-only, asignamos un copy
 *      del EngagementCopyPool por user, evitando repetir el ultimo copy
 *      que ese user vio (anti-fatiga). Ponderado por copy.weight.
 *
 *   3) AutomationLaunch: registra cada lanzamiento con detalle per-user
 *      para luego computar veredicto a 48h.
 *
 *   4) Reusa primitivas existentes:
 *        - WeeklyNotifBudget para cooldown 72h
 *        - MoneyGiveaway para acreditar regalos $
 *        - sendNotificationToAllUsers para mandar push
 *        - DailyPlayerStats para segmentar
 */
const { v4: uuidv4 } = require('uuid');

const PLAN_TTL_MS = 60 * 60 * 1000; // 1 hora
const _automationPlans = new Map(); // planId -> { plan, expiresAt }

function _gcAutomationPlans() {
  const now = Date.now();
  for (const [k, v] of _automationPlans) {
    if (v.expiresAt < now) _automationPlans.delete(k);
  }
}

function storeAutomationPlan(plan) {
  _gcAutomationPlans();
  const planId = plan.id || uuidv4();
  _automationPlans.set(planId, {
    plan: { ...plan, id: planId },
    expiresAt: Date.now() + PLAN_TTL_MS
  });
  return planId;
}

function getAutomationPlan(planId) {
  _gcAutomationPlans();
  const e = _automationPlans.get(planId);
  return e ? e.plan : null;
}

function consumeAutomationPlan(planId) {
  _gcAutomationPlans();
  const e = _automationPlans.get(planId);
  if (!e) return null;
  _automationPlans.delete(planId);
  return e.plan;
}

// ============================================
// SEGMENTACIÓN
// ============================================
//
// Cada segmento tiene un mix bonusRatio (0..1) que define qué fracción
// recibe oferta concreta vs engagement-only. El otro flag relevante es
// kind ('money' | 'whatsapp_promo'): qué TIPO de oferta cuando le toca
// bono. Si bonusRatio es 1, todos los del segmento reciben oferta. Si es
// 0, todos reciben engagement.
const SEGMENTS = [
  {
    code: 'big_loser_hot',
    label: '🎰 Gran perdedor caliente',
    description: 'Perdió ≥$200k hace ≤2 días',
    matcher: (s) => s.netwinARS >= 200000 && s.daysSinceLastDeposit != null && s.daysSinceLastDeposit <= 2,
    bonusRatio: 1.0,
    bonusKind: 'money',
    suggestGiftAmount: (s) => {
      if (s.netwinARS >= 500000) return 15000;
      if (s.netwinARS >= 350000) return 12000;
      return 10000;
    },
    suggestBonusPct: () => 0
  },
  {
    code: 'medium_loser',
    label: '💸 Perdedor medio',
    description: 'Perdió $50k–$200k en los últimos 7 días',
    matcher: (s) => s.netwinARS >= 50000 && s.netwinARS < 200000 && s.daysSinceLastDeposit != null && s.daysSinceLastDeposit <= 7,
    bonusRatio: 0.5,
    bonusKind: 'money',
    suggestGiftAmount: (s) => {
      if (s.netwinARS >= 120000) return 7500;
      if (s.netwinARS >= 80000) return 5000;
      return 3000;
    },
    suggestBonusPct: () => 0
  },
  {
    code: 'small_loser',
    label: '😐 Perdedor chico',
    description: 'Perdió $10k–$50k — bono % carga',
    matcher: (s) => s.netwinARS >= 10000 && s.netwinARS < 50000,
    bonusRatio: 0.3,
    bonusKind: 'whatsapp_promo',
    suggestGiftAmount: () => 0,
    suggestBonusPct: (s) => {
      // A/B: rotamos 30/40/50 por hash del username, asi la asignacion
      // es estable entre re-analyses pero balanceada en la cohorte.
      const variants = [30, 40, 50];
      const hash = String(s.username).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      return variants[hash % variants.length];
    }
  },
  {
    code: 'dormant_hot',
    label: '💤 Dormido caliente',
    description: 'Cargaba antes pero hace 3-7d que no',
    matcher: (s) => s.totalDepositsARS > 0 && s.daysSinceLastDeposit != null && s.daysSinceLastDeposit >= 3 && s.daysSinceLastDeposit <= 7,
    bonusRatio: 0.4,
    bonusKind: 'money',
    suggestGiftAmount: (s) => {
      if (s.totalDepositsARS >= 100000) return 5000;
      if (s.totalDepositsARS >= 50000) return 3500;
      return 2000;
    },
    suggestBonusPct: () => 0
  },
  {
    code: 'dormant_cold',
    label: '🥶 Dormido frío',
    description: 'Cargaba antes, hace 8-30d que no',
    matcher: (s) => s.totalDepositsARS > 0 && s.daysSinceLastDeposit != null && s.daysSinceLastDeposit >= 8 && s.daysSinceLastDeposit <= 30,
    bonusRatio: 0.2,
    bonusKind: 'money',
    suggestGiftAmount: (s) => {
      if (s.totalDepositsARS >= 100000) return 7000;
      if (s.totalDepositsARS >= 50000) return 5000;
      return 3000;
    },
    suggestBonusPct: () => 0
  },
  {
    code: 'active_regular',
    label: '🟢 Activo regular',
    description: 'Sigue jugando, sin pérdida fuerte',
    matcher: (s) => s.daysSinceLastDeposit != null && s.daysSinceLastDeposit <= 7 && s.netwinARS < 50000,
    bonusRatio: 0.0,
    bonusKind: 'whatsapp_promo',
    suggestGiftAmount: () => 0,
    suggestBonusPct: () => 0
  }
];

// Hash determinista por username para asignar bonus vs engagement en
// proporcion bonusRatio. Mismo user → mismo destino entre re-analyses
// (importante: si re-analizamos despues de editar, no debe re-shufflear).
function _userBucket01(username) {
  const s = String(username || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Normalizamos a 0..1
  return ((h >>> 0) % 10000) / 10000;
}

// ============================================
// ROTACIÓN DE COPIES DE ENGAGEMENT
// ============================================
//
// Defaults que se siembran en la primera consulta si la coleccion esta
// vacia. El admin los puede editar/desactivar/agregar después.
const DEFAULT_ENGAGEMENT_COPIES = [
  { title: 'Te extrañamos 🥺', body: '¿Volvés a jugar con nosotros? La mesa te espera.' },
  { title: 'Tu suerte te está esperando 🎰', body: 'Entrá un ratito, hoy puede ser tu día.' },
  { title: '¿Una vuelta más antes de dormir?', body: 'Cinco minutos, los mejores premios están en esta hora.' },
  { title: 'Hace rato que no jugás 🔥', body: 'No pierdas la racha — abrí la app y mantené el ritmo.' },
  { title: 'La mesa está caliente esta noche 💸', body: 'Pasá rapido, las ganadoras del rato están repartiendo.' },
  { title: '¿Listo para revancha?', body: 'Hoy el aire viene mejor, abrí y probá una jugada.' },
  { title: 'Vení, jugamos un rato 🎲', body: 'Una mano, dos y te vas — entrá nomás.' },
  { title: 'Hoy puede ser tu día 🍀', body: 'Abrí la app y sentí la energía que se viene.' }
];

async function _ensureCopiesSeeded(EngagementCopyPool) {
  const count = await EngagementCopyPool.estimatedDocumentCount();
  if (count > 0) return;
  for (const c of DEFAULT_ENGAGEMENT_COPIES) {
    await EngagementCopyPool.create({
      id: uuidv4(),
      title: c.title,
      body: c.body,
      segments: [],
      enabled: true,
      weight: 1,
      createdBy: 'seed'
    }).catch(() => {});
  }
}

// Selecciona un copy del pool para un user de un segmento, ponderado por
// weight y respetando segmentos. Si todo el pool esta filtrado, devuelve
// el primero disponible (best-effort). Determinista por (username, runSalt).
function _pickCopy(copies, segment, username, runSalt) {
  // Filtramos por segmento (los que no especifican segmento sirven para
  // cualquiera, los que especifican deben matchear).
  const eligible = copies.filter(c =>
    c.enabled !== false &&
    (!Array.isArray(c.segments) || c.segments.length === 0 || c.segments.includes(segment))
  );
  if (eligible.length === 0) return null;
  // Suma de pesos.
  let totalW = 0;
  for (const c of eligible) totalW += Math.max(0.1, Number(c.weight) || 1);
  // Punto en [0, totalW) deterministico por hash(username + runSalt).
  const s = String(username || '') + ':' + String(runSalt || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let pick = ((h >>> 0) % 1000000) / 1000000 * totalW;
  for (const c of eligible) {
    pick -= Math.max(0.1, Number(c.weight) || 1);
    if (pick <= 0) return c;
  }
  return eligible[eligible.length - 1];
}

// ============================================
// COMPUTE PLAN
// ============================================
async function computeAutomationPlan({ models, weeklyService, analysisFrom, analysisTo, preset, logger }) {
  const { User, DailyPlayerStats, EngagementCopyPool } = models;

  await _ensureCopiesSeeded(EngagementCopyPool);
  const copies = await EngagementCopyPool.find({ enabled: true }).lean();

  // Universo: solo users con app + notifs (canal disponible).
  const allUsers = await User.find(
    { role: 'user' },
    { username: 1, lineTeamName: 1, linePhone: 1,
      fcmTokens: 1, fcmTokenContext: 1, notifPermission: 1, _id: 0 }
  ).lean();
  const userIndex = new Map();
  for (const u of allUsers) {
    const tokens = Array.isArray(u.fcmTokens) ? u.fcmTokens : [];
    const legacyMatch = u.fcmTokenContext === 'standalone' && u.notifPermission === 'granted';
    const arrayMatch = tokens.some(t => t && t.context === 'standalone' && t.notifPermission === 'granted');
    if (!legacyMatch && !arrayMatch) continue; // sin canal → fuera
    userIndex.set(String(u.username).toLowerCase(), {
      username: u.username,
      linePhone: u.linePhone || null,
      lineTeamName: u.lineTeamName || null
    });
  }

  // Stats agregadas en el rango analizado.
  const statsAgg = await DailyPlayerStats.aggregate([
    { $match: { dateUtc: { $gte: analysisFrom, $lte: analysisTo } } },
    {
      $group: {
        _id: '$username',
        totalDepositsARS: { $sum: '$depositSum' },
        depositCount: { $sum: '$depositCount' },
        totalWithdrawsARS: { $sum: '$withdrawSum' },
        lastDepositDate: { $max: { $cond: [{ $gt: ['$depositSum', 0] }, '$dateUtc', null] } }
      }
    }
  ]);

  const statsByUser = new Map();
  const now = Date.now();
  for (const s of statsAgg) {
    const lower = String(s._id).toLowerCase();
    if (!userIndex.has(lower)) continue;
    const lastDep = s.lastDepositDate ? new Date(s.lastDepositDate).getTime() : null;
    statsByUser.set(lower, {
      username: userIndex.get(lower).username,
      totalDepositsARS: Number(s.totalDepositsARS) || 0,
      totalWithdrawsARS: Number(s.totalWithdrawsARS) || 0,
      netwinARS: (Number(s.totalDepositsARS) || 0) - (Number(s.totalWithdrawsARS) || 0),
      daysSinceLastDeposit: lastDep ? Math.floor((now - lastDep) / 86400000) : null,
      depositCount: s.depositCount || 0
    });
  }

  // También incluimos users con app pero SIN actividad en el rango — esos
  // van al segmento "active_regular" con netwin 0 si daysSinceLastDeposit
  // es <=7 (los que abrieron la app reciente), o quedan fuera si están
  // muy fríos (los toma recovery, no automation).
  for (const [lower, u] of userIndex) {
    if (statsByUser.has(lower)) continue;
    statsByUser.set(lower, {
      username: u.username,
      totalDepositsARS: 0,
      totalWithdrawsARS: 0,
      netwinARS: 0,
      daysSinceLastDeposit: null,
      depositCount: 0
    });
  }

  // Cooldown 72h: filtramos los que recibieron push en los ult. 3 dias.
  const config = await weeklyService.getOrCreateConfig(models.WeeklyStrategyConfig);
  const cooldownHours = Math.max(48, Math.min(168, config.cooldownHours || 72));
  const wk = weeklyService._weekKey();

  // Asignación a segmento + decisión bonus/engagement.
  const targets = [];
  const skippedNoMatch = [];
  const skippedCooldown = [];

  for (const [, s] of statsByUser) {
    s.username = s.username; // explicit
    const seg = SEGMENTS.find(x => x.matcher(s));
    if (!seg) { skippedNoMatch.push(s.username); continue; }

    // Cooldown gate
    const gate = await weeklyService.canSendToUser({
      username: s.username,
      weekKey: wk,
      cooldownHours,
      capPerUser: config.capPerUserPerWeek,
      WeeklyNotifBudget: models.WeeklyNotifBudget
    });
    if (!gate.ok) { skippedCooldown.push({ username: s.username, reason: gate.reason }); continue; }

    // 70/30 split por hash determinista del user.
    const bucket = _userBucket01(s.username);
    const getsBonus = bucket < seg.bonusRatio;

    let kind, giftAmount = 0, bonusPct = 0, copyTitle = null, copyBody = null;
    if (getsBonus) {
      kind = seg.bonusKind;
      giftAmount = seg.suggestGiftAmount(s) || 0;
      bonusPct = seg.suggestBonusPct(s) || 0;
    } else {
      kind = 'engagement';
      const copy = _pickCopy(copies, seg.code, s.username, 'auto-' + Date.now());
      if (copy) {
        copyTitle = copy.title;
        copyBody = copy.body;
      } else {
        copyTitle = '🎰 Pasá a jugar un rato';
        copyBody = 'Te esperamos en la app.';
      }
    }

    targets.push({
      username: s.username,
      segment: seg.code,
      segmentLabel: seg.label,
      kind,
      giftAmount,
      bonusPct,
      copyTitle,
      copyBody,
      netwinARS: s.netwinARS,
      totalDepositsARS: s.totalDepositsARS,
      daysSinceLastDeposit: s.daysSinceLastDeposit
    });
  }

  // Breakdown agregado por segmento.
  const breakdown = {};
  for (const t of targets) {
    if (!breakdown[t.segment]) {
      const seg = SEGMENTS.find(x => x.code === t.segment);
      breakdown[t.segment] = {
        segment: t.segment,
        label: seg.label,
        description: seg.description,
        bonusRatio: seg.bonusRatio,
        bonusKind: seg.bonusKind,
        count: 0,
        engagementCount: 0,
        bonusCount: 0,
        costARS: 0,
        avgGiftAmount: 0,
        avgBonusPct: 0,
        _giftSum: 0,
        _giftN: 0,
        _pctSum: 0,
        _pctN: 0
      };
    }
    const b = breakdown[t.segment];
    b.count++;
    if (t.kind === 'engagement') {
      b.engagementCount++;
    } else {
      b.bonusCount++;
      if (t.kind === 'money') {
        b._giftSum += t.giftAmount;
        b._giftN++;
        b.costARS += t.giftAmount;
      } else if (t.kind === 'whatsapp_promo') {
        b._pctSum += t.bonusPct;
        b._pctN++;
        // No costo directo; bono % se realiza al cargar.
      }
    }
  }
  for (const k of Object.keys(breakdown)) {
    const b = breakdown[k];
    b.avgGiftAmount = b._giftN ? Math.round(b._giftSum / b._giftN) : 0;
    b.avgBonusPct = b._pctN ? Math.round(b._pctSum / b._pctN) : 0;
    delete b._giftSum; delete b._giftN; delete b._pctSum; delete b._pctN;
  }

  const totalEngagement = targets.filter(t => t.kind === 'engagement').length;
  const totalBonus = targets.length - totalEngagement;
  const totalCostARS = targets.reduce((sum, t) => sum + (t.kind === 'money' ? (t.giftAmount || 0) : 0), 0);

  return {
    id: null,
    analysisFrom,
    analysisTo,
    preset: preset || 'custom',
    cooldownHours,
    totalCandidates: statsByUser.size,
    totalTargets: targets.length,
    totalEngagement,
    totalBonus,
    totalCostARS,
    skippedNoMatch: skippedNoMatch.length,
    skippedCooldown: skippedCooldown.length,
    breakdown: Object.values(breakdown),
    targets,
    copiesAvailable: copies.length
  };
}

// ============================================
// EXECUTE PLAN
// ============================================
async function executeAutomationPlan({
  plan, edits, models, weeklyService, sendPushFn,
  setConfig, getConfig, TIER_PROMOS_KEY,
  validUntil, triggeredBy, logger
}) {
  const { User, MoneyGiveaway, NotificationHistory, WeeklyNotifBudget,
          AutomationLaunch, EngagementCopyPool } = models;
  const wk = weeklyService._weekKey();

  if (!plan.targets || plan.targets.length === 0) {
    return { skipped: 'no-targets' };
  }

  // 1) Aplicar edits del admin (override de monto y/o %) por segmento.
  // edits = { [segmentCode]: { giftAmount?, bonusPct? } }
  const e = edits || {};
  for (const t of plan.targets) {
    const segEdit = e[t.segment];
    if (!segEdit) continue;
    if (t.kind === 'money' && Number.isFinite(segEdit.giftAmount) && segEdit.giftAmount >= 0) {
      t.giftAmount = Math.round(segEdit.giftAmount);
    }
    if (t.kind === 'whatsapp_promo' && Number.isFinite(segEdit.bonusPct) && segEdit.bonusPct >= 1 && segEdit.bonusPct <= 100) {
      t.bonusPct = Math.round(segEdit.bonusPct);
    }
  }

  // 2) Re-check elegibilidad — entre analyze y launch puede haber pasado
  // tiempo y algunos perdieron app+notifs.
  const allUsernames = plan.targets.map(t => t.username);
  const stillEligible = await weeklyService.filterToEligibleUsernames(User, allUsernames);
  const eligibleSet = new Set(stillEligible.map(u => u.toLowerCase()));
  const liveTargets = plan.targets.filter(t => eligibleSet.has(t.username.toLowerCase()));
  if (liveTargets.length === 0) return { skipped: 'no-eligible-after-recheck' };

  const droppedAtSend = plan.targets.length - liveTargets.length;

  // 3) Separar por kind.
  const engagementTargets = liveTargets.filter(t => t.kind === 'engagement');
  const moneyTargets = liveTargets.filter(t => t.kind === 'money' && (t.giftAmount || 0) > 0);
  const promoTargets = liveTargets.filter(t => t.kind === 'whatsapp_promo' && (t.bonusPct || 0) > 0);

  const launchId = uuidv4();
  const historyId = uuidv4();
  const giveawayIds = [];

  // 4) Cancelar automation-strategy giveaways viejos antes de crear nuevos.
  await MoneyGiveaway.updateMany(
    { status: 'active', strategySource: 'auto-rule', createdBy: { $regex: /^automation-/ } },
    { $set: { status: 'cancelled' } }
  );

  // 5) Crear giveaways agrupados por monto.
  if (moneyTargets.length > 0) {
    const byAmount = new Map();
    for (const t of moneyTargets) {
      const k = String(t.giftAmount);
      if (!byAmount.has(k)) byAmount.set(k, []);
      byAmount.get(k).push(t);
    }
    for (const [amountKey, list] of byAmount) {
      const amount = Number(amountKey);
      const ga = await MoneyGiveaway.create({
        id: uuidv4(),
        amount,
        totalBudget: amount * list.length,
        maxClaims: list.length,
        expiresAt: validUntil,
        createdBy: 'automation-' + (triggeredBy || 'admin'),
        strategySource: 'auto-rule',
        prefix: null,
        audienceWhitelist: list.map(x => String(x.username).toLowerCase()),
        notificationHistoryId: historyId,
        status: 'active',
        requireZeroBalance: false
      });
      giveawayIds.push(ga.id);
    }
  }

  // 6) Promo % carga: registrar tier-promos.
  const promoConfigs = [];
  if (promoTargets.length > 0) {
    const byPct = new Map();
    for (const t of promoTargets) {
      const k = String(t.bonusPct);
      if (!byPct.has(k)) byPct.set(k, []);
      byPct.get(k).push(t);
    }
    for (const [pctKey, list] of byPct) {
      promoConfigs.push({
        id: uuidv4(),
        pct: Number(pctKey),
        audienceWhitelist: list.map(x => String(x.username).toLowerCase()),
        message: `🎁 ${pctKey}% de bono en tu próxima carga — válido hasta ${validUntil.toLocaleString('es-AR')}. Reclamá por WhatsApp.`,
        expiresAt: validUntil.toISOString(),
        createdAt: new Date().toISOString(),
        createdBy: 'automation-' + (triggeredBy || 'admin'),
        source: 'automation-strategy'
      });
    }
    if (setConfig && TIER_PROMOS_KEY) {
      let existingPromos = [];
      if (typeof getConfig === 'function') {
        try {
          const cur = await getConfig(TIER_PROMOS_KEY);
          if (Array.isArray(cur)) {
            const nowMs = Date.now();
            existingPromos = cur.filter(p => {
              try { return p && p.expiresAt && new Date(p.expiresAt).getTime() > nowMs; }
              catch (_) { return false; }
            });
          }
        } catch (e) {
          logger && logger.warn(`[automation] no se pudo leer TIER_PROMOS_KEY existente: ${e.message}`);
        }
      }
      await setConfig(TIER_PROMOS_KEY, [...existingPromos, ...promoConfigs]);
    }
  }

  // 7) Mandar pushes en batches por (titulo, body) — no podemos meter todo
  // en un sendNotificationToAllUsers porque cada user-engagement tiene su
  // propio copy rotado. Para los bonus targets (money + promo) sí podemos
  // mandar un copy unificado de "tenés un regalo".
  let totalSent = 0;
  let totalFailed = 0;

  // Engagement: agrupar por (title, body) para minimizar llamadas a FCM.
  const engagementByCopy = new Map();
  for (const t of engagementTargets) {
    const k = (t.copyTitle || '') + ' ' + (t.copyBody || '');
    if (!engagementByCopy.has(k)) {
      engagementByCopy.set(k, {
        title: t.copyTitle,
        body: t.copyBody,
        usernames: []
      });
    }
    engagementByCopy.get(k).usernames.push(t.username);
  }
  for (const [, group] of engagementByCopy) {
    try {
      const r = await sendPushFn(
        User,
        group.title,
        group.body,
        { source: 'automation-strategy', strategyType: 'automation-engagement', historyId, launchId },
        { username: { $in: group.usernames } }
      );
      totalSent += r.successCount || 0;
      totalFailed += r.failureCount || 0;
    } catch (err) {
      logger && logger.warn(`[automation] engagement batch failed: ${err.message}`);
      totalFailed += group.usernames.length;
    }
  }

  // Bonus: un solo push para todos los con oferta.
  const bonusTargets = [...moneyTargets, ...promoTargets];
  if (bonusTargets.length > 0) {
    try {
      const r = await sendPushFn(
        User,
        '🎁 Tenés un regalo esperándote',
        'Abrí la app y reclamalo antes de que se termine.',
        { source: 'automation-strategy', strategyType: 'automation-bonus', historyId, launchId },
        { username: { $in: bonusTargets.map(t => t.username) } }
      );
      totalSent += r.successCount || 0;
      totalFailed += r.failureCount || 0;
    } catch (err) {
      logger && logger.warn(`[automation] bonus batch failed: ${err.message}`);
      totalFailed += bonusTargets.length;
    }
  }

  // 8) NotificationHistory (para reusar la maquinaria de tracking existente).
  await NotificationHistory.create({
    id: historyId,
    sentAt: new Date(),
    audienceType: 'list',
    audienceCount: liveTargets.length,
    title: '🤖 Automatización (mix engagement + bonos)',
    body: 'Lanzamiento desde la sección Automatización del admin.',
    type: moneyTargets.length > 0 ? 'money_giveaway' : (promoTargets.length > 0 ? 'whatsapp_promo' : 'plain'),
    giveawayAmount: null,
    giveawayExpiresAt: validUntil,
    totalUsers: liveTargets.length,
    successCount: totalSent,
    failureCount: totalFailed,
    cleanedTokens: 0,
    strategyType: 'automation',
    strategyMeta: {
      analysisFrom: plan.analysisFrom,
      analysisTo: plan.analysisTo,
      preset: plan.preset,
      breakdown: plan.breakdown,
      droppedAtSend,
      launchId
    },
    strategyWeekKey: wk,
    strategyDetails: liveTargets.map(t => ({
      username: t.username,
      lossARS: t.netwinARS,
      giftAmount: t.giftAmount || 0,
      tierLabel: t.segmentLabel,
      bonusPct: t.bonusPct || null,
      refundsARS: 0,
      percentile: 0,
      claimed: false,
      classification: t.kind
    })),
    audienceUsernames: liveTargets.map(t => t.username),
    sentBy: triggeredBy || 'admin'
  });

  // 9) Anotar en WeeklyNotifBudget (cap+cooldown).
  for (const t of liveTargets) {
    await weeklyService.recordSent({
      username: t.username,
      weekKey: wk,
      type: 'automation',
      historyId,
      tier: t.segment,
      giftAmount: t.giftAmount || null,
      bonusPct: t.bonusPct || null,
      WeeklyNotifBudget
    });
  }

  // 10) Incrementar usageCount de copies asignados.
  const copyTitles = new Set(engagementTargets.map(t => t.copyTitle).filter(Boolean));
  for (const title of copyTitles) {
    const usedBy = engagementTargets.filter(t => t.copyTitle === title).length;
    await EngagementCopyPool.updateOne(
      { title },
      { $inc: { usageCount: usedBy } }
    ).catch(() => {});
  }

  // 11) Snapshot per-segmento para AutomationLaunch.
  const segments = (plan.breakdown || []).map(b => ({
    segment: b.segment,
    label: b.label,
    count: b.count,
    engagementCount: b.engagementCount,
    bonusCount: b.bonusCount,
    costARS: b.costARS,
    avgBonusPct: b.avgBonusPct,
    avgGiftAmount: b.avgGiftAmount
  }));

  const totalCostARS = liveTargets.reduce((sum, t) => sum + (t.kind === 'money' ? (t.giftAmount || 0) : 0), 0);

  await AutomationLaunch.create({
    id: launchId,
    launchedAt: new Date(),
    launchedBy: triggeredBy || 'admin',
    analysisFrom: plan.analysisFrom,
    analysisTo: plan.analysisTo,
    preset: plan.preset || 'custom',
    totalTargets: liveTargets.length,
    engagementCount: engagementTargets.length,
    bonusCount: moneyTargets.length + promoTargets.length,
    totalCostARS,
    segments,
    targets: liveTargets.map(t => ({
      username: t.username,
      segment: t.segment,
      kind: t.kind,
      giftAmount: t.giftAmount || 0,
      bonusPct: t.bonusPct || 0,
      copyTitle: t.copyTitle || null
    })),
    sentCount: totalSent,
    failureCount: totalFailed,
    notificationHistoryId: historyId,
    giveawayIds,
    verdict: 'pending'
  });

  return {
    success: true,
    launchId,
    historyId,
    giveawayIds,
    sentCount: totalSent,
    failureCount: totalFailed,
    droppedAtSend,
    totalCostARS,
    engagementCount: engagementTargets.length,
    bonusCount: moneyTargets.length + promoTargets.length
  };
}

module.exports = {
  computeAutomationPlan,
  executeAutomationPlan,
  storeAutomationPlan,
  getAutomationPlan,
  consumeAutomationPlan,
  SEGMENTS,
  DEFAULT_ENGAGEMENT_COPIES
};
