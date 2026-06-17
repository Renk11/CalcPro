import { sendJson } from '../server/http.js';
import { requireCommunityAdmin } from '../server/request-auth.js';
import {
  getServerAdminSettings,
  saveServerPayment,
  updateServerSubscription,
} from '../server/settings-store.js';
import { normalizeYooKassaPayment, requestYooKassa } from '../server/yookassa.js';
import {
  buildNextPaidUntil,
  DEFAULT_SUBSCRIPTION_PLAN,
  getSubscriptionPlanConfig,
  isSubscriptionAmountValid,
  normalizeSubscriptionAmount,
} from '../server/subscription-config.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function buildReturnUrl(request) {
  const publicOrigin = String(process.env.PUBLIC_APP_URL || '').trim();
  const requestOrigin = String(request.headers.origin || '').trim();
  const host = String(request.headers.host || '').trim();
  const rawOrigin = publicOrigin || requestOrigin || (host ? `https://${host}` : '');

  if (!rawOrigin) {
    return undefined;
  }

  try {
    const normalizedOrigin = new URL(rawOrigin.startsWith('http') ? rawOrigin : `https://${rawOrigin}`);
    if (normalizedOrigin.protocol !== 'http:' && normalizedOrigin.protocol !== 'https:') {
      return undefined;
    }

    return `${normalizedOrigin.origin}/#/payments`;
  } catch {
    return undefined;
  }
}

async function createPayment(request, response) {
  const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);
  const auth = requireCommunityAdmin(request, response, groupId);
  if (!auth) {
    return undefined;
  }

  const settings = await getServerAdminSettings(groupId);
  const plan = String(request.body?.plan || settings.subscription.plan || DEFAULT_SUBSCRIPTION_PLAN);
  const planConfig = getSubscriptionPlanConfig(plan);
  const amountRub = normalizeSubscriptionAmount(planConfig.monthlyPriceRub, planConfig.id);
  const idempotenceKey = `calcpro_${Date.now()}`;
  const returnUrl = buildReturnUrl(request);

  const yooKassaPayment = await requestYooKassa('/payments', {
    method: 'POST',
    idempotenceKey,
    body: {
      amount: {
        value: amountRub.toFixed(2),
        currency: 'RUB',
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: returnUrl,
      },
      description: planConfig.paymentTitle,
      metadata: {
        plan: planConfig.id,
        expectedAmountRub: String(amountRub),
        product: `calcpro_${planConfig.id}_30_days`,
        groupId: String(groupId || ''),
      },
    },
  });

  const payment = normalizeYooKassaPayment(yooKassaPayment);
  await saveServerPayment({
    id: payment.id,
    status: payment.status || 'pending',
    amountRub,
    description: planConfig.paymentTitle,
    paymentUrl: payment.confirmationUrl,
  });

  return sendJson(response, 200, {
    ok: true,
    data: {
      payment: {
        id: payment.id,
        status: payment.status,
        confirmationUrl: payment.confirmationUrl,
        amountRub,
      },
    },
  });
}

async function checkPayment(request, response) {
  const paymentId = String(request.body?.paymentId || '').trim();

  if (!paymentId) {
    return sendJson(response, 400, { ok: false, error: 'paymentId is required' });
  }

  const rawPayment = await requestYooKassa(`/payments/${encodeURIComponent(paymentId)}`);
  const payment = normalizeYooKassaPayment(rawPayment);
  const groupId = parseGroupId(rawPayment?.metadata?.groupId || request.body?.groupId);
  const auth = requireCommunityAdmin(request, response, groupId);
  if (!auth) {
    return undefined;
  }

  const settings = await getServerAdminSettings(groupId);
  const rawPlan = String(
    rawPayment?.metadata?.plan || request.body?.plan || settings.subscription.plan || DEFAULT_SUBSCRIPTION_PLAN,
  );
  const planConfig = getSubscriptionPlanConfig(rawPlan);
  const expectedAmountRub = normalizeSubscriptionAmount(rawPayment?.metadata?.expectedAmountRub, planConfig.id);

  if (settings.subscription.externalPaymentId === payment.id) {
    return sendJson(response, 200, {
      ok: true,
      data: {
        activated: true,
        payment,
        subscription: settings.subscription,
        settings,
      },
    });
  }

  if (
    !(payment.paid || payment.status === 'succeeded') ||
    !isSubscriptionAmountValid(payment.amountRub, expectedAmountRub)
  ) {
    await saveServerPayment({
      id: payment.id,
      status: payment.status || 'pending',
      amountRub: payment.amountRub,
      description: planConfig.paymentTitle,
      paymentUrl: payment.confirmationUrl,
    });

    return sendJson(response, 200, {
      ok: true,
      data: {
        activated: false,
        payment,
      },
    });
  }

  const nextSettings = await updateServerSubscription(
    {
      plan: planConfig.id,
      priceRub: expectedAmountRub,
      status: 'active',
      paidUntil: buildNextPaidUntil(settings.subscription.paidUntil),
      provider: 'yookassa',
      externalPaymentId: payment.id,
    },
    groupId,
  );
  await saveServerPayment({
    id: payment.id,
    status: payment.status || 'succeeded',
    amountRub: payment.amountRub,
    description: planConfig.paymentTitle,
    paymentUrl: payment.confirmationUrl,
    paidAt: new Date().toISOString(),
  });

  return sendJson(response, 200, {
    ok: true,
    data: {
      activated: true,
      payment,
      subscription: nextSettings.subscription,
      settings: nextSettings,
    },
  });
}

async function handleWebhook(request, response) {
  const event = request.body || {};
  const object = event.object || {};
  const paymentId = object.id;

  if (!paymentId) {
    return sendJson(response, 400, { ok: false, error: 'payment id is required' });
  }

  const rawPayment = await requestYooKassa(`/payments/${encodeURIComponent(paymentId)}`);
  const payment = normalizeYooKassaPayment(rawPayment);
  const rawPlan = String(rawPayment?.metadata?.plan || DEFAULT_SUBSCRIPTION_PLAN);
  const planConfig = getSubscriptionPlanConfig(rawPlan);
  const expectedAmountRub = normalizeSubscriptionAmount(rawPayment?.metadata?.expectedAmountRub, planConfig.id);
  const groupId = parseGroupId(rawPayment?.metadata?.groupId);

  if (
    (payment.paid || payment.status === 'succeeded') &&
    isSubscriptionAmountValid(payment.amountRub, expectedAmountRub)
  ) {
    const settings = await getServerAdminSettings(groupId);
    if (settings.subscription.externalPaymentId !== payment.id) {
      await updateServerSubscription(
        {
          plan: planConfig.id,
          priceRub: expectedAmountRub,
          status: 'active',
          paidUntil: buildNextPaidUntil(settings.subscription.paidUntil),
          provider: 'yookassa',
          externalPaymentId: payment.id,
        },
        groupId,
      );
    }
  }

  await saveServerPayment({
    id: payment.id,
    status: payment.status || (payment.paid ? 'succeeded' : 'pending'),
    amountRub: payment.amountRub,
    description: planConfig.paymentTitle,
    paymentUrl: payment.confirmationUrl,
    paidAt: payment.paid ? new Date().toISOString() : '',
  });

  return sendJson(response, 200, {
    ok: true,
    data: {
      received: true,
    },
  });
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  }

  const action = String(request.query?.action || request.body?.action || '').toLowerCase();

  try {
    if (action === 'create') {
      return await createPayment(request, response);
    }

    if (action === 'check') {
      return await checkPayment(request, response);
    }

    if (action === 'webhook') {
      return await handleWebhook(request, response);
    }

    return sendJson(response, 400, { ok: false, error: 'Unknown YooKassa action' });
  } catch (error) {
    console.error('yookassa api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'YooKassa request failed',
    });
  }
}
