
const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "../public")));

const rooms = {};
const questions = require("./questions");

//helper function to find the team of the player using the rooms and playerID
function getTeamOf(room, playerId) {
  if (!room.teams) return null;
  return room.teams.find(t => t.members.includes(playerId)) || null;
}

function teamChatRoom(roomId, teamName) {
  return `${roomId}:team:${teamName}`;
}


/*
Start the round by broadcasting a random question to all the players 
The timer is started and the room state is ANSWER
*/
function startRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.processed = false;

  const q = questions[Math.floor(Math.random() * questions.length)];
  room.currentQuestion = q;
  room.state = "ANSWER";

  io.to(roomId).emit("new_question", {
    question: q.question,
    round: room.round,
    maxRounds: room.maxRounds
  });

  room.timer = setTimeout(() => sendAllAnswers(roomId), 20000);
}


/*
shuffle the correct answer with all the answers provided by the players
The room state is VOTE
timer starts for the player to select the correct option
*/
function sendAllAnswers(roomId) {
  const room = rooms[roomId];
  if (!room || !room.currentQuestion) return;

  clearTimeout(room.timer);
  room.roundAnswers = [...room.answers];

  const allAnswers = [
    ...room.answers.map(a => ({ text: a.answer, playerId: a.playerId })),
    { text: room.currentQuestion.correct, playerId: "CORRECT" }
  ];

  allAnswers.sort(() => Math.random() - 0.5);

  room.state = "VOTE";
  io.to(roomId).emit("all_answers", allAnswers);

  room.answers = [];

  room.timer = setTimeout(() => calculateResults(roomId), 15000);
}

/*core game logic to calculate points for correct answer and bluffing others*/

function calculateResults(roomId) {
  const room = rooms[roomId];
  if (!room || !room.currentQuestion || room.processed) return;

  room.processed = true;
  clearTimeout(room.timer);

  const resultMessages = {}; // playerId -> message

  room.votes.forEach(vote => {
    const voter = room.players.find(p => p.id === vote.voterId);
    if (!voter) return;

    if (vote.selectedPlayerId === "CORRECT") {
      voter.score += 100;

      // In team mode, teammate also gets bonus
      if (room.mode === "team") {
        const team = getTeamOf(room, voter.id);
        if (team) {
          team.members.forEach(mid => {
            if (mid !== voter.id) {
              const mate = room.players.find(p => p.id === mid);
              if (mate && !mate.disconnected) mate.score += 25; // teammate bonus
            }
          });
        }
      }

      resultMessages[voter.id] = "✅ Correct! +100";
    } else {
      const bluffer = room.players.find(p => p.id === vote.selectedPlayerId);
      if (bluffer) {
        bluffer.score += 50;
        resultMessages[voter.id] = `😈 Bluffed by ${bluffer.name}! They get +50`;
        resultMessages[bluffer.id] = (resultMessages[bluffer.id] || "") + ` 😈 You fooled ${voter.name}! +50`;
      }
    }
  });

  // Send individual results
  Object.entries(resultMessages).forEach(([pid, msg]) => {
    io.to(pid).emit("vote_result", { message: msg });
  });

  // Players who didn't vote get a message
  room.players.forEach(p => {
    if (!resultMessages[p.id] && !p.disconnected) {
      io.to(p.id).emit("vote_result", { message: "⏰ Time's up! You didn't vote." });
    }
  });

  io.to(roomId).emit("score_update", room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    team: room.mode === "team" ? (getTeamOf(room, p.id)?.name || null) : null
  })));

  // reset round state
  room.votes = [];
  room.roundAnswers = [];
  room.currentQuestion = null;
  room.round++;

  if (room.round > room.maxRounds) {
    setTimeout(() => endGame(roomId), 3000);
  } else {
    setTimeout(() => startRound(roomId), 4000);
  }
}

function endGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const sorted = [...room.players].sort((a, b) => b.score - a.score);

  if (room.mode === "team") {
    // Aggregate team scores
    const teamScores = {};
    room.teams.forEach(t => {
      const total = t.members.reduce((sum, mid) => {
        const p = room.players.find(pl => pl.id === mid);
        return sum + (p ? p.score : 0);
      }, 0);
      teamScores[t.name] = total;
    });

    const winningTeam = Object.entries(teamScores).sort((a, b) => b[1] - a[1])[0];

    io.to(roomId).emit("game_over", {
      winner: winningTeam ? `Team ${winningTeam[0]} (${winningTeam[1]} pts)` : sorted[0].name,
      scores: sorted,
      teamScores
    });
  } else {
    io.to(roomId).emit("game_over", {
      winner: sorted[0].name,
      scores: sorted
    });
  }

  room.state = "DONE";
}



io.on("connection", socket => {

  //joining the room 
  socket.on("join_room", ({ roomId, name }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        answers: [],
        votes: [],
        roundAnswers: [],
        currentQuestion: null,
        state: "WAITING",
        round: 1,
        maxRounds: 6,
        hostId: socket.id,
        processed: false,
        mode: "solo",   // "solo" | "team"
        teams: []
      };
    }

    const room = rooms[roomId];

    //check if the player was already there in the game
    const existing = room.players.find(
      p => p.name.toLowerCase() === name.toLowerCase()
    );

    if (existing) {
      // Rejoin: swap socket ID, clear disconnected flag
      const oldId = existing.id;
      existing.id = socket.id;
      existing.disconnected = false;

      // Fix up team membership if needed
      if (room.teams) {
        room.teams.forEach(t => {
          const idx = t.members.indexOf(oldId);
          if (idx !== -1) t.members[idx] = socket.id;
        });
      }

      socket.emit("reconnected", {
        score: existing.score,
        round: room.round,
        state: room.state,
        mode: room.mode,
        teams: room.teams,
        players: room.players
      });

      // Re-join team chat room if in team mode
      if (room.mode === "team") {
        const team = getTeamOf(room, socket.id);
        if (team) socket.join(teamChatRoom(roomId, team.name));
      }

      // If game already running, catch them up
      if (room.state === "ANSWER" && room.currentQuestion) {
        socket.emit("new_question", {
          question: room.currentQuestion.question,
          round: room.round,
          maxRounds: room.maxRounds
        });
      }

      if (room.state === "VOTE") {
        const allAnswers = [
          ...room.roundAnswers.map(a => ({ text: a.answer, playerId: a.playerId })),
          { text: room.currentQuestion?.correct || "?", playerId: "CORRECT" }
        ];
        socket.emit("all_answers", allAnswers);
      }

    } else {
      // New player
      room.players.push({ id: socket.id, name, score: 0, disconnected: false });

      if (room.players.length === 1) room.hostId = socket.id;
    }

    io.to(roomId).emit("room_players", room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      disconnected: p.disconnected || false
    })));
  });

  //disconnet
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const player = room.players.find(p => p.id === socket.id);
      if (!player) continue;

      player.disconnected = true;

      io.to(roomId).emit("player_disconnected", {
        name: player.name,
        message: `${player.name} disconnected. Score saved — they can rejoin.`
      });

      // If host left, assign new host
      if (room.hostId === socket.id) {
        const next = room.players.find(p => !p.disconnected);
        if (next) {
          room.hostId = next.id;
          io.to(next.id).emit("you_are_host");
        }
      }

      // Auto-advance if everyone connected has answered/voted
      if (room.state === "ANSWER") {
        const connected = room.players.filter(p => !p.disconnected);
        const answered = connected.filter(p =>
          room.answers.find(a => a.playerId === p.id)
        );
        if (answered.length === connected.length && connected.length > 0) {
          clearTimeout(room.timer);
          sendAllAnswers(roomId);
        }
      }

      if (room.state === "VOTE") {
        const connected = room.players.filter(p => !p.disconnected);
        const voted = connected.filter(p =>
          room.votes.find(v => v.voterId === p.id)
        );
        if (voted.length === connected.length && connected.length > 0) {
          clearTimeout(room.timer);
          calculateResults(roomId);
        }
      }

      break;
    }
  });

  //set up for team gameplay

  // Host sets game mode before starting
  socket.on("set_mode", ({ roomId, mode }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;
    room.mode = mode; // "solo" | "team"
    io.to(roomId).emit("mode_set", { mode });
  });

  // Host assigns teams: teams = [{ name: "Alpha", members: ["Alice","Bob"] }, ...]
  socket.on("set_teams", ({ roomId, teams }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;

    // Map player names → socket IDs
    room.teams = teams.map(t => ({
      name: t.name,
      members: t.members.map(mName => {
        const p = room.players.find(pl =>
          pl.name.toLowerCase() === mName.toLowerCase()
        );
        return p ? p.id : null;
      }).filter(Boolean)
    }));

    // Put each team into its own private chat sub-room
    room.teams.forEach(team => {
      team.members.forEach(mid => {
        const memberSocket = io.sockets.sockets.get(mid);
        if (memberSocket) {
          memberSocket.join(teamChatRoom(roomId, team.name));
        }
      });
    });

    io.to(roomId).emit("teams_set", {
      teams: room.teams.map(t => ({
        name: t.name,
        members: t.members.map(mid => {
          const p = room.players.find(pl => pl.id === mid);
          return p ? p.name : mid;
        })
      }))
    });
  });

  // team chat 
  socket.on("team_chat", ({ roomId, message }) => {
    const room = rooms[roomId];
    if (!room) return;

    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return;

    const team = getTeamOf(room, socket.id);
    if (!team) return;

    // Only allow chat during ANSWER or VOTE phase
    if (room.state !== "ANSWER" && room.state !== "VOTE") return;

    io.to(teamChatRoom(roomId, team.name)).emit("team_message", {
      from: sender.name,
      message,
      timestamp: Date.now()
    });
  });

  //starting the game
  socket.on("start_game", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    startRound(roomId);
  });

  // submit the answer
  socket.on("submit_answer", ({ roomId, answer }) => {
    const room = rooms[roomId];
    if (!room || room.state !== "ANSWER") return;
    if (room.answers.find(a => a.playerId === socket.id)) return;

    room.answers.push({ playerId: socket.id, answer });

    const connected = room.players.filter(p => !p.disconnected);
    if (room.answers.length === connected.length) {
      clearTimeout(room.timer);
      sendAllAnswers(roomId);
    }
  });

  // submit the vote 
  socket.on("submit_vote", ({ roomId, selectedPlayerId }) => {
    const room = rooms[roomId];
    if (!room || room.state !== "VOTE") return;
    if (room.votes.find(v => v.voterId === socket.id)) return;

    // Prevent self-vote
    const own = room.roundAnswers.find(a => a.playerId === socket.id);
    if (own && own.playerId === selectedPlayerId) return;

    // In team mode, prevent voting for teammate's answer
    if (room.mode === "team") {
      const team = getTeamOf(room, socket.id);
      if (team && team.members.includes(selectedPlayerId)) return;
    }

    room.votes.push({ voterId: socket.id, selectedPlayerId });

    const connected = room.players.filter(p => !p.disconnected);
    if (room.votes.length === connected.length) {
      clearTimeout(room.timer);
      calculateResults(roomId);
    }
  });
});

server.listen(3000, () => {
  console.log("LIE-FI server running on :3000");
});
