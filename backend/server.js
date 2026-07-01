require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

let waitUntil = (promise) => {
  Promise.resolve(promise).catch((err) => console.error('push background:', err));
};
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch {
  // Dev local sans @vercel/functions
}

let db = null;
let messaging = null;
let pushReady = false;

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
    messaging = getMessaging();
    pushReady = true;
    console.log('Firebase push: OK');
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT manquant — notifications push désactivées');
  }
} catch (err) {
  console.error('Firebase init error:', err.message);
}

const app = express();

// Push serveur : paiement (FCM) + dashboard admin + souvenirs photo.
const APP_NAME = 'PinPhoto';
const FCM_CHANNELS = {
  default: 'pinphoto_default',
  payment: 'pinphoto_payments',
};

function paymentMessage(product) {
  if (product === 'premium') {
    return {
      title: `${APP_NAME} — Paiement confirmé`,
      body: 'Récap : Éditeur Premium activé (5,00 €). Photos géolocalisées sur la carte.',
    };
  }
  if (product === 'download') {
    return {
      title: `${APP_NAME} — Paiement confirmé`,
      body: 'Récap : Téléchargement photo (1,00 €). Export enregistré sur votre appareil.',
    };
  }
  return {
    title: `${APP_NAME} — Paiement confirmé`,
    body: 'Merci pour votre achat sur PinPhoto.',
  };
}

function photoMemoryMessage(address) {
  const place = address?.trim() || 'cet endroit';
  return {
    title: `${APP_NAME} — Souvenir`,
    body: `Vous vous souvenez de cette photo à ${place} ? Appuyez pour la revoir.`,
  };
}

function parseDelaySeconds(value, fallback = 15) {
  return Math.min(Math.max(Number(value) || fallback, 0), 60);
}

async function sendPushJob(job) {
  const { token, type, product, filepath, address } = job;

  if (type === 'payment') {
    const copy = paymentMessage(product);
    await messaging.send(
      buildPushPayload(token, copy.title, copy.body, 'payment', {
        action: 'payment_confirmed',
        product: product || '',
      }),
    );
    return;
  }

  if (type === 'memory') {
    const copy = photoMemoryMessage(address);
    await messaging.send(
      buildPushPayload(token, copy.title, copy.body, 'default', {
        action: 'open_photo',
        filepath: filepath || '',
        address: address || '',
      }),
    );
  }
}

/** File d'attente Firestore si l'app coupe la connexion HTTP. */
async function queuePush(job, delaySeconds) {
  if (!db) {
    return null;
  }

  const sendAt = Date.now() + delaySeconds * 1000;
  const ref = await db.collection('pending_pushes').add({
    ...job,
    sendAt,
    createdAt: Date.now(),
  });
  return ref.id;
}

async function processPendingPushes() {
  if (!db || !messaging) {
    return 0;
  }

  const snapshot = await db.collection('pending_pushes').where('sendAt', '<=', Date.now()).limit(20).get();
  let sent = 0;

  for (const doc of snapshot.docs) {
    try {
      await sendPushJob(doc.data());
      await doc.ref.delete();
      sent += 1;
    } catch (err) {
      console.error('processPendingPushes:', err.message);
    }
  }

  return sent;
}

function schedulePush(queuedId, job, delaySeconds, res) {
  waitUntil(
    (async () => {
      if (delaySeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }

      try {
        await sendPushJob(job);
        if (queuedId && db) {
          await db.collection('pending_pushes').doc(queuedId).delete();
        }
      } catch (err) {
        console.error('schedulePush:', err.message);
      }
    })(),
  );

  res.json({ success: true, scheduledIn: delaySeconds, queued: Boolean(queuedId) });
}

function buildPushPayload(token, title, body, channel = 'default', extraData = {}) {
  const data = {
    channel,
    title,
    body,
    ...Object.fromEntries(
      Object.entries(extraData).map(([key, value]) => [key, String(value ?? '')]),
    ),
  };

  return {
    token,
    notification: { title, body },
    data,
    android: {
      priority: 'high',
      notification: {
        channelId: FCM_CHANNELS[channel] || FCM_CHANNELS.default,
        icon: 'ic_stat_pinphoto',
        color: '#5b5bd6',
        defaultSound: true,
        visibility: 'public',
      },
    },
  };
}

const PRODUCTS = {
  premium: { amount: 500, label: 'Éditeur Premium' },
  download: { amount: 100, label: 'Téléchargement photo' },
};

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'PinPhoto backend', push: pushReady });
});

app.get('/health', async (_req, res) => {
  const pending = db ? await processPendingPushes() : 0;
  res.json({
    ok: true,
    push: pushReady,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    pendingProcessed: pending,
  });
});

/** Cron Vercel + secours : envoie les push en file d'attente. */
app.get('/process-pushes', async (_req, res) => {
  try {
    const sent = await processPendingPushes();
    res.json({ ok: true, sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/register-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token requis' });
  if (!db) {
    return res.status(503).json({ error: 'Push non configuré (Firebase manquant sur Vercel)' });
  }

  await db.collection('devices').doc(token).set({
    fcmToken: token,
    updatedAt: Date.now(),
  });

  res.json({ ok: true });
});

app.get('/dashboard', async (req, res) => {
  if (!db) {
    return res.status(503).send('Firebase non configuré sur le serveur');
  }

  const snapshot = await db.collection('devices').get();
  const devices = snapshot.docs.map(d => ({
    id: d.id,
    fcmToken: d.data().fcmToken,
    updatedAt: d.data().updatedAt,
  }));

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Push Dashboard</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
        h1 { color: #23b2a4; }
        label { display: block; margin-top: 12px; font-weight: 600; }
        input, select, textarea {
          width: 100%; padding: 8px; margin-top: 4px;
          border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;
        }
        button {
          margin-top: 20px; padding: 12px 24px; background: #23b2a4;
          color: white; border: none; border-radius: 4px; cursor: pointer;
          font-size: 16px;
        }
        button:hover { background: #1e8e7e; }
        .device { padding: 8px; background: #f5f5f5; margin: 4px 0; border-radius: 4px; font-size: 13px; }
      </style>
    </head>
    <body>
      <h1>Push Notification Dashboard</h1>

      <h3>Devices enregistrés (${devices.length})</h3>
      ${devices.map(d => `
        <div class="device">
          <strong>${d.id}</strong>
          Token: ${d.fcmToken.substring(0, 40)}...
          Updated: ${new Date(d.updatedAt).toLocaleString()}
        </div>
      `).join('')}

      <h3>Envoyer une notification</h3>
      <form id="form">
        <label>Device</label>
        <select name="deviceId" required>
          ${devices.map(d => `<option value="${d.id}">${d.id}</option>`).join('')}
        </select>

        <label>Titre</label>
        <input name="title" value="Test depuis le dashboard" required />

        <label>Message</label>
        <textarea name="body" rows="3" required>Hello !</textarea>

        <button type="submit">Envoyer</button>
      </form>

      <h3>Souvenir photo (lien vers la carte)</h3>
      <form id="memoryForm">
        <label>Device</label>
        <select name="deviceId" required>
          ${devices.map(d => `<option value="${d.id}">${d.id}</option>`).join('')}
        </select>

        <label>Fichier photo (ex. 1712345678.jpeg)</label>
        <input name="filepath" placeholder="1712345678.jpeg" required />

        <label>Adresse affichée</label>
        <input name="address" placeholder="12 rue Example, Aix-en-Provence" required />

        <button type="submit">Envoyer souvenir</button>
      </form>

      <p id="result"></p>

      <script>
        document.getElementById('form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target));
          const res = await fetch('/notify-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();
          document.getElementById('result').innerText = JSON.stringify(json);
        });

        document.getElementById('memoryForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target));
          const res = await fetch('/notify-photo-memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();
          document.getElementById('result').innerText = JSON.stringify(json);
        });
      </script>
    </body>
    </html>
  `);
});

app.post('/notify-custom', async (req, res) => {
  const { deviceId, title, body } = req.body;
  if (!messaging || !db) {
    return res.status(503).json({ error: 'Push non configuré sur le serveur' });
  }

  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'title et body requis' });
  }

  try {
    const deviceDoc = await db.collection('devices').doc(deviceId).get();
    if (!deviceDoc.exists) {
      return res.status(404).json({ error: 'Device non trouvé' });
    }

    const { fcmToken } = deviceDoc.data();

    await messaging.send(buildPushPayload(fcmToken, title.trim(), body.trim(), 'default'));

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Push FCM paiement — répond tout de suite, envoi après délai (fermez l'app).
 * File Firestore en secours si la connexion coupe.
 */
app.post('/notify-payment', async (req, res) => {
  const { token, product, delaySeconds = 15 } = req.body;

  if (!messaging) {
    return res.status(503).json({ error: 'Push non configuré (FIREBASE_SERVICE_ACCOUNT manquant sur Vercel)' });
  }

  if (!token) {
    return res.status(400).json({ error: 'token FCM requis' });
  }

  const delay = parseDelaySeconds(delaySeconds, 15);
  const job = { token, type: 'payment', product: product || 'premium' };

  try {
    const queuedId = await queuePush(job, delay);
    schedulePush(queuedId, job, delay, res);
  } catch (err) {
    console.error('Erreur notify-payment:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/notify-photo-memory', async (req, res) => {
  const { deviceId, token, filepath, address, delaySeconds = 15 } = req.body;

  if (!messaging) {
    return res.status(503).json({ error: 'Push non configuré sur le serveur' });
  }

  if (!filepath?.trim()) {
    return res.status(400).json({ error: 'filepath requis' });
  }

  const delay = parseDelaySeconds(delaySeconds, 15);

  try {
    let fcmToken = token;

    if (deviceId && db) {
      const deviceDoc = await db.collection('devices').doc(deviceId).get();
      if (!deviceDoc.exists) {
        return res.status(404).json({ error: 'Device non trouvé' });
      }
      fcmToken = deviceDoc.data().fcmToken;
    }

    if (!fcmToken) {
      return res.status(400).json({ error: 'token ou deviceId requis' });
    }

    const job = {
      token: fcmToken,
      type: 'memory',
      filepath: filepath.trim(),
      address: address?.trim() || '',
    };

    const queuedId = await queuePush(job, delay);
    schedulePush(queuedId, job, delay, res);
  } catch (err) {
    console.error('Erreur notify-photo-memory:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/payment-sheet', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe non configuré (STRIPE_SECRET_KEY manquant sur Vercel)' });
  }

  try {
    const product = req.body?.product === 'download' ? 'download' : 'premium';
    const config = PRODUCTS[product];

    const customer = await stripe.customers.create();

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-06-20' },
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount: config.amount,
      currency: 'eur',
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      metadata: {
        product,
        filepath: req.body?.filepath || '',
      },
      description: config.label,
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      product,
      amount: config.amount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(4000, '0.0.0.0', () => {
    console.log('Backend lancé sur http://localhost:4000');
  });
}
