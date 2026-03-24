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
  // ── Practice – 45 sec ── target: 750+ words, easy vocabulary, relaxed tone
  0: `Welcome to TypeSprint. This practice round is here to help you settle in before the real scoring starts. 
  
  Sit comfortably, keep your shoulders relaxed, and place your fingers on the home row. Try to type smoothly, not aggressively. 
  
  Focus on accuracy first. If you make an error, do not panic — just continue with a steady rhythm. 
  
  The goal is to warm up your hands, get used to the caret, and understand how the highlighting works.

. If every keystroke lands correctly the first time, you never have to stop and backspace.`,

  // ── Round 1 – 150 sec ── target: 2,500+ words, easy/general content
  1: `Everyday typing should feel simple and controlled. Imagine you are writing a clear message to a friend: short sentences, familiar words, and a calm pace. When you stay relaxed, your hands move more efficiently and your mind stays focused. Try to keep your eyes on the text, not on the keyboard. Use consistent spacing, and avoid rushing. A steady rhythm is usually faster than random bursts of speed.

In this round, aim for clean keystrokes and a smooth flow. If you notice mistakes, correct your technique rather than forcing more speed. Finish strong, and keep your breathing steady until the timer ends. The best typists in the world share one quality above all others: they do not waste movement. Every finger travels the shortest possible path from one key to the next. Over many thousands of keystrokes, those saved fractions of a second add up to a meaningful advantage.

Think about your daily routine for a moment. You wake up, check your messages, perhaps send a quick reply. You open a document, write a few lines, move on. Most people type for hours every day without ever thinking about how to do it better. This round is your chance to be intentional — to choose accuracy, to choose rhythm, and to let your fingers do their job without interference from your mind.

The history of the keyboard is older than most people realise. The QWERTY layout was designed in the early days of mechanical typewriters, when engineers arranged keys partly to reduce the chance that fast typists would cause the physical hammers to collide and jam. Modern keyboards have no such mechanical constraint, yet the QWERTY layout persists because hundreds of millions of people have already learned it. Changing the layout of a keyboard is a bit like changing which side of the road a country drives on — theoretically possible, practically enormous.

Writing well and typing well are related but different skills. A good writer knows how to organise thoughts, choose the right word, and build a sentence that flows naturally. A good typist knows how to translate those words from the screen into keystrokes without introducing errors or delays. When both skills come together, communication becomes effortless. You stop thinking about the act of typing and start thinking only about the idea you are expressing.

Consider how children learn to type. Most start by hunting and pecking with one or two fingers, looking down at the keyboard after each letter. Over time, with patience and repetition, they learn to keep their eyes on the screen and let muscle memory guide their fingers. The transition from hunt-and-peck to touch typing can take weeks or months, but the improvement in speed and comfort is enormous. Adults who retrain themselves after years of bad habits often find the process frustrating at first but deeply rewarding in the end.

Ergonomics plays a larger role in typing than many people expect. Wrist pain, shoulder tightness, and neck strain are all common complaints among people who type for long periods without thinking about their posture. A keyboard that sits too high forces your wrists upward. A screen that sits too low causes you to hunch your neck. A chair that does not support your lower back shifts weight onto your arms and hands. Small adjustments to each of these factors can eliminate discomfort that you might otherwise assume is just a part of typing.

Accuracy is measured by comparing the characters you typed against the characters in the original text. Every correct character contributes to your score. Every error reduces it. In most typing competitions, accuracy is weighted heavily because it reflects the quality of the output, not just the speed. A message sent with spelling errors and wrong punctuation can confuse the reader or even change the meaning entirely. A message sent correctly, even if a little slower, always communicates better.

Rhythm in typing is similar to rhythm in music. A drummer who plays steadily, even at a moderate tempo, sounds far more professional than a drummer who rushes through some bars and drags through others. The same principle applies to your fingers on the keyboard. Try to keep each keystroke spaced evenly. Do not sprint through easy words and then stumble over longer ones. Maintain your pace, breathe, and trust your training.

As you approach the final stretch of this round, remember everything you have practised. Eyes forward. Shoulders relaxed. Fingers light. Rhythm steady. You have been building toward this moment, and all that preparation is about to pay off. Stay with the text, do not look down, and carry your best effort all the way to the last character.`,

  // ── Round 2 – 120 sec ── target: 2,000+ words, technical content (medium)
  2: `In software engineering, small details matter. A single missing character can change a command, break a configuration file, or cause a deployment to fail. Teams use logging, metrics, and tracing to observe systems that run across multiple services. When investigating an issue, engineers often check request IDs, timestamps, and error rates. They compare expected behaviour with actual behaviour, then test one hypothesis at a time. Clear notes help everyone understand what changed and why.

Version control systems like Git allow developers to track every change made to a codebase over time. Each commit records what changed, who changed it, and when the change was made. Branching lets teams work on multiple features simultaneously without interfering with each other. Merging brings those branches back together, and automated tests verify that the combined result still behaves correctly. Pull requests create a structured review process where peers can comment, suggest improvements, and catch bugs before they reach production.

Databases store the persistent state of an application. Relational databases organise data into tables with rows and columns, and use structured query language to retrieve, insert, update, and delete records. Indexes speed up queries by allowing the database engine to find relevant rows without scanning every record in a table. Transactions ensure that a group of related operations either all succeed or all fail together, which protects data integrity even when something goes wrong partway through.

Networking concepts underpin every modern application. An IP address identifies a device on a network. A port number identifies a specific service or process running on that device. The TCP protocol provides a reliable, ordered stream of data between two endpoints by managing packet sequencing, acknowledgements, and retransmission on failure. The HTTP protocol sits on top of TCP and defines a request-response model where a client sends a request for a resource and the server returns a response with a status code, headers, and a body.

Containerisation has transformed the way applications are packaged and deployed. A container image bundles an application together with all its dependencies, libraries, and configuration files into a single portable unit. Container runtimes like Docker can run these images on any compatible host operating system without requiring the application to be reinstalled or reconfigured. Orchestration platforms like Kubernetes manage fleets of containers across many machines, automatically restarting failed containers, distributing load, and rolling out updates with minimal disruption.

Observability is the practice of building systems that can be understood from the outside by examining their outputs. The three main pillars of observability are logs, metrics, and traces. Logs record discrete events that happen inside a system, such as an error message or a user action. Metrics record numerical measurements over time, such as request count per second or memory usage. Traces record the path that a single request takes through a distributed system, showing which services it touched and how long each step took.

Security considerations are woven into every layer of a well-designed system. At the network layer, firewalls restrict which traffic can enter or leave a system. At the application layer, input validation prevents malicious data from being processed. Authentication verifies the identity of a user or service, while authorisation controls what that identity is allowed to do. Encryption protects data in transit and at rest, ensuring that even if data is intercepted or stolen, it cannot be read without the correct key.

Performance optimisation often begins with measurement. Without data, it is easy to optimise the wrong part of a system. Profiling tools identify which functions consume the most CPU time, which queries take the longest, and which network calls have the highest latency. Once the bottleneck is identified, targeted improvements can produce dramatic results. Caching stores the results of expensive computations so they can be reused quickly. Load balancing distributes incoming requests across multiple servers so that no single machine becomes overwhelmed.

In this round, type carefully as if you are writing a precise technical document. Every symbol, every hyphen, and every capital letter matters. Your accuracy here demonstrates not just typing skill but also careful attention to detail — a quality that is essential in any engineering discipline. Stay focused, keep your pace steady, and carry your precision all the way to the end of the round.`,

  // ── Final – 110 sec ── target: 1,800+ words, mixed hard/technical with symbols
  3: `Final round: stay calm under pressure. This is the hardest passage in the competition, designed to test both your speed and your precision. You will encounter normal prose, technical jargon, special characters, and structured data all in the same passage. The goal is not to rush — the goal is to stay accurate while maintaining a competitive pace.

System configuration example (type exactly as written): service_name=auth-gateway; version=2.4.1; env=production; region=ap-south-1; retry_limit=5; timeout_ms=2000; circuit_breaker={threshold:10,reset_sec:30}; feature_flags=[oauth2,mfa_required,rate_limit]; owner="platform-team"; alert_channel="#ops-critical";

Now return to normal writing. After reading a block of structured data like the one above, many typists lose their rhythm. The key is to treat symbols as ordinary characters — give each one the same calm, deliberate keystroke you would give any letter. Do not tense your fingers when you see a curly brace or a semicolon. Breathe, look ahead, and keep moving.

Incident response runbook (type exactly): step_1=verify-health-endpoint; step_2=check-error-rate; step_3=inspect-logs(tail -n 500 /var/log/app/error.log); step_4=restart_service_if_needed; step_5=rollback_deployment --version=prev; step_6=notify-stakeholders; escalation_path=["on-call-eng","team-lead","vp-engineering"]; sla_breach_threshold_sec=120;

Back to prose: incident response is a skill that improves with practice and with clear documentation. The best runbooks are written during calm periods, not during outages. They are short enough to read quickly under stress but detailed enough to guide someone who is unfamiliar with the system. Every step should have a clear action and a clear expected outcome. If the outcome does not match expectations, the runbook should say what to do next.

Monitoring configuration snippet (type exactly): dashboard_id="ops-prod-001"; panels=[{title:"p95_latency",query:"histogram_quantile(0.95,rate(http_duration_seconds_bucket[5m]))",threshold_ms:300},{title:"error_rate",query:"rate(http_errors_total[1m])",threshold_pct:0.5}]; refresh_interval=15s; alert_policy={send_if:"threshold_exceeded",repeat_after_min:10,auto_resolve:true};

Now finish strong with clear prose. You are nearly at the end. The symbols are behind you, and all that remains is steady, clean typing. This final passage tests whether you can shift gears smoothly — from structured technical data back to natural language — without losing accuracy or pace.

The best competitors in any typing championship share a common trait: they practise deliberately. They do not simply type faster and faster until errors multiply. Instead, they slow down just enough to eliminate mistakes, build clean muscle memory at that accurate speed, and then gradually push the pace upward while keeping errors near zero. Speed without accuracy is noise. Accuracy without speed is insufficient. The combination of both, maintained under pressure, is what separates good typists from great ones.

You have reached the final sentences of this passage. Every character you type correctly from this point forward adds to your score. Do not glance at the keyboard. Do not second-guess your fingers. Trust the training, trust your rhythm, and type the last line with the same calm focus you brought to the very first character.`,
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
      // Emit exactly when typing starts - clients enable on this event, not local clock
      io.emit("roundTypingStart", { roundId: currentRoundId });
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
    // 1) by round in descending event importance:
    //    Final (3) → Round 2 (2) → Round 1 (1) → Practice (0),
    // 2) within each round by best accuracy, then best WPM.
    const allResultsByRound = allResults.slice().sort((a, b) => {
      if (a.roundId !== b.roundId) {
        const weight = (roundId) => {
          if (roundId === 3) return 0; // Final
          if (roundId === 2) return 1; // Round 2
          if (roundId === 1) return 2; // Round 1
          return 3; // Practice or any other
        };
        return weight(a.roundId) - weight(b.roundId);
      }
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
