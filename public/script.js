(() => {
  const socket = io();

  const bodyRole = document.body.getAttribute("data-role");

  // Theme toggle (shared)
  const savedTheme = localStorage.getItem("typesprint-theme") || "dark";
  document.body.setAttribute("data-theme", savedTheme);
  function applyThemeIcon(iconEl, theme) {
    if (iconEl) iconEl.textContent = theme === "light" ? "☀️" : "🌙";
  }
  const elThemeToggle = document.getElementById("btn-theme-toggle");
  const elThemeIcon = document.getElementById("theme-icon");
  const elThemeToggleLogin = document.getElementById("btn-theme-toggle-login");
  const elThemeIconLogin = document.getElementById("theme-icon-login");
  [elThemeIcon, elThemeIconLogin].forEach((el) => applyThemeIcon(el, savedTheme));

  function updateFullscreenButtonLabel(isFullscreen) {
    const btn = document.getElementById("btn-toggle-fullscreen");
    if (!btn) return;
    btn.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
  }

  function toggleTheme() {
    const next = document.body.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.body.setAttribute("data-theme", next);
    [elThemeIcon, elThemeIconLogin].forEach((el) => applyThemeIcon(el, next));
    localStorage.setItem("typesprint-theme", next);
  }
  if (elThemeToggle) elThemeToggle.addEventListener("click", toggleTheme);
  if (elThemeToggleLogin) elThemeToggleLogin.addEventListener("click", toggleTheme);

  // keep fullscreen label in sync when user exits via ESC or browser UI
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButtonLabel(!!document.fullscreenElement);
  });

  // ---- Shared helpers ----
  function preventCheat() {
    window.addEventListener(
      "contextmenu",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          const k = e.key.toLowerCase();
          if (k === "c" || k === "v" || k === "x" || k === "a") {
            e.preventDefault();
          }
        }
      },
      { passive: false }
    );
  }

  function formatTimer(sec) {
    if (sec == null) return "Waiting…";
    return String(Math.max(0, Math.floor(sec)));
  }

  function buildCsv(rows) {
    const escapeCell = (value) => {
      const s = String(value ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    return rows.map((r) => r.map(escapeCell).join(",")).join("\n");
  }

  function triggerDownload(filename, mimeType, data) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---- Player logic ----
  if (bodyRole === "player") {
    preventCheat();
    window.addEventListener("beforeunload", (e) => {
      e.preventDefault();
      e.returnValue = "If you refresh or leave this page, you will be disqualified.";
    });

    const elName = document.getElementById("player-name");
    const elCollege = document.getElementById("player-college");
    const elBtnRegister = document.getElementById("btn-register");
    const elStatusPill = document.getElementById("player-status-pill");
    const elStatusText = document.getElementById("player-status-text");
    const elTimer = document.getElementById("player-timer");
    const elRoundBadge = document.getElementById("player-current-round-badge");
    const elRoundLabel = document.getElementById("player-round-label");
    const elTypingShell = document.getElementById("typing-shell");
    const elParagraph = document.getElementById("typing-paragraph");
    const elInput = document.getElementById("typing-input");
    const elCountdownOverlay = document.getElementById("typing-countdown");
    const elCountdownNumber = document.getElementById(
      "typing-countdown-number"
    );
    const elAnnouncement = document.getElementById("player-announcement");
    const elLeaderboardBody = document.getElementById(
      "leaderboard-body-player"
    );
    const elBtnFullscreen = document.getElementById("btn-toggle-fullscreen");
    const elQualifiedMessage = document.getElementById("player-qualified-msg");
    const elEliminatedMessage = document.getElementById("player-eliminated-msg");

    let registered = false;
    let lockedIdentity = null;
    let qualifiedUntilRound = 1;
    let eliminatedAfterRound = null;
    let roundTime = null;
    let totalTime = null;
    let timerInterval = null;
    let countdownTimeout = null;

    let originalText = "";
    let charSpans = [];
    let typedText = "";
    let caretEl = null;
    let prevTypedLength = 0;
    let currentRoundId = null;

    // initialize fullscreen button label once DOM is ready
    updateFullscreenButtonLabel(!!document.fullscreenElement);

    function setStatusPill(state, text) {
      elStatusPill.classList.remove(
        "status-pill--idle",
        "status-pill--ready",
        "status-pill--running"
      );
      if (state === "ready") elStatusPill.classList.add("status-pill--ready");
      else if (state === "running")
        elStatusPill.classList.add("status-pill--running");
      else elStatusPill.classList.add("status-pill--idle");
      elStatusText.textContent = text;
    }

    function renderParagraphHighlighted() {
      elParagraph.innerHTML = "";
      charSpans = [];
      prevTypedLength = 0;
      for (let i = 0; i < originalText.length; i++) {
        const span = document.createElement("span");
        const ch = originalText[i];
        span.className = "char-span" + (ch === " " ? " char-space" : "");
        if (ch === "\n") {
          span.textContent = "\n";
        } else {
          // use a normal space so the browser can wrap between words
          span.textContent = ch === " " ? " " : ch;
        }
        charSpans.push(span);
        elParagraph.appendChild(span);
      }
      caretEl = document.createElement("span");
      caretEl.className = "caret";
      caretEl.setAttribute("aria-hidden", "true");
      elParagraph.appendChild(caretEl);
      updateCharClasses();
    }

    function updateCharClasses() {
      const len = typedText.length;
      const maxTouched = Math.min(
        charSpans.length,
        Math.max(len, prevTypedLength) + 1
      );

      for (let i = 0; i < maxTouched; i++) {
        const span = charSpans[i];
        if (!span) continue;
        span.classList.remove("correct", "incorrect", "current");
        if (i < len) {
          if (typedText[i] === originalText[i]) {
            span.classList.add("correct");
          } else {
            span.classList.add("incorrect");
          }
        } else if (i === len) {
          span.classList.add("current");
        }
      }

      prevTypedLength = len;

      // Position caret before the next character to type (Word-style), using minimal layout work
      if (!caretEl || !charSpans.length) return;
      const targetIndex = Math.min(len, charSpans.length - 1);
      const targetSpan = charSpans[targetIndex];
      if (!targetSpan) return;
      const rect = targetSpan.getBoundingClientRect();
      const hostRect = elParagraph.getBoundingClientRect();
      const isEndOfText = len >= charSpans.length;
      caretEl.style.left = `${
        (isEndOfText ? rect.right : rect.left) - hostRect.left
      }px`;
      caretEl.style.top = `${rect.top - hostRect.top}px`;
      caretEl.style.height = `${rect.height}px`;
      caretEl.style.display = "block";
    }

    function resetRoundVisuals() {
      typedText = "";
      if (elInput) {
        elInput.value = "";
      }
      if (!originalText) {
        elParagraph.textContent =
          "Waiting for admin to start the first round.";
        return;
      }
      renderParagraphHighlighted();
    }

    function startCountdownAndTimer(timeSeconds, startAt) {
      clearInterval(timerInterval);
      if (countdownTimeout) clearInterval(countdownTimeout);
      if (!originalText) return;

      roundTime = timeSeconds;
      totalTime = timeSeconds;
      elTimer.textContent = formatTimer(roundTime);

      elCountdownOverlay.style.display = "flex";
      const syncTick = () => {
        const now = Date.now();
        const msLeft = startAt - now;
        if (msLeft <= 0) {
          clearInterval(countdownTimeout);
          countdownTimeout = null;
          // Hide countdown and start typing exactly when the server timer starts
          elCountdownOverlay.style.display = "none";
          beginTimer();
          return;
        }
        const secLeft = Math.ceil(msLeft / 1000);
        // Show a simple 3..2..1..Go countdown
        if (secLeft > 3) {
          elCountdownNumber.textContent = "3";
        } else if (secLeft === 3) {
          elCountdownNumber.textContent = "3";
        } else if (secLeft === 2) {
          elCountdownNumber.textContent = "2";
        } else if (secLeft === 1) {
          elCountdownNumber.textContent = "1";
        } else {
          elCountdownNumber.textContent = "Go!";
        }
      };
      syncTick();
      countdownTimeout = setInterval(syncTick, 100);
    }

    function beginTimer() {
      if (!roundTime) return;
      setStatusPill("running", "Round in progress");
      elInput.disabled = false;
      elInput.focus();
      // Timer is now driven by server ticks (timerTick) - no local setInterval to avoid clock drift on remote clients
    }

    function submitScore() {
      if (!originalText || totalTime == null) return;

      let correctChars = 0;
      const totalCharsTyped = typedText.length;
      const maxIdx = Math.min(typedText.length, originalText.length);
      for (let i = 0; i < maxIdx; i++) {
        if (typedText[i] === originalText[i]) correctChars++;
      }

      // Accuracy = correct / total typed (Monkeytype-style). If nothing typed, 100% (no mistakes).
      const accuracy =
        totalCharsTyped > 0
          ? (correctChars / totalCharsTyped) * 100
          : 100;
      const minutes = totalTime / 60;
      const wpm =
        minutes > 0 ? (correctChars / 5) / minutes : 0;

      socket.emit("submitScore", {
        wpm: Number(wpm.toFixed(2)),
        accuracy: Number(accuracy.toFixed(2)),
        correctChars,
        totalChars: totalCharsTyped,
      });

      elAnnouncement.innerHTML =
        "Round finished. Your entry has been recorded.";
    }

    elTypingShell.addEventListener("click", () => {
      if (!elInput.disabled) {
        elInput.focus();
      }
    });

    elInput.addEventListener("input", () => {
      const value = elInput.value;
      typedText = value;
      updateCharClasses();
    });

    elInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
      }
    });

    elBtnRegister.addEventListener("click", () => {
      if (registered) return;
      const name = elName.value.trim();
      const college = elCollege.value.trim();
      socket.emit("register", { name, college });
    });

    elBtnFullscreen.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          updateFullscreenButtonLabel(true);
        } else {
          await document.exitFullscreen();
          updateFullscreenButtonLabel(false);
        }
      } catch {
        // ignore
      }
    });

    // Socket events
    socket.on("state:init", (state) => {
      const sid = state.currentRoundId;
      if (sid != null) {
        currentRoundId = sid;
        const roundDef = (state.rounds || []).find((r) => r.id === sid);
        const label = state.currentRoundLabel || (roundDef && roundDef.label);
        if (label) elRoundLabel.textContent = label;
        // If a round is running and we have paragraph + start time, show the round (fixes trial round not showing for participants)
        if (state.currentParagraph && state.roundStartAt != null && state.currentRoundTime != null) {
          const startAt = state.roundStartAt;
          const now = Date.now();
          const isPractice = sid === 0;
          const canParticipate =
            lockedIdentity &&
            (isPractice || (eliminatedAfterRound === null && qualifiedUntilRound >= sid));
          if (!lockedIdentity) {
            setStatusPill("idle", "Register first to participate");
            elAnnouncement.textContent = "You must register before you can participate in any round.";
            elParagraph.textContent = "Please register with your name and college to participate.";
          } else if (canParticipate) {
            originalText = state.currentParagraph;
            roundTime = state.currentRoundTime;
            totalTime = state.currentRoundTime;
            setStatusPill("ready", "Get ready…");
            elAnnouncement.innerHTML = isPractice
              ? '<span class="announcement-strong">Practice round.</span> Get familiar with the software.'
              : '<span class="announcement-strong">Round in progress.</span> Join and type.';
            if (elEliminatedMessage) elEliminatedMessage.style.display = "none";
            resetRoundVisuals();
            if (now < startAt) {
              startCountdownAndTimer(state.currentRoundTime, startAt);
            } else {
              const remaining = typeof state.remainingSec === "number" ? state.remainingSec : 0;
              if (remaining > 0) {
                roundTime = remaining;
                totalTime = state.currentRoundTime;
                elTimer.textContent = formatTimer(roundTime);
                setStatusPill("running", "Round in progress");
                elInput.disabled = false;
                elInput.focus();
                // Timer updates come from server (timerTick) - no local setInterval
              } else {
                elTimer.textContent = "0";
                setStatusPill("idle", "Round ended");
              }
            }
          }
        }
      }
      if (state.participants && lockedIdentity) {
        const me = state.participants.find(
          (p) =>
            p.name &&
            p.name.trim().toLowerCase() ===
              lockedIdentity.name.trim().toLowerCase()
        );
        if (me) qualifiedUntilRound = me.qualifiedUntilRound ?? 1;
      }
      if (state.leaderboard && state.leaderboard.length > 0) {
        renderLeaderboard(state.leaderboard);
      }
    });

    socket.on("register:result", (payload) => {
      if (!payload) return;
      if (payload.success) {
        registered = true;
        lockedIdentity = payload.participant;
        qualifiedUntilRound = lockedIdentity.qualifiedUntilRound ?? 1;
        elName.value = lockedIdentity.name;
        elCollege.value = lockedIdentity.college;
        elName.disabled = true;
        elCollege.disabled = true;
        elBtnRegister.disabled = true;
        setStatusPill("ready", "Registered – waiting for round");
        elAnnouncement.textContent = payload.message || "";
        if (elEliminatedMessage) elEliminatedMessage.style.display = "none";
      } else {
        setStatusPill("idle", payload.message || "Registration failed");
        elAnnouncement.textContent = payload.message || "";
      }
    });

    function startRoundUI(data, isPractice) {
      originalText = data.paragraph || "";
      elRoundLabel.textContent = data.label || "Round started";
      roundTime = data.time;
      totalTime = data.time;
      // Use the server-provided startAt so that all players share the same start time.
      // If for some reason it's missing, fall back to a local 3 second countdown.
      const startAt =
        typeof data.startAt === "number" ? data.startAt : Date.now() + 3000;
      setStatusPill("ready", "Get ready…");
      elAnnouncement.innerHTML = isPractice
        ? '<span class="announcement-strong">Practice round.</span> Get familiar with the software.'
        : '<span class="announcement-strong">Round starting!</span> Watch the countdown, then type.';
      if (elEliminatedMessage) elEliminatedMessage.style.display = "none";
      resetRoundVisuals();
      startCountdownAndTimer(data.time, startAt);
    }

    socket.on("practiceStarted", (data) => {
      if (!data || !data.paragraph) return;
      currentRoundId = 0;
      if (!lockedIdentity) {
        setStatusPill("idle", "Register first to participate");
        elAnnouncement.textContent = "You must register before you can participate in any round.";
        return;
      }
      startRoundUI(
        {
          label: data.label || "Practice – 45 sec",
          time: data.time,
          paragraph: data.paragraph,
          startAt: data.startAt,
        },
        true
      );
    });

    socket.on("roundStarted", (data) => {
      const rid = Number(data.roundId);
      currentRoundId = rid;
      if (rid === 0) {
        return;
      }
      originalText = data.paragraph || "";
      elRoundLabel.textContent = data.label || "Round started";
      roundTime = data.time;
      totalTime = data.time;
      const startAt = typeof data.startAt === "number" ? data.startAt : Date.now() + 3000;

      const isRoundOne = rid === 1;

      let canParticipate = false;
      if (isRoundOne) {
        canParticipate = !!lockedIdentity;
      } else {
        const qualifiedList = data.qualifiedForThisRound || [];
        const myName = lockedIdentity ? lockedIdentity.name.trim().toLowerCase() : "";
        const amInList = qualifiedList.some(
          (n) => String(n).trim().toLowerCase() === myName
        );
        canParticipate = !!lockedIdentity && amInList;
        if (canParticipate && rid >= 2) {
          qualifiedUntilRound = Math.max(qualifiedUntilRound, rid);
        }
      }

      if (!canParticipate) {
        setStatusPill("idle", "Not qualified for this round");
        elAnnouncement.innerHTML =
          "You are not qualified for this round. Only participants who made the cut can continue.";
        if (elEliminatedMessage)
          elEliminatedMessage.style.display =
            eliminatedAfterRound != null ? "block" : "none";
        if (elQualifiedMessage) elQualifiedMessage.style.display = "none";
        resetRoundVisuals();
        elTimer.textContent = formatTimer(data.time);
        return;
      }

      startRoundUI(data, false);
    });

    socket.on("updateLeaderboard", (payload) => {
      if (!payload || !payload.results) return;
      renderLeaderboard(payload.results);
    });

    socket.on("timerTick", (payload) => {
      if (!payload || payload.roundId !== currentRoundId) return;
      const remaining = payload.remaining;
      roundTime = remaining;
      elTimer.textContent = formatTimer(remaining);
      if (remaining <= 0) {
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        elInput.disabled = true;
        submitScore();
      }
    });

    socket.on("admin:competitionReset", () => {
      qualifiedUntilRound = 1;
      eliminatedAfterRound = null;
      if (elQualifiedMessage) elQualifiedMessage.style.display = "none";
      if (elEliminatedMessage) elEliminatedMessage.style.display = "none";
    });

    socket.on("player:qualificationResult", (payload) => {
      if (!payload || !lockedIdentity) return;
      const myName = lockedIdentity.name.trim();
      const inList = (payload.qualifiedNames || []).some(
        (n) => String(n).trim().toLowerCase() === myName.toLowerCase()
      );
      if (inList) {
        qualifiedUntilRound = payload.nextRoundId ?? qualifiedUntilRound;
        if (elEliminatedMessage) elEliminatedMessage.style.display = "none";
        const qualifiedText =
          payload.nextRoundId === 2
            ? "You are qualified for Round 2!"
            : payload.nextRoundId === 3
            ? "You are qualified for the Final!"
            : "You are through to the next round.";
        if (elQualifiedMessage) {
          elQualifiedMessage.innerHTML = "<strong>" + qualifiedText + "</strong>";
          elQualifiedMessage.style.display = "block";
        }
        elAnnouncement.innerHTML = "<span class=\"announcement-strong\">" + qualifiedText + "</span>";
      } else {
        eliminatedAfterRound = payload.roundId;
        if (elQualifiedMessage) elQualifiedMessage.style.display = "none";
        if (elEliminatedMessage) {
          elEliminatedMessage.style.display = "block";
          const roundLabel =
            payload.roundId === 1
              ? "Round 1"
              : payload.roundId === 2
              ? "Round 2"
              : "this round";
          elEliminatedMessage.innerHTML =
            "<strong>You have been eliminated after " + roundLabel + ".</strong> You will not participate in the next rounds.";
        }
        elAnnouncement.innerHTML =
          "You have been eliminated. Thank you for participating.";
      }
    });

    function renderLeaderboard(results) {
      elLeaderboardBody.innerHTML = "";
      if (!results.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 5;
        td.className = "text-center small muted";
        td.textContent = "Waiting for scores…";
        tr.appendChild(td);
        elLeaderboardBody.appendChild(tr);
        return;
      }

      results.forEach((r, idx) => {
        const tr = document.createElement("tr");

        const tdRank = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "rank-badge";
        if (idx === 0) badge.classList.add("rank-1");
        else if (idx === 1) badge.classList.add("rank-2");
        else if (idx === 2) badge.classList.add("rank-3");
        badge.textContent = String(idx + 1);
        tdRank.appendChild(badge);

        const tdName = document.createElement("td");
        tdName.textContent = r.name;

        const tdCollege = document.createElement("td");
        tdCollege.textContent = r.college || "-";

        const tdAcc = document.createElement("td");
        tdAcc.textContent = `${r.accuracy.toFixed(2)}%`;

        const tdWpm = document.createElement("td");
        tdWpm.textContent = r.wpm.toFixed(2);

        tr.appendChild(tdRank);
        tr.appendChild(tdName);
        tr.appendChild(tdCollege);
        tr.appendChild(tdAcc);
        tr.appendChild(tdWpm);
        elLeaderboardBody.appendChild(tr);
      });
    }
  }

  // ---- Admin logic ----
  if (bodyRole === "admin") {
    preventCheat();

    const ADMIN_USERNAME = "Admin";
    const ADMIN_PASSWORD = "Admin";

    const elLoginScreen = document.getElementById("admin-login-screen");
    const elDashboard = document.getElementById("admin-dashboard");
    const elAdminUsername = document.getElementById("admin-username");
    const elAdminPassword = document.getElementById("admin-password");
    const elBtnAdminLogin = document.getElementById("btn-admin-login");
    const elLoginError = document.getElementById("admin-login-error");

    function tryAdminLogin() {
      const username = (elAdminUsername.value || "").trim();
      const password = (elAdminPassword.value || "").trim();
      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        elLoginScreen.style.display = "none";
        elDashboard.style.display = "";
        elLoginError.style.display = "none";
      } else {
        elLoginError.style.display = "block";
      }
    }

    const elAdminLoginForm = document.getElementById("admin-login-form");
    if (elAdminLoginForm) {
      elAdminLoginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        tryAdminLogin();
      });
    }
    elBtnAdminLogin.addEventListener("click", (e) => {
      e.preventDefault();
      tryAdminLogin();
    });

    window.addEventListener("beforeunload", (e) => {
      e.preventDefault();
      e.returnValue = "If you refresh or leave this page, you may lose admin control.";
    });

    const elRoundBadge = document.getElementById("admin-round-badge");
    const elRoundLabel = document.getElementById("admin-round-label");
    const elStatusPill = document.getElementById("admin-status-pill");
    const elStatusText = document.getElementById("admin-status-text");
    const elRoundSelect = document.getElementById("admin-round-select");
    const elBtnStartRound = document.getElementById("btn-admin-start-round");
    const elBtnReset = document.getElementById("btn-admin-reset");
    const elActiveCount = document.getElementById("admin-active-count");
    const elQualifiedCount = document.getElementById("admin-qualified-count");
    const elLeaderboardBody = document.getElementById(
      "leaderboard-body-admin"
    );
    const elParticipantsBody = document.getElementById(
      "participants-body-admin"
    );
    const elBtnExportCsv = document.getElementById("btn-export-csv");

    let currentRoundId = null;
    let latestResultsPayload = null;
    let latestParticipants = [];

    function setStatus(state, text) {
      elStatusPill.classList.remove(
        "status-pill--idle",
        "status-pill--ready",
        "status-pill--running"
      );
      if (state === "ready") elStatusPill.classList.add("status-pill--ready");
      else if (state === "running")
        elStatusPill.classList.add("status-pill--running");
      else elStatusPill.classList.add("status-pill--idle");
      elStatusText.textContent = text;
    }

    elBtnStartRound.addEventListener("click", () => {
      const roundId = parseInt(elRoundSelect.value, 10);
      if (roundId < 0 || isNaN(roundId)) return;
      currentRoundId = roundId;
      setStatus("running", "Round running");
      const label =
        roundId === 0
          ? "Practice – 45 sec"
          : roundId === 1
          ? "Round 1 – 150 sec (Easy)"
          : roundId === 2
          ? "Round 2 – 120 sec (Medium)"
          : "Final – 110 sec (Hard)";
      elRoundLabel.textContent = label;
      socket.emit("admin:startRound", roundId);
    });

    elBtnReset.addEventListener("click", () => {
      if (!window.confirm("Reset entire competition? This cannot be undone.")) {
        return;
      }
      socket.emit("admin:resetCompetition");
    });

    elBtnExportCsv.addEventListener("click", () => {
      socket.emit("admin:requestResults");
    });

    // Socket handlers
    socket.on("state:init", (state) => {
      currentRoundId = state.currentRoundId || null;
      if (currentRoundId) {
        const roundDef = (state.rounds || []).find(
          (r) => r.id === currentRoundId
        );
        if (roundDef) {
          elRoundLabel.textContent = roundDef.label;
          setStatus("running", "Round running");
        }
      } else {
        elRoundLabel.textContent = "No round running";
        setStatus("idle", "Waiting to start");
      }

      if (state.participants) {
        latestParticipants = state.participants;
        renderParticipants(latestParticipants);
      }
    });

    socket.on("updateLeaderboard", (payload) => {
      if (!payload || !payload.results) return;
      renderLeaderboard(payload.results, payload.roundId);
      latestResultsPayload = {
        currentRoundId: payload.roundId,
        currentRoundResults: payload.results,
      };
    });

    socket.on("participants:update", (list) => {
      latestParticipants = list || [];
      renderParticipants(latestParticipants);
    });

    socket.on("admin:qualifiedUpdate", (payload) => {
      if (!payload) return;
      renderParticipants(payload.qualified || latestParticipants);
    });

    socket.on("admin:competitionReset", () => {
      currentRoundId = null;
      latestResultsPayload = null;
      elRoundLabel.textContent = "No round running";
      setStatus("idle", "Waiting to start");
      elLeaderboardBody.innerHTML = `
        <tr><td colspan="7" class="text-center small muted">Waiting for scores…</td></tr>
      `;
    });

    socket.on("admin:resultsData", (payload) => {
      latestResultsPayload = payload;
      // CSV export
      if (payload && payload.currentRoundResults) {
        const rows = [
          ["Name", "College", "Round", "Accuracy", "WPM", "Correct Chars", "Total Chars"],
        ];
        const roundsById = {};
        (payload.rounds || []).forEach((r) => {
          roundsById[r.id] = r.label;
        });
        payload.allResults.forEach((r) => {
          rows.push([
            r.name,
            r.college,
            roundsById[r.roundId] || `Round ${r.roundId}`,
            r.accuracy.toFixed(2),
            r.wpm.toFixed(2),
            r.correctChars,
            r.totalChars,
          ]);
        });
        const csv = buildCsv(rows);
        triggerDownload("typesprint-results.csv", "text/csv;charset=utf-8", csv);
      }
    });

    function renderLeaderboard(results, roundId) {
      elLeaderboardBody.innerHTML = "";
      if (!results.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 7;
        td.className = "text-center small muted";
        td.textContent = "Waiting for scores…";
        tr.appendChild(td);
        elLeaderboardBody.appendChild(tr);
        return;
      }

      results.forEach((r, idx) => {
        const tr = document.createElement("tr");

        const tdRank = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "rank-badge";
        if (idx === 0) badge.classList.add("rank-1");
        else if (idx === 1) badge.classList.add("rank-2");
        else if (idx === 2) badge.classList.add("rank-3");
        badge.textContent = String(idx + 1);
        tdRank.appendChild(badge);

        const tdName = document.createElement("td");
        tdName.textContent = r.name;

        const tdCollege = document.createElement("td");
        tdCollege.textContent = r.college || "-";

        const tdRound = document.createElement("td");
        tdRound.textContent =
          roundId === 0
            ? "Practice"
            : roundId === 1
            ? "R1"
            : roundId === 2
            ? "R2"
            : roundId === 3
            ? "Final"
            : `R${roundId}`;

        const tdAcc = document.createElement("td");
        tdAcc.textContent = `${r.accuracy.toFixed(2)}%`;

        const tdWpm = document.createElement("td");
        tdWpm.textContent = r.wpm.toFixed(2);

        const tdChars = document.createElement("td");
        tdChars.textContent = `${r.correctChars}/${r.totalChars}`;

        tr.appendChild(tdRank);
        tr.appendChild(tdName);
        tr.appendChild(tdCollege);
        tr.appendChild(tdRound);
        tr.appendChild(tdAcc);
        tr.appendChild(tdWpm);
        tr.appendChild(tdChars);
        elLeaderboardBody.appendChild(tr);
      });
    }

    function renderParticipants(list) {
      elParticipantsBody.innerHTML = "";
      const total = list.length;
      const qualified = list.filter((p) => (p.qualifiedUntilRound || 1) > 1)
        .length;
      elActiveCount.textContent = `${total} registered`;
      elQualifiedCount.textContent = `${qualified} qualified (Round > 1)`;

      if (!list.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.className = "text-center small muted";
        td.textContent = "No participants yet.";
        tr.appendChild(td);
        elParticipantsBody.appendChild(tr);
        return;
      }

      list.forEach((p) => {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        const tdCollege = document.createElement("td");
        const tdRound = document.createElement("td");

        tdName.textContent = p.name;
        tdCollege.textContent = p.college;
        tdRound.textContent =
          p.qualifiedUntilRound === 1
            ? "R1"
            : p.qualifiedUntilRound === 2
            ? "R2"
            : p.qualifiedUntilRound === 3
            ? "Final"
            : `R${p.qualifiedUntilRound}`;

        tr.appendChild(tdName);
        tr.appendChild(tdCollege);
        tr.appendChild(tdRound);
        elParticipantsBody.appendChild(tr);
      });
    }
  }
})();

