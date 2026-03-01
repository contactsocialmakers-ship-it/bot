const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

class ReplyGenerator {
  constructor() {
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.taskertimeUrl = process.env.TASKERTIME_URL || 'https://taskertime.app';
    this.useAI = !!this.anthropicKey;
    logger.info(`Reply generator: ${this.useAI ? 'AI mode (Anthropic)' : 'Template mode'}`);
  }

  async generate(postText, authorName, category) {
    if (this.useAI) {
      try {
        return await this._generateAI(postText, authorName, category);
      } catch (err) {
        logger.error(`AI generation failed, falling back to template: ${err.message}`);
        return this._generateTemplate(category);
      }
    }
    return this._generateTemplate(category);
  }

  async _generateAI(postText, authorName, category) {
    const systemPrompt = `Tu es un freelance français expérimenté qui utilise TaskerTime au quotidien.
Tu réponds à un post LinkedIn de manière 100% naturelle et authentique.

RÈGLES ABSOLUES :
- Tu parles comme un VRAI humain sur LinkedIn, pas un bot, pas une pub
- Tu apportes d'abord de la VALEUR (conseil, expérience, empathie) PUIS tu mentionnes TaskerTime
- Tu mentionnes TaskerTime UNE SEULE FOIS, naturellement, comme un conseil entre collègues
- Tu inclus le lien ${this.taskertimeUrl} une seule fois, intégré dans le texte
- Tu ne commences JAMAIS par "En tant que freelance" ou "Super post"
- Tu varies tes accroches — parfois tu rebondis sur un point précis du post
- Longueur : 3-5 phrases max (les commentaires LinkedIn longs ne sont pas lus)
- Si l'auteur a un prénom, tu peux l'interpeller naturellement
- Pas de hashtags, pas d'emojis excessifs (1 max), pas de "🚀" ou "💡"
- Ton décontracté mais pro (c'est LinkedIn, pas Twitter)

CATÉGORIE DU POST : ${category}
${category === 'competitive' ? "L'auteur compare des outils → positionne TaskerTime comme l'alternative que TU utilises" : ''}
${category === 'seeking_tool' ? "L'auteur cherche un outil → recommande TaskerTime directement avec ton expérience" : ''}
${category === 'pain_point' ? "L'auteur galère → montre de l'empathie, partage que tu avais le même problème, puis mentionne TaskerTime comme solution" : ''}
${category === 'becoming_freelance' ? "L'auteur se lance → donne un vrai conseil utile sur la facturation, puis mentionne TaskerTime" : ''}`;

    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Post LinkedIn de ${authorName || 'un freelance'} :\n"${postText.substring(0, 1000)}"\n\nRéponds à ce post.`,
          },
        ],
      },
      {
        headers: {
          'x-api-key': this.anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const reply = res.data.content[0].text;
    logger.info(`AI reply generated (${reply.length} chars)`);
    return reply;
  }

  _generateTemplate(category) {
    const templates = config.replyTemplates[category] || config.replyTemplates.generic;
    const template = templates[Math.floor(Math.random() * templates.length)];
    return template.replace('{url}', this.taskertimeUrl);
  }
}

module.exports = ReplyGenerator;
