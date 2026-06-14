/* ============================================================
   FILE: api/gemini.js
   PURPOSE: Vercel Serverless Function — TMDb Only Version.
   Handles all TMDb API requests from the browser.
   The TMDb key is hidden here on the server.
   No Gemini API needed anymore.

   ENDPOINTS HANDLED:
     tmdb_mood      → movies by genre/mood (with pagination)
     tmdb_search    → search movies by text query
     tmdb_detail    → full movie details by TMDb id
     tmdb_trending  → trending movies this week
     tmdb_more      → load more movies (next page)
     tmdb_similar   → similar movies to a given movie
============================================================ */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TMDB_KEY = process.env.TMDB_API_KEY;

  if (!TMDB_KEY) {
    return res.status(500).json({ error: 'TMDb API key not configured on server' });
  }

  const BASE = 'https://api.themoviedb.org/3';

  /* Helper — fetch from TMDb */
  const tmdb = async (path) => {
    const sep = path.includes('?') ? '&' : '?';
    const r   = await fetch(`${BASE}${path}${sep}api_key=${TMDB_KEY}&language=en-US`);
    return r.json();
  };

  try {
    const { type, payload } = req.body;

    /* ── MOOD MOVIES ──────────────────────────────────────────
       Fetches movies by genre ID from TMDb discover endpoint.
       Each mood maps to one or more TMDb genre IDs.
       Returns 18 movies per request (3 pages merged).
    ── */
    if (type === 'tmdb_mood') {
      const { genreIds, page = 1, sortBy = 'popularity.desc' } = payload;
      const genres = genreIds.join(',');

      /* Fetch 3 pages in parallel for more results */
      const pages = await Promise.all([
        tmdb(`/discover/movie?with_genres=${genres}&sort_by=${sortBy}&page=${page}&vote_count.gte=50`),
        tmdb(`/discover/movie?with_genres=${genres}&sort_by=${sortBy}&page=${page + 1}&vote_count.gte=50`),
        tmdb(`/discover/movie?with_genres=${genres}&sort_by=${sortBy}&page=${page + 2}&vote_count.gte=50`),
      ]);

      /* Merge all results and remove duplicates */
      const seen = new Set();
      const results = [];
      for (const p of pages) {
        for (const m of (p.results || [])) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            results.push(m);
          }
        }
      }

      return res.status(200).json({ results, total_pages: pages[0].total_pages || 1 });
    }

    /* ── SEARCH MOVIES ────────────────────────────────────────
       Searches TMDb by text query.
       Returns multiple pages merged for more results.
    ── */
    if (type === 'tmdb_search') {
      const { query, page = 1 } = payload;

      /* Detect mood keywords and redirect to genre-based discovery */
      const MOOD_KEYWORDS = {
        happy:     { keywords: ['happy','funny','comedy','cheerful'],      genres: [35, 10751, 16] },
        sad:       { keywords: ['sad','emotional','cry','moving'],          genres: [18] },
        romantic:  { keywords: ['romantic','love','romance'],               genres: [10749, 18] },
        scary:     { keywords: ['scary','horror','terrifying'],             genres: [27, 53] },
        action:    { keywords: ['action','fight','adventure'],              genres: [28, 12] },
        scifi:     { keywords: ['scifi','space','future','robot'],          genres: [878, 14] },
        thriller:  { keywords: ['thriller','suspense','mystery'],           genres: [53, 9648] },
        animation: { keywords: ['animation','cartoon','animated'],          genres: [16, 10751] },
      };

      const lowerQuery = query.toLowerCase();
      for (const { keywords, genres } of Object.values(MOOD_KEYWORDS)) {
        if (keywords.some(k => lowerQuery.includes(k))) {
          const genreStr = genres.join(',');
          const pages = await Promise.all([
            tmdb(`/discover/movie?with_genres=${genreStr}&sort_by=popularity.desc&page=${page}&vote_count.gte=50`),
            tmdb(`/discover/movie?with_genres=${genreStr}&sort_by=popularity.desc&page=${page + 1}&vote_count.gte=50`),
            tmdb(`/discover/movie?with_genres=${genreStr}&sort_by=popularity.desc&page=${page + 2}&vote_count.gte=50`),
          ]);
          const seen = new Set();
          const results = [];
          for (const p of pages) {
            for (const m of (p.results || [])) {
              if (!seen.has(m.id) && m.poster_path) { seen.add(m.id); results.push(m); }
            }
          }
          return res.status(200).json({ results, total_pages: pages[0].total_pages || 1 });
        }
      }

      const q = encodeURIComponent(query);

      /* Fetch 3 pages of search results in parallel */
      const pages = await Promise.all([
        tmdb(`/search/movie?query=${q}&page=${page}&include_adult=false`),
        tmdb(`/search/movie?query=${q}&page=${page + 1}&include_adult=false`),
        tmdb(`/search/movie?query=${q}&page=${page + 2}&include_adult=false`),
      ]);

      const seen = new Set();
      const results = [];
      for (const p of pages) {
        for (const m of (p.results || [])) {
          if (!seen.has(m.id) && m.poster_path) {
            seen.add(m.id);
            results.push(m);
          }
        }
      }

      return res.status(200).json({ results, total_pages: pages[0].total_pages || 1 });
    }

    /* ── MOVIE DETAIL ─────────────────────────────────────────
       Full movie details including genres, runtime, etc.
    ── */
    if (type === 'tmdb_detail') {
      const { id } = payload;
      const data = await tmdb(`/movie/${id}?append_to_response=credits`);
      return res.status(200).json(data);
    }

    /* ── TRENDING ─────────────────────────────────────────────
       This week's trending movies — 2 pages merged.
    ── */
    if (type === 'tmdb_trending') {
      const [p1, p2] = await Promise.all([
        fetch(`${BASE}/trending/movie/week?api_key=${TMDB_KEY}&language=en-US&page=1`).then(r => r.json()),
        fetch(`${BASE}/trending/movie/week?api_key=${TMDB_KEY}&language=en-US&page=2`).then(r => r.json()),
      ]);

      const seen = new Set();
      const results = [];
      for (const m of [...(p1.results || []), ...(p2.results || [])]) {
        if (!seen.has(m.id)) { seen.add(m.id); results.push(m); }
      }

      return res.status(200).json({ results });
    }

    /* ── SIMILAR MOVIES ───────────────────────────────────────
       Movies similar to a given movie — used in modal.
    ── */
    if (type === 'tmdb_similar') {
      const { id } = payload;
      const data = await tmdb(`/movie/${id}/similar?page=1`);
      return res.status(200).json(data);
    }

    /* ── TOP RATED BY GENRE ───────────────────────────────────
       Top rated movies for a genre — used for variety.
    ── */
    if (type === 'tmdb_top') {
      const { genreIds, page = 1 } = payload;
      const genres = genreIds.join(',');
      const data   = await tmdb(`/discover/movie?with_genres=${genres}&sort_by=vote_average.desc&page=${page}&vote_count.gte=200`);
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Unknown request type' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
