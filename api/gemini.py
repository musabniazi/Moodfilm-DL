from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import urllib.parse

TMDB_API_KEY = "bb597d85fbd9044ebd48b8a454a8c972"
TMDB_BASE    = "https://api.themoviedb.org/3"

MOOD_GENRES = {
    "happy":     [35, 10402],
    "sad":       [18],
    "excited":   [28, 12],
    "anxious":   [53, 27],
    "romantic":  [10749],
    "angry":     [28, 80],
    "bored":     [14, 878],
    "nostalgic": [36, 10751],
}

MOOD_KEYWORDS = {
    "happy":     ["happy", "joy", "funny", "comedy", "cheerful", "great", "amazing", "fun"],
    "sad":       ["sad", "cry", "depressed", "lonely", "heartbroken", "grief", "unhappy"],
    "excited":   ["excited", "pumped", "thrilled", "energetic", "hyped", "adrenaline"],
    "anxious":   ["anxious", "nervous", "scared", "worried", "stress", "fear", "panic"],
    "romantic":  ["love", "romantic", "crush", "heart", "date", "passion", "adore"],
    "angry":     ["angry", "furious", "mad", "rage", "frustrated", "hate", "upset"],
    "bored":     ["bored", "lazy", "idle", "dull", "meh", "chill", "slow"],
    "nostalgic": ["nostalgic", "memories", "childhood", "remember", "classic", "past"],
}


def tmdb_get(path: str, params: dict = {}) -> dict:
    params["api_key"]  = TMDB_API_KEY
    params["language"] = "en-US"
    query  = urllib.parse.urlencode(params)
    url    = f"{TMDB_BASE}{path}?{query}"
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode())


def fetch_movies_by_genres(genre_ids: list, page: int = 1, sort_by: str = "popularity.desc") -> list:
    """Fetch 3 pages in sequence and merge, deduplicating by movie id."""
    genre_str = ",".join(str(g) for g in genre_ids)
    seen    = set()
    results = []
    for p in range(page, page + 3):
        data = tmdb_get("/discover/movie", {
            "with_genres":    genre_str,
            "sort_by":        sort_by,
            "page":           p,
            "vote_count.gte": 50,
        })
        for m in data.get("results", []):
            if m["id"] not in seen:
                seen.add(m["id"])
                results.append(m)
    return results


def format_movie(m: dict) -> dict:
    return {
        "id":           m.get("id"),
        "title":        m.get("title") or m.get("original_title", ""),
        "overview":     m.get("overview", ""),
        "poster_path":  m.get("poster_path"),
        "genre_ids":    m.get("genre_ids", []),
        "vote_average": m.get("vote_average"),
        "release_date": m.get("release_date", ""),
    }


def detect_mood_from_query(query: str) -> str | None:
    q = query.lower()
    for mood, keywords in MOOD_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            return mood
    return None


class handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # suppress default Apache-style logs

    def send_json(self, status: int, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(parsed.query))

            mood = params.get("mood", "happy").lower()
            page = int(params.get("page", 1))
            type_ = params.get("type", "tmdb_mood")

            # ── TRENDING ──────────────────────────────────────────
            if type_ == "tmdb_trending" or parsed.path.endswith("/trending"):
                seen    = set()
                results = []
                for p in [1, 2]:
                    data = tmdb_get("/trending/movie/week", {"page": p})
                    for m in data.get("results", []):
                        if m["id"] not in seen:
                            seen.add(m["id"])
                            results.append(format_movie(m))
                return self.send_json(200, {"results": results})

            # ── MOVIE DETAIL ──────────────────────────────────────
            if type_ == "tmdb_detail":
                movie_id = params.get("id")
                if not movie_id:
                    return self.send_json(400, {"error": "id param required"})
                data = tmdb_get(f"/movie/{movie_id}", {"append_to_response": "credits"})
                return self.send_json(200, data)

            # ── SEARCH ────────────────────────────────────────────
            if type_ == "tmdb_search":
                query = params.get("query", "")
                detected = detect_mood_from_query(query)
                if detected:
                    genre_ids = MOOD_GENRES[detected]
                    movies = fetch_movies_by_genres(genre_ids, page)
                else:
                    q = urllib.parse.quote(query)
                    seen    = set()
                    movies  = []
                    for p in range(page, page + 3):
                        data = tmdb_get("/search/movie", {
                            "query": query, "page": p, "include_adult": "false"
                        })
                        for m in data.get("results", []):
                            if m["id"] not in seen and m.get("poster_path"):
                                seen.add(m["id"])
                                movies.append(m)
                return self.send_json(200, {"results": [format_movie(m) for m in movies]})

            # ── MOOD MOVIES (default) ─────────────────────────────
            genre_ids = MOOD_GENRES.get(mood, MOOD_GENRES["happy"])
            movies    = fetch_movies_by_genres(genre_ids, page)
            return self.send_json(200, {
                "mood":    mood,
                "results": [format_movie(m) for m in movies],
            })

        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length)) if length else {}

            type_    = body.get("type", "tmdb_mood")
            payload  = body.get("payload", {})

            # ── MOOD MOVIES ───────────────────────────────────────
            if type_ == "tmdb_mood":
                genre_ids = payload.get("genreIds", [35])
                page      = int(payload.get("page", 1))
                sort_by   = payload.get("sortBy", "popularity.desc")
                movies    = fetch_movies_by_genres(genre_ids, page, sort_by)
                return self.send_json(200, {"results": [format_movie(m) for m in movies]})

            # ── TOP RATED ─────────────────────────────────────────
            if type_ == "tmdb_top":
                genre_ids = payload.get("genreIds", [35])
                page      = int(payload.get("page", 1))
                genre_str = ",".join(str(g) for g in genre_ids)
                data      = tmdb_get("/discover/movie", {
                    "with_genres":    genre_str,
                    "sort_by":        "vote_average.desc",
                    "page":           page,
                    "vote_count.gte": 200,
                })
                return self.send_json(200, {"results": [format_movie(m) for m in data.get("results", [])]})

            # ── SEARCH ────────────────────────────────────────────
            if type_ == "tmdb_search":
                query = payload.get("query", "")
                page  = int(payload.get("page", 1))
                detected = detect_mood_from_query(query)
                if detected:
                    movies = fetch_movies_by_genres(MOOD_GENRES[detected], page)
                else:
                    seen   = set()
                    movies = []
                    for p in range(page, page + 3):
                        data = tmdb_get("/search/movie", {
                            "query": query, "page": p, "include_adult": "false"
                        })
                        for m in data.get("results", []):
                            if m["id"] not in seen and m.get("poster_path"):
                                seen.add(m["id"])
                                movies.append(m)
                return self.send_json(200, {"results": [format_movie(m) for m in movies]})

            # ── MOVIE DETAIL ──────────────────────────────────────
            if type_ == "tmdb_detail":
                movie_id = payload.get("id")
                data     = tmdb_get(f"/movie/{movie_id}", {"append_to_response": "credits"})
                return self.send_json(200, data)

            # ── TRENDING ──────────────────────────────────────────
            if type_ == "tmdb_trending":
                seen    = set()
                results = []
                for p in [1, 2]:
                    data = tmdb_get("/trending/movie/week", {"page": p})
                    for m in data.get("results", []):
                        if m["id"] not in seen:
                            seen.add(m["id"])
                            results.append(format_movie(m))
                return self.send_json(200, {"results": results})

            # ── SIMILAR ───────────────────────────────────────────
            if type_ == "tmdb_similar":
                movie_id = payload.get("id")
                data     = tmdb_get(f"/movie/{movie_id}/similar", {"page": 1})
                return self.send_json(200, {"results": [format_movie(m) for m in data.get("results", [])]})

            return self.send_json(400, {"error": f"Unknown type '{type_}'"})

        except Exception as e:
            self.send_json(500, {"error": str(e)})
