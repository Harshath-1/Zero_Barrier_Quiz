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

// Built-in Dynamic Fallback Questions to ensure 100% uptime
function getFallbackQuestions(t1, t2, t3) {
  const top1 = t1 || 'General Science';
  const top2 = t2 || 'Technology';
  const top3 = t3 || 'World History';

  const bank = [
    // 8 EASY (Topic 1)
    { question: `Which primary element is essential for life on Earth?`, options: ["Carbon", "Helium", "Neon", "Argon"], answer: 0, level: "EASY" },
    { question: `What is the chemical formula for water?`, options: ["CO2", "H2O", "O2", "NaCl"], answer: 1, level: "EASY" },
    { question: `What is the closest planet to the Sun?`, options: ["Venus", "Mars", "Mercury", "Jupiter"], answer: 2, level: "EASY" },
    { question: `Which force pulls objects toward the center of the Earth?`, options: ["Magnetism", "Friction", "Gravity", "Inertia"], answer: 2, level: "EASY" },
    { question: `What gas do plants absorb during photosynthesis?`, options: ["Carbon Dioxide", "Oxygen", "Nitrogen", "Hydrogen"], answer: 0, level: "EASY" },
    { question: `How many states of matter are commonly recognized in primary physics?`, options: ["Two", "Three", "Four", "Five"], answer: 1, level: "EASY" },
    { question: `What is the boiling point of pure water at sea level?`, options: ["50°C", "90°C", "100°C", "120°C"], answer: 2, level: "EASY" },
    { question: `What part of a cell contains its genetic material?`, options: ["Nucleus", "Ribosome", "Cytoplasm", "Vacuole"], answer: 0, level: "EASY" },

    // 6 MODERATE (Topic 2)
    { question: `What protocol is used to secure browsing sessions on the web?`, options: ["FTP", "HTTPS", "SMTP", "DNS"], answer: 1, level: "MODERATE" },
    { question: `Which company developed the JavaScript programming language?`, options: ["Microsoft", "Netscape", "Sun Microsystems", "Oracle"], answer: 1, level: "MODERATE" },
    { question: `In computer networking, what does LAN stand for?`, options: ["Large Area Network", "Local Area Network", "Linear Access Node", "Linked Audio Net"], answer: 1, level: "MODERATE" },
    { question: `What is the standard port used for unencrypted HTTP traffic?`, options: ["21", "22", "80", "443"], answer: 2, level: "MODERATE" },
    { question: `What data structure follows the First-In, First-Out (FIFO) principle?`, options: ["Stack", "Queue", "Tree", "Graph"], answer: 1, level: "MODERATE" },
    { question: `Which logic gate outputs TRUE only when both inputs are TRUE?`, options: ["OR", "XOR", "AND", "NOR"], answer: 2, level: "MODERATE" },

    // 6 HARD (Topic 3)
    { question: `In which year did the Apollo 11 mission land humans on the Moon?`, options: ["1965", "1969", "1971", "1973"], answer: 1, level: "HARD" },
    { question: `What treaty was signed in 1919 ending World War I?`, options: ["Treaty of Paris", "Treaty of Versailles", "Treaty of Ghent", "Treaty of Utrecht"], answer: 1, level: "HARD" },
    { question: `Who was the first emperor of unified China?`, options: ["Qin Shi Huang", "Han Wudi", "Kublai Khan", "Sun Yat-sen"], answer: 0, level: "HARD" },
    { question: `The ancient city of Constantinople is known today as which city?`, options: ["Athens", "Cairo", "Istanbul", "Alexandria"], answer: 2, level: "HARD" },
    { question: `Which civilization built the ancient complex of Machu Picchu?`, options: ["Maya", "Aztec", "Inca", "Olmec"], answer: 2, level: "HARD" },
    { question: `What year marked the fall of the Western Roman Empire?`, options: ["312 AD", "476 AD", "800 AD", "1066 AD"], answer: 1, level: "HARD" }
  ];

  return bank.map(shuffleOptions);
}

// ----------------- GEMINI CONFIGURATION -----------------

const HARDCODED_GEMINI_KEY = 'AQ.Ab8RN6JU5tI6FERNp_IrVVJw2ou_4dsf2pmWZIqyDgtQKs_4mA';

function getGeminiApiKey() {
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  return envKey || HARDCODED_GEMINI_KEY;
}

async function callGemini(prompt) {
  const apiKey = getGeminiApiKey();
  const models = ['gemini-flash-latest', 'gemini-2.0-flash'];
  let lastErr = null;

  for (const model of models) {
    // 7.5 second timeout to keep within Vercel's limit
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);

    try {
      console.log(`[Gemini Engine] Querying model: ${model}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
          }
        })
      });

      clearTimeout(timeout);
      const data = await res.json();

      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `Gemini status ${res.status}`);
        console.warn(`[Gemini Engine] ${model} failed: ${lastErr.message}`);
        continue;
      }

      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      text = text.trim();

      if (text.startsWith('```json')) text = text.slice(7);
      if (text.startsWith('```')) text = text.slice(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      text = text.trim();

      const s = text.indexOf('[');
      const e = text.lastIndexOf(']');
      if (s !== -1 && e !== -1) text = text.substring(s, e + 1);

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length >= 10) {
        console.log(`✅ [Gemini SUCCESS] Generated ${parsed.length} questions using ${model}!`);
        return parsed.map(shuffleOptions);
      }
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      console.warn(`[Gemini Engine] ${model} timed out or failed: ${e.message}`);
    }
  }

  throw lastErr || new Error('Gemini call failed or timed out.');
}

async function generateQuizQuestions(t1, t2, t3) {
  const topic1 = (t1 && t1.trim()) || 'World Cinema';
  const topic2 = (t2 && t2.trim()) || 'World Geography';
  const topic3 = (t3 && t3.trim()) || 'Modern Science';

  console.log(`[Diagnostic] Generating 20 questions for: ${topic1}, ${topic2}, ${topic3}`);

  const prompt = `Generate a JSON array of 20 multiple choice questions:
- 8 EASY questions about "${topic1}" (level: "EASY")
- 6 MODERATE questions about "${topic2}" (level: "MODERATE")
- 6 HARD questions about "${topic3}" (level: "HARD")

Each question must be an object: {"question": string, "options": [4 strings], "answer": int (0-3), "level": string}.
Keep questions and options concise.`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn(`⚠️ [AI Engine Notice] ${err.message}. Serving instantaneous curated quiz bank to preserve session.`);
    return getFallbackQuestions(topic1, topic2, topic3);
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
      questions = await generateQuizQuestions(topic1, topic2, topic3);
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
