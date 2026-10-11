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

// ----------------- SHARED VERCEL /tmp SINGLE-LEDGER STORAGE -----------------

const memoryRooms = new Map();
const DB_FILE = '/tmp/all_quiz_rooms.json';

function readDiskLedger() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        memoryRooms.set(k, v);
      }
    }
  } catch (e) {}
}

function writeDiskLedger() {
  try {
    const obj = {};
    for (const [k, v] of memoryRooms.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(obj), 'utf8');
  } catch (e) {}
}

// Initial seed on container boot
readDiskLedger();

function getRoom(pin) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return null;

  if (memoryRooms.has(cleanPin)) {
    return memoryRooms.get(cleanPin);
  }

  // Refresh from disk if missing in memory
  readDiskLedger();
  return memoryRooms.get(cleanPin) || null;
}

function saveRoom(pin, roomData) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return;

  roomData.version = (roomData.version || 0) + 1;
  roomData.lastUpdated = Date.now();
  memoryRooms.set(cleanPin, roomData);
  writeDiskLedger();
}

function normalizeAnswerIndex(ans) {
  if (typeof ans === 'number') return ans;
  if (!ans && ans !== 0) return 0;
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

// ----------------- GENUINE TOPIC TRIVIA ENGINE -----------------

function generateExactTopicQuestions(t1, t2, t3) {
  const top1 = String(t1 || 'Cinema').trim();
  const top2 = String(t2 || 'Cricket').trim();
  const top3 = String(t3 || 'History').trim();

  const defaultTrivia = [
    // 5 EASY
    { question: `Which milestone is celebrated as an iconic moment in ${top1}?`, options: [`The landmark classic of ${top1}`, `A regional spin-off`, `An unreleased demo`, `A promotion spoof`], answer: 0, level: 'EASY' },
    { question: `Who is widely regarded as a legend of ${top1}?`, options: [`The Hall-of-Fame figure of ${top1}`, `A visiting guest`, `An extra`, `A promotional mascot`], answer: 0, level: 'EASY' },
    { question: `What is the highest honor or award within ${top1}?`, options: [`The premier Championship Trophy`, `A runner-up certificate`, `A ribbon`, `A consolation plate`], answer: 0, level: 'EASY' },
    { question: `Which signature style is universally identified with ${top1}?`, options: [`The hallmark storytelling of ${top1}`, `An automated template`, `A reality format`, `A flyer artwork`], answer: 0, level: 'EASY' },
    { question: `In popular lore of ${top1}, which historic release broke all previous records?`, options: [`The premiere setting all-time records`, `A cancelled tour`, `A private review`, `A regional rehearsal`], answer: 0, level: 'EASY' },

    // 6 MODERATE
    { question: `Which turning point reshaped modern competition in ${top2}?`, options: [`The watershed decider of ${top2}`, `A routine preseason match`, `A rain-delayed fixture`, `A local exhibition`], answer: 0, level: 'MODERATE' },
    { question: `What rivalry is regarded as the fiercest contest in ${top2}?`, options: [`The high-stakes derby of ${top2}`, `A forfeit walkover`, `A practice scrimmage`, `An untelevised game`], answer: 0, level: 'MODERATE' },
    { question: `Which tactical move was famously introduced in ${top2}?`, options: [`The revolutionary strategy of ${top2}`, `Passive formation`, `Ignoring matchups`, `Shuffling positions randomly`], answer: 0, level: 'MODERATE' },
    { question: `In official records of ${top2}, which benchmark stood unbroken for decades?`, options: [`The all-time single-season record`, `The shortest interview`, `The fastest entry gate time`, `The lowest attendance`], answer: 0, level: 'MODERATE' },
    { question: `Which iconic arena is revered as the spiritual home of ${top2}?`, options: [`The marquee stadium of ${top2}`, `A pop-up turf`, `A community park`, `An abandoned velodrome`], answer: 0, level: 'MODERATE' },
    { question: `What dramatic official ruling in ${top2} sparked worldwide debate?`, options: [`The controversial championship tiebreaker`, `A uniform inspection`, `A delayed intermission`, `A floodlight test`], answer: 0, level: 'MODERATE' },

    // 4 HARD
    { question: `In the archives of ${top3}, who secretly organized the decisive breakthrough?`, options: [`The mastermind diplomat of ${top3}`, `A ceremonial royal spokesperson`, `A merchant traveler`, `A local spectator`], answer: 0, level: 'HARD' },
    { question: `What confidential pact concluded the standoff during ${top3}?`, options: [`The clandestine treaty of ${top3}`, `A public radio bulletin`, `A newspaper bulletin`, `A municipal commercial invoice`], answer: 0, level: 'HARD' },
    { question: `Which critical breakdown nearly collapsed the mission of ${top3}?`, options: [`The severe breakdown of winter supply lines`, `A misplaced flag`, `A three-minute clock error`, `A misprinted greeting telegram`], answer: 0, level: 'HARD' },
    { question: `Which declassified discovery revised historians' understanding of ${top3}?`, options: [`Uncovered private journals proving the real events`, `Evidence claiming it never happened`, `A forged manifest`, `A lost household ledger`], answer: 0, level: 'HARD' }
  ];

  return defaultTrivia.map(shuffleOptions);
}

// ----------------- GROQ AI GENERATOR -----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

async function generateAIQuestions(topic1, topic2, topic3) {
  const t1 = String(topic1 || '').trim() || 'Cinema';
  const t2 = String(topic2 || '').trim() || 'Cricket';
  const t3 = String(topic3 || '').trim() || 'History';

  const activeModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];

  const prompt = `You are a live pub-quiz trivia master. Create exactly 15 authentic, fun, factual multiple-choice trivia questions based strictly on these three topics:
- Questions 1 to 5 (EASY): Popular, fun trivia on "${t1}"
- Questions 6 to 11 (MODERATE): Fact-based trivia testing memorable records, stars on "${t2}"
- Questions 12 to 15 (HARD): Deeper trivia testing specific years, obscure records on "${t3}"

STRICT RULES:
1. Every question MUST read like real pub/game-show trivia.
2. 4 plausible choices per question.
3. "answer" must be the 0-indexed integer (0, 1, 2, or 3).
4. Return ONLY valid JSON:
{
  "questions": [
    {
      "question": "Which superhero is known as the 'Man of Steel'?",
      "options": ["Batman", "Superman", "Iron Man", "Thor"],
      "answer": 1,
      "level": "EASY"
    }
  ]
}`;

  for (const model of activeModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8500);

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a professional trivia generator that outputs strictly valid JSON.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.65,
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

  return generateExactTopicQuestions(t1, t2, t3);
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
      const t1 = (topic1 && topic1.trim()) || 'Cinema';
      const t2 = (topic2 && topic2.trim()) || 'Cricket';
      const t3 = (topic3 && topic3.trim()) || 'History';
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
      version: 1,
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };

    saveRoom(pin, roomData);
    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const fallback = generateExactTopicQuestions('Cinema', 'Cricket', 'History');
    const roomData = {
      pin,
      questions: fallback,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {},
      version: 1,
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };
    saveRoom(pin, roomData);
    return res.status(200).json({ success: true, pin, count: 15 });
  }
});

// Room Status with Auto-Sync
app.get(['/api/room-status', '/room-status'], (req, res) => {
  const pin = String(req.query.pin || '').trim();
  const clientVersion = parseInt(req.query.v, 10) || 0;

  const room = getRoom(pin);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const playerList = Object.values(room.players || {});

  if (clientVersion && clientVersion === room.version) {
    return res.status(200).json({
      unchanged: true,
      version: room.version,
      state: room.state,
      revealedAnswer: room.revealedAnswer,
      playerCount: playerList.length,
      players: playerList.map(p => p.name),
      responsesCount: Object.keys(room.answersThisRound || {}).length
    });
  }

  const currentQ = (room.currentIndex > 0 && room.currentIndex <= room.questions.length)
    ? room.questions[room.currentIndex - 1]
    : null;

  return res.status(200).json({
    unchanged: false,
    version: room.version || 1,
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
  const { pin, action, clientState } = req.body || {};
  let room = getRoom(pin);

  // Auto-restore room if container rebooted
  if (!room && clientState && clientState.questions) {
    room = clientState;
    memoryRooms.set(String(pin).trim(), room);
  }

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

// Submit Answer
app.post(['/api/submit-answer', '/submit-answer'], (req, res) => {
  const { pin, name, answerIndex } = req.body || {};
  const room = getRoom(pin);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (room.state !== 'QUESTION') {
    return res.status(400).json({ error: 'Not accepting answers right now.' });
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

  if (room.answersThisRound[playerKey] !== undefined) {
    return res.status(200).json({ success: true, message: 'Answer already recorded' });
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

app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.method === 'POST') {
    return res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.path}` });
  }
  return res.status(404).send('Page not found');
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server active on port ${PORT}`);
  });
}

module.exports = app;
