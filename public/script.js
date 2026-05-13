// LIE-FI — client script
const socket = io();

let currentRoomId = "";
let myName = "";
let isHost = false;
let currentMode = "solo";   // "solo" | "team"
let myTeam = null;
let chatOpen = true;
let unreadCount = 0;

//Toast -> pop up msg for the players
function showToast(msg, duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove("show"), duration);
}

// time bar for the timer 
let timerInterval = null;

function startTimerBar(seconds) {
  const bar = document.getElementById("timerBar");
  if (!bar) return;
  bar.style.transition = "none";
  bar.style.width = "100%";
  requestAnimationFrame(() => {
    bar.style.transition = `width ${seconds}s linear`;
    bar.style.width = "0%";
  });
}

//leaderboard
function renderLeaderboard(players) {
  const div = document.getElementById("leaderboard");
  const section = document.getElementById("leaderboardSection");
  if (!div) return;

  section.style.display = "block";
  div.innerHTML = "";

  const sorted = [...players].sort((a, b) => b.score - a.score);

  sorted.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "player-row";

    const dot = document.createElement("span");
    dot.className = "disc " + (p.disconnected ? "" : "online");

    const label = document.createElement("span");
    label.style.flex = "1";
    label.style.fontSize = "14px";
    label.innerHTML = `${i + 1}. <b>${p.name}</b>`;

    if (p.team) {
      const tag = document.createElement("span");
      tag.className = "team-tag";
      tag.textContent = p.team;
      label.appendChild(tag);
    }

    const score = document.createElement("span");
    score.textContent = p.score + " pts";
    score.style.color = "#888";
    score.style.fontSize = "13px";

    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(score);
    div.appendChild(row);
  });
}

// ─── Team setup builder (host only) ──────────────────────────────────────────
function buildTeamSlots(players) {
  const container = document.getElementById("teamSlots");
  container.innerHTML = "";

  const numTeams = Math.floor(players.length / 2);

  for (let i = 0; i < numTeams; i++) {
    const teamDiv = document.createElement("div");
    teamDiv.className = "team-builder";

    const nameInput = document.createElement("input");
    nameInput.className = "team-name-input";
    nameInput.placeholder = `Team ${i + 1} name`;
    nameInput.value = `Team ${String.fromCharCode(65 + i)}`;
    nameInput.dataset.teamIdx = i;

    teamDiv.appendChild(Object.assign(document.createElement("h4"), { textContent: `Team ${i + 1}` }));
    teamDiv.appendChild(nameInput);

    ["Member 1", "Member 2"].forEach((label, j) => {
      const slot = document.createElement("div");
      slot.className = "team-slot";

      const lbl = document.createElement("label");
      lbl.textContent = label;

      const sel = document.createElement("select");
      sel.dataset.teamIdx = i;
      sel.dataset.memberIdx = j;

      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "— pick player —";
      sel.appendChild(blank);

      players.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });

      slot.appendChild(lbl);
      slot.appendChild(sel);
      teamDiv.appendChild(slot);
    });

    container.appendChild(teamDiv);
  }
}

// ─── JOIN ─────────────────────────────────────────────────────────────────────
document.getElementById("joinBtn").onclick = () => {
  const name = document.getElementById("name").value.trim();
  const roomId = document.getElementById("room").value.trim();
  if (!name || !roomId) return;

  myName = name;
  currentRoomId = roomId;

  socket.emit("join_room", { name, roomId });
};

// ─── HOST CONTROLS ────────────────────────────────────────────────────────────

// Mode toggle
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.onclick = () => {
    if (!isHost) return;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;

    socket.emit("set_mode", { roomId: currentRoomId, mode: currentMode });

    const teamSetup = document.getElementById("teamSetup");
    if (currentMode === "team") {
      teamSetup.style.display = "block";
      const players = Array.from(document.querySelectorAll("#players li")).map(li => ({
        name: li.dataset.name
      }));
      buildTeamSlots(players);
    } else {
      teamSetup.style.display = "none";
    }
  };
});

// Apply teams
document.getElementById("applyTeamsBtn").onclick = () => {
  const nameInputs = document.querySelectorAll(".team-name-input");
  const teams = [];

  nameInputs.forEach((input, i) => {
    const name = input.value.trim() || `Team ${i + 1}`;
    const selects = document.querySelectorAll(`select[data-team-idx="${i}"]`);
    const members = Array.from(selects).map(s => s.value).filter(Boolean);
    if (members.length > 0) teams.push({ name, members });
  });

  if (teams.length === 0) return showToast("Set up at least one team.");

  socket.emit("set_teams", { roomId: currentRoomId, teams });
  showToast("Teams applied! ✅");
};

// Start game
document.getElementById("startBtn").onclick = () => {
  socket.emit("start_game", { roomId: currentRoomId });
};

// ─── CHAT ─────────────────────────────────────────────────────────────────────
document.getElementById("chatHeader").onclick = () => {
  chatOpen = !chatOpen;
  document.getElementById("chatBody").style.display = chatOpen ? "block" : "none";
  if (chatOpen) {
    unreadCount = 0;
    const badge = document.getElementById("chatBadge");
    badge.style.display = "none";
  }
};

function sendChat() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit("team_chat", { roomId: currentRoomId, message: msg });
  input.value = "";
}

document.getElementById("chatSend").onclick = sendChat;
document.getElementById("chatInput").addEventListener("keydown", e => {
  if (e.key === "Enter") sendChat();
});

function appendChatMessage(from, message, isMine) {
  const box = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = "chat-msg " + (isMine ? "mine" : "theirs");

  div.innerHTML = `<div class="sender">${isMine ? "You" : from}</div>
                   <div class="text">${escapeHtml(message)}</div>`;

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;

  // Unread badge
  if (!chatOpen) {
    unreadCount++;
    const badge = document.getElementById("chatBadge");
    badge.textContent = unreadCount;
    badge.style.display = "flex";
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────────

// Players list update
socket.on("room_players", players => {
  document.getElementById("joinSection").style.display = "none";
  document.getElementById("lobbySection").style.display = "block";
  document.getElementById("roomLabel").textContent = `#${currentRoomId}`;

  const list = document.getElementById("players");
  list.innerHTML = "";

  players.forEach(p => {
    const li = document.createElement("li");
    li.dataset.name = p.name;
    li.style.padding = "3px 0";
    li.style.color = p.disconnected ? "#555" : "#fff";
    li.innerHTML = `${p.disconnected ? "💤 " : ""}${p.name}`;
    if (p.id === socket.id) li.innerHTML += " <span style='color:#888;font-size:11px;'>(you)</span>";
    list.appendChild(li);
  });

  // Show host controls if we're host
  const hostPlayer = players[0];
  if (hostPlayer && hostPlayer.id === socket.id) {
    isHost = true;
    document.getElementById("hostControls").style.display = "block";
    if (currentMode === "team") buildTeamSlots(players);
  }
});

// You became host (after original host left)
socket.on("you_are_host", () => {
  isHost = true;
  document.getElementById("hostControls").style.display = "block";
  showToast("You are now the host! 👑");
});

// Mode confirmed by server
socket.on("mode_set", ({ mode }) => {
  currentMode = mode;
});

// Teams confirmed
socket.on("teams_set", ({ teams }) => {
  // Find MY team
  teams.forEach(t => {
    if (t.members.includes(myName)) {
      myTeam = t;
    }
  });

  if (myTeam) {
    document.getElementById("chatPanel").style.display = "block";
    showToast(`You're in ${myTeam.name} with ${myTeam.members.filter(m => m !== myName).join(", ")} 🤝`);
  }
});

// Reconnected
socket.on("reconnected", data => {
  showToast(`Welcome back! Your score: ${data.score} pts 💾`);
  currentMode = data.mode;
  document.getElementById("joinSection").style.display = "none";
  document.getElementById("lobbySection").style.display = "block";
  document.getElementById("roomLabel").textContent = `#${currentRoomId}`;
  renderLeaderboard(data.players);

  if (data.mode === "team" && data.teams) {
    data.teams.forEach(t => {
      if (t.members.includes(myName)) {
        myTeam = t;
        document.getElementById("chatPanel").style.display = "block";
      }
    });
  }
});

// Player disconnected notification
socket.on("player_disconnected", ({ message }) => {
  showToast(message, 4000);
});

// Question
socket.on("new_question", data => {
  document.getElementById("lobbySection").style.display = "none";
  document.getElementById("leaderboardSection").style.display = "block";

  const game = document.getElementById("game");

  game.innerHTML = `
    <p style="color:#888;font-size:12px;letter-spacing:1px;">ROUND ${data.round} / ${data.maxRounds}</p>
    <div id="timerBar"></div>
    <h3 style="margin:16px 0 12px;">${escapeHtml(data.question)}</h3>
    <p style="color:#888;font-size:12px;">Write a fake answer to fool others</p>
    <input id="ans" placeholder="Your bluff…" autocomplete="off" maxlength="120" style="width:100%;box-sizing:border-box;"/>
    <button id="submitAnswerBtn" style="width:100%;margin-top:8px;">Submit Answer</button>
  `;

  startTimerBar(20);

  document.getElementById("submitAnswerBtn").onclick = () => {
    const ans = document.getElementById("ans").value.trim();
    if (!ans) return;

    socket.emit("submit_answer", { roomId: currentRoomId, answer: ans });

    game.innerHTML = `
      <p style="color:#888;font-size:12px;letter-spacing:1px;">ROUND ${data.round} / ${data.maxRounds}</p>
      <h3>Answer submitted ✅</h3>
      <p style="color:#888;">Waiting for other players…</p>
    `;
  };

  // Auto-focus
  setTimeout(() => document.getElementById("ans")?.focus(), 100);
});

// All answers to vote on
socket.on("all_answers", answers => {
  const game = document.getElementById("game");
  game.innerHTML = `
    <div id="timerBar"></div>
    <h3 style="margin-bottom:16px;">Pick the correct answer</h3>
  `;

  startTimerBar(15);

  answers.forEach(ans => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = ans.text;

    // Disable own answer
    if (ans.playerId === socket.id) {
      btn.disabled = true;
      btn.title = "Your own answer";
    }

    btn.onclick = () => {
      socket.emit("submit_vote", {
        roomId: currentRoomId,
        selectedPlayerId: ans.playerId
      });

      game.innerHTML = `
        <h3>Vote submitted ✅</h3>
        <p style="color:#888;">Waiting for other players to vote…</p>
      `;
    };

    game.appendChild(btn);
  });
});

// Individual vote result
socket.on("vote_result", ({ message }) => {
  const game = document.getElementById("game");
  game.innerHTML = `
    <h3 style="font-size:20px;margin:24px 0 8px;">${escapeHtml(message)}</h3>
    <p style="color:#888;font-size:13px;">Next round starting…</p>
  `;
});

// Score update → leaderboard
socket.on("score_update", players => {
  renderLeaderboard(players);
});

// Team message
socket.on("team_message", ({ from, message }) => {
  appendChatMessage(from, message, from === myName);
});

// Game over
socket.on("game_over", data => {
  document.getElementById("game").innerHTML = `
    <h2 style="margin-top:24px;">🏆 ${escapeHtml(data.winner)}</h2>
    <p style="color:#888;font-size:13px;margin-bottom:16px;">Game Over</p>
    ${data.teamScores
      ? "<p style='font-size:12px;color:#888;'>Team totals shown on leaderboard</p>"
      : ""}
    <button onclick="window.location.href='index.html'">Play Again</button>
  `;
});
