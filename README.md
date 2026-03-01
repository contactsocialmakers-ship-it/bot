# TaskerTime LinkedIn Bot

Bot de social listening LinkedIn qui tourne 24/7. Scanne les posts de freelances, détecte les opportunités, et répond automatiquement avec des messages contextuels pour promouvoir TaskerTime.

## Architecture

```
index.js                    → Orchestrateur + dashboard stats
├── scanners/linkedin.js    → Scanner LinkedIn (API cookie-based)
├── replyGenerator.js       → Réponses AI (Anthropic) ou templates
├── config.js               → Keywords, scoring, catégorisation
├── store.js                → Tracking + limites quotidiennes
└── logger.js               → Logs structurés
```

## Comment ça marche

1. Le bot recherche des posts LinkedIn par mots-clés (facturation, freelance, etc.)
2. Chaque post est **scoré** (0-200) selon sa pertinence et son engagement
3. Les posts sont **catégorisés** : comparaison d'outils, recherche active, point de douleur, nouveau freelance
4. Le bot génère une **réponse contextuelle** (via AI ou templates)
5. Le commentaire est posté automatiquement
6. Le post est tracké pour ne jamais répondre 2 fois

## Setup — 5 minutes

### 1. Récupérer le cookie LinkedIn

1. Connecte-toi à LinkedIn dans Chrome
2. Ouvre les DevTools : **F12** → onglet **Application** → **Cookies** → `linkedin.com`
3. Copie la valeur de **`li_at`** (longue chaîne commençant par `AQED...`)
4. Copie aussi **`JSESSIONID`** (commence par `ajax:...`)

### 2. Créer un repo GitHub

```bash
cd taskertime-bot
git init
git add .
git commit -m "init linkedin bot"
git remote add origin https://github.com/TON-USER/taskertime-bot.git
git push -u origin main
```

### 3. Déployer sur Railway

1. Va sur **railway.app** → New Project → Deploy from GitHub
2. Sélectionne le repo `taskertime-bot`
3. Dans **Variables**, ajoute :

```
LINKEDIN_COOKIE_LI_AT=AQEDASxxxxxx
LINKEDIN_COOKIE_JSESSIONID=ajax:xxxxxxx
TASKERTIME_URL=https://taskertime.app
SCAN_INTERVAL_MINUTES=10
MAX_REPLIES_PER_DAY=20
MAX_SEARCHES_PER_DAY=50
DRY_RUN=true
ANTHROPIC_API_KEY=sk-ant-xxxxx  (optionnel)
```

4. Railway build et deploy automatiquement
5. Accède au dashboard : `https://ton-app.railway.app/`

### 4. Tester puis passer en live

- Commence en **DRY_RUN=true** → le bot scanne mais ne poste pas
- Vérifie les logs : `railway logs`
- Quand c'est bon, passe **DRY_RUN=false**

## Dashboard

Le dashboard est accessible sur l'URL de ton app Railway. Il affiche en temps réel :
- Replies aujourd'hui / max
- Searches aujourd'hui / max
- Total lifetime
- Status de la session LinkedIn
- Auto-refresh toutes les 30s

## Limites de sécurité

| Paramètre | Default | Recommandé |
|---|---|---|
| Scan interval | 10 min | 10-15 min |
| Max replies/jour | 20 | 15-25 |
| Max searches/jour | 50 | 30-50 |
| Pause entre replies | 45s-3min | Aléatoire (intégré) |

**Important** : LinkedIn détecte les patterns mécaniques. Le bot intègre :
- Pauses aléatoires entre chaque action
- Limites quotidiennes strictes
- Headers qui imitent un vrai navigateur Chrome
- Rotation des mots-clés à chaque cycle

## Cookie LinkedIn expiré ?

Le cookie `li_at` dure **3-6 mois**. Quand il expire :
1. Le dashboard affiche "Session Expired"
2. Reconnecte-toi à LinkedIn dans Chrome
3. Recopie le cookie `li_at`
4. Mets à jour la variable sur Railway
5. Railway redéploie automatiquement

## Coût

- Railway Starter : ~$5/mois
- Anthropic API (optionnel) : ~$2-3/mois
- **Total : $5-8/mois**
