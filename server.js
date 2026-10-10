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

  // If visited via player-zero-barrier-quiz.vercel.app (or any domain containing 'player')
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

// ----------------- STATELESS / PERSISTENT ROOM STORAGE -----------------

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

function saveRoom(pin, roomData) {
  const cleanPin = String(pin || '').trim();
  memoryRooms.set(cleanPin, roomData);
  const filePath = path.join(STORAGE_DIR, `${cleanPin}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(roomData), 'utf8');
  } catch (e) {}
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

// ----------------- GUARANTEED FALLBACK GENERATOR (5-6-4 SPLIT) -----------------

function generateExactTopicQuestions(t1, t2, t3) {
  const qList = [];

  const easyBank = [
    `What is a foundational principle or definition associated with ${t1}?`,
    `Which core concept is most widely identified with ${t1}?`,
    `When learning elementary ${t1}, which basic rule universally applies?`,
    `What standard term or feature distinguishes ${t1}?`,
    `What basic notation, unit, or concept is recognized in ${t1}?`
  ];

  const moderateBank = [
    `In intermediate practical problems of ${t2}, how is standard balance preserved?`,
    `Which key mechanism is essential when analyzing transitions in ${t2}?`,
    `What common variable is calculated when measuring dynamics in ${t2}?`,
    `How does an increase in operational scale typically influence ${t2}?`,
    `Which relationship describes standard intermediate interactions in ${t2}?`,
    `Under standard conditions in ${t2}, how do system changes impact efficiency?`
  ];

  const hardBank = [
    `Under rigorous theoretical constraints in ${t3}, which theorem governs non-linear behavior?`,
    `What boundary limit is observed in asymptotic edge cases of ${t3}?`,
    `Which advanced paradox challenges conventional interpretations of ${t3}?`,
    `In higher-level proofs, which invariant property remains conserved across ${t3}?`
  ];

  for (let i = 0; i < 5; i++) {
    qList.push({
      question: easyBank[i],
      options: [
        `The primary baseline principle of ${t1}`,
        `A secondary empirical deviation seen in ${t2}`,
        `An inverse variable derived from ${t3}`,
        `An arbitrary unverified assumption`
      ],
      answer: 0,
      level: 'EASY'
    });
  }

  for (let i = 0; i < 6; i++) {
    qList.push({
      question: moderateBank[i],
      options: [
        `Decreases linearly at a uniform rate`,
        `Exponentially increases the operational efficiency of ${t2}`,
        `Inverts the standard state vector`,
        `Remains invariant under standard conditions`
      ],
      answer: 1,
      level: 'MODERATE'
    });
  }

  for (let i = 0; i < 4; i++) {
    qList.push({
      question: hardBank[i],
      options: [
        `The asymptotic perturbation threshold of ${t3}`,
        `The heuristic derivative equilibrium`,
        `The deterministic limit derived from ${t1}`,
        `The stochastic uncertainty coefficient`
      ],
      answer: 0,
      level: 'HARD'
    });
  }

  return qList.map(shuffleOptions);
}

// ----------------- GROQ AI GENERATION (5-6-4 SPLIT) -----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

async function generateAIQuestions(topic1, topic2, topic3) {
  const activeModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];

  const prompt = `You are an expert trivia quiz generator.
Create exactly 15 authentic multiple-choice trivia questions based strictly on these topics:
- Exactly 5 EASY questions strictly on: "${topic1}" (level: "EASY")
- Exactly 6 MODERATE questions strictly on: "${topic2}" (level: "MODERATE")
- Exactly 4 HARD questions strictly on: "${topic3}" (level: "HARD")

Requirements:
1. Every question must be factual and test knowledge of "${topic1}", "${topic2}", or "${topic3}".
2. Exactly 4 plausible multiple-choice options per question.
3. "answer" must be the 0-indexed integer (0, 1, 2, or 3) of the correct choice.
4. Output strictly a JSON object with a single "questions" array containing all 15 question objects.

Format:
{
  "questions": [
    {
      "question": "What is...",
      "options": ["A", "B", "C", "D"],
      "answer": 0,
      "level": "EASY"
    }
  ]
}`;

  for (const model of activeModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);

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
      const data = await res.json();
      if (!res.ok) continue;

      const rawText = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(rawText);
      const list = Array.isArray(parsed) ? parsed : (parsed.questions || []);

      if (Array.isArray(list) && list.length === 15) {
        return list.map(shuffleOptions);
      }
    } catch (err) {
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
    console.log(`Room [${pin}] established with ${questions.length} questions.`);
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

// Room Status (Host & Player Polling + Sync)
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

// Player Join & Re-entry / Re-login Support
app.post(['/api/join-room', '/join-room'], (req, res) => {
  const { pin, name } = req.body || {};
  const room = getRoom(pin);
  if (!room) return res.status(404).json({ error: 'Invalid PIN. Room not found.' });

  const cleanName = String(name || '').trim() || 'Player';
  const playerKey = cleanName.toLowerCase();

  if (!room.players) room.players = {};
  if (!room.answersThisRound) room.answersThisRound = {};

  // If player already exists, restore their record; if not, create new
  if (!room.players[playerKey]) {
    room.players[playerKey] = {
      name: cleanName,
      score: 0,
      correctCount: 0,
      joinedAt: Date.now()
    };
  }

  saveRoom(pin, room);

  // Determine current active question
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

  // Ensure player is registered
  if (!room.players[playerKey]) {
    room.players[playerKey] = { name: String(name || '').trim(), score: 0, correctCount: 0 };
  }

  // Prevent multiple answers for the same question
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
