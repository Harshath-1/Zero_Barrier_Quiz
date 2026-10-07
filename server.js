require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static assets from public folder and root
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

// Generate 20 authentic questions via Groq or xAI Grok
async function generateQuizQuestions(t1, t2, t3) {
  const rawKey = (process.env.API_KEY || process.env.GROQ_API_KEY || process.env.GROK_API_KEY || '').trim();
  if (!rawKey) {
    throw new Error('API_KEY is missing from Render Environment Variables!');
  }

  // Auto-detect provider
  const isGroq = rawKey.startsWith('gsk_');
  const endpoint = isGroq
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.x.ai/v1/chat/completions';
  const modelName = isGroq ? 'llama-3.3-70b-versatile' : 'grok-2';

  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'Science';
  const topic3 = (t3 && t3.trim()) || 'World History';

  const prompt = `You are a trivia master. Create exactly 20 multiple-choice trivia questions based strictly on these topics:
- 8 EASY trivia questions on: "${topic1}"
- 6 MODERATE trivia questions on: "${topic2}"
- 6 HARD trivia questions on: "${topic3}"

Rules:
1. Every question must be a factual, realistic trivia question directly testing real knowledge about that topic.
2. Provide exactly 4 plausible options for each.
3. The "answer" field must be the 0-based index (0, 1, 2, or 3) of the correct option.
4. Output strictly a JSON array without markdown formatting, backticks, or preamble text.

Schema:
[
  {
    "question": "Trivia question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  console.log(`[AI Call] Generating 20 questions via ${isGroq ? 'Groq' : 'Grok'} (${modelName}) for: ${topic1}, ${topic2}, ${topic3}...`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${rawKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates trivia quizzes exclusively in raw JSON array format.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `API error HTTP ${response.status}`);
  }

  let text = data.choices?.[0]?.message?.content || '';
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1) {
    text = text.substring(start, end + 1);
  }

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('AI output could not be parsed into a question list.');
  }

  console.log(`✅ [AI SUCCESS] Generated ${parsed.length} questions for: ${topic1}, ${topic2}, ${topic3}!`);
  return parsed.map(shuffleOptions);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz server running on port ${PORT}`);
});

module.exports = app;
