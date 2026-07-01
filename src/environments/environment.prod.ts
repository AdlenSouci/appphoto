export const environment = {
  production: true,
  stripe: {
    publishableKey:
      'pk_test_51TlkZ4FsDvyDpRQarv7AodYhQadNLPlHcIusmdQB52EOWP91D7IM1wnHx63MDxXmkoiwEBrr33kpGj2qMNG3BgqG002ifzAaAI',
    // Sans câble : téléphone + PC sur le même Wi-Fi → IP locale du PC.
    // En vraie prod : remplacer par l'URL déployée (Render, Railway…).
    backendUrl: 'https://appphoto-delta-teal.vercel.app',
  },
};
