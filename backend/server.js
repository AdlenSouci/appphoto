const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

const PRODUCTS = {
  premium: { amount: 500, label: 'Éditeur Premium' },
  download: { amount: 100, label: 'Téléchargement photo' },
};

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'PinPhoto Stripe backend' });
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

// Vercel : exporte l'app. En local : npm start lance le serveur.
module.exports = app;

if (require.main === module) {
  app.listen(4000, '0.0.0.0', () => {
    console.log('Backend Stripe lancé sur http://localhost:4000');
  });
}
