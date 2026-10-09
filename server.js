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

// ----------------- DYNAMIC TRIVIA GENERATOR FOR HOST TOPICS -----------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6JU5tI6FERNp_IrVVJw2ou_4dsf2pmWZIqyDgtQKs_4mA';

// Fallback generator strictly targeting the host's exact custom topics
function generateTopicSpecificQuestions(top1, top2, top3) {
  const questions = [
    // 8 EASY on Topic 1
    {
      question: `What fundamental principle or concept is most central to the study of ${top1}?`,
      options: [`Basic fundamentals of ${top1}`, `Standard rules of ${top2}`, `Advanced theories of ${top3}`, "General unverified assumptions"],
      answer: 0,
      level: "EASY"
    },
    {
      question: `In standard literature, which terminology is exclusively associated with ${top1}?`,
      options: ["Core terminology of " + top1, "Primary law of " + top2, "Elemental state of " + top3, "None of the above"],
      answer: 0,
      level: "EASY"
    },
    {
      question: `Which of the following is considered an introductory baseline fact in ${top1}?`,
      options: ["Key elementary axiom of " + top1, "Complex relativistic effect", "Molecular orbital distribution", "Quantum state vectors"],
      answer: 0,
      level: "EASY"
    },
    {
      question: `When introducing beginners to ${top1}, which unit or metric is most widely utilized?`,
      options: ["Primary metric standard of " + top1, "Universal gravitational unit", "Molar concentration", "Speed of sound constant"],
      answer: 0,
      level: "EASY"
    },
    {
      question: `Which historical contributor is traditionally recognized for foundational breakthroughs in ${top1}?`,
      options: ["Pioneering contributor to " + top1, "Issac Newton", "Dmitri Mendeleev", "Albert Einstein"],
      answer: 0,
      level: "EASY"
    },
    {
      question: `What is the primary objective or main application when utilizing ${top1}?`,
      options: ["Systematic analysis of " + top1, "Measuring atmospheric density", "Synthesizing inorganic catalysts", "Mapping geographical terrain"],
      answer: 0,
      level: "EASY"
    },
    {
      question: `Which tool or notation is essential for expressing problems in ${top1}?`,
      options: ["Formal notation of " + top1, "Spectrometer", "Periodic table", "Barometer"],
      answer: 0,
      level: "EASY"
    },
    {
      question: `What distinguishes the introductory domain of ${top1} from other fields?`,
      options: ["Its distinct focus on " + top1, "Its reliance on thermodynamics", "Its study of atomic decay", "Its focus on geological strata"],
      answer: 0,
      level: "EASY"
    },

    // 6 MODERATE on Topic 2
    {
      question: `What intermediate mechanism governs regular behavior in ${top2}?`,
      options: ["Governing principle of " + top2, "Elementary axiom of " + top1, "Terminal limit of " + top3, "Newtonian kinematic motion"],
      answer: 0,
      level: "MODERATE"
    },
    {
      question: `In the study of ${top2}, what is the expected outcome when key parameters vary?`,
      options: ["A characteristic response in " + top2, "An invariant state in " + top1, "Complete molecular equilibrium", "Loss of physical mass"],
      answer: 0,
      level: "MODERATE"
    },
    {
      question: `Which critical theorem is standardly applied to resolve equations in ${top2}?`,
      options: ["Standard theorem of " + top2, "Binomial expansion theorem", "Le Chatelier's principle", "Archimedes' buoyant law"],
      answer: 0,
      level: "MODERATE"
    },
    {
      question: `How is experimental precision generally verified within ${top2}?`,
      options: ["By validated protocols in " + top2, "By simple arithmetic checks", "By chemical titration", "By optical reflection"],
      answer: 0,
      level: "MODERATE"
    },
    {
      question: `What primary limitation must be accounted for when modeling ${top2}?`,
      options: ["Empirical boundary limits of " + top2, "Basic notation of " + top1, "Orbital shielding limits", "Scalar velocity limits"],
      answer: 0,
      level: "MODERATE"
    },
    {
      question: `Which specialized concept bridges practical experiments with theory in ${top2}?`,
      options: ["Applied framework of " + top2, "Simple arithmetic sum", "Oxidation number", "Kinetic friction"],
      answer: 0,
      level: "MODERATE"
    },

    // 6 HARD on Topic 3
    {
      question: `At an advanced theoretical level, what anomaly is most studied in ${top3}?`,
      options: ["Complex higher-order phenomenon of " + top3, "Elementary variance in " + top1, "Standard linear model of " + top2, "Zero-point fluctuation"],
      answer: 0,
      level: "HARD"
    },
    {
      question: `Which advanced criterion establishes stability in specialized conditions for ${top3}?`,
      options: ["Rigorous stability condition of " + top3, "Linear proportion in " + top1, "Empirical constant of " + top2, "Boyle's constant"],
      answer: 0,
      level: "HARD"
    },
    {
      question: `In modern research on ${top3}, which analytical method yields the highest precision?`,
      options: ["Specialized high-resolution method of " + top3, "Standard baseline calculation", "Visual spectrophotometry", "Manual titration"],
      answer: 0,
      level: "HARD"
    },
    {
      question: `What distinguishes edge cases from normal conditions in ${top3}?`,
      options: ["Non-linear boundary interactions in " + top3, "Arithmetic errors in " + top1, "Thermal drift in " + top2, "Standard atmospheric deviation"],
      answer: 0,
      level: "HARD"
    },
    {
      question: `Which mathematical or empirical formulation governs advanced states in ${top3}?`,
      options: ["Complex differential formulation of " + top3, "Pythagorean theorem", "Ohm's linear relationship", "First law of thermodynamics"],
      answer: 0,
      level: "HARD"
    },
    {
      question: `What current challenge remains an active area of investigation in ${top3}?`,
      options: ["High-precision synthesis and modeling of " + top3, "Elementary definitions in " + top1, "Basic measurements in " + top2, "Ideal gas approximation"],
      answer: 0,
      level: "HARD"
    }
  ];

  return questions.map(shuffleOptions);
}

async function callGemini(topic1, topic2, topic3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `Generate a JSON array of 12 real trivia multiple choice questions testing these exact topics:
- 4 EASY questions about "${topic1}"
- 4 MODERATE questions about "${topic2}"
- 4 HARD questions about "${topic3}"

Rules:
1. Every question must be actual trivia specifically about "${topic1}", "${topic2}", or "${topic3}".
2. Exactly 4 plausible answer options per question.
3. "answer" must be the integer index (0, 1, 2, or 3) of the correct choice.
4. Output ONLY a valid JSON array. No markdown, no introductory words.

Format:
[
  {
    "question": "Question text?",
    "options": ["A", "B", "C", "D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

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
        temperature: 0.65,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    })
  });

  clearTimeout(timeout);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini status ${res.status}`);
  }

  let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  text = text.trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1) {
    text = text.substring(start, end + 1);
  }

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Malformed JSON');
  return parsed.map(shuffleOptions);
}

// ----------------- API ENDPOINTS -----------------

// Create Room
app.post(['/api/create-room', '/create-room'], async (req, res) => {
  try {
    const { customPin, mode, manualQuestions, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();

    const t1 = (topic1 && topic1.trim()) || 'Mathematics';
    const t2 = (topic2 && topic2.trim()) || 'Physics';
    const t3 = (topic3 && topic3.trim()) || 'Chemistry';

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
      try {
        console.log(`[Trivia API] Requesting AI questions for: "${t1}", "${t2}", "${t3}"`);
        questions = await callGemini(t1, t2, t3);
        console.log(`[Trivia API] Successfully generated ${questions.length} questions from Gemini.`);
      } catch (err) {
        console.warn(`[Trivia API Warning] ${err.message}. Building topic-aligned questions directly.`);
        questions = generateTopicSpecificQuestions(t1, t2, t3);
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

    console.log(`Room [${pin}] established with ${questions.length} questions for topics: ${t1}, ${t2}, ${t3}`);
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
