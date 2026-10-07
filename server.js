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

// Helper to shuffle answer positions
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

// Reliable emergency fallback generator if Google AI is completely unresponsive
function createTopicQuestions(t1, t2, t3) {
  const qList = [];

  // 8 Easy questions for Topic 1
  for (let i = 1; i <= 8; i++) {
    qList.push({
      question: `In the study of ${t1}, which of the following is considered a core foundational element (Part ${i})?`,
      options: [
        `Primary standard principle of ${t1}`,
        `Secondary variable in ${t1}`,
        `Unrelated hypothesis`,
        `Outdated theoretical model`
      ],
      answer: 0,
      level: "EASY"
    });
  }

  // 6 Moderate questions for Topic 2
  for (let i = 1; i <= 6; i++) {
    qList.push({
      question: `When analyzing key components of ${t2}, which method is most commonly applied (Scenario ${i})?`,
      options: [
        `Systematic evaluation framework of ${t2}`,
        `Non-standard observational method`,
        `Randomized theoretical guess`,
        `Incompatible analysis criteria`
      ],
      answer: 0,
      level: "MODERATE"
    });
  }

  // 6 Hard questions for Topic 3
  for (let i = 1; i <= 6; i++) {
    qList.push({
      question: `Under advanced conditions in ${t3}, which factor plays the most critical determining role (Case ${i})?`,
      options: [
        `Core structural mechanism of ${t3}`,
        `Minor environmental fluctuation`,
        `Negligible secondary correlation`,
        `False positive assumption`
      ],
      answer: 0,
      level: "HARD"
    });
  }

  return qList.map(shuffleOptions);
}

// AI Question Generator with AbortController timeout
async function generateQuizQuestions(t1, t2, t3) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const topic1 = (t1 && t1.trim()) || 'Indian History';
  const topic2 = (t2 && t2.trim()) || 'General Science';
  const topic3 = (t3 && t3.trim()) || 'World Geography';

  if (!apiKey) {
    console.error('❌ [AI Error] GEMINI_API_KEY is missing from environment!');
    return createTopicQuestions(topic1, topic2, topic3);
  }

  const prompt = `You are a trivia master. Create exactly 20 distinct multiple-choice questions strictly on these topics:
- 8 EASY questions on: "${topic1}"
- 6 MODERATE questions on: "${topic2}"
- 6 HARD questions on: "${topic3}"

Output ONLY a valid raw JSON array in this exact schema without markdown backticks:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000); // 9-second hard limit

  try {
    console.log(`[AI Call] Requesting 20 questions for: ${topic1}, ${topic2}, ${topic3}...`);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7,
          maxOutputTokens: 8192
        }
      })
    });

    clearTimeout(timeoutId);
    const data = await res.json();

    if (res.ok) {
      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const start = rawText.indexOf('[');
        const end = rawText.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
          rawText = rawText.substring(start, end + 1);
        }

        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed) && parsed.length >= 10) {
          console.log(`✅ [AI SUCCESS] Generated ${parsed.length} questions from Gemini!`);
          return parsed.map(shuffleOptions);
        }
      }
    } else {
      console.warn(`⚠️ Gemini HTTP ${res.status}:`, data?.error?.message || data);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`⚠️ AI call aborted/failed (${err.message}). Using instant topic generator.`);
  }

  // Guaranteed fallback ensures host never hangs
  return createTopicQuestions(topic1, topic2, topic3);
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
