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
  if (host.includes('player')) {
    return serveHtml('player.html', res);
  }
  return serveHtml('host.html', res);
});

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

function saveRoom(pin, roomData) {
  const cleanPin = String(pin || '').trim();
  memoryRooms.set(cleanPin, roomData);

  const filePath = path.join(STORAGE_DIR, `${cleanPin}.json`);
  fs.writeFile(filePath, JSON.stringify(roomData), 'utf8', (err) => {
    if (err) console.error(`Async save warning [${cleanPin}]:`, err.message);
  });
}

function normalizeAnswerIndex(ans) {
  if (typeof ans === 'number') return ans;
  if (!ans) return 0;
  const str = String(ans).trim().toUpperCase();
  if (str === 'A' || str === '0') return 0;
  if (str === 'B' || str === '1') return 1;
  if (str === 'C' || str === '2') return 2;
  if (str === 'D' || str === '3') return 3;
  const parsed = parseInt(str, 10);
  return isNaN(parsed) ? 0 : parsed;
}

function shuffleOptions(item) {
  if (!item || !Array.isArray(item.options) || item.options.length < 2) return item;
  const correctIdx = normalizeAnswerIndex(item.answer);
  const correctOptionText = item.options[correctIdx] || item.options[0];

  const indices = item.options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const newOptions = indices.map(idx => item.options[idx]);
  const newAnswer = newOptions.indexOf(correctOptionText);

  return {
    ...item,
    options: newOptions,
    answer: newAnswer >= 0 ? newAnswer : 0
  };
}

// ----------------- MEANINGFUL FACTUAL FALLBACK QUESTIONS -----------------

function generateExactTopicQuestions(t1, t2, t3) {
  const topic1 = t1 || 'Mathematics';
  const topic2 = t2 || 'Physics';
  const topic3 = t3 || 'Chemistry';

  const defaultQuestions = [
    // 5 EASY
    { question: `What is the square root of 144 in basic ${topic1}?`, options: ['12', '14', '16', '10'], answer: 0, level: 'EASY' },
    { question: `Which basic operation in ${topic1} represents repeated addition?`, options: ['Multiplication', 'Division', 'Subtraction', 'Exponentiation'], answer: 0, level: 'EASY' },
    { question: `In geometry, what is the sum of interior angles in a triangle?`, options: ['180 degrees', '360 degrees', '90 degrees', '270 degrees'], answer: 0, level: 'EASY' },
    { question: `What is the value of Pi rounded to two decimal places?`, options: ['3.14', '3.12', '3.16', '3.18'], answer: 0, level: 'EASY' },
    { question: `A polygon with five sides is called a:`, options: ['Pentagon', 'Hexagon', 'Octagon', 'Heptagon'], answer: 0, level: 'EASY' },

    // 6 MODERATE
    { question: `Which law of motion states that for every action, there is an equal and opposite reaction?`, options: ['Newton\'s Third Law', 'Newton\'s First Law', 'Newton\'s Second Law', 'Law of Gravitation'], answer: 0, level: 'MODERATE' },
    { question: `What is the standard unit of electrical resistance in ${topic2}?`, options: ['Ohm', 'Volt', 'Ampere', 'Watt'], answer: 0, level: 'MODERATE' },
    { question: `What is the rate of acceleration due to Earth\'s gravity near the surface?`, options: ['9.8 m/s²', '8.9 m/s²', '10.8 m/s²', '6.67 m/s²'], answer: 0, level: 'MODERATE' },
    { question: `Light travels fastest through which of the following media?`, options: ['Vacuum', 'Water', 'Glass', 'Air'], answer: 0, level: 'MODERATE' },
    { question: `The kinetic energy of an object depends on its mass and:`, options: ['Velocity squared', 'Height', 'Volume', 'Density'], answer: 0, level: 'MODERATE' },
    { question: `Which physical quantity is measured in Joules?`, options: ['Work and Energy', 'Power', 'Force', 'Momentum'], answer: 0, level: 'MODERATE' },

    // 4 HARD
    { question: `What is the atomic number of Carbon on the periodic table?`, options: ['6', '12', '8', '14'], answer: 0, level: 'HARD' },
    { question: `Which chemical bond involves the sharing of electron pairs between atoms?`, options: ['Covalent bond', 'Ionic bond', 'Hydrogen bond', 'Metallic bond'], answer: 0, level: 'HARD' },
    { question: `What is the pH value of pure water at 25 degrees Celsius?`, options: ['7.0', '6.0', '8.0', '1.0'], answer: 0, level: 'HARD' },
    { question: `Which gas is the most abundant by volume in Earth\'s atmosphere?`, options: ['Nitrogen', 'Oxygen', 'Carbon Dioxide', 'Argon'], answer: 0, level: 'HARD' }
  ];

  return defaultQuestions.map(shuffleOptions);
}

// ----------------- GROQ AI GENERATION -----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function generateAIQuestions(topic1, topic2, topic3) {
  if (!GROQ_API_KEY) {
    console.log('No GROQ_API_KEY found, using standard curated bank.');
    return generateExactTopicQuestions(topic1, topic2, topic3);
  }

  const activeModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

  const prompt = `You are an expert trivia writer. Generate exactly 15 factual, high-quality, authentic trivia questions:
- Exactly 5 EASY trivia questions on: "${topic1}"
- Exactly 6 MODERATE trivia questions on: "${topic2}"
- Exactly 4 HARD trivia questions on: "${topic3}"

STRICT RULES:
1. Every question must be a real trivia question testing clear facts. No placeholder or generic template text.
2. Provide 4 distinct options per question.
3. The "answer" field MUST be the 0-indexed number (0, 1, 2, or 3) pointing to the correct choice.
4. Return ONLY valid JSON with a "questions" array containing 15 objects.

Format:
{
  "questions": [
    {
      "question": "What is the capital of France?",
      "options": ["Paris", "Rome", "Madrid", "Berlin"],
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
            { role: 'system', content: 'You respond only in strictly valid JSON.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.6,
          response_format: { type: 'json_object' }
        })
      });

      clearTimeout(timeout);
      if (!res.ok) continue;

      const data = await res.json();
      const rawText = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(rawText);
      const list = Array.isArray(parsed) ? parsed : (parsed.questions || []);

      if (Array.isArray(list) && list.length === 15) {
        return list.map(q => ({
          question: String(q.question),
          options: q.options.map(String),
          answer: normalizeAnswerIndex(q.answer),
          level: q.level || 'EASY'
        })).map(shuffleOptions);
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
        answer: normalizeAnswerIndex(q.answer),
        level: q.level || 'CUSTOM'
      }));
    } else {
      const t1 = (topic1 && topic1.trim()) || 'Mathematics';
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
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const fallback = generateExactTopicQuestions('Mathematics', 'Physics', 'Chemistry');
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

// Room Status
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

// Host Action
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
      room.revealedAnswer = normalizeAnswerIndex(room.questions[room.currentIndex - 1].answer);
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

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // Accept answer only when active
  if (room.state !== 'QUESTION') {
    return res.status(400).json({ error: 'Quiz is not currently accepting answers.' });
  }

  if (!room.answersThisRound) room.answersThisRound = {};
  if (!room.players) room.players = {};

  const playerKey = String(name || '').trim().toLowerCase();
  if (!playerKey) {
    return res.status(400).json({ error: 'Missing player name' });
  }

  if (!room.players[playerKey]) {
    room.players[playerKey] = { name: String(name || '').trim(), score: 0, correctCount: 0 };
  }

  // Idempotency: if already answered this round
  if (room.answersThisRound[playerKey] !== undefined) {
    return res.status(200).json({ success: true, message: 'Answer already received' });
  }

  const chosen = normalizeAnswerIndex(answerIndex);
  room.answersThisRound[playerKey] = chosen;

  const currentQ = room.questions[room.currentIndex - 1];
  if (currentQ) {
    const correct = normalizeAnswerIndex(currentQ.answer);
    if (chosen === correct) {
      room.players[playerKey].score = (room.players[playerKey].score || 0) + 100;
      room.players[playerKey].correctCount = (room.players[playerKey].correctCount || 0) + 1;
    }
  }

  saveRoom(pin, room);
  return res.status(200).json({ success: true, score: room.players[playerKey].score });
});

// Catch-all
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.method === 'POST') {
    return res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.path}` });
  }
  return res.status(404).send('Page not found');
});

// Dev listener
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server active on port ${PORT}`);
  });
}

module.exports = app;
