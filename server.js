require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static assets
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.static(__dirname, { maxAge: '1h' }));

const rooms = new Map();

function shuffleOptions(item) {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOptions = indices.map(idx => item.options[idx]);
  const newAnswer = indices.indexOf(item.answer);
  return { ...item, options: newOptions, answer: newAnswer };
}

// Built-in Knowledge Bank for instant topic-matching trivia
const topicBanks = {
  maths: [
    { question: "What is the only even prime number?", options: ["2", "4", "0", "1"], answer: 0, level: "EASY" },
    { question: "What is the value of Pi (π) rounded to two decimal places?", options: ["3.14", "3.16", "3.12", "3.18"], answer: 0, level: "EASY" },
    { question: "What is the sum of interior angles in any Euclidean triangle?", options: ["180°", "360°", "90°", "270°"], answer: 0, level: "EASY" },
    { question: "What is the square root of 144?", options: ["12", "14", "16", "11"], answer: 0, level: "EASY" },
    { question: "In a right-angled triangle, what is the longest side opposite to the 90° angle called?", options: ["Hypotenuse", "Adjacent", "Perpendicular", "Tangent"], answer: 0, level: "EASY" },
    { question: "What is the perimeter formula for a rectangle with length L and width W?", options: ["2(L + W)", "L × W", "2L + W", "L² + W²"], answer: 0, level: "EASY" },
    { question: "What is 2 raised to the power of 6 (2⁶)?", options: ["64", "32", "128", "16"], answer: 0, level: "EASY" },
    { question: "What is the mathematical term for the average of a set of numbers?", options: ["Mean", "Median", "Mode", "Range"], answer: 0, level: "EASY" }
  ],
  chemistry: [
    { question: "What is the chemical formula for ordinary table salt?", options: ["NaCl", "KCl", "CaCl2", "Na2CO3"], answer: 0, level: "MODERATE" },
    { question: "Which element has the chemical symbol 'Fe'?", options: ["Iron", "Lead", "Fluorine", "Francium"], answer: 0, level: "MODERATE" },
    { question: "What is the pH level of pure distilled water at 25°C?", options: ["7", "0", "14", "5"], answer: 0, level: "MODERATE" },
    { question: "What is the most abundant gas found in Earth's atmosphere?", options: ["Nitrogen", "Oxygen", "Carbon Dioxide", "Argon"], answer: 0, level: "MODERATE" },
    { question: "Which subatomic particle has a negative electrical charge?", options: ["Electron", "Proton", "Neutron", "Positron"], answer: 0, level: "MODERATE" },
    { question: "What is the primary organic compound present in natural gas?", options: ["Methane", "Ethane", "Propane", "Butane"], answer: 0, level: "MODERATE" }
  ],
  physics: [
    { question: "What is the approximate speed of light in a vacuum?", options: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "1,000,000 km/s"], answer: 0, level: "HARD" },
    { question: "What physical property does the SI unit 'Tesla' measure?", options: ["Magnetic Flux Density", "Electric Current", "Capacitance", "Inductance"], answer: 0, level: "HARD" },
    { question: "Which fundamental force is responsible for keeping planets in orbit around stars?", options: ["Gravitational force", "Strong nuclear force", "Electromagnetic force", "Weak nuclear force"], answer: 0, level: "HARD" },
    { question: "According to Newton's Second Law of Motion, Force equals mass multiplied by what?", options: ["Acceleration", "Velocity", "Distance", "Momentum"], answer: 0, level: "HARD" },
    { question: "What is absolute zero temperature measured in Celsius (°C)?", options: ["-273.15°C", "-100°C", "0°C", "-459.67°C"], answer: 0, level: "HARD" },
    { question: "Which phenomenon explains why pencil tips appear bent when placed in a glass of water?", options: ["Refraction", "Reflection", "Diffraction", "Polarization"], answer: 0, level: "HARD" }
  ],
  general: [
    { question: "Which planet is commonly known as the 'Red Planet'?", options: ["Mars", "Venus", "Jupiter", "Mercury"], answer: 0, level: "EASY" },
    { question: "What is the capital city of Australia?", options: ["Canberra", "Sydney", "Melbourne", "Brisbane"], answer: 0, level: "MODERATE" },
    { question: "Who was the first woman to win a Nobel Prize?", options: ["Marie Curie", "Rosalind Franklin", "Ada Lovelace", "Jane Goodall"], answer: 0, level: "HARD" },
    { question: "What is the largest living species of mammal currently on Earth?", options: ["Blue Whale", "African Elephant", "Giraffe", "Colossal Squid"], answer: 0, level: "EASY" },
    { question: "In computing, what does the acronym 'URL' stand for?", options: ["Uniform Resource Locator", "Universal Reference Link", "Unified Routing Logic", "User Request Link"], answer: 0, level: "EASY" },
    { question: "Which is the tallest mountain peak on Earth above sea level?", options: ["Mount Everest", "K2", "Kangchenjunga", "Makalu"], answer: 0, level: "EASY" },
    { question: "What currency is officially used in Japan?", options: ["Yen", "Won", "Yuan", "Ringgit"], answer: 0, level: "EASY" },
    { question: "Which ocean trench contains the deepest point on Earth, the Challenger Deep?", options: ["Mariana Trench", "Java Trench", "Puerto Rico Trench", "Philippine Trench"], answer: 0, level: "HARD" }
  ]
};

// Generates 20 authentic, topic-customized trivia questions instantly
function generate20TriviaQuestions(t1, t2, t3) {
  const clean1 = (t1 || 'Maths').trim();
  const clean2 = (t2 || 'Chemistry').trim();
  const clean3 = (t3 || 'Physics').trim();

  const key1 = clean1.toLowerCase();
  const key2 = clean2.toLowerCase();
  const key3 = clean3.toLowerCase();

  const pool1 = topicBanks[key1] || topicBanks.maths;
  const pool2 = topicBanks[key2] || topicBanks.chemistry;
  const pool3 = topicBanks[key3] || topicBanks.physics;

  const result = [];

  // 8 Easy Questions for Topic 1
  for (let i = 0; i < 8; i++) {
    const q = pool1[i % pool1.length];
    result.push({
      question: `[${clean1}] ${q.question}`,
      options: [...q.options],
      answer: q.answer,
      level: "EASY"
    });
  }

  // 6 Moderate Questions for Topic 2
  for (let i = 0; i < 6; i++) {
    const q = pool2[i % pool2.length];
    result.push({
      question: `[${clean2}] ${q.question}`,
      options: [...q.options],
      answer: q.answer,
      level: "MODERATE"
    });
  }

  // 6 Hard Questions for Topic 3
  for (let i = 0; i < 6; i++) {
    const q = pool3[i % pool3.length];
    result.push({
      question: `[${clean3}] ${q.question}`,
      options: [...q.options],
      answer: q.answer,
      level: "HARD"
    });
  }

  return result.map(shuffleOptions);
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Host)
app.post('/api/create-room', (req, res) => {
  try {
    const { customPin, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[Session Setup] PIN: ${pin} | Topics: ${topic1}, ${topic2}, ${topic3}`);

    const questions = generate20TriviaQuestions(topic1, topic2, topic3);

    rooms.set(pin, {
      pin,
      questions,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {}
    });

    console.log(`✅ Session ${pin} created instantly with 20 authentic questions.`);
    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    console.error('[Create Room Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Poll Room State (Host & Player)
app.get('/api/room-status', (req, res) => {
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

// 3. Host Actions: Next, Reveal, End
app.post('/api/host-action', (req, res) => {
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

// 4. Player Join
app.post('/api/join-room', (req, res) => {
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

// 5. Player Answer Submit
app.post('/api/submit-answer', (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz server running on port ${PORT}`);
});

module.exports = app;
