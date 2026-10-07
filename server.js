require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Disable caching for all API routes so polling never serves stale sessions
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '0' }));
app.use(express.static(__dirname, { maxAge: '0' }));

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

// Built-in trivia dictionary for instant fallback if API credits expire
const topicTriviaPacks = {
  maths: [
    { question: "What is the only even prime number?", options: ["2", "4", "0", "1"], answer: 0, level: "EASY" },
    { question: "What is the value of Pi (π) rounded to two decimal places?", options: ["3.14", "3.16", "3.12", "3.18"], answer: 0, level: "EASY" },
    { question: "What is the sum of interior angles in any Euclidean triangle?", options: ["180°", "360°", "90°", "270°"], answer: 0, level: "EASY" },
    { question: "What is the square root of 144?", options: ["12", "14", "16", "11"], answer: 0, level: "EASY" },
    { question: "What is the longest side of a right-angled triangle called?", options: ["Hypotenuse", "Perpendicular", "Adjacent", "Radius"], answer: 0, level: "EASY" },
    { question: "What is 2 raised to the power of 6 (2⁶)?", options: ["64", "32", "128", "16"], answer: 0, level: "EASY" },
    { question: "Who is widely revered as the father of modern geometry?", options: ["Euclid", "Pythagoras", "Archimedes", "Descartes"], answer: 0, level: "EASY" },
    { question: "What is the mathematical term for an 8-sided polygon?", options: ["Octagon", "Hexagon", "Heptagon", "Decagon"], answer: 0, level: "EASY" }
  ],
  physics: [
    { question: "What is the approximate speed of light in a vacuum?", options: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "1,000,000 km/s"], answer: 0, level: "MODERATE" },
    { question: "What physical quantity does the SI unit 'Tesla' measure?", options: ["Magnetic Flux Density", "Electric Current", "Capacitance", "Resistance"], answer: 0, level: "MODERATE" },
    { question: "According to Newton's 2nd Law, Force equals mass multiplied by what?", options: ["Acceleration", "Velocity", "Distance", "Momentum"], answer: 0, level: "MODERATE" },
    { question: "What is absolute zero temperature in degrees Celsius?", options: ["-273.15°C", "-100°C", "0°C", "-459.67°C"], answer: 0, level: "MODERATE" },
    { question: "Which phenomenon causes a pencil to look bent in a glass of water?", options: ["Refraction", "Reflection", "Diffraction", "Polarization"], answer: 0, level: "MODERATE" },
    { question: "Which fundamental particle carries a negative electric charge?", options: ["Electron", "Proton", "Neutron", "Positron"], answer: 0, level: "MODERATE" }
  ],
  chemistry: [
    { question: "What is the chemical formula for ordinary table salt?", options: ["NaCl", "KCl", "CaCl2", "Na2CO3"], answer: 0, level: "HARD" },
    { question: "Which element has the chemical symbol 'Fe'?", options: ["Iron", "Lead", "Fluorine", "Francium"], answer: 0, level: "HARD" },
    { question: "What is the pH level of pure neutral water at 25°C?", options: ["7", "0", "14", "5"], answer: 0, level: "HARD" },
    { question: "What is the most abundant gas in Earth's atmosphere?", options: ["Nitrogen", "Oxygen", "Carbon Dioxide", "Argon"], answer: 0, level: "HARD" },
    { question: "What is the primary organic compound present in natural gas?", options: ["Methane", "Ethane", "Propane", "Butane"], answer: 0, level: "HARD" },
    { question: "Which scientist proposed the modern periodic table arranged by atomic number?", options: ["Henry Moseley", "Dmitri Mendeleev", "John Newlands", "Antoine Lavoisier"], answer: 0, level: "HARD" }
  ]
};

function generateFallbackTrivia(t1, t2, t3) {
  const name1 = (t1 || 'Maths').trim();
  const name2 = (t2 || 'Physics').trim();
  const name3 = (t3 || 'Chemistry').trim();

  const k1 = name1.toLowerCase();
  const k2 = name2.toLowerCase();
  const k3 = name3.toLowerCase();

  const p1 = topicTriviaPacks[k1] || topicTriviaPacks.maths;
  const p2 = topicTriviaPacks[k2] || topicTriviaPacks.physics;
  const p3 = topicTriviaPacks[k3] || topicTriviaPacks.chemistry;

  const out = [];
  for (let i = 0; i < 8; i++) {
    const q = p1[i % p1.length];
    out.push({ question: `[${name1}] ${q.question}`, options: [...q.options], answer: q.answer, level: "EASY" });
  }
  for (let i = 0; i < 6; i++) {
    const q = p2[i % p2.length];
    out.push({ question: `[${name2}] ${q.question}`, options: [...q.options], answer: q.answer, level: "MODERATE" });
  }
  for (let i = 0; i < 6; i++) {
    const q = p3[i % p3.length];
    out.push({ question: `[${name3}] ${q.question}`, options: [...q.options], answer: q.answer, level: "HARD" });
  }
  return out.map(shuffleOptions);
}

// Generate 20 authentic questions via Grok with proper model parameters
async function generateQuizQuestions(t1, t2, t3) {
  const apiKey = (process.env.API_KEY || process.env.GROK_API_KEY || '').trim();
  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'Science';
  const topic3 = (t3 && t3.trim()) || 'History';

  if (apiKey) {
    const modelCandidates = ['grok-4.1-fast', 'grok-4.3', 'grok-beta', 'grok-2'];
    const prompt = `You are a trivia master. Create exactly 20 distinct trivia questions: 8 EASY on "${topic1}", 6 MODERATE on "${topic2}", 6 HARD on "${topic3}". Every question must be a real factual trivia fact specifically about that topic. Output ONLY a raw JSON array of objects with keys: "question", "options" (array of 4 strings), "answer" (0-3 index), and "level". No markdown backticks.`;

    for (const model of modelCandidates) {
      try {
        console.log(`[AI Call] Requesting 20 questions via Grok (${model}) for: ${topic1}, ${topic2}, ${topic3}...`);
        const res = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7
          })
        });

        const data = await res.json();
        if (res.ok) {
          let text = data.choices?.[0]?.message?.content || '';
          text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
          const start = text.indexOf('[');
          const end = text.lastIndexOf(']');
          if (start !== -1 && end !== -1) text = text.substring(start, end + 1);

          const parsed = JSON.parse(text);
          if (Array.isArray(parsed) && parsed.length >= 10) {
            console.log(`✅ [Grok SUCCESS] Generated ${parsed.length} questions for: ${topic1}, ${topic2}, ${topic3}!`);
            return parsed.map(shuffleOptions);
          }
        } else {
          console.warn(`⚠️ Grok (${model}) HTTP ${res.status}:`, data?.error?.message || data);
        }
      } catch (err) {
        console.warn(`⚠️ Grok (${model}) exception:`, err.message);
      }
    }
  }

  return generateFallbackTrivia(topic1, topic2, topic3);
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Host) - Always forces a clean reset
app.post('/api/create-room', async (req, res) => {
  try {
    const { customPin, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[Session Setup] Resetting PIN: ${pin} | New Topics: ${topic1}, ${topic2}, ${topic3}`);

    // Force purge of any previous room data under this PIN
    if (rooms.has(pin)) {
      rooms.delete(pin);
    }

    const questions = await generateQuizQuestions(topic1, topic2, topic3);

    // Save newly generated session
    rooms.set(pin, {
      pin,
      topics: [topic1, topic2, topic3],
      questions,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {},
      createdAt: Date.now()
    });

    console.log(`✅ Fresh room registered under PIN ${pin}.`);
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
