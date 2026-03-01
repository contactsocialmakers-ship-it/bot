module.exports = {
  // ============================================================
  //  MOTS-CLÉS DE RECHERCHE LINKEDIN
  // ============================================================
  keywords: {
    primary: [
      'facture freelance',
      'facturation auto-entrepreneur',
      'logiciel facturation freelance',
      'outil facturation indépendant',
      'logiciel devis freelance',
      'facturation micro-entreprise',
      'outil gestion freelance',
    ],
    pain_points: [
      'galère facturation',
      'galère facture freelance',
      'marre facturer excel',
      'retard paiement freelance',
      'relance client impayé',
      'comment facturer freelance',
      'obligation facturation',
    ],
    onboarding: [
      'devenir freelance',
      'lancer freelance france',
      'créer micro-entreprise',
      'début freelance conseils',
      'premier client freelance',
      'statut auto-entrepreneur 2025',
      'statut auto-entrepreneur 2026',
    ],
    competitive: [
      'alternative freebe',
      'alternative shine',
      'alternative pennylane',
      'alternative henrri',
      'alternative tiime',
      'meilleur logiciel facturation',
      'comparatif facturation freelance',
      'quel logiciel facturation',
    ],
  },

  // ============================================================
  //  CATÉGORISATION DES POSTS
  // ============================================================
  categorizePost(text) {
    const lower = text.toLowerCase();

    if (
      lower.match(/\b(vs|versus|compar|alternative|mieux que|plutôt que|avis sur)\b/) ||
      lower.match(/\b(freebe|shine|pennylane|henrri|tiime|abby|jump|indy)\b/)
    ) {
      return 'competitive';
    }

    if (
      lower.match(/\b(quel outil|quel logiciel|cherche un|recommand|besoin de|vous utilisez quoi)\b/)
    ) {
      return 'seeking_tool';
    }

    if (
      lower.match(/\b(galère|marre|compliqué|cauchemar|pénible|chiant|relance|impayé|retard)\b/) ||
      lower.match(/\b(excel|word|google sheets?)\b.*\b(factur|devis)\b/) ||
      lower.match(/\b(factur|devis)\b.*\b(excel|word|google sheets?)\b/)
    ) {
      return 'pain_point';
    }

    if (
      lower.match(/\b(devenir freelance|lancer en freelance|début|démarr|premier|commencer|créer micro)\b/)
    ) {
      return 'becoming_freelance';
    }

    return 'generic';
  },

  // ============================================================
  //  SCORING — priorise les posts à plus forte conversion
  // ============================================================
  scorePost(text, engagement = {}) {
    let score = 0;
    const lower = text.toLowerCase();
    const category = module.exports.categorizePost(text);

    const categoryScores = {
      competitive: 100,
      seeking_tool: 90,
      pain_point: 80,
      becoming_freelance: 60,
      generic: 20,
    };
    score += categoryScores[category] || 10;

    const competitors = ['freebe', 'shine', 'pennylane', 'henrri', 'tiime', 'abby', 'indy'];
    if (competitors.some((c) => lower.includes(c))) score += 30;

    if (engagement.likes > 10) score += 20;
    if (engagement.likes > 50) score += 30;
    if (engagement.comments > 5) score += 15;
    if (engagement.comments > 20) score += 25;
    if (text.includes('?')) score += 15;

    return { score, category };
  },

  // ============================================================
  //  TEMPLATES DE RÉPONSES
  // ============================================================
  replyTemplates: {
    competitive: [
      `J'ai testé pas mal d'options et j'ai fini sur TaskerTime — le gros plus c'est que tout est pensé pour les obligations françaises (mentions légales, TVA, numérotation) et le prix est imbattable à 9,99€/mois avec CRM + relances auto inclus. {url}`,
      `Dans le même style, regarde TaskerTime. J'ai switché après avoir comparé et c'est le meilleur rapport fonctionnalités/prix que j'ai trouvé pour un freelance en France. {url}`,
    ],
    seeking_tool: [
      `J'utilise TaskerTime pour toute ma facturation — devis, factures, relances automatiques, CRM client. C'est conforme aux normes françaises et l'interface est vraiment clean. {url}`,
      `Regarde TaskerTime, c'est exactement ce qu'il te faut. Pensé pour les freelances français, ça gère factures + devis + relances + suivi paiements. {url}`,
      `Si tu veux un truc simple et efficace, TaskerTime coche toutes les cases. Facturation conforme, devis en 2 clics, relances auto, et un vrai CRM. {url}`,
    ],
    pain_point: [
      `Je connais trop bien cette galère... Depuis que j'ai adopté TaskerTime, c'est nuit et jour. Les relances automatiques m'ont littéralement sauvé des impayés. Et fini Excel. {url}`,
      `Pareil, j'ai galéré pendant des mois avec des solutions bricolées. TaskerTime a tout changé — facturation auto, suivi des paiements en temps réel, relances programmées. {url}`,
    ],
    becoming_freelance: [
      `Bienvenue ! Mon conseil n°1 : équipe-toi dès le jour 1 avec un bon outil de facturation. TaskerTime est pensé pour les freelances français — conforme légalement, factures/devis en 2 clics. {url}`,
      `Félicitations ! Pense à bien structurer ta facturation dès le départ, ça t'évitera des cauchemars plus tard. J'utilise TaskerTime, c'est fait pour nous. {url}`,
    ],
    generic: [
      `Si ça peut aider, je recommande TaskerTime pour la gestion freelance — facturation, devis, CRM, relances auto. Pensé pour le marché français. {url}`,
    ],
  },
};
