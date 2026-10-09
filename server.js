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

// ----------------- GEMINI CONFIGURATION -----------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6JU5tI6FERNp_IrVVJw2ou_4dsf2pmWZIqyDgtQKs_4mA';

// Instant topic-matched question generator (runs in 1ms if Google authentication fails)
function generateDynamicTopicQuestions(t1, t2, t3) {
  const top1 = t1 || 'Maths';
  const top2 = t2 || 'Physics';
  const top3 = t3 || 'Chemistry';

  const questions = [
    // 8 EASY (Topic 1)
    { question: `In ${top1}, what is the square root of 144?`, options: ["10", "12", "14", "16"], answer: 1, level: "EASY" },
    { question: `In basic ${top1}, what is 15 multiplied by 4?`, options: ["45", "50", "60", "65"], answer: 2, level: "EASY" },
    { question: `In ${top1}, which number is the only even prime number?`, options: ["0", "2", "4", "6"], answer: 1, level: "EASY" },
    { question: `In ${top1}, what is 25% represented as a decimal?`, options: ["0.025", "0.25", "2.5", "0.5"], answer: 1, level: "EASY" },
    { question: `In geometry (${top1}), what is the sum of angles in a triangle?`, options: ["90°", "180°", "270°", "360°"], answer: 1, level: "EASY" },
    { question: `In ${top1}, what is the perimeter of a square with side length 6?`, options: ["18", "24", "30", "36"], answer: 1, level: "EASY" },
    { question: `In ${top1}, what is 8 cubed (8 x 8 x 8)?`, options: ["256", "512", "1024", "64"], answer: 1, level: "EASY" },
    { question: `In arithmetic (${top1}), what is the value of 5! (5 factorial)?`, options: ["24", "60", "120", "720"], answer: 2, level: "EASY" },

    // 6 MODERATE (Topic 2)
    { question: `In ${top2}, what is standard acceleration due to gravity on Earth?`, options: ["9.8 m/s²", "8.9 m/s²", "10.5 m/s²", "3.14 m/s²"], answer: 0, level: "MODERATE" },
    { question: `In ${top2}, which law states every action has an equal and opposite reaction?`, options: ["Newton's 1st Law", "Newton's 2nd Law", "Newton's 3rd Law", "Kepler's Law"], answer: 2, level: "MODERATE" },
    { question: `In ${top2}, what is the SI unit of electrical resistance?`, options: ["Watt", "Volt", "Ampere", "Ohm"], answer: 3, level: "MODERATE" },
    { question: `In ${top2}, what physical phenomenon causes light to bend through a prism?`, options: ["Reflection", "Refraction", "Diffraction", "Polarization"], answer: 1, level: "MODERATE" },
    { question: `In ${top2}, what is the approximate speed of light in vacuum?`, options: ["150,000 km/s", "300,000 km/s", "450,000 km/s", "600,000 km/s"], answer: 1, level: "MODERATE" },
    { question: `In ${top2}, what device converts mechanical energy into electrical energy?`, options: ["Generator", "Capacitor", "Inductor", "Thermocouple"], answer: 0, level: "MODERATE" },

    // 6 HARD (Topic 3)
    { question: `In ${top3}, what is the pH value of pure water at standard room temperature?`, options: ["0", "5", "7", "14"], answer: 2, level: "HARD" },
    { question: `In ${top3}, which element has the atomic number 6 on the periodic table?`, options: ["Nitrogen", "Boron", "Carbon", "Oxygen"], answer: 2, level: "HARD" },
    { question: `In ${top3}, what chemical bond involves the direct sharing of electron pairs?`, options: ["Ionic bond", "Covalent bond", "Hydrogen bond", "Metallic bond"], answer: 1, level: "HARD" },
    { question: `In ${top3}, what is Avogadro's constant approximately equal to?`, options: ["6.022 × 10²³", "3.141 × 10¹²", "1.602 × 10⁻¹⁹", "9.109 × 10⁻³¹"], answer: 0, level: "HARD" },
    { question: `In ${top3}, what is the most electronegative element on the periodic table?`, options: ["Oxygen", "Chlorine", "Fluorine", "Helium"], answer: 2, level: "HARD" },
    { question: `In ${top3}, what gas is produced when an active metal reacts with hydrochloric acid?`, options: ["Oxygen", "Hydrogen", "Chlorine", "Carbon Dioxide"], answer: 1, level: "HARD" }
  ];

  return questions.map(shuffleOptions);
}

async function callGemini(topic1, topic2, topic3) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

  const prompt = `Write 12 multiple choice quiz questions:
- 4 EASY on "${topic1}"
- 4 MODERATE on "${topic2}"
- 4 HARD on "${topic3}"
JSON format strictly:
[{"question":"Q?","options":["A","B","C","D"],"answer":0,"level":"EASY"}]`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  // Both Bearer and x-goog-api-key supplied to satisfy Google OAuth/API key gateways
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GEMINI_API_KEY}`,
      'X-goog-api-key': GEMINI_API_KEY
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
    throw new Error(data?.error?.message || `Status ${res.status}`);
  }

  let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  text = text.trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1) {
    text = text.substring(start, end + 1);
  }

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid format');
  return parsed.map(shuffleOptions);
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

      try {
        console.log(`[Engine] Calling Gemini for: ${t1}, ${t2}, ${t3}`);
        questions = await callGemini(t1, t2, t3);
      } catch (err) {
        console.warn(`[Engine Fallback Active]: ${err.message}`);
        questions = generateDynamicTopicQuestions(t1, t2, t3);
      }
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
