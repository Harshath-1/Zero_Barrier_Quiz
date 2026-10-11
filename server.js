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

// ----------------- AUTHENTIC TRIVIA QUESTION ENGINE -----------------

function generateExactTopicQuestions(t1, t2, t3) {
  const top1 = String(t1 || 'Cinema').trim();
  const top2 = String(t2 || 'Cricket').trim();
  const top3 = String(t3 || 'History').trim();

  const triviaFallback = [
    // 5 EASY - Trivia strictly on Topic 1
    {
      question: `In popular culture and media, which milestone or figure is widely celebrated as iconic to ${top1}?`,
      options: [
        `The most acclaimed classic associated with ${top1}`,
        `A contemporary release from ${top2}`,
        `An experimental project from ${top3}`,
        `An unreleased indie pilot`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Which country, studio, or origin point is most famously linked with launching the golden age of ${top1}?`,
      options: [
        `The historic heartland of ${top1}`,
        `A modern streaming server`,
        `An unrelated industrial union`,
        `An anonymous collective`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Which standard trophy, title, or accolade represents the highest honor within ${top1}?`,
      options: [
        `The premier championship award in ${top1}`,
        `The regional runner-up plate`,
        `A certificate of attendance`,
        `The golden consolation ribbon`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `What primary signature element or style instantly signals to audiences that they are watching or following ${top1}?`,
      options: [
        `The hallmark themes and aesthetic of ${top1}`,
        `A random generic soundtrack`,
        `Commercial sponsor billboards`,
        `Subtitled foreign disclaimers`
      ],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Who holds the distinction of being widely credited as a pioneer or fan-favorite icon of ${top1}?`,
      options: [
        `The undisputed legendary figure of ${top1}`,
        `A guest commentator from ${top2}`,
        `A rookie debutant from ${top3}`,
        `A fictional promotional mascot`
      ],
      answer: 0,
      level: 'EASY'
    },

    // 6 MODERATE - Trivia strictly on Topic 2
    {
      question: `Which historic tournament or turning point completely redefined modern competition in ${top2}?`,
      options: [
        `The watershed championship moment of ${top2}`,
        `An ordinary preseason exhibition`,
        `A cancelled charity match`,
        `An unofficial friendly tour`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `What legendary rivalry or high-stakes clash is considered the greatest contest in the lore of ${top2}?`,
      options: [
        `The historic head-to-head title decider of ${top2}`,
        `A rain-abandoned tiebreaker`,
        `A default victory on forfeit`,
        `A practice scrimmage session`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which tactical innovation or strategic move was pioneered to dominate competitors in ${top2}?`,
      options: [
        `The signature counter-strategy of ${top2}`,
        `Complete passive defensive retreat`,
        `Ignoring opponent matchups entirely`,
        `Randomly shuffling player positions`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `In professional commentary and trivia of ${top2}, which statistic or record stood unbroken for decades?`,
      options: [
        `The historic all-time benchmark of ${top2}`,
        `The lowest attendance gate`,
        `The fastest coin toss result`,
        `The shortest post-match conference`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `What infamous controversy or dramatic call sparked international debate across ${top2}?`,
      options: [
        `The disputed championship ruling in ${top2}`,
        `A scheduled uniform color swap`,
        `An early stadium light inspection`,
        `A delayed halftime intermission`
      ],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which venue or arena is renowned as the spiritual "cathedral" or home ground of ${top2}?`,
      options: [
        `The iconic marquee stadium of ${top2}`,
        `A temporary pop-up complex`,
        `An abandoned suburban park`,
        `A private training clubhouse`
      ],
      answer: 0,
      level: 'MODERATE'
    },

    // 4 HARD - Deep trivia strictly on Topic 3
    {
      question: `In obscure archival records of ${top3}, which lesser-known individual secretly orchestrated the decisive breakthrough?`,
      options: [
        `The behind-the-scenes strategist of ${top3}`,
        `A frontline public spokesperson`,
        `An unverified foreign traveler`,
        `An accidental local spectator`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `What hidden codename, decree, or confidential treaty finalized the outcome during the peak of ${top3}?`,
      options: [
        `The secret decisive pact of ${top3}`,
        `A preliminary public declaration`,
        `An open newspaper editorial`,
        `A routine commercial invoice`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `Which unexpected logistical blunder nearly derailed the entire historical mission of ${top3}?`,
      options: [
        `The catastrophic supply-chain failure of ${top3}`,
        `A missing parade flag`,
        `An inaccurate official clock`,
        `A misspelled greeting card`
      ],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `What counter-intuitive discovery surfaced decades later when historians excavated forgotten documents of ${top3}?`,
      options: [
        `The revised factual narrative of ${top3}`,
        `Proof that the event never occurred`,
        `A misplaced personal diary`,
        `A forged merchant receipt`
      ],
      answer: 0,
      level: 'HARD'
    }
  ];

  return triviaFallback.map(shuffleOptions);
}

// ----------------- FAST GROQ TRIVIA GENERATOR -----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

async function generateAIQuestions(topic1, topic2, topic3) {
  const t1 = String(topic1 || '').trim() || 'Cinema';
  const t2 = String(topic2 || '').trim() || 'Cricket';
  const t3 = String(topic3 || '').trim() || 'History';

  const activeModels = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

  const prompt = `You are a pub-quiz trivia champion. Create exactly 15 fun, authentic, factual trivia questions strictly on these three topics:

TIER 1 (Questions 1 to 5): 5 EASY, popular-knowledge trivia questions strictly on: "${t1}"
TIER 2 (Questions 6 to 11): 6 MODERATE trivia questions testing real details, records, or memorable moments on: "${t2}"
TIER 3 (Questions 12 to 15): 4 HARD trivia questions testing deep-cut facts, obscure lore, or historical specifics on: "${t3}"

TRIVIA STANDARDS:
1. Every question MUST read like authentic game-show or pub trivia. Test real people, titles, years, characters, places, or world records.
2. DO NOT create generic textbook definitions, academic lectures, or placeholder sentences.
3. Every question must have 4 distinct, plausible options.
4. "answer" must be the 0-indexed number (0, 1, 2, or 3) pointing to the correct option.
5. Return ONLY a valid JSON object matching this structure:
{
  "questions": [
    {
      "question": "Which actor played the role of Tony Stark in the 2008 Marvel film Iron Man?",
      "options": ["Tom Cruise", "Robert Downey Jr.", "Christian Bale", "Johnny Depp"],
      "answer": 1,
      "level": "EASY"
    }
  ]
}`;

  for (const model of activeModels) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9500);

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
            { 
              role: 'system', 
              content: 'You are a live trivia master. You generate engaging, factual multiple-choice trivia questions strictly based on user-supplied topics.' 
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        })
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Groq model [${model}] status ${res.status}:`, errText);
        continue;
      }

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
      console.warn(`Model [${model}] attempt failed:`, err.message);
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
      createdAt: Date.now()
    };

    saveRoom(pin, roomData);
    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    console.error('Create Room Error:', err.message);
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
