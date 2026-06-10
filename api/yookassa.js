import { sendJson } from '../server/http.js';
import {
  getServerAdminSettings,
  saveServerPayment,
  updateServerSubscription,
} from '../server/settings-store.js';
import { normalizeYooKassaPayment, requestYooKassa } from '../server/yookassa.js';
import {
  buildNextPaidUntil,
  isSubscriptionAmountValid,
  normalizeSubscriptionAmount,
  SUBSCRIPTION_PLAN,
  SUBSCRIPTION_TITLE,
} from '../server/subscription-config.js';

function buildReturnUrl(request) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = forwardedHost || request.headers.host;
  const origin =
    process.env.PUBLIC_APP_URL ||
    (host ? `${forwardedProto || 'https'}://${host}` : request.headers.origin || '');

  if (!origin) {
    return undefined;
  }

  const normalizedOrigin = origin.startsWith('http') ? origin : `https://${origin}`;
  return `${normalizedOrigin}/#/payments`;
}

async function createPayment(request, response) {
  const settings = await getServerAdminSettings();
  const plan = String(request.body?.plan || settings.subscription.plan || SUBSCRIPTION_PLAN);
  const amountRub = normalizeSubscriptionAmount(settings.subscription.priceRub);
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
      description: SUBSCRIPTION_TITLE,
      metadata: {
        plan,
        expectedAmountRub: String(amountRub),
        product: 'calcpro_subscription_30_days',
      },
    },
  });

  const payment = normalizeYooKassaPayment(yooKassaPayment);
  await saveServerPayment({
    id: payment.id,
    status: payment.status || 'pending',
    amountRub,
    description: SUBSCRIPTION_TITLE,
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
  const expectedAmountRub = normalizeSubscriptionAmount(rawPayment?.metadata?.expectedAmountRub);
  const settings = await getServerAdminSettings();

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
      description: SUBSCRIPTION_TITLE,
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

  const nextSettings = await updateServerSubscription({
    plan: String(rawPayment?.metadata?.plan || request.body?.plan || settings.subscription.plan),
    priceRub: expectedAmountRub,
    status: 'active',
    paidUntil: buildNextPaidUntil(settings.subscription.paidUntil),
    provider: 'yookassa',
    externalPaymentId: payment.id,
  });
  await saveServerPayment({
    id: payment.id,
    status: payment.status || 'succeeded',
    amountRub: payment.amountRub,
    description: SUBSCRIPTION_TITLE,
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
  const expectedAmountRub = normalizeSubscriptionAmount(rawPayment?.metadata?.expectedAmountRub);

  if (
    (payment.paid || payment.status === 'succeeded') &&
    isSubscriptionAmountValid(payment.amountRub, expectedAmountRub)
  ) {
    const settings = await getServerAdminSettings();
    if (settings.subscription.externalPaymentId !== payment.id) {
      await updateServerSubscription({
        plan: String(rawPayment?.metadata?.plan || settings.subscription.plan),
        priceRub: expectedAmountRub,
        status: 'active',
        paidUntil: buildNextPaidUntil(settings.subscription.paidUntil),
        provider: 'yookassa',
        externalPaymentId: payment.id,
      });
    }
  }

  await saveServerPayment({
    id: payment.id,
    status: payment.status || (payment.paid ? 'succeeded' : 'pending'),
    amountRub: payment.amountRub,
    description: SUBSCRIPTION_TITLE,
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
