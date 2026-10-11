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

// ----------------- TOPIC-LOCKED FALLBACK QUESTIONS -----------------

function generateExactTopicQuestions(t1, t2, t3) {
  const top1 = String(t1 || 'Cinema').trim();
  const top2 = String(t2 || 'Geography').trim();
  const top3 = String(t3 || 'Science').trim();

  const fallbackQuestions = [
    // 5 EASY (Topic 1)
    {
      question: `Which foundational concept is most universally recognized in the study of ${top1}?`,
      options: [
        `The primary baseline principle of ${top1}`,
        `An advanced empirical formula from ${top2}`,
        `A secondary hypothesis borrowed from ${top3}`,
        `An obsolete 19th-century speculation`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `When beginners start learning about ${top1}, what core element is introduced first?`,
      options: [
        `Core definitions and foundational laws of ${top1}`,
        `Complex non-linear differential equations`,
        `Multi-variable statistical models`,
        `Advanced quantum mechanics algorithms`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Which term or entity is most widely considered iconic within ${top1}?`,
      options: [
        `The hallmark milestone recognized in ${top1}`,
        `A minor peripheral subfield of ${top2}`,
        `A random speculative trend in ${top3}`,
        `An arbitrary unverified convention`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `In standard literature, what is the main objective of studying ${top1}?`,
      options: [
        `Mastering the foundational mechanics of ${top1}`,
        `Replacing all empirical observations in ${top2}`,
        `Eliminating historical chronologies in ${top3}`,
        `Calculating arbitrary theoretical probabilities`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Which basic rule universally governs standard elementary cases in ${top1}?`,
      options: [
        `Consistent compliance with ${top1} principles`,
        `Unpredictable random outcomes every trial`,
        `Total absence of consistent logic`,
        `Complete inversion of baseline assumptions`
      ],
      answer: 0,
      level: 'EASY'
    },

    // 6 MODERATE (Topic 2)
    {
      question: `In real-world intermediate applications of ${top2}, what key variable must be balanced?`,
      options: [
        `Operational efficiency and baseline consistency in ${top2}`,
        `Random cosmetic surface parameters`,
        `Unmonitored arbitrary changes`,
        `Zero validation constraints`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which recognized methodology is most commonly applied to optimize systems in ${top2}?`,
      options: [
        `Iterative analysis and systematic calibration in ${top2}`,
        `Unchecked trial and error with no metrics`,
        `Passive observation without documentation`,
        `Unrestricted brute-force computation`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `How does scaling up operational complexity usually impact outcomes in ${top2}?`,
      options: [
        `Demands tighter control protocols and error-handling in ${top2}`,
        `Guarantees zero operational maintenance cost`,
        `Removes the need for testing and validation`,
        `Immediately causes catastrophic failure`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `When diagnosing inconsistent results in ${top2}, what is the standard recommended step?`,
      options: [
        `Re-verifying baseline inputs and boundary conditions of ${top2}`,
        `Discarding all previously collected empirical records`,
        `Assuming the underlying theory of ${top2} is flawed`,
        `Restarting the process with random parameters`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which relationship describes how intermediate components interact in ${top2}?`,
      options: [
        `Proportional feedback and interdependent equilibrium in ${top2}`,
        `Independent random noise with zero correlation`,
        `Permanent destructive interference across states`,
        `Instantaneous divergence without convergence`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `What distinguishes practical intermediate mastery of ${top2} from basic theory?`,
      options: [
        `The ability to solve multi-variable scenarios in ${top2}`,
        `Relying purely on mechanical memorization`,
        `Refusing to perform experimental verification`,
        `Ignoring boundary anomalies and edge cases`
      ],
      answer: 0,
      level: 'MODERATE'
    },

    // 4 HARD (Topic 3)
    {
      question: `Under rigorous theoretical analysis of ${top3}, which constraint poses the primary challenge?`,
      options: [
        `Handling asymptotic boundary conditions and edge cases in ${top3}`,
        `Performing simple elementary linear calculations`,
        `Basic static state preservation`,
        `Elementary classification of simple components`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `Which advanced concept in ${top3} frequently challenges conventional analytical models?`,
      options: [
        `Non-linear state transitions and threshold limits in ${top3}`,
        `Basic symmetric arithmetic relationships`,
        `Standard baseline identity models`,
        `Simple chronological sequence order`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `In advanced research evaluations of ${top3}, which invariant property must remain conserved?`,
      options: [
        `The fundamental governing equilibrium parameter of ${top3}`,
        `Transient unverified noise metrics`,
        `Uncontrolled environmental fluctuations`,
        `Arbitrary heuristic rough estimates`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `What distinguishes expert analysis in ${top3} from standard conventional implementations?`,
      options: [
        `Precise predictive modeling of critical edge cases in ${top3}`,
        `Limiting analysis strictly to elementary formulas`,
        `Relying on subjective intuition without validation`,
        `Omitting variable dependencies from evaluations`
      ],
      answer: 0,
      level: 'HARD'
    }
  ];

  return fallbackQuestions.map(shuffleOptions);
}

// ----------------- GROQ AI GENERATION -----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

async function generateAIQuestions(topic1, topic2, topic3) {
  const t1 = String(topic1 || '').trim() || 'General Knowledge';
  const t2 = String(topic2 || '').trim() || 'Science';
  const t3 = String(topic3 || '').trim() || 'History';

  const activeModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

  const prompt = `You are a professional trivia generator. Generate exactly 15 authentic, factual, and strictly relevant multiple-choice trivia questions:
- Exactly 5 EASY trivia questions strictly testing knowledge about: "${t1}" (level: "EASY")
- Exactly 6 MODERATE trivia questions strictly testing knowledge about: "${t2}" (level: "MODERATE")
- Exactly 4 HARD trivia questions strictly testing knowledge about: "${t3}" (level: "HARD")

CRITICAL RULES:
1. Every question in Tier 1 MUST be strictly and factually about "${t1}".
2. Every question in Tier 2 MUST be strictly and factually about "${t2}".
3. Every question in Tier 3 MUST be strictly and factually about "${t3}".
4. Do NOT output generic template text. Ask authentic, interesting trivia questions.
5. Provide 4 distinct options per question.
6. "answer" must be the 0-indexed number (0, 1, 2, or 3) indicating the correct answer.
7. Output strictly a JSON object with a single "questions" array containing 15 question objects.

Format:
{
  "questions": [
    {
      "question": "What is...",
      "options": ["Choice A", "Choice B", "Choice C", "Choice D"],
      "answer": 0,
      "level": "EASY"
    }
  ]
}`;

  for (const model of activeModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);

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
          temperature: 0.5,
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
      const t2 = (topic2 && topic2.trim()) || 'Geography';
      const t3 = (topic3 && topic3.trim()) || 'Science';

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
    const fallback = generateExactTopicQuestions('Cinema', 'Geography', 'Science');
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

// Host Actions
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
