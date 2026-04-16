import json
import mimetypes
import os
import re
import threading
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Tuple


ROOT_DIR = Path(__file__).resolve().parent
DATA_FILE = Path(os.getenv("LOCAL_DATA_FILE", "data/songs.json"))
if not DATA_FILE.is_absolute():
    DATA_FILE = ROOT_DIR / DATA_FILE
INDEX_FILE = ROOT_DIR / "templates" / "index.html"
STATIC_DIR = ROOT_DIR / "static"
INSTRUMENT_KEYS = ["chitarra", "basso", "batteria", "tastiere", "voce", "altro"]
LOCK = threading.Lock()


def normalize_label(value: str) -> str:
    stripped = unicodedata.normalize("NFKD", value or "")
    no_accents = "".join(ch for ch in stripped if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "", no_accents)


def blank_instruments() -> Dict[str, str]:
    return {key: "" for key in INSTRUMENT_KEYS}


def load_db() -> Dict[str, object]:
    if not DATA_FILE.exists():
        return {"nextId": 1, "songs": []}
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if "nextId" not in data:
        songs = data.get("songs", [])
        max_id = max([song.get("id", 0) for song in songs], default=0)
        data["nextId"] = max_id + 1
    return data


def save_db(data: Dict[str, object]) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with DATA_FILE.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def enrich_song(song: Dict[str, object]) -> Dict[str, object]:
    instruments = song.get("instruments", {})
    normalized = {key: str(instruments.get(key, "")).strip() for key in INSTRUMENT_KEYS}
    participants = sum(1 for value in normalized.values() if value)
    hearts = song.get("hearts", [])
    dedup_hearts = []
    seen = set()
    for heart in hearts:
        name = str(heart).strip()
        if not name:
            continue
        key = normalize_label(name)
        if key in seen:
            continue
        seen.add(key)
        dedup_hearts.append(name)

    return {
        "id": song.get("id"),
        "songTitle": str(song.get("songTitle", "")).strip(),
        "author": str(song.get("author", "")).strip(),
        "tone": str(song.get("tone", "")).strip(),
        "proposedBy": str(song.get("proposedBy", "")).strip(),
        "hearts": dedup_hearts,
        "heartsCount": len(dedup_hearts),
        "participantsCount": participants,
        "eligibleForScaletta": participants >= 3,
        "instruments": {
            key: {
                "label": key.capitalize(),
                "playerName": normalized[key],
                "taken": bool(normalized[key]),
            }
            for key in INSTRUMENT_KEYS
        },
    }


def build_payload(data: Dict[str, object]) -> Dict[str, List[Dict[str, object]]]:
    songs = [enrich_song(song) for song in data.get("songs", []) if song.get("songTitle")]
    scaletta = [song for song in songs if song["eligibleForScaletta"]]
    scaletta.sort(
        key=lambda song: (-song["participantsCount"], -song["heartsCount"], song["songTitle"])
    )
    return {"songs": songs, "scaletta": scaletta}


def find_song(data: Dict[str, object], song_id: int):
    for song in data.get("songs", []):
        if song.get("id") == song_id:
            return song
    return None


def get_songs() -> Tuple[dict, int]:
    with LOCK:
        data = load_db()
        return build_payload(data), 200


def propose_song(payload: dict) -> Tuple[dict, int]:
    song_title = str(payload.get("songTitle", "")).strip()
    author = str(payload.get("author", "")).strip()
    tone = str(payload.get("tone", "")).strip()
    musician_name = str(payload.get("musicianName", "")).strip()
    instrument = str(payload.get("instrument", "")).strip().lower()

    if not song_title:
        return {"error": "songTitle is required"}, 400
    if not author:
        return {"error": "author is required"}, 400
    if not tone:
        return {"error": "tone is required"}, 400
    if not musician_name:
        return {"error": "musicianName is required"}, 400
    if instrument not in INSTRUMENT_KEYS:
        return {"error": "Valid instrument is required"}, 400

    with LOCK:
        data = load_db()
        candidate_title = normalize_label(song_title)
        candidate_author = normalize_label(author)

        for existing_song in data.get("songs", []):
            existing_title = normalize_label(str(existing_song.get("songTitle", "")))
            existing_author = normalize_label(str(existing_song.get("author", "")))
            if existing_title == candidate_title and existing_author == candidate_author:
                return (
                    {
                        "error": "Song already exists (same title and author)",
                        "existingSongId": existing_song.get("id"),
                    },
                    409,
                )

        song = {
            "id": data["nextId"],
            "songTitle": song_title,
            "author": author,
            "tone": tone,
            "proposedBy": musician_name,
            "hearts": [],
            "instruments": blank_instruments(),
        }
        song["instruments"][instrument] = musician_name
        data["songs"].append(song)
        data["nextId"] += 1
        save_db(data)
        return {"ok": True, "songId": song["id"]}, 200


def heart_song(song_id: int, payload: dict) -> Tuple[dict, int]:
    musician_name = str(payload.get("musicianName", "")).strip()
    if not musician_name:
        return {"error": "musicianName is required"}, 400

    with LOCK:
        data = load_db()
        song = find_song(data, song_id)
        if not song:
            return {"error": "Song not found"}, 404

        hearts = [str(name).strip() for name in song.get("hearts", []) if str(name).strip()]
        musician_key = normalize_label(musician_name)

        existing_index = -1
        for idx, heart_name in enumerate(hearts):
            if normalize_label(heart_name) == musician_key:
                existing_index = idx
                break

        if existing_index >= 0:
            hearts.pop(existing_index)
            action = "removed"
        else:
            hearts.append(musician_name)
            action = "added"

        song["hearts"] = hearts
        save_db(data)
        return {"ok": True, "heartsCount": len(hearts), "action": action}, 200


def join_song(song_id: int, payload: dict) -> Tuple[dict, int]:
    musician_name = str(payload.get("musicianName", "")).strip()
    instrument = str(payload.get("instrument", "")).strip().lower()
    if not musician_name:
        return {"error": "musicianName is required"}, 400
    if instrument not in INSTRUMENT_KEYS:
        return {"error": "Invalid instrument"}, 400

    with LOCK:
        data = load_db()
        song = find_song(data, song_id)
        if not song:
            return {"error": "Song not found"}, 404

        instruments = song.get("instruments", blank_instruments())
        current_player = str(instruments.get(instrument, "")).strip()
        musician_key = normalize_label(musician_name)
        current_key = normalize_label(current_player)

        if current_player and current_key != musician_key:
            return {"error": "Instrument slot already taken", "currentPlayer": current_player}, 409

        if current_player and current_key == musician_key:
            instruments[instrument] = ""
            action = "removed"
        else:
            instruments[instrument] = musician_name
            action = "added"

        song["instruments"] = instruments
        save_db(data)
        return {"ok": True, "action": action}, 200


class AppHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404, "Not found")
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length_header = self.headers.get("Content-Length", "0")
        try:
            length = int(length_header)
        except ValueError:
            return {}
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        if self.path == "/":
            self._send_file(INDEX_FILE, "text/html; charset=utf-8")
            return
        if self.path == "/health":
            self._send_json({"ok": True}, 200)
            return
        if self.path.startswith("/static/"):
            relative = self.path.removeprefix("/static/")
            file_path = (STATIC_DIR / relative).resolve()
            if not str(file_path).startswith(str(STATIC_DIR.resolve())):
                self.send_error(403, "Forbidden")
                return
            mime, _ = mimetypes.guess_type(str(file_path))
            self._send_file(file_path, mime or "application/octet-stream")
            return
        if self.path == "/api/songs":
            payload, status = get_songs()
            self._send_json(payload, status)
            return
        self.send_error(404, "Not found")

    def do_POST(self):
        if self.path == "/api/songs":
            payload = self._read_json_body()
            response, status = propose_song(payload)
            self._send_json(response, status)
            return

        heart_match = re.fullmatch(r"/api/songs/(\d+)/heart", self.path)
        if heart_match:
            payload = self._read_json_body()
            song_id = int(heart_match.group(1))
            response, status = heart_song(song_id, payload)
            self._send_json(response, status)
            return

        join_match = re.fullmatch(r"/api/songs/(\d+)/join", self.path)
        if join_match:
            payload = self._read_json_body()
            song_id = int(join_match.group(1))
            response, status = join_song(song_id, payload)
            self._send_json(response, status)
            return

        self.send_error(404, "Not found")


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Jam Session lineup running on http://0.0.0.0:{port}")
    server.serve_forever()
