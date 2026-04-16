const state = {
  rankedSongs: [],
};

const songsList = document.getElementById("songsList");
const statusMsg = document.getElementById("statusMsg");
const refreshBtn = document.getElementById("refreshBtn");
const musicianNameInput = document.getElementById("musicianName");
const proposalForm = document.getElementById("proposalForm");
const proposalSongTitle = document.getElementById("proposalSongTitle");
const proposalAuthor = document.getElementById("proposalAuthor");
const proposalTone = document.getElementById("proposalTone");
const proposalInstrument = document.getElementById("proposalInstrument");

const joinModal = document.getElementById("joinModal");
const joinModalSong = document.getElementById("joinModalSong");
const joinInstrument = document.getElementById("joinInstrument");
const joinCancel = document.getElementById("joinCancel");
const joinConfirm = document.getElementById("joinConfirm");

const instrumentLabels = {
  chitarra: "Chitarra",
  basso: "Basso",
  batteria: "Batteria",
  tastiere: "Tastiere",
  voce: "Voce",
  altro: "Altro",
};

let pendingJoinSongId = null;

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

joinCancel.addEventListener("click", () => closeJoinModal());
joinModal.querySelectorAll("[data-close-modal]").forEach((node) => {
  node.addEventListener("click", () => closeJoinModal());
});

joinConfirm.addEventListener("click", async () => {
  if (!pendingJoinSongId) {
    closeJoinModal();
    return;
  }
  const instrument = joinInstrument.value;
  if (!instrument) {
    setStatus("Seleziona uno strumento");
    return;
  }
  closeJoinModal();
  await joinSong(pendingJoinSongId, instrument);
});

function currentMusician() {
  return musicianNameInput.value.trim();
}

function rankSongs(songs) {
  return [...songs].sort((left, right) => {
    if (right.participantsCount !== left.participantsCount) {
      return right.participantsCount - left.participantsCount;
    }
    if (right.heartsCount !== left.heartsCount) {
      return right.heartsCount - left.heartsCount;
    }
    return String(left.songTitle).localeCompare(String(right.songTitle), "it", {
      sensitivity: "base",
    });
  });
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
    const songs = data.songs || [];
    state.rankedSongs = rankSongs(songs);
    renderSongs();
    setStatus(`Caricati ${songs.length} brani`);
  } catch (error) {
    setStatus(error.message);
  }
}

function sheetHeader() {
  return `
    <div class="sheet-row sheet-header">
      <div class="col col-pos">Pos</div>
      <div class="col col-title">Brano</div>
      <div class="col col-meta">Autore / Tonalità</div>
      <div class="col col-musicians">Musicisti</div>
      <div class="col col-love">Love</div>
    </div>
  `;
}

function formatMusiciansDetail(song) {
  const parts = [];
  Object.entries(instrumentLabels).forEach(([key, label]) => {
    const slot = song.instruments[key];
    if (!slot) {
      return;
    }
    const name = slot.playerName;
    if (name) {
      parts.push(`${label}: ${name}`);
    }
  });
  return parts.join(" · ");
}

function countOpenInstrumentSlots(song) {
  return Object.keys(instrumentLabels).filter((key) => {
    const slot = song.instruments[key];
    return slot && !slot.taken;
  }).length;
}

function renderLoveCell(song) {
  const myHeart = Array.isArray(song.hearts)
    ? song.hearts.some((name) => isCurrentMusician(name))
    : false;

  return `
    <div class="love-cell">
      <button type="button" class="heart-btn ${myHeart ? "heart-btn-active" : ""}" data-heart-song-id="${song.id}" aria-label="Love per questo brano">
        ❤
      </button>
      <span class="love-count">${song.heartsCount}</span>
    </div>
  `;
}

function renderMusiciansCell(song) {
  const openSlots = countOpenInstrumentSlots(song);
  const detail = formatMusiciansDetail(song);
  const countLine = `<div class="musicians-count">${song.participantsCount} in formazione</div>`;
  const detailLine = detail
    ? `<div class="musicians-detail">${escapeHtml(detail)}</div>`
    : `<div class="musicians-detail muted">Nessun musicista ancora</div>`;

  if (openSlots === 0) {
    return `
      <div class="musicians-cell">
        ${countLine}
        ${detailLine}
        <button type="button" class="tiny-btn tiny-btn-disabled" disabled>Completo</button>
      </div>
    `;
  }

  return `
    <div class="musicians-cell">
      ${countLine}
      ${detailLine}
      <button type="button" class="tiny-btn" data-open-join="${song.id}">Aggiungiti</button>
    </div>
  `;
}

function renderSongs() {
  if (state.rankedSongs.length === 0) {
    songsList.innerHTML = "<p class=\"empty-msg\">Nessun brano disponibile al momento.</p>";
    return;
  }

  const rows = state.rankedSongs
    .map((song, idx) => {
      const hot = Boolean(song.eligibleForScaletta);
      const hotBadge = hot ? `<span class="hot-badge" title="Almeno 3 musicisti">HOT</span>` : "";
      return `
        <div class="sheet-row ${hot ? "sheet-row-hot" : ""}">
          <div class="col col-pos">${idx + 1}</div>
          <div class="col col-title">
            ${escapeHtml(song.songTitle)}
            ${hotBadge}
          </div>
          <div class="col col-meta">${escapeHtml(song.author || "Autore non indicato")} / ${escapeHtml(song.tone || "Tonalità non indicata")}</div>
          <div class="col col-musicians">${renderMusiciansCell(song)}</div>
          <div class="col col-love">${renderLoveCell(song)}</div>
        </div>
      `;
    })
    .join("");

  songsList.innerHTML = `${sheetHeader()}${rows}`;

  document.querySelectorAll("[data-heart-song-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const songId = Number(button.getAttribute("data-heart-song-id"));
      await voteSong(songId);
    });
  });

  document.querySelectorAll("[data-open-join]").forEach((button) => {
    button.addEventListener("click", () => {
      const songId = Number(button.getAttribute("data-open-join"));
      openJoinModal(songId);
    });
  });
}

function openJoinModal(songId) {
  const musicianName = currentMusician();
  if (!musicianName) {
    setStatus("Inserisci il tuo nome prima di aggiungerti");
    musicianNameInput.focus();
    return;
  }

  const song = state.rankedSongs.find((item) => item.id === songId);
  if (!song) {
    setStatus("Brano non trovato");
    return;
  }

  pendingJoinSongId = songId;
  joinModalSong.textContent = `${song.songTitle} — ${song.author || ""}`.trim();

  joinInstrument.innerHTML = "";

  const freeKeys = Object.keys(instrumentLabels).filter((key) => {
    const slot = song.instruments[key];
    return slot && !slot.taken;
  });

  if (freeKeys.length === 0) {
    joinInstrument.innerHTML = `<option value="">Nessuno slot libero</option>`;
    joinInstrument.disabled = true;
    joinConfirm.disabled = true;
  } else {
    joinInstrument.disabled = false;
    joinConfirm.disabled = false;
    joinInstrument.appendChild(new Option("Seleziona strumento", "", true, true));
    freeKeys.forEach((key) => {
      joinInstrument.appendChild(new Option(instrumentLabels[key], key));
    });
  }

  joinModal.hidden = false;
}

function closeJoinModal() {
  pendingJoinSongId = null;
  joinModal.hidden = true;
  joinInstrument.innerHTML = "";
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
