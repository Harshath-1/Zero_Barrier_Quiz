require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS & Real-Time Cache Control
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.path.includes('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
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
  return res.status(404).send(`Cannot find ${filename}`);
}

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

// ----------------- NON-BLOCKING SHARED /tmp STORAGE -----------------

const memoryRooms = new Map();
const DB_FILE = '/tmp/all_quiz_rooms.json';
let isSaving = false;
let pendingSave = false;

function readDiskLedger() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (!memoryRooms.has(k)) {
          memoryRooms.set(k, v);
        }
      }
    }
  } catch (e) {}
}

function flushToDisk() {
  if (isSaving) {
    pendingSave = true;
    return;
  }
  isSaving = true;

  const obj = {};
  for (const [k, v] of memoryRooms.entries()) {
    obj[k] = v;
  }

  fs.writeFile(DB_FILE, JSON.stringify(obj), 'utf8', () => {
    isSaving = false;
    if (pendingSave) {
      pendingSave = false;
      flushToDisk();
    }
  });
}

// Initial seed
readDiskLedger();

function getRoom(pin) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return null;

  if (memoryRooms.has(cleanPin)) {
    return memoryRooms.get(cleanPin);
  }

  readDiskLedger();
  return memoryRooms.get(cleanPin) || null;
}

function saveRoom(pin, roomData) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return;

  roomData.version = (roomData.version || 0) + 1;
  roomData.lastUpdated = Date.now();
  memoryRooms.set(cleanPin, roomData);
  flushToDisk();
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

// ----------------- CURATED TOPIC TRIVIA ENGINE (FAILSAFE) -----------------

function generateExactTopicQuestions(t1, t2, t3) {
  const top1 = String(t1 || 'Cinema').trim();
  const top2 = String(t2 || 'Cricket').trim();
  const top3 = String(t3 || 'History').trim();

  const curatedBank = [
    // 5 EASY - Topic 1
    {
      question: `In the subject of ${top1}, which of the following is celebrated as a defining milestone?`,
      options: [`The Landmark Premiere of ${top1}`, `An Unreleased Demo Cut`, `A Regional Spin-off Project`, `A Promotional Spoof Reel`],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Who among the following is widely hailed as an iconic legend in ${top1}?`,
      options: [`The Hall-of-Fame Pioneer`, `The Visiting Guest Speaker`, `The Studio Extra`, `The Fictional Commercial Mascot`],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `What represents the highest competitive honor or recognition within ${top1}?`,
      options: [`The Premier Championship Title`, `The Participation Ribbon`, `The Consolation Certificate`, `The Regional Badge`],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Which historic milestone marked the global commercial breakthrough for ${top1}?`,
      options: [`The Record-Setting Public Premiere`, `A Canceled Pilot Production`, `An Unreleased Studio Track`, `A Private Review Session`],
      answer: 0,
      level: 'EASY'
    },
    {
      question: `Which core stylistic element is universally identified with popular works in ${top1}?`,
      options: [`Signature Storytelling & Direction`, `A Generic Video Filter`, `Unedited Stock Audio`, `A Static Slide Presentation`],
      answer: 0,
      level: 'EASY'
    },

    // 6 MODERATE - Topic 2
    {
      question: `In modern ${top2}, which event is universally regarded as the ultimate prize?`,
      options: [`The World Cup Championship Final`, `A Preseason Practice Match`, `A Domestic Warm-up Series`, `A Charity Scrimmage`],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which statistical milestone in ${top2} remained unbroken for several decades?`,
      options: [`The All-Time Highest Scoring Record`, `The Shortest Post-Match Interview`, `The Fastest Stadium Entry Record`, `The Lowest Recorded Attendance`],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which tactical approach was famously introduced to dominate matchups in ${top2}?`,
      options: [`Data-Driven Strategic Formations`, `Passive Defense Only`, `Random Player Substitutions`, `Completely Ignoring Matchup Analytics`],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which historic rivalry match is known as the fiercest clash in ${top2}?`,
      options: [`The Marquee Championship Showdown`, `A Closed-Door Training Scrimmage`, `A Walkover Forfeit`, `An Untelevised Qualifier`],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `Which venue is globally recognized as the spiritual home of ${top2}?`,
      options: [`The Marquee Historic Central Stadium`, `A Temporary Pop-up Turf`, `A Local Community Field`, `An Abandoned Training Complex`],
      answer: 0,
      level: 'MODERATE'
    },
    {
      question: `What major rule revision in ${top2} sparked widespread international debate?`,
      options: [`The Official Tiebreaker Regulation`, `A Player Jersey Numbering Guideline`, `An Interval Time Extension`, `A Stadium Lighting Check Rule`],
      answer: 0,
      level: 'MODERATE'
    },

    // 4 HARD - Topic 3
    {
      question: `During major pivotal events in ${top3}, what was the decisive treaty or agreement signed?`,
      options: [`The Historic Strategic Treaty`, `An Unofficial Press Note`, `A Provisional Broadcast Memo`, `A Municipal Supply Receipt`],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `Which critical factor proved most decisive during operations in ${top3}?`,
      options: [`Severe Winter Logistics and Supply Strains`, `A Misplaced Unit Banner`, `A Clock Synchronization Error`, `A Lost Diplomatic Telegram`],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `In modern analysis of ${top3}, what primary source material altered historians' consensus?`,
      options: [`Declassified Government Dispatches and Journals`, `A Forged Merchant Manifest`, `An Undated Personal Receipt`, `An Unverified Rumor in Foreign Tabloids`],
      answer: 0,
      level: 'HARD'
    },
    {
      question: `Who was the key strategist responsible for organizing the decisive campaign in ${top3}?`,
      options: [`The Chief Diplomatic Commander`, `A Royal Court Attendant`, `A Visiting Merchant`, `An Uninvolved Spectator`],
      answer: 0,
      level: 'HARD'
    }
  ];

  return curatedBank.map(shuffleOptions);
}

// ----------------- STRICT TOPIC-DRIVEN TRIVIA ENGINE -----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

async function generateAIQuestions(topic1, topic2, topic3) {
  const t1 = String(topic1 || '').trim() || 'Cinema';
  const t2 = String(topic2 || '').trim() || 'Cricket';
  const t3 = String(topic3 || '').trim() || 'World History';

  // Officially active and supported Groq model names
  const activeModels = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768'
  ];

  const prompt = `You are an expert pub-quiz trivia host. Create exactly 15 authentic, factual, fun multiple-choice trivia questions based strictly on the three user-specified topics below.

USER TOPICS:
- Topic 1: "${t1}"
- Topic 2: "${t2}"
- Topic 3: "${t3}"

ROUND BREAKDOWN:
- Questions 1 to 5 (EASY): Famous, widely known trivia strictly about "${t1}" (e.g., recognizable actors, films, directors, characters, or cultural hits).
- Questions 6 to 11 (MODERATE): Fact-based trivia strictly about "${t2}" (e.g., memorable tournament records, championship finals, famous stars, or rivalries).
- Questions 12 to 15 (HARD): Deeper trivia strictly about "${t3}" (e.g., specific years, battles, treaties, prominent figures, or lesser-known milestones).

ABSOLUTE QUALITY RULES:
1. Every question MUST explicitly mention or test real, specific, named entities related to "${t1}", "${t2}", or "${t3}". Use real proper nouns (people, titles, places, numbers).
2. NEVER produce vague or placeholder text like "Which milestone is celebrated in...", "A generic automated template", or "Landmark classic of...".
3. Provide exactly 4 plausible choices per question. All 4 choices must belong to the exact same category (e.g., all 4 are actor names, or all 4 are years, or all 4 are stadiums).
4. Exactly one choice is correct. "answer" must be the 0-indexed integer (0, 1, 2, or 3) identifying the correct choice.
5. Keep question texts concise (under 25 words).

Return ONLY valid JSON matching this schema:
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
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are an authentic pub-quiz trivia master. You generate real-world trivia with concrete named entities and output strictly valid JSON matching the schema.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          response_format: { type: 'json_object' }
        })
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`Groq API Error on model [${model}] (Status ${res.status}):`, errorText);
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
      console.error(`Request attempt failed on model [${model}]:`, err.message);
      continue;
    }
  }

  return generateExactTopicQuestions(t1, t2, t3);
}

// ----------------- FAST REST API ENDPOINTS -----------------

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

app.get(['/api/room-status', '/room-status'], (req, res) => {
  const pin = String(req.query.pin || '').trim();
  const clientVersion = parseInt(req.query.v, 10) || 0;

  const room = getRoom(pin);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const playerList = Object.values(room.players || {});

  // Fast unchanged branch: returns in < 1ms
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

app.post(['/api/host-action', '/host-action'], (req, res) => {
  const { pin, action, clientState } = req.body || {};
  let room = getRoom(pin);

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

app.post(['/api/submit-answer', '/submit-answer'], (req, res) => {
  const { pin, name, answerIndex } = req.body || {};
  const room = getRoom(pin);

  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.state !== 'QUESTION') return res.status(400).json({ error: 'Not accepting answers' });

  if (!room.answersThisRound) room.answersThisRound = {};
  if (!room.players) room.players = {};

  const playerKey = String(name || '').trim().toLowerCase();
  if (!playerKey) return res.status(400).json({ error: 'Missing player name' });

  if (!room.players[playerKey]) {
    room.players[playerKey] = { name: String(name || '').trim(), score: 0, correctCount: 0 };
  }

  if (room.answersThisRound[playerKey] !== undefined) {
    return res.status(200).json({ success: true, message: 'Already recorded' });
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

app.use((req, res) => res.status(404).send('Not found'));

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => console.log(`Listening on ${PORT}`));
}

module.exports = app;
