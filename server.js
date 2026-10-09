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

// ----------------- INSTANT 20-QUESTION GENERATOR -----------------

function generateInstantQuestions(t1, t2, t3) {
  const top1 = (t1 && t1.trim()) || 'Mathematics';
  const top2 = (t2 && t2.trim()) || 'Physics';
  const top3 = (t3 && t3.trim()) || 'Chemistry';

  const questions = [
    // 8 EASY (Topic 1)
    { question: `What is the square root of 144? (${top1})`, options: ["10", "12", "14", "16"], answer: 1, level: "EASY" },
    { question: `What is the value of 15 multiplied by 4? (${top1})`, options: ["45", "50", "60", "65"], answer: 2, level: "EASY" },
    { question: `What is the only even prime number? (${top1})`, options: ["0", "2", "4", "6"], answer: 1, level: "EASY" },
    { question: `What is 25% written as a decimal fraction? (${top1})`, options: ["0.025", "0.25", "2.5", "0.5"], answer: 1, level: "EASY" },
    { question: `What is the perimeter of a square with a side length of 5? (${top1})`, options: ["15", "20", "25", "30"], answer: 1, level: "EASY" },
    { question: `What is the sum of the angles inside a triangle? (${top1})`, options: ["90°", "180°", "270°", "360°"], answer: 1, level: "EASY" },
    { question: `If a car travels at 60 km/h, how far does it go in 2 hours? (${top1})`, options: ["90 km", "100 km", "120 km", "150 km"], answer: 2, level: "EASY" },
    { question: `What is the value of 7 squared (7²)? (${top1})`, options: ["14", "42", "49", "56"], answer: 2, level: "EASY" },

    // 6 MODERATE (Topic 2)
    { question: `Which fundamental physical constant has the approximate value 9.8 m/s² on Earth? (${top2})`, options: ["Speed of Sound", "Gravitational Acceleration", "Atmospheric Pressure", "Hubble Constant"], answer: 1, level: "MODERATE" },
    { question: `Which law of motion states that for every action there is an equal and opposite reaction? (${top2})`, options: ["Newton's First Law", "Newton's Second Law", "Newton's Third Law", "Law of Gravitation"], answer: 2, level: "MODERATE" },
    { question: `What unit is used to measure electrical frequency? (${top2})`, options: ["Volt", "Joule", "Watt", "Hertz"], answer: 3, level: "MODERATE" },
    { question: `In optics, what phenomenon causes a straw to look bent in a glass of water? (${top2})`, options: ["Reflection", "Refraction", "Diffraction", "Dispersion"], answer: 1, level: "MODERATE" },
    { question: `What device transforms mechanical energy into electrical energy? (${top2})`, options: ["Generator", "Capacitor", "Resistor", "Transformer"], answer: 0, level: "MODERATE" },
    { question: `What is the approximate speed of light in a vacuum? (${top2})`, options: ["150,000 km/s", "300,000 km/s", "450,000 km/s", "600,000 km/s"], answer: 1, level: "MODERATE" },

    // 6 HARD (Topic 3)
    { question: `What is the primary chemical bond holding water molecules together internally? (${top3})`, options: ["Ionic bond", "Polar covalent bond", "Hydrogen bond", "Metallic bond"], answer: 1, level: "HARD" },
    { question: `What is the pH value of a completely neutral aqueous solution at 25°C? (${top3})`, options: ["0", "5", "7", "14"], answer: 2, level: "HARD" },
    { question: `Which element has the atomic number 6 on the periodic table? (${top3})`, options: ["Helium", "Boron", "Carbon", "Nitrogen"], answer: 2, level: "HARD" },
    { question: `What noble gas is commonly used in bright blue-red illuminating sign lamps? (${top3})`, options: ["Argon", "Neon", "Krypton", "Radon"], answer: 1, level: "HARD" },
    { question: `What is Avogadro's constant approximately equal to? (${top3})`, options: ["6.022 × 10²³", "3.141 × 10¹²", "1.602 × 10⁻¹⁹", "9.109 × 10⁻³¹"], answer: 0, level: "HARD" },
    { question: `What is the oxidation state of pure oxygen gas (O₂)? (${top3})`, options: ["-2", "-1", "0", "+2"], answer: 2, level: "HARD" }
  ];

  return questions.map(shuffleOptions);
}

// ----------------- API ENDPOINTS -----------------

// Create Room
app.post(['/api/create-room', '/create-room'], (req, res) => {
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
      questions = generateInstantQuestions(topic1, topic2, topic3);
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

    console.log(`Room [${pin}] established immediately with ${questions.length} questions.`);
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
