const state = {
  songs: [],
  scaletta: [],
};

const songsList = document.getElementById("songsList");
const scalettaTable = document.getElementById("scalettaTable");
const statusMsg = document.getElementById("statusMsg");
const refreshBtn = document.getElementById("refreshBtn");
const musicianNameInput = document.getElementById("musicianName");
const proposalForm = document.getElementById("proposalForm");
const proposalSongTitle = document.getElementById("proposalSongTitle");
const proposalAuthor = document.getElementById("proposalAuthor");
const proposalTone = document.getElementById("proposalTone");
const proposalInstrument = document.getElementById("proposalInstrument");
const instrumentLabels = {
  chitarra: "Chitarra",
  basso: "Basso",
  batteria: "Batteria",
  tastiere: "Tastiere",
  voce: "Voce",
  altro: "Altro",
};

refreshBtn.addEventListener("click", () => {
  loadSongs();
});

musicianNameInput.addEventListener("input", () => {
  renderSongs();
});

proposalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitProposal();
});

function currentMusician() {
  return musicianNameInput.value.trim();
}

async function loadSongs() {
  setStatus("Caricamento brani...");
  try {
    const response = await fetch("/api/songs");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Errore nel caricamento dei brani");
    }
    if (data.error) {
      throw new Error(data.error);
    }
    state.songs = data.songs || [];
    state.scaletta = data.scaletta || [];
    renderSongs();
    renderScaletta();
    setStatus(`Caricati ${state.songs.length} brani`);
  } catch (error) {
    setStatus(error.message);
  }
}

function renderSongs() {
  if (state.songs.length === 0) {
    songsList.innerHTML = "<p>Nessun brano disponibile al momento.</p>";
    return;
  }

  songsList.innerHTML = state.songs
    .map((song) => {
      const instrumentButtons = Object.entries(instrumentLabels)
        .map(([key, label]) => {
          const instrument = song.instruments[key];
          if (!instrument) {
            return "";
          }

          const taken = instrument.taken;
          const takenByMe = taken && isCurrentMusician(instrument.playerName);
          let content = "";
          if (takenByMe) {
            content = `
                <button class="slot-btn slot-btn-remove" data-song-id="${song.id}" data-instrument="${key}">
                  ${escapeHtml(label)}: libera il mio posto
                </button>
              `;
          } else if (taken) {
            content = `<div class="slot-taken">${escapeHtml(label)}: ${escapeHtml(instrument.playerName)}</div>`;
          } else {
            content = `
                <button class="slot-btn" data-song-id="${song.id}" data-instrument="${key}">
                  ${escapeHtml(label)}: suono io
                </button>
              `;
          }
          return `<div>${content}</div>`;
        })
        .join("");

      const myHeart = Array.isArray(song.hearts)
        ? song.hearts.some((name) => isCurrentMusician(name))
        : false;

      return `
        <article class="song-card">
          <div class="song-head">
            <h3>${escapeHtml(song.songTitle)}</h3>
            <div class="tone">${escapeHtml(song.author || "Autore non indicato")} - ${escapeHtml(song.tone || "Tonalità non indicata")}</div>
          </div>
          <div class="song-meta">
            <button class="heart-btn ${myHeart ? "heart-btn-active" : ""}" data-heart-song-id="${song.id}">
              ❤ ${song.heartsCount} ${myHeart ? "(votato da te)" : ""}
            </button>
            <span>${song.participantsCount} musicisti</span>
          </div>
          <div class="instruments-grid">${instrumentButtons}</div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-heart-song-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const songId = Number(button.getAttribute("data-heart-song-id"));
      await voteSong(songId);
    });
  });

  document.querySelectorAll("[data-instrument]").forEach((button) => {
    button.addEventListener("click", async () => {
      const songId = Number(button.getAttribute("data-song-id"));
      const instrument = button.getAttribute("data-instrument");
      await joinSong(songId, instrument);
    });
  });
}

function renderScaletta() {
  if (state.scaletta.length === 0) {
    scalettaTable.innerHTML =
      "<tbody><tr><td>Nessun brano con almeno 3 musicisti per ora.</td></tr></tbody>";
    return;
  }

  const header = `
    <thead>
      <tr>
        <th>Pos</th>
        <th>Brano</th>
        <th>Tonalità</th>
        <th>Musicisti</th>
        <th>Love</th>
      </tr>
    </thead>
  `;

  const rows = state.scaletta
    .map((song, idx) => {
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(song.songTitle)}</td>
          <td>${escapeHtml(song.author || "-")} / ${escapeHtml(song.tone || "-")}</td>
          <td>${song.participantsCount}</td>
          <td>${song.heartsCount}</td>
        </tr>
      `;
    })
    .join("");

  scalettaTable.innerHTML = `${header}<tbody>${rows}</tbody>`;
}

async function voteSong(songId) {
  const musicianName = currentMusician();
  if (!musicianName) {
    setStatus("Inserisci il tuo nome prima di votare");
    musicianNameInput.focus();
    return;
  }

  setStatus("Invio voto...");
  try {
    const response = await fetch(`/api/songs/${songId}/heart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicianName }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Errore nel voto");
    }
    await loadSongs();
    if (data.action === "removed") {
      setStatus("Voto rimosso");
    } else {
      setStatus("Voto registrato");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function joinSong(songId, instrument) {
  const musicianName = currentMusician();
  if (!musicianName) {
    setStatus("Inserisci il tuo nome prima di scegliere uno strumento");
    musicianNameInput.focus();
    return;
  }

  setStatus("Prenotazione strumento...");
  try {
    const response = await fetch(`/api/songs/${songId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicianName, instrument }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Errore nella prenotazione dello strumento");
    }
    await loadSongs();
    if (data.action === "removed") {
      setStatus("Posto liberato");
    } else {
      setStatus("Strumento assegnato");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function submitProposal() {
  const musicianName = currentMusician();
  const songTitle = proposalSongTitle.value.trim();
  const author = proposalAuthor.value.trim();
  const tone = proposalTone.value.trim();
  const instrument = proposalInstrument.value;

  if (!musicianName) {
    setStatus("Inserisci il tuo nome prima di proporre un brano");
    musicianNameInput.focus();
    return;
  }

  setStatus("Aggiunta nuovo brano...");
  try {
    const response = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songTitle,
        author,
        tone,
        musicianName,
        instrument,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Errore durante la proposta del brano");
    }
    proposalForm.reset();
    await loadSongs();
    setStatus("Brano proposto con successo");
  } catch (error) {
    setStatus(error.message);
  }
}

function setStatus(message) {
  statusMsg.textContent = message;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeName(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isCurrentMusician(name) {
  const current = normalizeName(currentMusician());
  if (!current) {
    return false;
  }
  return normalizeName(name) === current;
}

loadSongs();
