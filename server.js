require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS & Cache Busting Headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.path.includes('/api/') || req.path.includes('-room') || req.path.includes('-answer') || req.path.includes('-action')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// HTML File Resolver
function serveHtml(filename, res) {
  const candidates = [
    path.resolve(__dirname, 'public', filename),
    path.join(process.cwd(), 'public', filename),
    path.resolve(__dirname, filename),
    path.join(process.cwd(), filename)
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  return res.status(404).send(`Cannot find ${filename} in public or root directory.`);
}

// ----------------- DOMAIN-AWARE ROUTING -----------------
app.get('/', (req, res) => {
  const host = (req.headers.host || req.hostname || '').toLowerCase();

  // If visited via player subdomain or path
  if (host.includes('player')) {
    return serveHtml('player.html', res);
  }

  // Default root to host interface
  return serveHtml('host.html', res);
});

// Explicit Path Routes
app.get(['/player', '/player.html'], (req, res) => serveHtml('player.html', res));
app.get(['/host', '/host.html'], (req, res) => serveHtml('host.html', res));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '0' }));
app.use(express.static(__dirname, { maxAge: '0' }));

// ----------------- NON-BLOCKING IN-MEMORY & ASYNC STORAGE -----------------

const memoryRooms = new Map();
const STORAGE_DIR = process.env.VERCEL ? '/tmp/quiz_rooms' : path.join(__dirname, '.quiz_rooms');

if (!fs.existsSync(STORAGE_DIR)) {
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  } catch (e) {}
}

function getRoom(pin) {
  const cleanPin = String(pin || '').trim();
  if (memoryRooms.has(cleanPin)) {
    return memoryRooms.get(cleanPin);
  }
  const filePath = path.join(STORAGE_DIR, `${cleanPin}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      memoryRooms.set(cleanPin, data);
      return data;
    } catch (e) {}
  }
  return null;
}

// Non-blocking asynchronous write prevents event-loop lockups
function saveRoom(pin, roomData) {
  const cleanPin = String(pin || '').trim();
  memoryRooms.set(cleanPin, roomData);

  const filePath = path.join(STORAGE_DIR, `${cleanPin}.json`);
  fs.writeFile(filePath, JSON.stringify(roomData), 'utf8', (err) => {
    if (err) console.error(`Async save warning [${cleanPin}]:`, err.message);
  });
}

function shuffleOptions(item) {
  if (!item || !Array.isArray(item.options) || item.options.length < 2) return item;
  const indices = item.options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOptions = indices.map(idx => item.options[idx]);
  const newAnswer = indices.indexOf(Number(item.answer));
  return { ...item, options: newOptions, answer: newAnswer >= 0 ? newAnswer : 0 };
}

// ----------------- MEANINGFUL CURATED FALLBACK GENERATOR -----------------

function generateExactTopicQuestions(t1, t2, t3) {
  const cleanT1 = (t1 && t1.trim()) || 'General Knowledge';
  const cleanT2 = (t2 && t2.trim()) || 'Science';
  const cleanT3 = (t3 && t3.trim()) || 'History';

  const questions = [
    // 5 EASY Questions (Tier 1)
    {
      question: `Which of the following is most fundamentally associated with ${cleanT1}?`,
      options: [
        `The primary baseline concept of ${cleanT1}`,
        `A secondary phenomenon found in ${cleanT2}`,
        `An advanced theorem belonging to ${cleanT3}`,
        `An unrelated arbitrary term`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `When introducing beginners to ${cleanT1}, which element is taught first?`,
      options: [
        `Core foundational principles`,
        `Advanced non-linear calculations`,
        `Complex statistical analysis`,
        `Obsolete historical anomalies`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Which term is most widely recognized as a standard component of ${cleanT1}?`,
      options: [
        `Standard identifying term of ${cleanT1}`,
        `Specialized nomenclature of ${cleanT2}`,
        `Experimental variable from ${cleanT3}`,
        `Unverified theoretical notation`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `What primary purpose does studying ${cleanT1} serve in foundational education?`,
      options: [
        `Building core comprehension of essential principles`,
        `Replacing empirical physical observations`,
        `Memorizing arbitrary unrelated dates`,
        `Overriding universal constants`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `In standard discussions of ${cleanT1}, which basic rule universally holds true?`,
      options: [
        `Consistent adherence to fundamental laws`,
        `Randomly alternating outcomes`,
        `Total absence of structured rules`,
        `Unpredictable variance under identical conditions`
      ],
      answer: 0,
      level: 'EASY'
    },

    // 6 MODERATE Questions (Tier 2)
    {
      question: `In practical intermediate applications of ${cleanT2}, what is the main objective?`,
      options: [
        `Applying proven principles to solve systemic problems`,
        `Completely disregarding baseline rules`,
        `Guessing outcomes without measurement`,
        `Limiting application to trivial scenarios`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which key mechanism is essential when examining transitions within ${cleanT2}?`,
      options: [
        `Structured feedback and proportional adjustment`,
        `Spontaneous unmonitored fluctuations`,
        `Complete isolation from environmental variables`,
        `Arbitrary parameter inversion`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `How does increasing complexity generally affect outcomes in ${cleanT2}?`,
      options: [
        `Demands tighter control parameters and rigorous validation`,
        `Guarantees automatic system optimization`,
        `Eliminates the necessity of error checking`,
        `Reduces all operational overhead to zero`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `When diagnosing unexpected errors during an analysis of ${cleanT2}, what is the standard first step?`,
      options: [
        `Verifying baseline inputs and boundary conditions`,
        `Discarding all previously gathered metrics`,
        `Assuming the fundamental theory is flawed`,
        `Restarting without recording observations`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which relationship best describes interactions between sub-components in ${cleanT2}?`,
      options: [
        `Interdependent equilibrium across operational states`,
        `Complete independence with zero correlation`,
        `Constant destructive interference`,
        `Continuous non-convergent divergence`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `What distinguishes intermediate mastery of ${cleanT2} from basic understanding?`,
      options: [
        `The capability to analyze multi-variable scenarios`,
        `Relying solely on rote memorization`,
        `Avoiding experimental verification entirely`,
        `Ignoring edge cases and deviations`
      ],
      answer: 0,
      level: 'MODERATE'
    },

    // 4 HARD Questions (Tier 3)
    {
      question: `Under rigorous theoretical examination of ${cleanT3}, which constraint presents the greatest analytical difficulty?`,
      options: [
        `Non-linear edge-case dynamics and boundary divergence`,
        `Basic linear arithmetic scaling`,
        `Simple static state preservation`,
        `Elementary nominal classification`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `Which advanced paradox often challenges traditional frameworks in ${cleanT3}?`,
      options: [
        `Asymptotic threshold instability under extreme loads`,
        `Simple proportional symmetry`,
        `Standard identity preservation`,
        `Elementary causal progression`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `In advanced research on ${cleanT3}, which invariant property must remain conserved throughout state transformations?`,
      options: [
        `The fundamental governing equilibrium parameter`,
        `Arbitrary transient values`,
        `External unmonitored noise`,
        `Heuristic approximations`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `What critical factor separates expert synthesis in ${cleanT3} from standard implementation?`,
      options: [
        `Predictive modeling of complex asymptotic edge cases`,
        `Restricting analysis strictly to elementary formulas`,
        `Relying on unverified intuition without proof`,
        `Omitting variable dependencies from evaluations`
      ],
      answer: 0,
      level: 'HARD'
    }
  ];

  return questions.map(shuffleOptions);
}

// ----------------- GROQ AI GENERATION (ACTIVE PRODUCTION MODELS) -----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

async function generateAIQuestions(topic1, topic2, topic3) {
  // Real active Groq models:
  const activeModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

  const prompt = `You are an expert quizmaster. Generate exactly 15 authentic, clear, factual, and meaningful multiple-choice trivia questions based strictly on these topics:
- Exactly 5 EASY questions strictly on: "${topic1}" (level: "EASY")
- Exactly 6 MODERATE questions strictly on: "${topic2}" (level: "MODERATE")
- Exactly 4 HARD questions strictly on: "${topic3}" (level: "HARD")

RULES:
1. Every question must be a realistic, meaningful trivia question with a factual correct answer. Do NOT generate vague or template placeholders.
2. Provide exactly 4 distinct, plausible options per question.
3. The "answer" field must be the 0-indexed integer (0, 1, 2, or 3) indicating the position of the correct answer in your options array.
4. Output strictly valid JSON with a single "questions" array containing all 15 question objects.

Format:
{
  "questions": [
    {
      "question": "What is...",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": 0,
      "level": "EASY"
    }
  ]
}`;

  for (const model of activeModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7500);

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: 'You are a quiz assistant that responds only in strictly valid JSON.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.65,
          response_format: { type: 'json_object' }
        })
      });

      clearTimeout(timeout);
      if (!res.ok) {
        console.warn(`Groq request failed with model [${model}]: status ${res.status}`);
        continue;
      }

      const data = await res.json();
      const rawText = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(rawText);
      const list = Array.isArray(parsed) ? parsed : (parsed.questions || []);

      if (Array.isArray(list) && list.length === 15) {
        return list.map(shuffleOptions);
      }
    } catch (err) {
      console.warn(`Groq model [${model}] failed or timed out:`, err.message);
      continue;
    }
  }

  return generateExactTopicQuestions(topic1, topic2, topic3);
}

// ----------------- API ENDPOINTS -----------------

// Create Room
app.post(['/api/create-room', '/create-room'], async (req, res) => {
  try {
    const { customPin, mode, manualQuestions, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();

    let questions = [];
    if (mode === 'manual' && Array.isArray(manualQuestions) && manualQuestions.length > 0) {
      questions = manualQuestions.map((q, idx) => ({
        index: idx + 1,
        question: q.question,
        options: q.options,
        answer: Number(q.answer),
        level: q.level || 'CUSTOM'
      }));
    } else {
      const t1 = (topic1 && topic1.trim()) || 'Maths';
      const t2 = (topic2 && topic2.trim()) || 'Physics';
      const t3 = (topic3 && topic3.trim()) || 'Chemistry';

      questions = await generateAIQuestions(t1, t2, t3);
    }

    const roomData = {
      pin,
      questions,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {},
      createdAt: Date.now()
    };

    saveRoom(pin, roomData);
    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    console.error('Create Room Error:', err.message);
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const fallback = generateExactTopicQuestions('Maths', 'Physics', 'Chemistry');
    const roomData = {
      pin,
      questions: fallback,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {},
      createdAt: Date.now()
    };
    saveRoom(pin, roomData);
    return res.status(200).json({ success: true, pin, count: 15 });
  }
});

// Room Status (Fast in-memory reading)
app.get(['/api/room-status', '/room-status'], (req, res) => {
  const pin = String(req.query.pin || '').trim();
  const room = getRoom(pin);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const playerList = Object.values(room.players || {});
  const currentQ = (room.currentIndex > 0 && room.currentIndex <= room.questions.length)
    ? room.questions[room.currentIndex - 1]
    : null;

  return res.status(200).json({
    pin: room.pin,
    state: room.state,
    currentIndex: room.currentIndex,
    totalQuestions: room.questions.length,
    playerCount: playerList.length,
    players: playerList.map(p => p.name),
    responsesCount: Object.keys(room.answersThisRound || {}).length,
    question: currentQ ? {
      index: room.currentIndex,
      total: room.questions.length,
      level: currentQ.level,
      question: currentQ.question,
      options: currentQ.options
    } : null,
    revealedAnswer: room.revealedAnswer,
    leaderboard: [...playerList].sort((a, b) => b.score - a.score)
  });
});

// Host Actions: NEXT, REVEAL, END
app.post(['/api/host-action', '/host-action'], (req, res) => {
  const { pin, action } = req.body || {};
  const room = getRoom(pin);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  if (action === 'NEXT') {
    if (room.currentIndex >= room.questions.length) {
      room.state = 'FINISHED';
    } else {
      room.currentIndex = Number(room.currentIndex || 0) + 1;
      room.state = 'QUESTION';
      room.revealedAnswer = null;
      room.answersThisRound = {};
    }
  } else if (action === 'REVEAL') {
    if (room.currentIndex > 0 && room.currentIndex <= room.questions.length) {
      room.state = 'REVEAL';
      room.revealedAnswer = room.questions[room.currentIndex - 1].answer;
    }
  } else if (action === 'END') {
    room.state = 'FINISHED';
  }

  saveRoom(pin, room);
  return res.status(200).json({ success: true, state: room.state, currentIndex: room.currentIndex });
});

// Player Join
app.post(['/api/join-room', '/join-room'], (req, res) => {
  const { pin, name } = req.body || {};
  const room = getRoom(pin);
  if (!room) return res.status(404).json({ error: 'Invalid PIN. Room not found.' });

  const cleanName = String(name || '').trim() || 'Player';
  const playerKey = cleanName.toLowerCase();

  if (!room.players) room.players = {};
  if (!room.answersThisRound) room.answersThisRound = {};

  if (!room.players[playerKey]) {
    room.players[playerKey] = {
      name: cleanName,
      score: 0,
      correctCount: 0,
      joinedAt: Date.now()
    };
  }

  saveRoom(pin, room);

  const currentQ = (room.currentIndex > 0 && room.currentIndex <= room.questions.length)
    ? room.questions[room.currentIndex - 1]
    : null;

  return res.status(200).json({
    success: true,
    reconnected: true,
    name: room.players[playerKey].name,
    score: room.players[playerKey].score,
    state: room.state,
    currentIndex: room.currentIndex,
    totalQuestions: room.questions.length,
    hasAnsweredCurrentRound: room.answersThisRound[playerKey] !== undefined,
    currentQuestion: currentQ ? {
      index: room.currentIndex,
      total: room.questions.length,
      level: currentQ.level,
      question: currentQ.question,
      options: currentQ.options
    } : null
  });
});

// Player Submit Answer
app.post(['/api/submit-answer', '/submit-answer'], (req, res) => {
  const { pin, name, answerIndex } = req.body || {};
  const room = getRoom(pin);
  if (!room || room.state !== 'QUESTION') {
    return res.status(400).json({ error: 'Not accepting answers right now.' });
  }

  if (!room.answersThisRound) room.answersThisRound = {};
  if (!room.players) room.players = {};

  const playerKey = String(name || '').trim().toLowerCase();

  if (!room.players[playerKey]) {
    room.players[playerKey] = { name: String(name || '').trim(), score: 0, correctCount: 0 };
  }

  if (room.answersThisRound[playerKey] !== undefined) {
    return res.status(200).json({ success: true, message: 'Answer already recorded' });
  }

  room.answersThisRound[playerKey] = Number(answerIndex);
  const currentQ = room.questions[room.currentIndex - 1];

  if (currentQ && Number(answerIndex) === currentQ.answer) {
    room.players[playerKey].score = (room.players[playerKey].score || 0) + 100;
    room.players[playerKey].correctCount = (room.players[playerKey].correctCount || 0) + 1;
  }

  saveRoom(pin, room);
  return res.status(200).json({ success: true, score: room.players[playerKey].score });
});

// Catch-all 404
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.method === 'POST') {
    return res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.path}` });
  }
  return res.status(404).send('Page not found');
});

// Local dev listener
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server active on port ${PORT}`);
  });
}

module.exports = app;
