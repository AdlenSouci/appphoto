/* Génère les PNG sources (1024x1024) pour @capacitor/assets à partir du logo SVG. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const GRAD = `
  <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#6366F1"/>
    <stop offset="1" stop-color="#8B5CF6"/>
  </linearGradient>`;

// Caméra + pin (groupe réutilisable), dessiné dans un repère 1024x1024.
const camera = (fillBg) => `
  <g filter="url(#soft)">
    <rect x="192" y="340" width="640" height="460" rx="96" fill="#FFFFFF"/>
    <path d="M392 340 l44 -68 a32 32 0 0 1 26 -14 h116 a32 32 0 0 1 26 14 l44 68 Z" fill="#FFFFFF"/>
  </g>
  <path d="M512 428 c-98 0 -178 80 -178 178 c0 120 156 224 170 232 a14 14 0 0 0 16 0 c14 -8 170 -112 170 -232 c0 -98 -80 -178 -178 -178 Z" fill="${fillBg}"/>
  <circle cx="512" cy="600" r="68" fill="#FFFFFF"/>
  <circle cx="740" cy="420" r="24" fill="#FBBF24"/>`;

const defs = `
  <defs>
    ${GRAD}
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.18"/>
    </filter>
  </defs>`;

// 1) Icône complète : fond arrondi + caméra
const iconOnly = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bg)"/>
  ${camera('url(#bg)')}
</svg>`;

// 2) Fond adaptatif : dégradé plein
const iconBackground = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>${GRAD}</defs>
  <rect x="0" y="0" width="1024" height="1024" fill="url(#bg)"/>
</svg>`;

// 3) Premier plan adaptatif : caméra seule, centrée dans la zone de sécurité (~62%)
const iconForeground = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <g transform="translate(512,512) scale(0.62) translate(-512,-512)">
    ${camera('#5B53D6')}
  </g>
</svg>`;

async function render(svg, file) {
  await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile(path.join(outDir, file));
  console.log('written', file);
}

(async () => {
  await render(iconOnly, 'icon-only.png');
  await render(iconBackground, 'icon-background.png');
  await render(iconForeground, 'icon-foreground.png');
  await render(iconOnly, 'logo.png');
})();
