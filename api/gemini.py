from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import urllib.parse

TMDB_API_KEY = "bb597d85fbd9044ebd48b8a454a8c972"

MOOD_GENRES = {
    "happy":     "35,10402",
    "sad":       "18",
    "excited":   "28,12",
    "anxious":   "53,27",
    "romantic":  "10749",
    "angry":     "28,80",
    "bored":     "14,878",
    "nostalgic": "36,10751"
}

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)

            mood = params.get("mood", ["happy"])[0].lower()
            page = params.get("page", ["1"])[0]
            genres = MOOD_GENRES.get(mood, "35")

            url = (
                f"https://api.themoviedb.org/3/discover/movie"
                f"?api_key={TMDB_API_KEY}"
                f"&with_genres={genres}"
                f"&sort_by=popularity.desc"
                f"&page={page}"
                f"&language=en-US"
            )

            req = urllib.request.Request(url)
            with urllib.request.urlopen(req) as res:
                data = json.loads(res.read().decode())

            movies = data.get("results", [])

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(movies).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()
