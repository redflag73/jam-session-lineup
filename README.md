# Jam Session lineup

Self-contained Python web app for a musician community to vote songs and reserve instrument slots for a jam session.

The app is now fully self-contained: it uses a local JSON database already imported from your current sheet snapshot.

## Features

- Show proposed songs with title, author, and tone
- Heart voting per song (persisted locally)
- Instrument slot reservation (`Chitarra`, `Basso`, `Batteria`, `Tastiere`, `Voce`, `Altro`)
- Locked slots: once an instrument is taken on a song, it cannot be overwritten
- Auto-updating lineup ("Scaletta per la serata") for songs with at least 3 musicians
- Ranking by participants and hearts, from highest to lowest priority
- New song proposal form requiring: song title, author, tone, and proposer instrument

## 1) Install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`requirements.txt` is intentionally empty (no external packages needed).

## 2) Configure environment (optional)

```bash
cp .env.example .env
```

Update values in `.env` if needed:

- `LOCAL_DATA_FILE` -> local JSON data file (default: `data/songs.json`)

## 3) Run

```bash
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000)

## 4) Publish for your community

The app is ready for both Render and Railway.

### Option A - Render (recommended)

1. Push this folder to a GitHub repository.
2. In Render, click **New + -> Blueprint** and connect the repository.
3. Render will read `render.yaml` automatically.
4. Deploy.
5. Open your app URL and check `/health` returns `{"ok": true}`.

Important:
- `render.yaml` already mounts a persistent disk at `/data`.
- App data is configured as `LOCAL_DATA_FILE=/data/songs.json`.
- On first deploy, copy your current `data/songs.json` into the Render disk (Render Shell), or start with empty data and add songs from UI.

### Option B - Railway

1. Push this folder to a GitHub repository.
2. In Railway, create a project from that repository.
3. Add variable `LOCAL_DATA_FILE=/data/songs.json`.
4. Add a persistent volume and mount it to `/data`.
5. Deploy (uses `railway.json` start command: `python app.py`).

## Notes

- Initial dataset is imported in `data/songs.json`.
- Every vote, instrument join, and new proposal updates `data/songs.json`.
- The lineup includes only songs with at least 3 musicians assigned.
