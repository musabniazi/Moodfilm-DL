/* ============================================================
   FILE: api/ml-engine.js
   PURPOSE: Vercel Serverless Function — Pure-JS ML Features.

   ENDPOINTS HANDLED:
     ml_sentiment  → sentiment analysis → MoodFilm mood mapping
     ml_recommend  → content-based filtering via cosine similarity
     ml_cluster    → k=4 soft mood clustering by genre overlap
============================================================ */

/* ── SENTIMENT ANALYSIS DATA ──────────────────────────────── */

const SENTIMENT_WORDS = {
  positive: [
    'happy','joy','joyful','love','wonderful','amazing','great','fantastic',
    'excited','fun','laugh','cheerful','delightful','upbeat','bright','funny',
    'romantic','beautiful','sweet','adorable','charming','warm','light',
    'adventure','thrilling','epic','heroic','brave','strong','powerful',
    'curious','wonder','magic','dream','hope','inspire','uplift',
    'energetic','pumped','bold','fearless','daring','confident',
    'crush','affection','tender','longing','nostalgic',
    'chill','relaxed','cozy','lazy','mellow','calm',
    'nerdy','thoughtful','philosophical','intellectual','pensive',
  ],
  negative: [
    'sad','cry','depressed','miserable','grief','loss','sorrow','lonely',
    'dark','fear','scared','terrified','horror','nightmare','death','dead',
    'angry','rage','violent','brutal','blood','kill','murder','monster',
    'anxiety','stress','tense','suspense','danger','threat','evil','sinister',
    'melancholy','heartbreak','tragedy','despair','pain','suffer',
    'bored','dull','restless','anxious','nervous','worried','panicked',
    'alone','isolated','empty','hollow','numb','broken',
  ],
};

/* Maps each mood to weighted trigger words */
const MOOD_SIGNALS = {
  happy: {
    words: [
      'happy','joy','fun','laugh','cheerful','upbeat','comedy','light','silly','playful',
      'smile','goofy','hilarious','giddy','elated','carefree','bubbly','jolly','humor',
    ],
    weight: 1,
  },
  sad: {
    words: [
      'sad','cry','grief','loss','sorrow','lonely','melancholy','heartbreak','tragedy','tears',
      'depressed','miserable','heartbroken','broken','hopeless','despair','mourn','empty',
      'alone','isolated','abandoned','unloved','hurt','devastated','gloomy','blue',
    ],
    weight: 1,
  },
  romantic: {
    words: [
      'romantic','love','romance','passion','sweet','kiss','couple','valentine','adorable','charming',
      'crush','affection','tender','date','flirt','intimacy','longing','soulmate','butterflies','beloved',
      'infatuated','attracted','devoted','loving','heartfelt','amorous',
    ],
    weight: 1,
  },
  thriller: {
    words: [
      'suspense','tense','mystery','twist','danger','chase','spy','crime','detective','intrigue',
      'stressed','anxious','nervous','worried','paranoid','uneasy','panic','pressure','edgy',
      'conspiracy','murder','heist','thriller','gripping','taut','whodunit',
    ],
    weight: 1,
  },
  scifi: {
    words: [
      'space','future','robot','alien','technology','science','cyber','galaxy','dystopia','quantum',
      'curious','nerdy','thoughtful','philosophical','intellectual','pensive','discovery','universe',
      'artificial','intelligence','simulation','time','dimension','experiment','innovation','geek',
    ],
    weight: 1,
  },
  action: {
    words: [
      'action','adventure','fight','battle','hero','explosive','chase','stunts','war','mission',
      'excited','energetic','pumped','adrenaline','bold','fearless','daring','epic','intense',
      'rush','wild','extreme','warrior','champion','combat','thrill','powerful','unstoppable',
      'adventurous','confident','driven','motivated',
    ],
    weight: 1,
  },
  horror: {
    words: [
      'horror','scary','fear','ghost','monster','terror','nightmare','creepy','haunted','dark',
      'scared','terrified','startled','dread','eerie','sinister','unsettled','jumpy',
      'night','shadow','lurking','ominous','chilling','spine','demonic','paranormal',
    ],
    weight: 1,
  },
  animation: {
    words: [
      'cartoon','animated','animation','kids','family','cute','colorful','pixar','disney','magic',
      'bored','lazy','chill','relaxed','cozy','mellow','lighthearted','whimsical',
      'nostalgic','childhood','comfort','easy','simple',
    ],
    weight: 1,
  },
};

function analyzeSentiment(text) {
  const lower   = text.toLowerCase();
  const tokens  = lower.match(/\b[a-z]+\b/g) || [];
  const found   = { positive: [], negative: [] };

  for (const token of tokens) {
    if (SENTIMENT_WORDS.positive.includes(token) && !found.positive.includes(token))
      found.positive.push(token);
    if (SENTIMENT_WORDS.negative.includes(token) && !found.negative.includes(token))
      found.negative.push(token);
  }

  const pos = found.positive.length;
  const neg = found.negative.length;
  const total = pos + neg || 1;
  const score = (pos - neg) / total; // -1 … +1

  /* Score each mood */
  const moodScores = {};
  for (const [mood, { words }] of Object.entries(MOOD_SIGNALS)) {
    let hits = 0;
    const matched = [];
    for (const token of tokens) {
      if (words.includes(token)) { hits++; matched.push(token); }
    }
    moodScores[mood] = { score: hits, matched };
  }

  /* Apply sentiment bias: positive score boosts happy/romantic/animation/action;
     negative score boosts sad/horror/thriller */
  const BIAS = {
    happy: 0.4, romantic: 0.3, animation: 0.3, action: 0.1,
    sad: -0.3, horror: -0.35, thriller: -0.2, scifi: 0,
  };
  for (const mood of Object.keys(moodScores)) {
    moodScores[mood].score += (score * (BIAS[mood] ?? 0)) * 2;
  }

  const sorted = Object.entries(moodScores).sort((a, b) => b[1].score - a[1].score);
  const [topMood, topData] = sorted[0];

  /* Confidence: ratio of top score to sum of all scores, scaled to 0-100 */
  const totalScore = sorted.reduce((s, [, d]) => s + Math.max(0, d.score), 0) || 1;
  const rawConf = Math.min(1, Math.max(0.1, Math.max(0, topData.score) / totalScore));
  /* Boost confidence when we have strong keyword hits */
  const hitBoost = Math.min(0.25, topData.matched.length * 0.05);
  const confidence = Math.round(Math.min(99, Math.max(10, (rawConf + hitBoost) * 100)));

  const keywords_found = [...new Set([...found.positive, ...found.negative, ...topData.matched])];

  const sentimentLabel = score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral';
  const explanation =
    `Detected ${sentimentLabel} sentiment (${pos} positive / ${neg} negative signal words). ` +
    `Best mood match: "${topMood}" based on keywords: ${topData.matched.join(', ') || 'general tone'}.`;

  return { mood: topMood, confidence, keywords_found, explanation };
}

/* ── CONTENT-BASED FILTERING ─────────────────────────────── */

/* TMDb genre IDs used as the feature vector dimensions */
const GENRE_IDS = [28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37];

/* Mood → genre ID mapping (mirrors front-end MOOD_GENRES) */
const MOOD_GENRE_MAP = {
  happy:     [35, 10751, 16],
  sad:       [18, 10749],
  romantic:  [10749, 18, 35],
  thriller:  [53, 9648, 80],
  scifi:     [878, 12, 28],
  action:    [28, 12, 53],
  horror:    [27, 53],
  animation: [16, 10751, 35],
};

function genreVector(genreIds) {
  return GENRE_IDS.map(g => (genreIds || []).includes(g) ? 1 : 0);
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/* Candidate pool: representative genre combos for scoring.
   In production you'd pass real candidates; here we build a
   synthetic pool from the mood→genre map so the endpoint is
   self-contained and testable without a TMDb call. */
function buildCandidates(genres, rating, year) {
  const candidates = [];
  for (const [mood, gids] of Object.entries(MOOD_GENRE_MAP)) {
    candidates.push({
      id:     `synthetic_${mood}`,
      mood,
      genres: gids,
      rating: rating ?? 7,
      year:   year   ?? 2020,
    });
  }
  return candidates;
}

function recommendMovies({ genres = [], rating, year, liked_ids = [] }) {
  const queryVec = genreVector(genres);
  const candidates = buildCandidates(genres, rating, year);

  const scored = candidates
    .filter(c => !liked_ids.includes(c.id))
    .map(c => {
      const sim       = cosineSimilarity(queryVec, genreVector(c.genres));
      const ratingBon = rating ? 1 - Math.abs((c.rating - rating) / 10) : 1;
      const yearBon   = year   ? 1 - Math.abs((c.year   - year)   / 50) : 1;
      const match_score = Math.round(sim * 0.6 * 100 + ratingBon * 0.2 * 100 + yearBon * 0.2 * 100);
      return { ...c, match_score: Math.min(100, Math.max(0, match_score)) };
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 8);

  return { recommendations: scored };
}

/* ── MOOD CLUSTERING ─────────────────────────────────────── */

/* k=4 soft clusters defined by representative genre sets */
const CLUSTERS = [
  { label: 'uplifting',  genres: [35, 10751, 16, 10749] },
  { label: 'dark',       genres: [27, 53, 9648, 80, 18] },
  { label: 'adventure',  genres: [28, 12, 878, 10752, 37] },
  { label: 'thoughtful', genres: [18, 36, 99, 10770, 14] },
];

function clusterMovies(movies) {
  if (!Array.isArray(movies) || !movies.length) return { movies: [] };

  const clusterVecs = CLUSTERS.map(c => genreVector(c.genres));

  const tagged = movies.map(movie => {
    const movieGenreIds = (movie.genre_ids || (movie.genres || []).map(g => g.id) || []);
    const movieVec = genreVector(movieGenreIds);

    /* Soft scores for each cluster */
    const scores = clusterVecs.map((cv, i) => ({
      label: CLUSTERS[i].label,
      score: cosineSimilarity(movieVec, cv),
    }));
    scores.sort((a, b) => b.score - a.score);

    return {
      ...movie,
      cluster_label:  scores[0].label,
      cluster_scores: scores.map(s => ({ label: s.label, score: +s.score.toFixed(3) })),
    };
  });

  /* Group summary */
  const groups = {};
  for (const m of tagged) {
    groups[m.cluster_label] = (groups[m.cluster_label] || 0) + 1;
  }

  return { movies: tagged, cluster_summary: groups };
}

/* ── HANDLER ─────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, payload = {} } = req.body;

    if (type === 'ml_sentiment') {
      const { text } = payload;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'payload.text (string) is required' });
      }
      return res.status(200).json(analyzeSentiment(text));
    }

    if (type === 'ml_recommend') {
      return res.status(200).json(recommendMovies(payload));
    }

    if (type === 'ml_cluster') {
      const { movies } = payload;
      if (!Array.isArray(movies)) {
        return res.status(400).json({ error: 'payload.movies (array) is required' });
      }
      return res.status(200).json(clusterMovies(movies));
    }

    return res.status(400).json({ error: 'Unknown request type. Use ml_sentiment, ml_recommend, or ml_cluster.' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
