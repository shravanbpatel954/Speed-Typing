const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ----- Database configuration -----
const MONGODB_URL =
  process.env.MONGODB_URL ||
  "mongodb+srv://speed-typing:speedtyping@cluster0.g23lxod.mongodb.net/";

// Simple schemas to persist participants and scores
const scoreSchema = new mongoose.Schema(
  {
    roundId: Number,
    name: String,
    college: String,
    wpm: Number,
    accuracy: Number,
    correctChars: Number,
    totalChars: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const participantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    college: String,
    qualifiedUntilRound: { type: Number, default: 1 },
    scores: [scoreSchema],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const Participant = mongoose.model("Participant", participantSchema);
const Score = mongoose.model("Score", scoreSchema);

// ----- Competition configuration -----
// 3-second visible countdown (3..2..1) before typing starts.
const COUNTDOWN_MS = 3000;

// Updated round timings:
// - Practice: 45 seconds
// - Round 1: 150 seconds
// - Round 2: 120 seconds
// - Final:   110 seconds
const ROUNDS = [
  { id: 0, label: "Practice – 45 sec", durationSec: 45, isPractice: true },
  { id: 1, label: "Round 1 – 150 sec (Easy)", durationSec: 150 },
  { id: 2, label: "Round 2 – 120 sec (Medium)", durationSec: 120 },
  { id: 3, label: "Final – 110 sec (Hard)", durationSec: 110 },
];

// Paragraphs are now keyed by round id (0 = Practice, 1 = Round 1, 2 = Round 2, 3 = Final)
// and have been extended so even very fast typists should not run out of content.
const paragraphs = {
  // Practice – normal/general, enough length for 45 seconds
  0: `Welcome to TypeSprint. This practice round is here to help you settle in before the real scoring starts. Sit comfortably, keep your shoulders relaxed, and place your fingers on the home row. Try to type smoothly, not aggressively.

Focus on accuracy first. If you make an error, do not panic—just continue with a steady rhythm. The goal is to warm up your hands, get used to the caret, and understand how the highlighting works.

Take a calm breath. Keep your wrists neutral. Let your eyes move ahead by a few words so you are always prepared for the next characters. By the end of this practice, you should feel confident and ready for Round 1.`,

  // Round 1 – normal general content (easy)
  1: `Everyday typing should feel simple and controlled. Imagine you are writing a clear message to a friend: short sentences, familiar words, and a calm pace. When you stay relaxed, your hands move more efficiently and your mind stays focused.

Try to keep your eyes on the text, not on the keyboard. Use consistent spacing, and avoid rushing. A steady rhythm is usually faster than random bursts of speed.

In this round, aim for clean keystrokes and a smooth flow. If you notice mistakes, correct your technique rather than forcing more speed. Finish strong, and keep your breathing steady until the timer ends.`,

  // Round 2 – technical content (medium)
  2: `In software engineering, small details matter. A single missing character can change a command, break a configuration file, or cause a deployment to fail. Teams use logging, metrics, and tracing to observe systems that run across multiple services.

When investigating an issue, engineers often check request IDs, timestamps, and error rates. They compare expected behavior with actual behavior, then test one hypothesis at a time. Clear notes help everyone understand what changed and why.

In this round, type carefully like you are writing a technical update. Keep consistent punctuation, keep spacing correct, and maintain accuracy even when the words feel unfamiliar.`,

  // Final – mix of normal + technical, complex/hard to type (hard testing)
  3: `Final round: stay calm under pressure. You are writing both a human explanation and a technical checklist at the same time—this is where mistakes happen.

Checklist (type exactly): incident_id=TS-110; region=ap-south-1; retry_count=3; timeout_ms=1500; flags=[beta,true]; thresholds={p95:320,p99:900}; owner="on-call"; note="do-not-skip";

Now switch back to normal writing: the crowd is loud, the clock is ticking, and you still need to stay precise. Do not guess characters. Slow down just enough to be correct.

Then mix again: runbook steps include (1) verify-cache, (2) restart-service, (3) rollback_if_needed. Watch symbols like -, _, =, :, ;, [, ], {, }, and quotes " ". Finish this passage without losing your rhythm or your accuracy.`,
};

// ----- In-memory state -----
let participantsBySocket = new Map(); // socket.id -> { name, college, qualifiedUntilRound, scores, hasSubmittedForRound }
let nameIndex = new Map(); // name (lowercase) -> socket.id

let currentRoundId = null; // 0,1,2,3
let currentRoundTime = null;
let currentParagraph = "";
let roundStartAt = null; // server timestamp (ms) when typing starts, for late joiners
let currentResults = []; // scores for current round only

// history of all scores (per round)
let allResults = []; // { roundId, name, college, wpm, accuracy, correctChars, totalChars }

// auto-qualify after round end: top N from Round 1 go to Round 2, top N from Round 2 go to Final
// CHANGE THESE TWO NUMBERS HERE for real event: use 15 and 5 (for testing now: 3 and 1)
const TOP_AFTER_ROUND_1 = 15;  // e.g. 15 for real competition
const TOP_AFTER_ROUND_2 = 5;  // e.g. 5 for real competition

let qualificationTimeoutId = null;
let timerTickIntervalId = null;
const QUALIFY_BUFFER_SEC = 10; // extra seconds after round end before auto-qualify runs

// Sort by BEST first: accuracy (desc), then WPM (desc). Top of array = top performers.
function sortResults(results) {
  return results.slice().sort((a, b) => {
    const accA = Number(a.accuracy);
    const accB = Number(b.accuracy);
    const wpmA = Number(a.wpm);
    const wpmB = Number(b.wpm);
    if (accB !== accA) return accB - accA; // higher accuracy first
    return wpmB - wpmA; // then higher WPM first
  });
}

function getCurrentRoundConfig() {
  if (!currentRoundId) return null;
  return ROUNDS.find((r) => r.id === currentRoundId) || null;
}

// ----- Socket handlers -----
io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  // Send initial state for late joiners / refreshes (include full round so participant sees trial round)
  const roundDef = currentRoundId != null ? ROUNDS.find((r) => r.id === currentRoundId) : null;
  let remainingSec = undefined;
  if (currentRoundId != null && roundStartAt != null && currentRoundTime != null) {
    const elapsed = Math.max(0, (Date.now() - roundStartAt) / 1000);
    remainingSec = Math.max(0, Math.ceil(currentRoundTime - elapsed));
  }
  socket.emit("state:init", {
    rounds: ROUNDS,
    currentRoundId,
    currentRoundTime,
    currentParagraph: currentParagraph || undefined,
    roundStartAt: roundStartAt || undefined,
    remainingSec,
    currentRoundLabel: roundDef ? roundDef.label : undefined,
    leaderboard: sortResults(currentResults),
    participants: Array.from(participantsBySocket.values()).map((p) => ({
      name: p.name,
      college: p.college,
      qualifiedUntilRound: p.qualifiedUntilRound,
    })),
  });

  socket.on("register", ({ name, college }) => {
    if (!name || !college) {
      socket.emit("register:result", {
        success: false,
        message: "Name and college are required.",
      });
      return;
    }

    const key = name.trim().toLowerCase();
    if (nameIndex.has(key) && nameIndex.get(key) !== socket.id) {
      socket.emit("register:result", {
        success: false,
        message: "This name is already registered.",
      });
      return;
    }

    const participant = {
      socketId: socket.id,
      name: name.trim(),
      college: college.trim(),
      qualifiedUntilRound: 1, // by default, can participate in Round 1
      scores: [],
      hasSubmittedForRound: {},
    };

    participantsBySocket.set(socket.id, participant);
    nameIndex.set(key, socket.id);

    // Persist or update participant in MongoDB (fire-and-forget)
    Participant.findOneAndUpdate(
      { name: participant.name },
      {
        name: participant.name,
        college: participant.college,
        qualifiedUntilRound: participant.qualifiedUntilRound,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch((err) => {
      console.error("Error saving participant to MongoDB", err);
    });

    socket.emit("register:result", {
      success: true,
      message: "Registered successfully. Waiting for admin to start.",
      participant: {
        name: participant.name,
        college: participant.college,
        qualifiedUntilRound: participant.qualifiedUntilRound,
      },
    });

    io.emit("participants:update", Array.from(participantsBySocket.values()).map((p) => ({
      name: p.name,
      college: p.college,
      qualifiedUntilRound: p.qualifiedUntilRound,
    })));
  });

  // Player score submission (allowed for round 0 = Practice, 1, 2, 3) - registration mandatory
  socket.on("submitScore", (payload) => {
    const participant = participantsBySocket.get(socket.id);
    if (!participant || (currentRoundId !== 0 && currentRoundId !== 1 && currentRoundId !== 2 && currentRoundId !== 3)) return;

    // Prevent multiple submissions per round
    if (participant.hasSubmittedForRound[currentRoundId]) return;

    const {
      wpm,
      accuracy,
      correctChars,
      totalChars,
    } = payload || {};

    if (
      typeof wpm !== "number" ||
      typeof accuracy !== "number" ||
      typeof correctChars !== "number" ||
      typeof totalChars !== "number"
    ) {
      return;
    }

    const score = {
      roundId: currentRoundId,
      name: participant.name,
      college: participant.college,
      wpm,
      accuracy,
      correctChars,
      totalChars,
    };

    participant.scores.push(score);
    participant.hasSubmittedForRound[currentRoundId] = true;
    currentResults.push(score);
    allResults.push(score);

    // Persist score in MongoDB (fire-and-forget)
    const scoreDoc = new Score(score);
    scoreDoc
      .save()
      .then(() => {
        return Participant.findOneAndUpdate(
          { name: participant.name },
          {
            $set: { qualifiedUntilRound: participant.qualifiedUntilRound },
            $push: { scores: score },
          },
          { upsert: true }
        );
      })
      .catch((err) => {
        console.error("Error saving score to MongoDB", err);
      });

    const sorted = sortResults(currentResults);
    io.emit("updateLeaderboard", {
      roundId: currentRoundId,
      results: sorted,
    });
  });

  // Admin: start round with a given roundId (0 = Practice, 1 = Round 1, 2 = Round 2, 3 = Final)
  socket.on("admin:startRound", (roundId) => {
    if (qualificationTimeoutId) {
      clearTimeout(qualificationTimeoutId);
      qualificationTimeoutId = null;
    }

    const roundIdNum = Number(roundId);
    if (!Number.isInteger(roundIdNum) || roundIdNum < 0 || roundIdNum > 3) return;
    const round = ROUNDS.find((r) => r.id === roundIdNum);
    if (!round) return;

    currentRoundId = roundIdNum;
    currentRoundTime = round.durationSec;
    currentParagraph = paragraphs[roundIdNum];
    currentResults = [];

    // reset per-round submission flags
    participantsBySocket.forEach((p) => {
      p.hasSubmittedForRound[currentRoundId] = false;
    });

    const startAt = Date.now() + COUNTDOWN_MS;
    roundStartAt = startAt;
    // Clear any existing timer tick
    if (timerTickIntervalId) {
      clearInterval(timerTickIntervalId);
      timerTickIntervalId = null;
    }
    // Start server-authoritative timer after countdown (fixes clock drift on remote clients)
    setTimeout(() => {
      if (currentRoundId !== roundIdNum) return;
      let elapsed = 0;
      const tick = () => {
        elapsed = Math.max(0, (Date.now() - roundStartAt) / 1000);
        const remaining = Math.max(0, Math.ceil(currentRoundTime - elapsed));
        io.emit("timerTick", { roundId: currentRoundId, remaining });
        if (remaining <= 0) {
          if (timerTickIntervalId) {
            clearInterval(timerTickIntervalId);
            timerTickIntervalId = null;
          }
        }
      };
      tick(); // emit immediately
      timerTickIntervalId = setInterval(tick, 1000);
    }, COUNTDOWN_MS);
    // Who can participate this round: Practice & Round 1 = registered only; Round 2+ = only qualified
    const qualifiedForThisRound =
      roundIdNum === 0 || roundIdNum === 1
        ? Array.from(participantsBySocket.values()).map((p) => p.name.trim())
        : Array.from(participantsBySocket.values())
            .filter((p) => p.qualifiedUntilRound >= roundIdNum)
            .map((p) => p.name.trim());
    io.emit("roundStarted", {
      roundId: currentRoundId,
      label: round.label,
      time: currentRoundTime,
      paragraph: currentParagraph,
      startAt,
      qualifiedForThisRound,
    });
    if (roundIdNum === 0) {
      io.emit("practiceStarted", {
        label: round.label,
        time: currentRoundTime,
        paragraph: currentParagraph,
        startAt,
      });
    }

    // Auto-qualify after round ends: Round 1 → top N for Round 2, Round 2 → top N for Final (not for Practice or Final)
    if (roundIdNum === 1 || roundIdNum === 2) {
      const topN = roundIdNum === 1 ? TOP_AFTER_ROUND_1 : TOP_AFTER_ROUND_2;
      // Wait for full countdown + full round duration + small buffer,
      // so elimination/qualification never fires while the timer is still visibly running.
      const totalBufferSec = QUALIFY_BUFFER_SEC + COUNTDOWN_MS / 1000;
      const delayMs = (currentRoundTime + totalBufferSec) * 1000;
      qualificationTimeoutId = setTimeout(() => {
        qualificationTimeoutId = null;
        if (currentRoundId !== roundIdNum) return;
        if (currentResults.length === 0) return;

        const sorted = sortResults(currentResults);
        // Top N = first N in sorted array (best accuracy, then best WPM)
        const topPerformers = sorted.slice(0, topN);
        const nextRoundId = currentRoundId + 1;

        topPerformers.forEach((score) => {
          const key = (score.name || "").trim().toLowerCase();
          if (!key) return;
          const sid = nameIndex.get(key);
          if (!sid) return;
          const p = participantsBySocket.get(sid);
          if (!p) return;
          if (p.qualifiedUntilRound < nextRoundId) {
            p.qualifiedUntilRound = nextRoundId;
            // Update participant qualification in MongoDB (fire-and-forget)
            Participant.updateOne(
              { name: p.name },
              { $set: { qualifiedUntilRound: p.qualifiedUntilRound } }
            ).catch((err) => {
              console.error("Error updating participant qualification", err);
            });
          }
        });

        const qualifiedList = Array.from(participantsBySocket.values())
          .filter((p) => p.qualifiedUntilRound >= nextRoundId)
          .map((p) => ({
            name: p.name,
            college: p.college,
            qualifiedUntilRound: p.qualifiedUntilRound,
          }));

        // Send exactly the names we marked qualified (same order as leaderboard: best first)
        const qualifiedNames = topPerformers
          .map((s) => (s.name || "").trim())
          .filter(Boolean)
          .filter((name, idx, arr) => arr.findIndex((n) => n.toLowerCase() === name.toLowerCase()) === idx);

        io.emit("admin:qualifiedUpdate", {
          nextRoundId,
          qualified: qualifiedList,
        });
        io.emit("player:qualificationResult", {
          roundId: currentRoundId,
          nextRoundId,
          qualifiedNames,
          topN,
        });
      }, delayMs);
    }
  });

  // Admin: reset entire competition
  socket.on("admin:resetCompetition", () => {
    if (qualificationTimeoutId) {
      clearTimeout(qualificationTimeoutId);
      qualificationTimeoutId = null;
    }
    if (timerTickIntervalId) {
      clearInterval(timerTickIntervalId);
      timerTickIntervalId = null;
    }
    currentRoundId = null;
    currentRoundTime = null;
    currentParagraph = "";
    roundStartAt = null;
    currentResults = [];
    allResults = [];
    participantsBySocket.forEach((p) => {
      p.qualifiedUntilRound = 1;
      p.scores = [];
      p.hasSubmittedForRound = {};
    });

    io.emit("admin:competitionReset");
    io.emit("participants:update", Array.from(participantsBySocket.values()).map((p) => ({
      name: p.name,
      college: p.college,
      qualifiedUntilRound: p.qualifiedUntilRound,
    })));
  });

  // Admin: request latest results for export
  socket.on("admin:requestResults", () => {
    // Round-wise sorted results for exports:
    // 1) by roundId ascending (Practice, Round 1, Round 2, Final),
    // 2) within each round by best accuracy, then best WPM.
    const allResultsByRound = allResults.slice().sort((a, b) => {
      if (a.roundId !== b.roundId) return a.roundId - b.roundId;
      const accA = Number(a.accuracy);
      const accB = Number(b.accuracy);
      const wpmA = Number(a.wpm);
      const wpmB = Number(b.wpm);
      if (accB !== accA) return accB - accA;
      return wpmB - wpmA;
    });

    socket.emit("admin:resultsData", {
      currentRoundId,
      rounds: ROUNDS,
      currentRoundResults: sortResults(currentResults),
      allResults: allResultsByRound,
    });
  });

  socket.on("disconnect", () => {
    const participant = participantsBySocket.get(socket.id);
    if (participant) {
      const key = participant.name.trim().toLowerCase();
      if (nameIndex.get(key) === socket.id) {
        nameIndex.delete(key);
      }
      participantsBySocket.delete(socket.id);

      io.emit("participants:update", Array.from(participantsBySocket.values()).map((p) => ({
        name: p.name,
        college: p.college,
        qualifiedUntilRound: p.qualifiedUntilRound,
      })));
    }
    console.log("User disconnected", socket.id);
  });
});

// ----- Start server (with graceful fallback if MongoDB is unreachable) -----
function startHttpServer() {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`TypeSprint server running on port ${PORT}`);
  });
}

mongoose
  .connect(MONGODB_URL, {
    serverSelectionTimeoutMS: 15000,
  })
  .then(() => {
    console.log("Connected to MongoDB");
    startHttpServer();
  })
  .catch((err) => {
    console.error(
      "Failed to connect to MongoDB. Continuing with in-memory storage only. Error:",
      err
    );
    // For local development or restricted networks, still run the event server
    startHttpServer();
  });