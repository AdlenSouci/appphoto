require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./notifpush-7920b-firebase-adminsdk-fbsvc-aec108018c.json');

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const app = express();

const PRODUCTS = {
  premium: { amount: 500, label: 'Éditeur Premium' },
  download: { amount: 100, label: 'Téléchargement photo' },
};

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'PinPhoto backend' });
});

app.post('/register-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token requis' });

  await db.collection('devices').doc(token).set({
    fcmToken: token,
    updatedAt: Date.now(),
  });

  res.json({ ok: true });
});

app.get('/dashboard', async (req, res) => {
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
      </script>
    </body>
    </html>
  `);
});

app.post('/notify-custom', async (req, res) => {
  const { deviceId, title, body } = req.body;

  try {
    const deviceDoc = await db.collection('devices').doc(deviceId).get();
    if (!deviceDoc.exists) {
      return res.status(404).json({ error: 'Device non trouvé' });
    }

    const { fcmToken } = deviceDoc.data();

    await getMessaging().send({
      token: fcmToken,
      notification: { title, body },
      data: { redirect: '/tabs/tab3' },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/notify-payment', async (req, res) => {
  const { title, body } = req.body;

  try {
    const snapshot = await db.collection('devices').get();
    const results = await Promise.allSettled(
      snapshot.docs.map(doc =>
        getMessaging().send({
          token: doc.data().fcmToken,
          notification: { title, body },
          data: { redirect: '/tabs/tab3' },
        })
      )
    );
    res.json({ sent: results.filter(r => r.status === 'fulfilled').length });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/payment-sheet', async (req, res) => {
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
