/* ==========================================================================
   DAILY CURRENT AFFAIRS QUIZ - ENGINE (Vanilla JS / Zero-Dependency)
   ========================================================================== */

const CONFIG = {
  RETENTION_DAYS: 45,
  ACTIVE_SESSION_KEY: 'ca_active_session_v1',
  MISTAKE_BANK_KEY: 'ca_mistake_bank_v1',
  ARCHIVE_KEY_PREFIX: 'ca_quiz_v1_',
  MARKING_SCHEMES: {
    UPSC: { correct: 2.0, incorrect: 0.66 },
    SSC: { correct: 2.0, incorrect: 0.50 },
    BANKING: { correct: 1.0, incorrect: 0.25 }
  }
};

// Global App State
let appState = {
  activeDate: null,
  manifest: [],
  quizData: null,
  currentIndex: 0,
  userResponses: {}, // { [qId]: optionId }
  timeSpent: {},     // { [qId]: seconds }
  timerInterval: null,
  elapsedTotalSeconds: 0,
  isReviewMode: false
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  cleanupOldStorage();
  updateMistakeBadge();
  setupEventListeners();
  loadManifest();
});

/* ==========================================================================
   1. DATA SOURCING & MANIFEST LOGIC
   ========================================================================== */
async function loadManifest() {
  const dateSelect = document.getElementById('date-select');
  try {
    const res = await fetch('./data/manifest.json');
    if (!res.ok) throw new Error('No manifest found');
    const data = await res.json();
    appState.manifest = data.availableDates || [];

    if (appState.manifest.length === 0) {
      dateSelect.innerHTML = `<option value="">No tests live yet</option>`;
      return;
    }

    dateSelect.innerHTML = appState.manifest
      .map(d => `<option value="${d}">${d}</option>`)
      .join('');

    // Default select latest date
    loadQuiz(appState.manifest[0]);
  } catch (err) {
    console.warn('Manifest load error. Loading fallback preview.', err);
    dateSelect.innerHTML = `<option value="demo">Demo Preview Test</option>`;
    loadDemoQuiz();
  }
}

async function loadQuiz(dateStr) {
  appState.activeDate = dateStr;
  try {
    const res = await fetch(`./data/daily/${dateStr}.json`);
    if (!res.ok) throw new Error(`Quiz for ${dateStr} not found`);
    const quizJson = await res.json();
    setupQuizSession(quizJson);
  } catch (err) {
    alert(`Could not load test for ${dateStr}: ${err.message}`);
  }
}

function setupQuizSession(quizJson) {
  appState.quizData = quizJson;
  appState.currentIndex = 0;
  appState.userResponses = {};
  appState.timeSpent = {};
  appState.elapsedTotalSeconds = 0;

  // Check Mid-Quiz Session Recovery
  const saved = getStoredSession();
  if (saved && saved.quizDate === quizJson.quizDate && saved.status === 'IN_PROGRESS') {
    promptResumeModal(saved);
  } else {
    startNewQuizSession();
  }
}

/* ==========================================================================
   2. QUIZ CONTROLLER & DOM RENDERING
   ========================================================================== */
function startNewQuizSession() {
  startTimer();
  renderPalette();
  renderQuestion(appState.currentIndex);
  switchView('view-quiz');
  saveActiveSession();
}

function renderQuestion(index) {
  appState.currentIndex = index;
  const q = appState.quizData.questions[index];
  if (!q) return;

  document.getElementById('badge-section').textContent = q.section;
  document.getElementById('badge-topic').textContent = q.topic || 'General';
  document.getElementById('question-text').textContent = `Q${index + 1}. ${q.question}`;

  const container = document.getElementById('options-container');
  container.innerHTML = '';

  const selectedOpt = appState.userResponses[q.id];

  q.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = `option-btn ${selectedOpt === opt.id ? 'selected' : ''}`;
    btn.innerHTML = `<span class="option-key">${opt.id}.</span> ${opt.text}`;
    btn.onclick = () => selectOption(q.id, opt.id);
    container.appendChild(btn);
  });

  // Update navigation button states
  document.getElementById('btn-prev').disabled = index === 0;
  document.getElementById('btn-next').disabled = index === appState.quizData.questions.length - 1;

  updatePaletteUI();
}

function selectOption(qId, optId) {
  appState.userResponses[qId] = optId;
  saveActiveSession();
  renderQuestion(appState.currentIndex);
}

function renderPalette() {
  const grid = document.getElementById('palette-grid');
  grid.innerHTML = '';
  appState.quizData.questions.forEach((q, idx) => {
    const item = document.createElement('button');
    item.className = 'palette-item';
    item.textContent = idx + 1;
    item.onclick = () => renderQuestion(idx);
    grid.appendChild(item);
  });
  updatePaletteUI();
}

function updatePaletteUI() {
  const items = document.querySelectorAll('.palette-item');
  appState.quizData.questions.forEach((q, idx) => {
    const item = items[idx];
    if (!item) return;
    item.className = 'palette-item';
    if (appState.userResponses[q.id]) item.classList.add('answered');
    if (idx === appState.currentIndex) item.classList.add('current');
  });
}

/* ==========================================================================
   3. DRIFT-FREE TIMER
   ========================================================================== */
function startTimer() {
  clearInterval(appState.timerInterval);
  const timerDisplay = document.getElementById('quiz-timer');

  appState.timerInterval = setInterval(() => {
    appState.elapsedTotalSeconds++;
    const activeQ = appState.quizData.questions[appState.currentIndex];
    if (activeQ) {
      appState.timeSpent[activeQ.id] = (appState.timeSpent[activeQ.id] || 0) + 1;
    }

    const mins = String(Math.floor(appState.elapsedTotalSeconds / 60)).padStart(2, '0');
    const secs = String(appState.elapsedTotalSeconds % 60).padStart(2, '0');
    timerDisplay.textContent = `${mins}:${secs}`;
  }, 1000);
}

/* ==========================================================================
   4. SCORING, EVALUATION & ANALYTICS
   ========================================================================== */
function submitQuiz() {
  if (!confirm('Are you sure you want to finish the quiz?')) return;

  clearInterval(appState.timerInterval);
  const schemeKey = document.getElementById('scheme-select').value;
  const scheme = CONFIG.MARKING_SCHEMES[schemeKey];

  let correctCount = 0;
  let incorrectCount = 0;
  let unattemptedCount = 0;

  let indiaTotal = 0, indiaCorrect = 0;
  let worldTotal = 0, worldCorrect = 0;

  const mistakesToStore = [];

  appState.quizData.questions.forEach(q => {
    const userChoice = appState.userResponses[q.id];
    const isIndia = q.section.toUpperCase() === 'INDIA';

    if (isIndia) indiaTotal++; else worldTotal++;

    if (!userChoice) {
      unattemptedCount++;
    } else if (userChoice === q.correctOptionId) {
      correctCount++;
      if (isIndia) indiaCorrect++; else worldCorrect++;
    } else {
      incorrectCount++;
      mistakesToStore.push(q);
    }
  });

  const netScore = (correctCount * scheme.correct) - (incorrectCount * scheme.incorrect);
  const accuracy = (correctCount + incorrectCount) > 0
    ? Math.round((correctCount / (correctCount + incorrectCount)) * 100)
    : 0;

  // Render Result Screen
  document.getElementById('res-net-score').textContent = netScore.toFixed(2);
  document.getElementById('res-accuracy').textContent = `${accuracy}%`;
  document.getElementById('res-attempted').textContent = `${correctCount + incorrectCount} / ${appState.quizData.questions.length}`;

  const avgTime = Math.round(appState.elapsedTotalSeconds / (appState.quizData.questions.length || 1));
  document.getElementById('res-avg-time').textContent = `${avgTime}s`;

  // Sectional Ratios
  const indiaAcc = indiaTotal ? Math.round((indiaCorrect / indiaTotal) * 100) : 0;
  const worldAcc = worldTotal ? Math.round((worldCorrect / worldTotal) * 100) : 0;

  document.getElementById('res-india-score').textContent = `${indiaCorrect}/${indiaTotal} (${indiaAcc}%)`;
  document.getElementById('bar-india').style.width = `${indiaAcc}%`;

  document.getElementById('res-world-score').textContent = `${worldCorrect}/${worldTotal} (${worldAcc}%)`;
  document.getElementById('bar-world').style.width = `${worldAcc}%`;

  // Persist Mistakes to Mistake Bank
  saveMistakesToBank(mistakesToStore);
  clearActiveSession();
  switchView('view-results');
}

/* ==========================================================================
   5. REVIEW DASHBOARD & NOTES
   ========================================================================== */
function renderReviewDashboard(filter = 'ALL') {
  const container = document.getElementById('review-cards-list');
  container.innerHTML = '';

  appState.quizData.questions.forEach((q, idx) => {
    const userChoice = appState.userResponses[q.id];
    const isCorrect = userChoice === q.correctOptionId;
    const isSkipped = !userChoice;

    if (filter === 'INCORRECT' && (isCorrect || isSkipped)) return;
    if (filter === 'SKIPPED' && !isSkipped) return;

    const statusClass = isSkipped ? 'skipped' : (isCorrect ? 'correct' : 'incorrect');
    const card = document.createElement('div');
    card.className = `review-card ${statusClass}`;

    const correctText = q.options.find(o => o.id === q.correctOptionId)?.text || '';
    const userText = userChoice ? (q.options.find(o => o.id === userChoice)?.text || '') : 'Skipped / Unattempted';

    card.innerHTML = `
      <div class="review-meta">
        <span>Question ${idx + 1} (${q.section})</span>
        <span>Time: ${appState.timeSpent[q.id] || 0}s</span>
      </div>
      <h3 style="font-size: 1rem; margin-bottom: 0.5rem;">${q.question}</h3>
      <div class="review-ans-row">
        <div><strong>Your Answer:</strong> <span style="color: ${isCorrect ? 'var(--correct)' : 'var(--incorrect)'}">${userText}</span></div>
        <div><strong>Correct Answer:</strong> <span style="color: var(--correct)">${q.correctOptionId}. ${correctText}</span></div>
      </div>
      <div class="explanation-box">
        <strong>Explanation:</strong> ${q.explanation}
        ${q.sourceReference?.url ? `<br><a href="${q.sourceReference.url}" target="_blank" rel="noopener noreferrer" class="source-link">🔗 Source: ${q.sourceReference.title || 'Verified Article'}</a>` : ''}
      </div>
    `;
    container.appendChild(card);
  });

  switchView('view-review');
}

/* ==========================================================================
   6. MISTAKE BANK ENGINE
   ========================================================================== */
function saveMistakesToBank(questionList) {
  let bank = JSON.parse(localStorage.getItem(CONFIG.MISTAKE_BANK_KEY) || '[]');
  questionList.forEach(q => {
    if (!bank.some(item => item.id === q.id)) {
      bank.push(q);
    }
  });
  localStorage.setItem(CONFIG.MISTAKE_BANK_KEY, JSON.stringify(bank));
  updateMistakeBadge();
}

function updateMistakeBadge() {
  const bank = JSON.parse(localStorage.getItem(CONFIG.MISTAKE_BANK_KEY) || '[]');
  document.getElementById('mistake-badge').textContent = bank.length;
}

function renderMistakeBankView() {
  const container = document.getElementById('mistake-list-container');
  const bank = JSON.parse(localStorage.getItem(CONFIG.MISTAKE_BANK_KEY) || '[]');
  container.innerHTML = '';

  if (bank.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No mistakes in bank! Shabaash, continue keeping 100% accuracy.</p>`;
    switchView('view-mistakes');
    return;
  }

  bank.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'review-card incorrect';
    card.innerHTML = `
      <div class="review-meta"><span>${q.section} &bull; ${q.topic}</span></div>
      <h4>Q${idx + 1}. ${q.question}</h4>
      <div class="explanation-box" style="margin: 0.75rem 0;">
        <strong>Correct:</strong> ${q.correctOptionId}. ${q.options.find(o => o.id === q.correctOptionId)?.text}<br>
        <strong>Note:</strong> ${q.explanation}
      </div>
      <button class="btn-outline" style="font-size: 0.8rem;" onclick="removeMistake('${q.id}')">✓ Mark Mastered (Remove)</button>
    `;
    container.appendChild(card);
  });

  switchView('view-mistakes');
}

window.removeMistake = function(qId) {
  let bank = JSON.parse(localStorage.getItem(CONFIG.MISTAKE_BANK_KEY) || '[]');
  bank = bank.filter(q => q.id !== qId);
  localStorage.setItem(CONFIG.MISTAKE_BANK_KEY, JSON.stringify(bank));
  updateMistakeBadge();
  renderMistakeBankView();
};

/* ==========================================================================
   7. STORAGE & RETENTION CLEANUP
   ========================================================================== */
function saveActiveSession() {
  const session = {
    quizDate: appState.activeDate,
    status: 'IN_PROGRESS',
    currentIndex: appState.currentIndex,
    userResponses: appState.userResponses,
    timeSpent: appState.timeSpent,
    elapsedSeconds: appState.elapsedTotalSeconds,
    timestamp: Date.now()
  };
  localStorage.setItem(CONFIG.ACTIVE_SESSION_KEY, JSON.stringify(session));
}

function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG.ACTIVE_SESSION_KEY));
  } catch (e) { return null; }
}

function clearActiveSession() {
  localStorage.removeItem(CONFIG.ACTIVE_SESSION_KEY);
}

function cleanupOldStorage() {
  const cutoff = Date.now() - (CONFIG.RETENTION_DAYS * 24 * 60 * 60 * 1000);
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith(CONFIG.ARCHIVE_KEY_PREFIX)) {
      try {
        const item = JSON.parse(localStorage.getItem(key));
        if (item.timestamp && item.timestamp < cutoff) {
          localStorage.removeItem(key);
        }
      } catch (e) {}
    }
  });
}

/* ==========================================================================
   8. EVENT LISTENERS & ROUTING
   ========================================================================== */
function setupEventListeners() {
  document.getElementById('btn-next').onclick = () => {
    if (appState.currentIndex < appState.quizData.questions.length - 1) {
      renderQuestion(appState.currentIndex + 1);
    }
  };

  document.getElementById('btn-prev').onclick = () => {
    if (appState.currentIndex > 0) {
      renderQuestion(appState.currentIndex - 1);
    }
  };

  document.getElementById('btn-clear').onclick = () => {
    const activeQ = appState.quizData.questions[appState.currentIndex];
    delete appState.userResponses[activeQ.id];
    saveActiveSession();
    renderQuestion(appState.currentIndex);
  };

  document.getElementById('btn-submit').onclick = submitQuiz;

  document.getElementById('btn-start-review').onclick = () => renderReviewDashboard('ALL');
  document.getElementById('btn-back-to-results').onclick = () => switchView('view-results');
  document.getElementById('btn-retest').onclick = () => setupQuizSession(appState.quizData);

  document.getElementById('btn-mistake-bank').onclick = renderMistakeBankView;
  document.getElementById('btn-close-mistakes').onclick = () => switchView('view-quiz');

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.onclick = (e) => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      renderReviewDashboard(e.target.dataset.filter);
    };
  });

  document.getElementById('date-select').onchange = (e) => {
    if (e.target.value) loadQuiz(e.target.value);
  };
}

function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

function promptResumeModal(saved) {
  const modal = document.getElementById('resume-modal');
  modal.classList.remove('hidden');

  document.getElementById('btn-modal-resume').onclick = () => {
    modal.classList.add('hidden');
    appState.currentIndex = saved.currentIndex || 0;
    appState.userResponses = saved.userResponses || {};
    appState.timeSpent = saved.timeSpent || {};
    appState.elapsedTotalSeconds = saved.elapsedSeconds || 0;
    startTimer();
    renderPalette();
    renderQuestion(appState.currentIndex);
    switchView('view-quiz');
  };

  document.getElementById('btn-modal-reset').onclick = () => {
    modal.classList.add('hidden');
    clearActiveSession();
    startNewQuizSession();
  };
}

// Fallback Dummy Data (for immediate testing before GitHub action runs)
function loadDemoQuiz() {
  const demoData = {
    quizDate: "2026-10-25",
    questions: [
      {
        id: "DEMO-01",
        section: "INDIA",
        topic: "Economy",
        question: "Consider the following statements regarding RBI's Digital Rupee (e-Rupee). Which of the following is correct?",
        options: [
          { id: "A", text: "It is a decentralized cryptocurrency similar to Bitcoin." },
          { id: "B", text: "It is a legal tender issued directly by the Reserve Bank of India in digital form." },
          { id: "C", text: "It cannot be held in digital wallets." },
          { id: "D", text: "It earns mandatory interest higher than fixed deposits." }
        ],
        correctOptionId: "B",
        explanation: "Digital Rupee (e-Rupee) is a Central Bank Digital Currency (CBDC) representing a sovereign currency in digital form.",
        sourceReference: { title: "Reserve Bank of India Portal", url: "https://rbi.org.in" }
      },
      {
        id: "DEMO-02",
        section: "WORLD",
        topic: "Geopolitics",
        question: "Where was the latest Quad Leaders' Summit held?",
        options: [
          { id: "A", text: "Tokyo, Japan" },
          { id: "B", text: "Canberra, Australia" },
          { id: "C", text: "Wilmington, Delaware, USA" },
          { id: "D", text: "New Delhi, India" }
        ],
        correctOptionId: "C",
        explanation: "The Quad Leaders' Summit was hosted in Wilmington, Delaware, USA focusing on maritime security and Indo-Pacific stability.",
        sourceReference: { title: "Ministry of External Affairs", url: "https://mea.gov.in" }
      }
    ]
  };
  setupQuizSession(demoData);
}