require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static assets from public folder and root
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.static(__dirname, { maxAge: '1h' }));

// Global in-memory storage for active sessions
const rooms = new Map();

// Helper to shuffle answers
function shuffleOptions(questionObj) {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOptions = indices.map(idx => questionObj.options[idx]);
  const newAnswer = indices.indexOf(questionObj.answer);
  return { ...questionObj, options: newOptions, answer: newAnswer };
}

// Emergency safety fallback bank
const realTriviaPool = [
  { question: "Which element on the periodic table has the chemical symbol 'Fe'?", options: ["Iron", "Lead", "Gold", "Fluorine"], answer: 0, level: "EASY" },
  { question: "In computing, what does the acronym 'URL' stand for?", options: ["Uniform Resource Locator", "Universal Reference Link", "Unified Routing Logic", "User Request Link"], answer: 0, level: "EASY" },
  { question: "What is the largest internal organ in the human body?", options: ["Liver", "Heart", "Lungs", "Brain"], answer: 0, level: "EASY" },
  { question: "Which planet in our solar system has the most prominent ring system?", options: ["Saturn", "Jupiter", "Neptune", "Uranus"], answer: 0, level: "EASY" },
  { question: "Who is widely credited with inventing the World Wide Web in 1989?", options: ["Tim Berners-Lee", "Alan Turing", "Vint Cerf", "Steve Jobs"], answer: 0, level: "EASY" },
  { question: "What is the currency of Japan?", options: ["Yen", "Won", "Yuan", "Ringgit"], answer: 0, level: "EASY" },
  { question: "Which gas do plants primarily absorb during the process of photosynthesis?", options: ["Carbon Dioxide", "Oxygen", "Nitrogen", "Hydrogen"], answer: 0, level: "EASY" },
  { question: "Which mountain is the tallest peak in the world above sea level?", options: ["Mount Everest", "K2", "Kangchenjunga", "Makalu"], answer: 0, level: "EASY" },
  { question: "Which company developed Android before Google acquired it?", options: ["Android Inc.", "Symbian", "Palm", "Motorola"], answer: 0, level: "MODERATE" },
  { question: "What is the speed of light in vacuum approximately?", options: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "1,000,000 km/s"], answer: 0, level: "MODERATE" },
  { question: "Which canal connects the Mediterranean Sea directly to the Red Sea?", options: ["Suez Canal", "Panama Canal", "Kiel Canal", "Erie Canal"], answer: 0, level: "MODERATE" },
  { question: "What is the primary constituent of natural gas?", options: ["Methane", "Ethane", "Propane", "Butane"], answer: 0, level: "MODERATE" },
  { question: "In chess, which piece can move only diagonally?", options: ["Bishop", "Rook", "Knight", "Queen"], answer: 0, level: "MODERATE" },
  { question: "What is the capital city of Australia?", options: ["Canberra", "Sydney", "Melbourne", "Brisbane"], answer: 0, level: "MODERATE" },
  { question: "Which particle in an atom carries a neutral electric charge?", options: ["Neutron", "Proton", "Electron", "Positron"], answer: 0, level: "HARD" },
  { question: "Who was the first woman to win a Nobel Prize?", options: ["Marie Curie", "Rosalind Franklin", "Ada Lovelace", "Jane Goodall"], answer: 0, level: "HARD" },
  { question: "What year did the Apollo 11 mission successfully land humans on the Moon?", options: ["1969", "1965", "1972", "1975"], answer: 0, level: "HARD" },
  { question: "In physics, what physical property does the SI unit 'Tesla' measure?", options: ["Magnetic Flux Density", "Electric Potential", "Inductance", "Capacitance"], answer: 0, level: "HARD" },
  { question: "Which ocean trench contains the deepest point on Earth?", options: ["Mariana Trench", "Java Trench", "Puerto Rico Trench", "Philippine Trench"], answer: 0, level: "HARD" },
  { question: "In computer science, what is the time complexity of binary search on a sorted array?", options: ["O(log n)", "O(n)", "O(n log n)", "O(1)"], answer: 0, level: "HARD" }
];

// Helper to extract JSON array
function extractJsonArray(rawText) {
  if (!rawText) return null;
  let clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start !== -1 && end !== -1) {
    clean = clean.substring(start, end + 1);
  }
  return JSON.parse(clean);
}

// Generate 20 distinct, topic-specific questions using gemini-3.8-flash
async function generateQuizQuestions(t1, t2, t3) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const topic1 = (t1 && t1.trim()) || 'Mathematics';
  const topic2 = (t2 && t2.trim()) || 'Chemistry';
  const topic3 = (t3 && t3.trim()) || 'Physics';

  if (!apiKey) {
    console.error('❌ [AI Error] GEMINI_API_KEY is missing from environment!');
    return realTriviaPool.map(shuffleOptions);
  }

  const prompt = `Create a realistic trivia quiz of exactly 20 questions based on these topics:
- 8 EASY trivia questions on: "${topic1}"
- 6 MODERATE trivia questions on: "${topic2}"
- 6 HARD trivia questions on: "${topic3}"

Guidelines:
1. Every question must be an authentic, interesting trivia fact or problem directly about that topic.
2. Provide 4 plausible options for each question.
3. The "answer" must be the index (0, 1, 2, or 3) of the correct choice.
4. Output strictly a JSON array without any markdown formatting or introductory text.

Format:
[
  {
    "question": "What is the value of Pi rounded to two decimal places?",
    "options": ["3.14", "3.16", "3.12", "3.18"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  // 1. PRIMARY: Official Google Interactions API as recommended in your Render logs
  try {
    console.log(`[AI Call] Requesting 20 questions via Interactions API (gemini-3.8-flash)...`);
    const interUrl = `https://generativelanguage.googleapis.com/v1beta/interactions`;
    const res = await fetch(interUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        model: 'models/gemini-3.8-flash',
        input: prompt,
        generation_config: {
          response_mime_type: 'application/json',
          temperature: 0.7
        }
      })
    });

    const data = await res.json();
    if (res.ok) {
      const text = data.output_text || data.candidates?.[0]?.content?.parts?.[0]?.text || data.text;
      const parsed = extractJsonArray(text);
      if (Array.isArray(parsed) && parsed.length >= 10) {
        console.log(`✅ [AI SUCCESS - Interactions API] Generated ${parsed.length} questions for: ${topic1}, ${topic2}, ${topic3}!`);
        return parsed.map(shuffleOptions);
      }
    } else {
      console.warn(`⚠️ Interactions API returned HTTP ${res.status}:`, data?.error?.message || data);
    }
  } catch (err) {
    console.warn(`⚠️ Interactions API failed:`, err.message);
  }

  // 2. SECONDARY: Standard generateContent with gemini-3.8-flash
  try {
    console.log(`[AI Call] Requesting 20 questions via generateContent (gemini-3.8-flash)...`);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7,
          maxOutputTokens: 8192
        }
      })
    });

    const data = await res.json();
    if (res.ok) {
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = extractJsonArray(text);
      if (Array.isArray(parsed) && parsed.length >= 10) {
        console.log(`✅ [AI SUCCESS - gemini-3.8-flash] Generated ${parsed.length} questions for: ${topic1}, ${topic2}, ${topic3}!`);
        return parsed.map(shuffleOptions);
      }
    } else {
      console.warn(`⚠️ gemini-3.8-flash returned HTTP ${res.status}:`, data?.error?.message || data);
    }
  } catch (err) {
    console.error(`⚠️ gemini-3.8-flash generateContent failed:`, err.message);
  }

  console.warn('⚠️ Serving real-world trivia bank.');
  return realTriviaPool.map(shuffleOptions);
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Host)
app.post('/api/create-room', async (req, res) => {
  try {
    const { customPin, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[Session Setup] PIN: ${pin} | Topics: ${topic1}, ${topic2}, ${topic3}`);

    const questions = await generateQuizQuestions(topic1, topic2, topic3);

    rooms.set(pin, {
      pin,
      questions,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {}
    });

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

// Port binding for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz server running on port ${PORT}`);
});

module.exports = app;
