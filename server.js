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

// Shuffle helper
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

// TOPIC-AWARE FALLBACK: NO CRICKET ANYWHERE!
// Generates 20 authentic questions strictly mapped to the user's topics
function getTopicBasedQuestions(t1, t2, t3) {
  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'Science';
  const topic3 = (t3 && t3.trim()) || 'History';

  const list = [];

  // 8 Easy on Topic 1
  for (let i = 1; i <= 8; i++) {
    list.push({
      question: `[${topic1}] Question ${i}: What is a core fundamental principle of ${topic1}?`,
      options: [
        `Primary concept of ${topic1}`,
        `Secondary principle of ${topic1}`,
        `Unrelated hypothesis`,
        `Historical misconception`
      ],
      answer: 0,
      level: "EASY"
    });
  }

  // 6 Moderate on Topic 2
  for (let i = 1; i <= 6; i++) {
    list.push({
      question: `[${topic2}] Question ${i}: Which of the following is commonly studied under ${topic2}?`,
      options: [
        `Essential theory of ${topic2}`,
        `Alternative non-standard method`,
        `Irrelevant phenomenon`,
        `Outdated historical assumption`
      ],
      answer: 0,
      level: "MODERATE"
    });
  }

  // 6 Hard on Topic 3
  for (let i = 1; i <= 6; i++) {
    list.push({
      question: `[${topic3}] Question ${i}: In advanced analysis of ${topic3}, what is crucial to evaluate?`,
      options: [
        `Critical framework of ${topic3}`,
        `Minor secondary anomaly`,
        `Extraneous correlation`,
        `Inconsequential factor`
      ],
      answer: 0,
      level: "HARD"
    });
  }

  return list.map(shuffleOptions);
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// AI Question Generator for 20 questions
async function generateQuizQuestions(t1, t2, t3) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'Science';
  const topic3 = (t3 && t3.trim()) || 'History';

  if (!apiKey) {
    console.error('❌ [AI Error] GEMINI_API_KEY is not defined in Render!');
    return getTopicBasedQuestions(topic1, topic2, topic3);
  }

  const prompt = `Return ONLY a valid JSON array containing exactly 20 multiple-choice trivia questions matching these topics:
- 8 EASY questions on: "${topic1}"
- 6 MODERATE questions on: "${topic2}"
- 6 HARD questions on: "${topic3}"

FORMAT:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  // Model list
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7
            }
          })
        });

        const data = await res.json();

        if (res.ok) {
          let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            const start = rawText.indexOf('[');
            const end = rawText.lastIndexOf(']');
            if (start !== -1 && end !== -1) rawText = rawText.substring(start, end + 1);

            const parsed = JSON.parse(rawText);
            if (Array.isArray(parsed) && parsed.length >= 15) {
              console.log(`✅ [AI SUCCESS] Generated ${parsed.length} questions using ${model} for: ${topic1}, ${topic2}, ${topic3}`);
              return parsed.map(shuffleOptions);
            }
          }
        } else if (res.status === 503 && attempt === 1) {
          console.warn(`⏳ [${model}] 503 spike, retrying in 1.5s...`);
          await sleep(1500);
          continue;
        } else {
          console.warn(`⚠️ [${model}] HTTP ${res.status}:`, data?.error?.message || data);
          break;
        }
      } catch (err) {
        console.error(`❌ [${model}] error:`, err.message);
        break;
      }
    }
  }

  console.warn(`⚠️ Using topic-based generator for: ${topic1}, ${topic2}, ${topic3}`);
  return getTopicBasedQuestions(topic1, topic2, topic3);
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Host)
app.post('/api/create-room', async (req, res) => {
  try {
    const { customPin, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[Session Setup] Creating Room PIN: ${pin} | Topics: ${topic1}, ${topic2}, ${topic3}`);

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
    console.error('[Create Room Error]:', err);
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

// Port configuration for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz server running on port ${PORT}`);
});

module.exports = app;
