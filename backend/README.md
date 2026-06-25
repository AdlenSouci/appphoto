# Backend Stripe - Déploiement Vercel

## Déploiement rapide

### 1. Installer Vercel CLI
```powershell
npm install -g vercel
```

### 2. Se connecter
```powershell
vercel login
```

### 3. Déployer depuis le dossier backend
```powershell
cd backend
vercel
```

Lors du premier déploiement, répondre :
- Set up and deploy? **Yes**
- Which scope? **Ton compte**
- Link to existing project? **No**
- Project name? **app-mobile-backend** (ou autre)
- Directory? **`./`** (c'est déjà le bon dossier)

### 4. Récupérer l'URL
Vercel affichera une URL du type : `https://app-mobile-backend-xxx.vercel.app`

### 5. Mettre à jour l'app Angular
Remplacer dans `src/environments/environment.ts` et `environment.prod.ts` :
```typescript
backendUrl: 'https://TON-URL-VERCEL.vercel.app'
```

### 6. Rebuild l'app
```powershell
npm run build
npx cap sync android
```

## Notes importantes
- Les clés Stripe sont actuellement **hardcodées** dans `server.js` (lignes 5 et 44-45)
- Pour la vraie production, il faudrait les mettre dans les **Environment Variables** de Vercel
- L'app fonctionnera alors **sans câble, sans backend local, partout**
