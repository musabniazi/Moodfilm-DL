/* ============================================================
   FILE: script.js — MoodFilm Pro (TMDb Only Version)
   No Gemini API. No quota limits. No rate limiting.
   Everything comes from TMDb — real data, real posters,
   real ratings, unlimited movies, instant search.
============================================================ */

const TMDB_IMG    = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMG_LG = 'https://image.tmdb.org/t/p/w1280';

/* ── MOOD → TMDb GENRE IDs ──────────────────────────────────
   TMDb genre IDs:
   28=Action, 12=Adventure, 16=Animation, 35=Comedy,
   80=Crime, 99=Documentary, 18=Drama, 10751=Family,
   14=Fantasy, 36=History, 27=Horror, 10402=Music,
   9648=Mystery, 10749=Romance, 878=Sci-Fi,
   10770=TV Movie, 53=Thriller, 10752=War, 37=Western
*/
const MOODS = [
  { id:'happy',     label:'Happy',     emoji:'😄', color:'#F59E0B', desc:'Feel-good & uplifting',  genres:[35,10751,16],    sort:'popularity.desc' },
  { id:'sad',       label:'Sad',       emoji:'😢', color:'#6366F1', desc:'Emotional & moving',     genres:[18],             sort:'vote_average.desc' },
  { id:'romantic',  label:'Romantic',  emoji:'❤️', color:'#EC4899', desc:'Love & passion',         genres:[10749,18],       sort:'popularity.desc' },
  { id:'thriller',  label:'Thriller',  emoji:'🔍', color:'#0EA5E9', desc:'Mystery & suspense',     genres:[53,9648,80],     sort:'popularity.desc' },
  { id:'scifi',     label:'Sci-Fi',    emoji:'🤖', color:'#10B981', desc:'Sci-fi & innovation',    genres:[878,14,12],      sort:'popularity.desc' },
  { id:'action',    label:'Action',    emoji:'⚔️', color:'#EF4444', desc:'Intense & adrenaline',   genres:[28,12],          sort:'popularity.desc' },
  { id:'horror',    label:'Horror',    emoji:'👻', color:'#7C3AED', desc:'Scary & suspenseful',    genres:[27,53],          sort:'popularity.desc' },
  { id:'animation', label:'Animation', emoji:'🎨', color:'#F97316', desc:'Fun for all ages',       genres:[16,10751,35],    sort:'popularity.desc' },
];

const CONFETTI_COLORS = ['#e50914','#f5c518','#3b82f6','#10b981','#f97316','#ec4899','#8b5cf6'];

let state = {
  selectedMood:  null,   /* current mood id */
  currentPage:   1,      /* current TMDb page for load more */
  searchQuery:   '',     /* current search text */
  searchPage:    1,      /* current search page for load more */
  currentMovie:  null,   /* movie shown in modal */
  favorites:     [],     /* saved movies */
  lastAction:    null,   /* for retry button */
  mode:          null,   /* 'mood' or 'search' */
  detectedMood:  null,   /* last ML-detected mood from search */
};


/* ── CALL BACKEND ───────────────────────────────────────────
   All requests go to /api/gemini on the Vercel server.
   The server holds the TMDb key — browser never sees it.
*/
async function api(type, payload = {}) {
  const res = await fetch('/api/gemini', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type, payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

async function mlApi(type, payload = {}) {
  const res = await fetch('/api/ml', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type, payload }),
  });
  return res.json();
}

function showMlBadge(mood, confidence) {
  const badge = document.getElementById('ml-mood-badge');
  if (!badge) return;
  const moodData = MOODS.find(m => m.id === mood);
  const emoji    = moodData?.emoji ?? '🧠';
  const pct      = Math.round(confidence * 100);
  badge.innerHTML =
    `🧠 AI detected mood: <span class="badge-label">${emoji} ${mood}</span>` +
    `<span class="badge-conf">(${pct}% match)</span>`;
  badge.style.display = 'flex';
  /* clicking the badge selects that mood */
  badge.onclick = () => selectMood(mood);
}

function hideMlBadge() {
  const badge = document.getElementById('ml-mood-badge');
  if (badge) badge.style.display = 'none';
}


/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadFavorites();
  renderMoodCards();
  renderHeroParticles();
  setupSearch();
  loadTrending();
  window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 60);
  });
});


/* ══════════════════════════════════════════════════════════
   NAVBAR
══════════════════════════════════════════════════════════ */
function toggleMobileMenu() {
  document.getElementById('nav-links')?.classList.toggle('open');
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}


/* ══════════════════════════════════════════════════════════
   HERO PARTICLES
══════════════════════════════════════════════════════════ */
function renderHeroParticles() {
  const c = document.getElementById('hero-particles');
  if (!c) return;
  for (let i = 0; i < 22; i++) {
    const d = document.createElement('div');
    d.className = 'hero-particle';
    d.style.cssText = `
      width:${3+Math.random()*7}px; height:${3+Math.random()*7}px;
      left:${Math.random()*100}%; top:${Math.random()*100}%;
      opacity:${(.15+Math.random()*.5).toFixed(2)};
      animation-duration:${(5+Math.random()*10).toFixed(2)}s;
      animation-delay:${(Math.random()*8).toFixed(2)}s;
    `;
    c.appendChild(d);
  }
}


/* ══════════════════════════════════════════════════════════
   MOOD CARDS
══════════════════════════════════════════════════════════ */
function renderMoodCards() {
  const grid = document.getElementById('mood-grid');
  if (!grid) return;
  MOODS.forEach(mood => {
    const card = document.createElement('div');
    card.className = 'mood-card';
    card.id = `mood-${mood.id}`;
    card.style.setProperty('--mood-color', mood.color);
    card.innerHTML = `
      <div class="mood-card-emoji">${mood.emoji}</div>
      <div class="mood-card-label">${mood.label}</div>
      <div class="mood-card-desc">${mood.desc}</div>
      <div class="mood-dot"></div>
    `;
    card.addEventListener('click', () => pickMood(mood.id));
    grid.appendChild(card);
  });
}

function pickMood(moodId) {
  state.selectedMood = moodId;
  state.currentPage  = 1;
  state.searchQuery  = '';
  state.mode         = 'mood';

  const mood = MOODS.find(m => m.id === moodId);

  document.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`mood-${moodId}`)?.classList.add('active');
  document.getElementById('results-title').textContent    = `${mood.emoji} ${mood.label} Movies`;
  document.getElementById('results-subtitle').textContent = mood.desc;
  document.getElementById('search-input').value = '';

  state.lastAction = () => pickMood(moodId);
  showResults();
  fetchMoodMovies(mood, 1, false);
  setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior:'smooth', block:'start' }), 120);
}


/* ══════════════════════════════════════════════════════════
   FETCH MOOD MOVIES FROM TMDb
══════════════════════════════════════════════════════════ */
async function fetchMoodMovies(mood, page, append) {
  if (!append) { showLoading(true); clearGrid(); }
  try {
    /* Get popular movies for this mood's genres */
    const popularData = await api('tmdb_mood', {
      genreIds: mood.genres,
      page,
      sortBy: mood.sort,
    });

    /* Also get top rated for variety (different sort) */
    const topData = await api('tmdb_top', {
      genreIds: mood.genres,
      page,
    });

    /* Merge both lists, remove duplicates */
    const seen = new Set();
    const combined = [];
    for (const m of [...(popularData.results || []), ...(topData.results || [])]) {
      if (!seen.has(m.id) && m.poster_path) {
        seen.add(m.id);
        combined.push(m);
      }
    }

    /* Shuffle for variety */
    combined.sort(() => Math.random() - 0.5);

    showLoading(false);
    const cards = combined.map(formatTMDbMovie);

    if (append) {
      appendGrid(cards, 'movies-grid');
      showToast(`✅ ${cards.length} more movies loaded!`, 'success');
    } else {
      renderGrid(cards, 'movies-grid');
      triggerConfetti();
    }

    state.currentPage = page;

  } catch (err) {
    console.error('fetchMoodMovies error:', err);
    showLoading(false);
    showError('Could not load movies. Please try again.');
  }
}


/* ══════════════════════════════════════════════════════════
   LOAD MORE
══════════════════════════════════════════════════════════ */
async function loadMoreMovies() {
  if (state.mode === 'mood' && state.selectedMood) {
    const mood = MOODS.find(m => m.id === state.selectedMood);
    fetchMoodMovies(mood, state.currentPage + 4, true);

  } else if (state.mode === 'search' && state.searchQuery) {
    fetchSearchMovies(state.searchQuery, state.searchPage + 3, true);

  } else {
    showToast('Pick a mood or search first!', 'info');
  }
}


/* ══════════════════════════════════════════════════════════
   TRENDING
══════════════════════════════════════════════════════════ */
async function loadTrending() {
  const loading = document.getElementById('trending-loading');
  try {
    const data    = await api('tmdb_trending');
    const results = data.results || [];
    if (loading) loading.style.display = 'none';
    const cards = results.map(formatTMDbMovie);
    renderGrid(cards, 'trending-grid');
  } catch (err) {
    console.error('Trending error:', err);
    if (loading) loading.textContent = '⚠️ Could not load trending movies.';
  }
}


/* ══════════════════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════════════════ */
function setupSearch() {
  const input = document.getElementById('search-input');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });
}

async function handleSearch() {
  const input = document.getElementById('search-input');
  const query = input?.value?.trim();
  if (!query) { showToast('Type a movie name to search!', 'info'); return; }

  state.searchQuery  = query;
  state.selectedMood = null;
  state.detectedMood = null;
  state.searchPage   = 1;
  state.mode         = 'search';

  document.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
  hideMlBadge();
  document.getElementById('results-title').textContent    = `🔍 "${query}"`;
  document.getElementById('results-subtitle').textContent = 'Search results from TMDb';

  state.lastAction = () => handleSearch();
  showResults();
  clearGrid();
  showLoading(true);

  setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior:'smooth', block:'start' }), 120);

  /* Run sentiment analysis and TMDb search in parallel */
  const [, mlResult] = await Promise.allSettled([
    fetchSearchMovies(query, 1, false),
    mlApi('ml_sentiment', { text: query }),
  ]);

  if (mlResult.status === 'fulfilled') {
    const { mood, confidence } = mlResult.value ?? {};
    if (mood && confidence > 0.6) {
      state.detectedMood = mood;
      showMlBadge(mood, confidence);
      /* Auto-select the mood card without triggering a new fetch */
      document.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
      document.getElementById(`mood-${mood}`)?.classList.add('active');
    }
  }
}

async function fetchSearchMovies(query, page, append) {
  try {
    const data    = await api('tmdb_search', { query, page });
    const results = (data.results || []).filter(m => m.poster_path);

    showLoading(false);
    const cards = results.map(formatTMDbMovie);

    if (append) {
      appendGrid(cards, 'movies-grid');
      showToast(`✅ ${cards.length} more results!`, 'success');
    } else {
      renderGrid(cards, 'movies-grid');
      if (cards.length > 0) {
        triggerConfetti();
        showToast(`Found ${cards.length} movies for "${query}"!`, 'success');
      }
    }

    state.searchPage = page;

  } catch (err) {
    console.error('Search error:', err);
    showLoading(false);
    showError('Search failed. Please try again.');
  }
}

function clearResults() {
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('search-input').value = '';
  state.searchQuery  = '';
  state.selectedMood = null;
  state.detectedMood = null;
  state.mode         = null;
  hideMlBadge();
  document.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
}

function retryLastAction() {
  document.getElementById('error-state').style.display = 'none';
  if (state.lastAction) state.lastAction();
}


/* ══════════════════════════════════════════════════════════
   FORMAT TMDb MOVIE OBJECT
   Converts raw TMDb API response into our app's format.
══════════════════════════════════════════════════════════ */
function computeMatchScore(m) {
  const moodId    = state.detectedMood || state.selectedMood;
  const moodData  = MOODS.find(md => md.id === moodId);
  const movieGenres = m.genre_ids || [];

  let score = 0;
  if (moodData?.genres?.length) {
    const overlap = movieGenres.filter(g => moodData.genres.includes(g)).length;
    score = Math.round((overlap / moodData.genres.length) * 100);
  }
  if ((m.vote_average ?? 0) > 7.5) score += 10;
  if ((m.vote_count  ?? 0) > 500)  score += 5;
  return Math.min(100, score);
}

function formatTMDbMovie(m) {
  return {
    id:         m.id,
    title:      m.title || m.original_title || 'Unknown',
    year:       m.release_date?.slice(0,4) || '',
    poster:     m.poster_path   ? TMDB_IMG    + m.poster_path   : null,
    backdrop:   m.backdrop_path ? TMDB_IMG_LG + m.backdrop_path : null,
    rating:     m.vote_average  ? m.vote_average.toFixed(1)     : null,
    plot:       m.overview || '',
    genres:     '',   /* filled by detail call in modal */
    tmdbId:     m.id,
    isAI:       false,
    matchScore: computeMatchScore(m),
  };
}


/* ══════════════════════════════════════════════════════════
   MOVIE CARD RENDERING
══════════════════════════════════════════════════════════ */
function renderGrid(movies, gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  if (!movies?.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎬</div>
        <h3>No movies found</h3>
        <p>Try a different mood or search term</p>
      </div>`;
    return;
  }
  movies.forEach((m, i) => grid.appendChild(buildCard(m, i)));
}

function appendGrid(movies, gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.querySelector('.empty-state')?.remove();
  movies.forEach((m, i) => grid.appendChild(buildCard(m, i)));
}

function buildMatchBadge(score) {
  /* Only show when there is an active mood context */
  if (score == null || (!state.selectedMood && !state.detectedMood)) return '';
  const s = Math.max(0, Math.min(100, score));
  let color, label;
  if (s >= 80) { color = '#22c55e'; label = '🎯 Perfect Match'; }
  else if (s >= 60) { color = '#f59e0b'; label = '👍 Good Match'; }
  else              { color = '#6b7280'; label = '🔍 Explore'; }
  return `
    <div class="ml-score-bar" title="ML match score: ${s}%">
      <div class="ml-score-fill" style="width:${s}%;background:${color};"></div>
      <div class="ml-score-meta">
        <span class="ml-score-label">${label}</span>
        <span class="ml-label">ML</span>
      </div>
    </div>`;
}

function buildCard(movie, index) {
  const card     = document.createElement('div');
  card.className = 'movie-card';
  card.style.animationDelay = `${index * 0.05}s`;

  const isFav   = state.favorites.some(f => f.id === movie.id);
  const favIcon = isFav ? '❤️' : '🤍';

  const posterHTML = movie.poster
    ? `<img src="${movie.poster}" alt="${esc(movie.title)}" loading="lazy"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
       <div class="poster-fallback" style="display:none;"><div class="poster-fallback-icon">🎬</div><span>${esc(movie.title)}</span></div>`
    : `<div class="poster-fallback"><div class="poster-fallback-icon">🎬</div><span>${esc(movie.title)}</span></div>`;

  card.innerHTML = `
    <div class="movie-poster">
      ${posterHTML}
      <div class="poster-overlay">
        <div class="quick-btns">
          <button class="qbtn" title="Details" onclick="openModalBtn(event)">👁</button>
          <button class="qbtn" title="${isFav?'Remove':'Save'}" onclick="toggleFav(event,${movie.id})">${favIcon}</button>
        </div>
      </div>
      <div class="fav-badge" onclick="toggleFav(event,${movie.id})">${favIcon}</div>
    </div>
    <div class="movie-info">
      <div class="movie-title">${esc(movie.title)}</div>
      <div class="movie-meta">
        <span class="movie-year">${movie.year||'—'}</span>
        ${movie.rating ? `<div class="movie-rating">⭐ ${movie.rating}</div>` : ''}
      </div>
      ${buildMatchBadge(movie.matchScore)}
    </div>
  `;

  card.addEventListener('click', e => {
    if (!e.target.closest('.qbtn') && !e.target.closest('.fav-badge')) openModal(movie);
  });
  card._data = movie;
  return card;
}

function openModalBtn(e) {
  e.stopPropagation();
  const card = e.target.closest('.movie-card');
  if (card?._data) openModal(card._data);
}


/* ══════════════════════════════════════════════════════════
   MODAL — Full movie details from TMDb
══════════════════════════════════════════════════════════ */
async function openModal(movie) {
  state.currentMovie = movie;
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const isFav   = state.favorites.some(f => f.id === movie.id);

  /* Show basic info immediately while fetching details */
  content.innerHTML = `
    ${movie.backdrop ? `<div class="modal-hero"><img src="${movie.backdrop}" alt="${esc(movie.title)}" loading="lazy" /><div class="modal-hero-overlay"></div></div>` : ''}
    <div class="modal-body">
      <h2 class="modal-title">${esc(movie.title)}</h2>
      <div class="modal-badges">
        ${movie.year   ? `<span class="mbadge mbadge-year">${movie.year}</span>` : ''}
        ${movie.rating ? `<span class="mbadge mbadge-rating">⭐ ${movie.rating}</span>` : ''}
      </div>
      ${movie.plot ? `<div class="modal-plot"><label>Plot</label>${movie.plot}</div>` : ''}
      <div id="modal-details">
        <div class="loading-text"><span class="spinner-sm"></span> Loading details…</div>
      </div>
      <div class="modal-actions" style="margin-top:20px;">
        <button class="btn-primary" id="fav-modal-btn" onclick="toggleFavModal()">
          ${isFav ? '❤️ Remove Favorite' : '🤍 Save to Favorites'}
        </button>
        <button class="btn-secondary" onclick="closeModalBtn()">Close</button>
      </div>
    </div>
  `;

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  /* Fetch full details in background */
  try {
    const detail = await api('tmdb_detail', { id: movie.id });
    const genres = detail.genres?.map(g => g.name).join(', ') || '';
    const director = detail.credits?.crew?.find(p => p.job === 'Director')?.name || '';
    const cast = detail.credits?.cast?.slice(0,3).map(p => p.name).join(', ') || '';
    const runtime = detail.runtime ? `${detail.runtime} min` : '';
    const tagline = detail.tagline || '';

    const detailSection = document.getElementById('modal-details');
    if (!detailSection) return;

    /* Build badges with full info */
    const badgesEl = content.querySelector('.modal-badges');
    if (badgesEl) {
      badgesEl.innerHTML = `
        ${genres  ? `<span class="mbadge mbadge-genre">${genres}</span>` : ''}
        ${movie.year   ? `<span class="mbadge mbadge-year">${movie.year}</span>` : ''}
        ${movie.rating ? `<span class="mbadge mbadge-rating">⭐ ${movie.rating}</span>` : ''}
        ${runtime ? `<span class="mbadge mbadge-year">${runtime}</span>` : ''}
      `;
    }

    if (tagline) {
      const titleEl = content.querySelector('.modal-title');
      if (titleEl) titleEl.insertAdjacentHTML('afterend', `<p style="color:var(--text2);font-style:italic;font-size:15px;margin-bottom:14px;">"${tagline}"</p>`);
    }

    detailSection.innerHTML = `
      ${director || cast ? `
        <div class="modal-info-grid" style="margin-bottom:16px;">
          ${director ? `<div class="modal-info-item"><label>Director</label><span>${director}</span></div>` : ''}
          ${cast     ? `<div class="modal-info-item"><label>Cast</label><span>${cast}</span></div>`         : ''}
        </div>` : ''}
      ${detail.homepage ? `
        <div style="margin-bottom:16px;">
          <a href="${detail.homepage}" target="_blank" class="btn-ghost" style="display:inline-block;">
            🌐 Official Website
          </a>
        </div>` : ''}
    `;

    /* Update movie object with genres for favorites */
    state.currentMovie = { ...movie, genres, director, cast };

  } catch (err) {
    const detailSection = document.getElementById('modal-details');
    if (detailSection) detailSection.innerHTML = '';
  }
}

function closeModalBtn() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
  state.currentMovie = null;
}

function closeModalOverlay(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalBtn();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const o = document.getElementById('modal-overlay');
    if (o?.classList.contains('active')) closeModalBtn();
  }
});


/* ══════════════════════════════════════════════════════════
   FAVORITES
══════════════════════════════════════════════════════════ */
function loadFavorites() {
  try { state.favorites = JSON.parse(localStorage.getItem('mf_favs') || '[]'); }
  catch { state.favorites = []; }
  updateFavCount();
  if (state.favorites.length > 0) renderFavsSection();
}

function saveFavorites() {
  localStorage.setItem('mf_favs', JSON.stringify(state.favorites));
  updateFavCount();
  renderFavsSection();
}

function toggleFav(e, movieId) {
  e.stopPropagation();
  const card = e.target.closest('.movie-card');
  if (!card?._data) return;
  doToggleFav(card._data);
  const isFav = state.favorites.some(f => f.id === movieId);
  const icon  = isFav ? '❤️' : '🤍';
  const badge = card.querySelector('.fav-badge');
  const qbtn  = card.querySelectorAll('.qbtn')[1];
  if (badge) badge.textContent = icon;
  if (qbtn)  qbtn.textContent  = icon;
}

function toggleFavModal() {
  if (!state.currentMovie) return;
  doToggleFav(state.currentMovie);
  const isFav = state.favorites.some(f => f.id === state.currentMovie.id);
  const btn   = document.getElementById('fav-modal-btn');
  if (btn) btn.textContent = isFav ? '❤️ Remove Favorite' : '🤍 Save to Favorites';
}

function doToggleFav(movie) {
  const idx = state.favorites.findIndex(f => f.id === movie.id);
  if (idx === -1) {
    state.favorites.push(movie);
    showToast(`❤️ "${movie.title}" saved!`, 'success');
  } else {
    state.favorites.splice(idx, 1);
    showToast(`Removed "${movie.title}"`, 'info');
  }
  saveFavorites();
}

function updateFavCount() {
  const el = document.getElementById('fav-count');
  if (el) el.textContent = state.favorites.length;
}

function renderFavsSection() {
  const section = document.getElementById('favorites-section');
  if (!section) return;
  if (state.favorites.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  renderGrid(state.favorites, 'favorites-grid');
}

function scrollToFavorites() {
  if (state.favorites.length === 0) { showToast('No favorites yet! Click 🤍 to save movies.','info'); return; }
  document.getElementById('favorites-section')?.scrollIntoView({ behavior:'smooth' });
}


/* ══════════════════════════════════════════════════════════
   CONFETTI
══════════════════════════════════════════════════════════ */
function triggerConfetti() {
  const c = document.getElementById('confetti-container');
  if (!c) return;
  c.innerHTML = '';
  for (let i = 0; i < 35; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.cssText = `
      left:${5+Math.random()*90}%;
      width:${7+Math.random()*9}px; height:${7+Math.random()*9}px;
      border-radius:${Math.random()>.5?'50%':'3px'};
      background:${CONFETTI_COLORS[i%CONFETTI_COLORS.length]};
      animation:confetti ${(1.1+Math.random()*1.5).toFixed(2)}s ${(Math.random()*.7).toFixed(2)}s ease-in both;
    `;
    c.appendChild(p);
  }
  setTimeout(() => { c.innerHTML = ''; }, 2800);
}


/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
let toastT = null;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  if (toastT) clearTimeout(toastT);
  t.textContent = msg;
  t.className   = `toast show ${type}`;
  toastT = setTimeout(() => {
    t.classList.add('hide');
    setTimeout(() => { t.className = 'toast'; }, 320);
  }, 3200);
}


/* ══════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════ */
function showLoading(v) {
  const l = document.getElementById('loading-state');
  const e = document.getElementById('error-state');
  if (l) l.style.display = v ? 'block' : 'none';
  if (e) e.style.display = 'none';
}

function showError(msg) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('error-state').style.display   = 'block';
  document.getElementById('error-message').textContent   = msg;
}

function showResults() {
  document.getElementById('results-section').style.display = 'block';
}

function clearGrid() {
  const g = document.getElementById('movies-grid');
  if (g) g.innerHTML = '';
}

function esc(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
