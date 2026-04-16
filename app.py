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
SEED_DATA_FILE = ROOT_DIR / "data" / "songs.json"
INDEX_FILE = ROOT_DIR / "templates" / "index.html"
STATIC_DIR = ROOT_DIR / "static"
INSTRUMENT_KEYS = ["chitarra", "basso", "batteria", "tastiere", "voce", "altro"]
MULTI_INSTRUMENT_KEYS = frozenset({"chitarra", "voce"})
LOCK = threading.Lock()
_LAST_SEED_SIGNATURE_FOR_INSTRUMENTS: Tuple[float, int] | None = None


def seed_file_signature() -> Tuple[float, int] | None:
    if not SEED_DATA_FILE.exists():
        return None
    stat = SEED_DATA_FILE.stat()
    return stat.st_mtime, stat.st_size


def normalize_label(value: str) -> str:
    stripped = unicodedata.normalize("NFKD", value or "")
    no_accents = "".join(ch for ch in stripped if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "", no_accents)


def list_strings(raw: object) -> List[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if raw is None:
        return []
    s = str(raw).strip()
    return [s] if s else []


def blank_instruments() -> Dict[str, object]:
    return {key: ([] if key in MULTI_INSTRUMENT_KEYS else "") for key in INSTRUMENT_KEYS}


def song_identity(song: Dict[str, object]) -> Tuple[str, str]:
    title = normalize_label(str(song.get("songTitle", "")))
    author = normalize_label(str(song.get("author", "")))
    return title, author


def merge_seed_instruments(target: Dict[str, object], seed: Dict[str, object]) -> bool:
    changed = False
    for key in INSTRUMENT_KEYS:
        if key in MULTI_INSTRUMENT_KEYS:
            cur = list_strings(target.get(key, []))
            inc = list_strings(seed.get(key, []))
            if not cur and inc:
                target[key] = list(inc)
                changed = True
        else:
            current = str(target.get(key, "")).strip()
            incoming_val = seed.get(key, "")
            if isinstance(incoming_val, list):
                inc_list = list_strings(incoming_val)
                incoming = inc_list[0] if inc_list else ""
            else:
                incoming = str(incoming_val).strip()
            if not current and incoming:
                target[key] = incoming
                changed = True
    return changed


def merge_seed_into_data(data: Dict[str, object], fill_instruments_from_seed: bool) -> bool:
    if not fill_instruments_from_seed:
        return False
    if not SEED_DATA_FILE.exists():
        return False

    with SEED_DATA_FILE.open("r", encoding="utf-8") as handle:
        seed_payload = json.load(handle)

    seed_songs = seed_payload.get("songs", [])
    seed_by_id: Dict[int, Dict[str, object]] = {}
    for seed_row in seed_songs:
        if not isinstance(seed_row, dict):
            continue
        raw_id = seed_row.get("id")
        try:
            seed_by_id[int(raw_id)] = seed_row
        except (TypeError, ValueError):
            continue
    seed_by_identity = {}
    for song in seed_songs:
        if isinstance(song, dict):
            seed_by_identity[song_identity(song)] = song

    changed = False
    for song in data.get("songs", []):
        if not isinstance(song, dict):
            continue
        seed_song = None
        song_id = song.get("id")
        try:
            sid = int(song_id) if song_id is not None else None
        except (TypeError, ValueError):
            sid = None
        if sid is not None and sid in seed_by_id:
            seed_song = seed_by_id[sid]
        else:
            seed_song = seed_by_identity.get(song_identity(song))

        if not seed_song:
            continue

        instruments = dict(song.get("instruments") or blank_instruments())
        seed_instruments = dict(seed_song.get("instruments") or blank_instruments())
        if merge_seed_instruments(instruments, seed_instruments):
            song["instruments"] = instruments
            changed = True

    return changed


def count_musicians_raw(song: Dict[str, object]) -> int:
    instruments = song.get("instruments", {})
    if not isinstance(instruments, dict):
        return 0
    total = 0
    for key in INSTRUMENT_KEYS:
        raw = instruments.get(key)
        if key in MULTI_INSTRUMENT_KEYS:
            total += len(list_strings(raw))
        elif str(raw or "").strip():
            total += 1
    return total


def prune_songs_with_no_musicians(data: Dict[str, object]) -> bool:
    """Remove songs with zero musicians (empty instrument slots)."""
    songs = data.get("songs", [])
    if not isinstance(songs, list):
        return False
    kept: List[Dict[str, object]] = []
    for song in songs:
        if isinstance(song, dict) and count_musicians_raw(song) > 0:
            kept.append(song)
    if len(kept) == len(songs):
        return False
    data["songs"] = kept
    max_id = 0
    for song in kept:
        try:
            max_id = max(max_id, int(song.get("id", 0)))
        except (TypeError, ValueError):
            continue
    try:
        next_id = int(data.get("nextId", max_id + 1))
    except (TypeError, ValueError):
        next_id = max_id + 1
    data["nextId"] = max(next_id, max_id + 1)
    return True


def coerce_instruments_field(instruments: object) -> Tuple[Dict[str, object], bool]:
    """
    Persisted shape: single slots are strings; chitarra/voce are lists of names.
    Migrates legacy strings for multi keys to one-element lists.
    """
    if not isinstance(instruments, dict):
        return blank_instruments(), True

    dirty = False
    normalized: Dict[str, object] = blank_instruments()
    for key in INSTRUMENT_KEYS:
        raw = instruments.get(key)
        if key in MULTI_INSTRUMENT_KEYS:
            if isinstance(raw, dict):
                name = str(raw.get("playerName", "") or raw.get("name", "") or "").strip()
                players = [name] if name else []
                dirty = True
            else:
                players = list_strings(raw)
                if not isinstance(raw, list):
                    dirty = True
                elif raw != players:
                    dirty = True
            normalized[key] = players
        else:
            if isinstance(raw, dict):
                name = str(raw.get("playerName", "") or raw.get("name", "") or "").strip()
                normalized[key] = name
                dirty = True
            elif isinstance(raw, list):
                lst = list_strings(raw)
                normalized[key] = lst[0] if lst else ""
                dirty = True
            else:
                name = str(raw).strip() if raw is not None else ""
                if raw != name:
                    dirty = True
                normalized[key] = name

    extra_keys = set(instruments.keys()) - set(INSTRUMENT_KEYS)
    if extra_keys:
        dirty = True

    return normalized, dirty


def normalize_song_record(song: Dict[str, object]) -> bool:
    changed = False
    raw_id = song.get("id")
    if isinstance(raw_id, str) and raw_id.strip().isdigit():
        song["id"] = int(raw_id.strip())
        changed = True

    coerced, instruments_dirty = coerce_instruments_field(song.get("instruments", {}))
    if instruments_dirty:
        song["instruments"] = coerced
        changed = True
    return changed


def load_db() -> Dict[str, object]:
    global _LAST_SEED_SIGNATURE_FOR_INSTRUMENTS

    if not DATA_FILE.exists():
        # First boot on cloud: initialize persistent data from bundled seed file.
        if SEED_DATA_FILE.exists():
            DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
            with SEED_DATA_FILE.open("r", encoding="utf-8") as src:
                seed = json.load(src)
            with DATA_FILE.open("w", encoding="utf-8") as dst:
                json.dump(seed, dst, ensure_ascii=False, indent=2)
        else:
            return {"nextId": 1, "songs": []}
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if "nextId" not in data:
        songs = data.get("songs", [])
        max_id = max([song.get("id", 0) for song in songs], default=0)
        data["nextId"] = max_id + 1

    songs = data.get("songs", [])
    if isinstance(songs, list):
        normalized_any = False
        for song in songs:
            if isinstance(song, dict) and normalize_song_record(song):
                normalized_any = True
        if normalized_any:
            save_db(data)

    if SEED_DATA_FILE.exists():
        sig = seed_file_signature()
        fill_instruments = sig is not None and sig != _LAST_SEED_SIGNATURE_FOR_INSTRUMENTS
        if merge_seed_into_data(data, fill_instruments_from_seed=fill_instruments):
            save_db(data)
        if fill_instruments and sig is not None:
            _LAST_SEED_SIGNATURE_FOR_INSTRUMENTS = sig

    if prune_songs_with_no_musicians(data):
        save_db(data)

    return data


def save_db(data: Dict[str, object]) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with DATA_FILE.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def enrich_song(song: Dict[str, object]) -> Dict[str, object]:
    instruments = song.get("instruments", {})
    if not isinstance(instruments, dict):
        instruments = {}

    participants = 0
    enriched_instruments: Dict[str, Dict[str, object]] = {}
    for key in INSTRUMENT_KEYS:
        if key in MULTI_INSTRUMENT_KEYS:
            players = list_strings(instruments.get(key, []))
        else:
            players = [str(instruments.get(key, "")).strip()] if str(instruments.get(key, "")).strip() else []
        participants += len(players)
        display = " · ".join(players)
        is_multi = key in MULTI_INSTRUMENT_KEYS
        enriched_instruments[key] = {
            "label": key.capitalize(),
            "playerName": display,
            "players": players,
            "multi": is_multi,
            "taken": False if is_multi else bool(display),
        }

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
        "instruments": enriched_instruments,
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
        raw_id = song.get("id")
        try:
            stored_id = int(raw_id)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if stored_id == song_id:
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
        if instrument in MULTI_INSTRUMENT_KEYS:
            song["instruments"][instrument] = [musician_name]
        else:
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

        instruments = dict(song.get("instruments") or blank_instruments())

        if instrument in MULTI_INSTRUMENT_KEYS:
            players = list_strings(instruments.get(instrument, []))
            musician_key = normalize_label(musician_name)
            existing_index = next(
                (idx for idx, p in enumerate(players) if normalize_label(str(p)) == musician_key),
                -1,
            )
            if existing_index >= 0:
                players.pop(existing_index)
                action = "removed"
            else:
                players.append(musician_name)
                action = "added"
            instruments[instrument] = players
        else:
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


def leave_song(song_id: int, payload: dict) -> Tuple[dict, int]:
    """Remove the musician from every instrument slot on this song (same normalized name)."""
    musician_name = str(payload.get("musicianName", "")).strip()
    if not musician_name:
        return {"error": "musicianName is required"}, 400
    musician_key = normalize_label(musician_name)

    with LOCK:
        data = load_db()
        song = find_song(data, song_id)
        if not song:
            return {"error": "Song not found"}, 404

        instruments = dict(song.get("instruments") or blank_instruments())
        cleared: List[str] = []
        for key in INSTRUMENT_KEYS:
            if key in MULTI_INSTRUMENT_KEYS:
                players = list_strings(instruments.get(key, []))
                before = len(players)
                players = [p for p in players if normalize_label(str(p)) != musician_key]
                if len(players) != before:
                    instruments[key] = players
                    cleared.append(key)
            else:
                current_player = str(instruments.get(key, "")).strip()
                if current_player and normalize_label(current_player) == musician_key:
                    instruments[key] = ""
                    cleared.append(key)

        song["instruments"] = instruments
        save_db(data)
        if not cleared:
            return {"ok": True, "action": "noop", "cleared": []}, 200
        return {"ok": True, "action": "removed", "cleared": cleared}, 200


class AppHandler(BaseHTTPRequestHandler):
    def _request_path(self) -> str:
        raw = self.path or "/"
        raw = raw.split("?", 1)[0]
        raw = raw.strip() or "/"
        raw = re.sub(r"/{2,}", "/", raw)
        if len(raw) > 1 and raw.endswith("/"):
            raw = raw[:-1]
        return raw or "/"

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
        path = self._request_path()
        try:
            if path == "/":
                self._send_file(INDEX_FILE, "text/html; charset=utf-8")
                return
            if path == "/health":
                self._send_json({"ok": True}, 200)
                return
            if path.startswith("/static/"):
                relative = path.removeprefix("/static/")
                file_path = (STATIC_DIR / relative).resolve()
                if not str(file_path).startswith(str(STATIC_DIR.resolve())):
                    self.send_error(403, "Forbidden")
                    return
                mime, _ = mimetypes.guess_type(str(file_path))
                self._send_file(file_path, mime or "application/octet-stream")
                return
            if path == "/api/songs":
                payload, status = get_songs()
                self._send_json(payload, status)
                return
            self.send_error(404, "Not found")
        except Exception as exc:  # noqa: BLE001
            self._send_json({"error": f"Server error: {exc}"}, 500)

    def do_POST(self):
        path = self._request_path()
        try:
            if path == "/api/songs":
                payload = self._read_json_body()
                response, status = propose_song(payload)
                self._send_json(response, status)
                return

            heart_match = re.fullmatch(r"/api/songs/(\d+)/heart", path)
            if heart_match:
                payload = self._read_json_body()
                song_id = int(heart_match.group(1))
                response, status = heart_song(song_id, payload)
                self._send_json(response, status)
                return

            join_match = re.fullmatch(r"/api/songs/(\d+)/join", path)
            if join_match:
                payload = self._read_json_body()
                song_id = int(join_match.group(1))
                response, status = join_song(song_id, payload)
                self._send_json(response, status)
                return

            leave_match = re.fullmatch(r"/api/songs/(\d+)/leave", path)
            if leave_match:
                payload = self._read_json_body()
                song_id = int(leave_match.group(1))
                response, status = leave_song(song_id, payload)
                self._send_json(response, status)
                return

            self._send_json({"error": "Not found"}, 404)
        except Exception as exc:  # noqa: BLE001
            self._send_json({"error": f"Server error: {exc}"}, 500)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Lab & Roll Unplugged running on http://0.0.0.0:{port}")
    server.serve_forever()
