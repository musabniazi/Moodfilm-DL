import os
import math
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

PORT = int(os.environ.get("PORT", 5000))
TMDB_KEY = "bb597d85fbd9044ebd48b8a454a8c972"
TMDB_BASE = "https://api.themoviedb.org/3"

# ── MOOD CONFIG ──────────────────────────────────────────────────────────────
# Genre IDs: 28=Action, 35=Comedy, 18=Drama, 27=Horror, 10749=Romance,
#            878=Sci-Fi, 53=Thriller, 16=Animation, 10751=Family, 9648=Mystery
MOOD_CONFIG = {
    "happy":      {"genres": [35, 10751, 16],    "keywords": ["happy", "joy", "great", "amazing", "excited", "fun", "good", "wonderful", "fantastic", "cheerful", "smile", "laugh", "love", "awesome"]},
    "sad":        {"genres": [18],               "keywords": ["sad", "cry", "depressed", "lonely", "heartbroken", "miss", "grief", "tears", "unhappy", "miserable", "down", "hopeless", "hurt", "pain"]},
    "excited":    {"genres": [28, 12, 878],      "keywords": ["excited", "pumped", "thrilled", "energetic", "hyped", "epic", "adventure", "action", "adrenaline", "fired", "unstoppable", "rush"]},
    "anxious":    {"genres": [53, 9648, 27],     "keywords": ["anxious", "nervous", "scared", "worried", "stress", "fear", "panic", "tense", "uneasy", "dread", "overwhelmed", "paranoid"]},
    "romantic":   {"genres": [10749, 18],        "keywords": ["love", "romantic", "crush", "heart", "date", "beautiful", "relationship", "affection", "passionate", "tender", "desire", "adore"]},
    "angry":      {"genres": [28, 53, 80],       "keywords": ["angry", "furious", "mad", "rage", "frustrated", "annoyed", "irritated", "hate", "upset", "outraged", "livid", "bitter"]},
    "bored":      {"genres": [35, 16, 14],       "keywords": ["bored", "lazy", "nothing", "idle", "dull", "tired", "sleepy", "meh", "whatever", "chill", "relax", "slow", "quiet"]},
    "nostalgic":  {"genres": [18, 36, 10751],    "keywords": ["nostalgic", "memories", "childhood", "old", "remember", "miss", "past", "classic", "throwback", "vintage", "remind", "used to"]},
}

# 8D genre vectors (one dimension per mood cluster)
MOOD_VECTOR = {
    "happy":     [0, 0, 0, 0, 0, 0, 1, 0],
    "sad":       [1, 0, 0, 0, 0, 0, 0, 0],
    "excited":   [0, 0, 0, 0, 1, 0, 0, 0],
    "anxious":   [0, 0, 0, 0, 0, 1, 0, 0],
    "romantic":  [0, 0, 1, 0, 0, 0, 0, 0],
    "angry":     [0, 0, 0, 0, 1, 1, 0, 0],
    "bored":     [0, 0, 0, 0, 0, 0, 1, 1],
    "nostalgic": [1, 0, 0, 1, 0, 0, 0, 0],
}

GENRE_TO_DIM = {
    18: 0,      # Drama → sad/nostalgic
    10749: 2,   # Romance → romantic
    36: 3,      # History → nostalgic
    28: 4,      # Action → excited/angry
    53: 5,      # Thriller → anxious/angry
    27: 5,      # Horror → anxious
    35: 6,      # Comedy → happy/bored
    10751: 6,   # Family → happy
    16: 6,      # Animation → happy/bored
    14: 7,      # Fantasy → bored
}


# ── ML PIPELINE ──────────────────────────────────────────────────────────────

def sentiment_analysis(text: str) -> dict:
    """Keyword scoring across 8 mood categories with softmax confidence."""
    text_lower = text.lower()
    scores = {}
    for mood, config in MOOD_CONFIG.items():
        score = sum(1 for kw in config["keywords"] if kw in text_lower)
        scores[mood] = score

    # Softmax normalization
    exp_scores = {m: math.exp(s) for m, s in scores.items()}
    total = sum(exp_scores.values())
    softmax = {m: v / total for m, v in exp_scores.items()}

    top_mood = max(softmax, key=softmax.get)
    confidence = round(softmax[top_mood] * 100, 1)

    keywords_found = [
        kw for kw in MOOD_CONFIG[top_mood]["keywords"]
        if kw in text_lower
    ]

    return {
        "mood": top_mood,
        "confidence": confidence,
        "all_scores": {m: round(v * 100, 1) for m, v in softmax.items()},
        "keywords_found": keywords_found[:8],
    }


def movie_to_vector(genre_ids: list) -> list:
    """Convert TMDb genre_ids list into an 8D mood vector."""
    vec = [0.0] * 8
    for gid in genre_ids:
        dim = GENRE_TO_DIM.get(gid)
        if dim is not None:
            vec[dim] += 1.0
    # Normalize
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def cosine_similarity(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a)) or 1e-9
    norm_b = math.sqrt(sum(x * x for x in b)) or 1e-9
    return dot / (norm_a * norm_b)


def euclidean_distance(a: list, b: list) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def content_based_filtering(movies: list, mood: str) -> list:
    """Rank movies by cosine similarity to the detected mood vector."""
    mood_vec = MOOD_VECTOR.get(mood, MOOD_VECTOR["happy"])
    for movie in movies:
        genre_ids = movie.get("genre_ids", [])
        movie_vec = movie_to_vector(genre_ids)
        movie["cosine_score"] = cosine_similarity(mood_vec, movie_vec)
    return sorted(movies, key=lambda m: m["cosine_score"], reverse=True)


def kmeans_cluster(movies: list, mood: str, iterations: int = 10) -> list:
    """
    8-cluster K-Means (one cluster per mood).
    Assigns each movie to the nearest mood cluster centroid,
    then returns movies belonging to the target mood cluster.
    """
    centroids = list(MOOD_VECTOR.values())
    mood_names = list(MOOD_VECTOR.keys())

    for _ in range(iterations):
        # Assign each movie to nearest centroid
        for movie in movies:
            vec = movie_to_vector(movie.get("genre_ids", []))
            distances = [euclidean_distance(vec, c) for c in centroids]
            movie["cluster"] = distances.index(min(distances))

        # Recompute centroids
        new_centroids = []
        for k in range(8):
            cluster_vecs = [
                movie_to_vector(m.get("genre_ids", []))
                for m in movies if m.get("cluster") == k
            ]
            if cluster_vecs:
                mean = [
                    sum(v[d] for v in cluster_vecs) / len(cluster_vecs)
                    for d in range(8)
                ]
                new_centroids.append(mean)
            else:
                new_centroids.append(centroids[k])
        centroids = new_centroids

    target_cluster = mood_names.index(mood) if mood in mood_names else 0
    return [m for m in movies if m.get("cluster") == target_cluster]


def compute_match_score(movie: dict, mood: str) -> dict:
    """0-100 match score with badge label."""
    cosine = movie.get("cosine_score", 0)
    rating_bonus = 10 if (movie.get("vote_average") or 0) > 7.5 else 0
    vote_bonus = 5 if (movie.get("vote_count") or 0) > 500 else 0
    score = min(100, round(cosine * 85) + rating_bonus + vote_bonus)

    if score >= 80:
        badge = "Perfect Match"
    elif score >= 60:
        badge = "Good Match"
    else:
        badge = "Explore"

    return {"match_score": score, "badge": badge}


def format_movie(m: dict, mood: str) -> dict:
    match = compute_match_score(m, mood)
    return {
        "id":           m.get("id"),
        "title":        m.get("title") or m.get("original_title", "Unknown"),
        "year":         (m.get("release_date") or "")[:4],
        "poster":       f"https://image.tmdb.org/t/p/w500{m['poster_path']}" if m.get("poster_path") else None,
        "backdrop":     f"https://image.tmdb.org/t/p/w1280{m['backdrop_path']}" if m.get("backdrop_path") else None,
        "rating":       round(m["vote_average"], 1) if m.get("vote_average") else None,
        "overview":     m.get("overview", ""),
        "genre_ids":    m.get("genre_ids", []),
        "match_score":  match["match_score"],
        "badge":        match["badge"],
    }


# ── TMDb HELPERS ──────────────────────────────────────────────────────────────

def tmdb_get(path: str, params: dict = {}) -> dict:
    params["api_key"] = TMDB_KEY
    params["language"] = "en-US"
    r = requests.get(f"{TMDB_BASE}{path}", params=params, timeout=10)
    r.raise_for_status()
    return r.json()


def fetch_mood_movies(mood: str, page: int = 1) -> list:
    genre_ids = MOOD_CONFIG.get(mood, MOOD_CONFIG["happy"])["genres"]
    genre_str = ",".join(str(g) for g in genre_ids)
    data = tmdb_get("/discover/movie", {
        "with_genres": genre_str,
        "sort_by": "popularity.desc",
        "page": page,
        "vote_count.gte": 100,
    })
    return data.get("results", [])


# ── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/api/movies", methods=["GET"])
def get_movies():
    mood = request.args.get("mood", "happy").lower()
    page = int(request.args.get("page", 1))

    if mood not in MOOD_CONFIG:
        return jsonify({"error": f"Unknown mood '{mood}'"}), 400

    try:
        raw_movies = fetch_mood_movies(mood, page)
        if not raw_movies:
            return jsonify({"movies": [], "mood": mood})

        # Run ML pipeline
        ranked = content_based_filtering(raw_movies, mood)
        clustered = kmeans_cluster(ranked, mood)

        # Fall back to cosine-ranked list if cluster is empty
        pool = clustered if len(clustered) >= 5 else ranked
        movies = [format_movie(m, mood) for m in pool if m.get("poster_path")]

        return jsonify({"mood": mood, "count": len(movies), "movies": movies})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ml", methods=["POST"])
def run_ml():
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()

    if not text:
        return jsonify({"error": "text field is required"}), 400

    try:
        # Step 1 — Sentiment analysis
        sentiment = sentiment_analysis(text)
        mood = sentiment["mood"]

        # Step 2 — Fetch movies for detected mood
        raw_movies = fetch_mood_movies(mood)

        # Step 3 — Content-based filtering
        ranked = content_based_filtering(raw_movies, mood)

        # Step 4 — K-Means clustering
        clustered = kmeans_cluster(ranked, mood)
        pool = clustered if len(clustered) >= 5 else ranked

        # Step 5 — Format with match scores
        movies = [format_movie(m, mood) for m in pool[:12] if m.get("poster_path")]

        return jsonify({
            "mood":          mood,
            "confidence":    sentiment["confidence"],
            "all_scores":    sentiment["all_scores"],
            "keywords_found": sentiment["keywords_found"],
            "movies":        movies,
            "count":         len(movies),
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/trending", methods=["GET"])
def get_trending():
    try:
        data = tmdb_get("/trending/movie/week")
        raw = data.get("results", [])
        movies = [format_movie(m, "happy") for m in raw if m.get("poster_path")]
        return jsonify({"count": len(movies), "movies": movies})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "MoodFilm ML Backend"})


# ── ENTRY POINT ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=False)
