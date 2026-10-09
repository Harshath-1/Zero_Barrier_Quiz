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

  if (req.path.includes('/api/') || req.path.includes('-room') || req.path.includes('-answer')) {
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

app.get(['/', '/host', '/host.html'], (req, res) => serveHtml('host.html', res));
app.get(['/player', '/player.html'], (req, res) => serveHtml('player.html', res));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '0' }));
app.use(express.static(__dirname, { maxAge: '0' }));

// In-Memory Storage
const rooms = new Map();

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

// ----------------- GEMINI API INTEGRATION -----------------

// The key copied from your Google AI Studio cURL
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6JU5tI6FERNp_IrVVJw2ou_4dsf2pmWZIqyDgtQKs_4mA';

async function fetchQuestionsFromGemini(topic1, topic2, topic3) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

  const prompt = `Generate a JSON array of 12 concise trivia questions:
- 4 EASY questions about "${topic1}" (level: "EASY")
- 4 MODERATE questions about "${topic2}" (level: "MODERATE")
- 4 HARD questions about "${topic3}" (level: "HARD")

Rules:
1. Every question must strictly test factual knowledge of these topics: "${topic1}", "${topic2}", "${topic3}".
2. Exactly 4 short options per question.
3. "answer" must be the 0-indexed number (0, 1, 2, or 3) of the correct option.
4. Output ONLY the JSON array. No markdown code blocks, no other text.

JSON format:
[
  {
    "question": "Question text?",
    "options": ["A", "B", "C", "D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': GEMINI_API_KEY
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 2048
        }
      })
    });

    clearTimeout(timeout);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || `Gemini error status ${res.status}`);
    }

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.trim();

    if (text.startsWith('```json')) text = text.slice(7);
    if (text.startsWith('```')) text = text.slice(3);
    if (text.endsWith('```')) text = text.slice(0, -3);
    text = text.trim();

    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      text = text.substring(start, end + 1);
    }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Malformed JSON received from Gemini');
    }

    console.log(`Generated ${parsed.length} questions from Gemini for ${topic1}, ${topic2}, ${topic3}`);
    return parsed.map(shuffleOptions);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
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

      questions = await fetchQuestionsFromGemini(t1, t2, t3);
    }

    rooms.set(pin, {
      pin,
      questions,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {},
      createdAt: Date.now()
    });

    console.log(`Room [${pin}] established with ${questions.length} questions.`);
    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    console.error('Create Room Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Room Status (Host & Player polling)
app.get(['/api/room-status', '/room-status'], (req, res) => {
  const pin = String(req.query.pin || '').trim();
  const room = rooms.get(pin);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const playerList = Object.values(room.players);
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
    responsesCount: Object.keys(room.answersThisRound).length,
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
  const room = rooms.get(String(pin || '').trim());
  if (!room) return res.status(404).json({ error: 'Room not found' });

  if (action === 'NEXT') {
    if (room.currentIndex >= room.questions.length) {
      room.state = 'FINISHED';
    } else {
      room.currentIndex++;
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

  return res.status(200).json({ success: true, state: room.state, currentIndex: room.currentIndex });
});

// Player Join
app.post(['/api/join-room', '/join-room'], (req, res) => {
  const { pin, name } = req.body || {};
  const room = rooms.get(String(pin || '').trim());
  if (!room) return res.status(404).json({ error: 'Invalid PIN. Room not found.' });

  const cleanName = String(name || '').trim() || 'Player';
  const playerKey = cleanName.toLowerCase();

  if (!room.players[playerKey]) {
    room.players[playerKey] = { name: cleanName, score: 0, correctCount: 0 };
  }

  return res.status(200).json({ success: true, name: cleanName, score: room.players[playerKey].score });
});

// Player Submit Answer
app.post(['/api/submit-answer', '/submit-answer'], (req, res) => {
  const { pin, name, answerIndex } = req.body || {};
  const room = rooms.get(String(pin || '').trim());
  if (!room || room.state !== 'QUESTION') return res.status(400).json({ error: 'Not accepting answers' });

  const playerKey = String(name || '').trim().toLowerCase();
  if (room.answersThisRound[playerKey] !== undefined) {
    return res.status(200).json({ message: 'Answer already submitted' });
  }

  room.answersThisRound[playerKey] = answerIndex;
  const currentQ = room.questions[room.currentIndex - 1];
  if (currentQ && answerIndex === currentQ.answer) {
    if (room.players[playerKey]) {
      room.players[playerKey].score += 100;
      room.players[playerKey].correctCount++;
    }
  }

  return res.status(200).json({ success: true });
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
