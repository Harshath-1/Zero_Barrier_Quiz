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

// Fallback questions if external AI is unreachable
const fallbackBank = {
  cricket: [
    { question: "Who holds the record for the highest individual score in Test cricket (400*)?", options: ["Brian Lara", "Sachin Tendulkar", "Don Bradman", "Matthew Hayden"], answer: 0, level: "EASY" },
    { question: "Which bowler has taken the most wickets in international Test cricket history?", options: ["Muttiah Muralitharan", "Shane Warne", "James Anderson", "Anil Kumble"], answer: 0, level: "EASY" },
    { question: "Who was the first batsman to score a double century in Men's ODI cricket?", options: ["Sachin Tendulkar", "Virender Sehwag", "Rohit Sharma", "Chris Gayle"], answer: 0, level: "EASY" },
    { question: "In which year did India win its first ICC Men's Cricket World Cup?", options: ["1983", "1975", "1987", "2011"], answer: 0, level: "EASY" }
  ],
  space: [
    { question: "What is the closest planet to the Sun in our Solar System?", options: ["Mercury", "Venus", "Mars", "Earth"], answer: 0, level: "MODERATE" },
    { question: "Which planet is famously known as the 'Red Planet'?", options: ["Mars", "Jupiter", "Saturn", "Mercury"], answer: 0, level: "MODERATE" },
    { question: "What is the largest moon of Saturn, known for its dense atmosphere?", options: ["Titan", "Europa", "Ganymede", "Callisto"], answer: 0, level: "MODERATE" }
  ],
  animals: [
    { question: "Which marine animal is known to have three hearts and blue blood?", options: ["Octopus", "Blue Whale", "Great White Shark", "Giant Squid"], answer: 0, level: "HARD" },
    { question: "Which bird is the only known avian species capable of flying backwards?", options: ["Hummingbird", "Kingfisher", "Swift", "Swallow"], answer: 0, level: "HARD" },
    { question: "What is the largest living species of mammal currently on Earth?", options: ["Blue Whale", "African Bush Elephant", "Fin Whale", "Colossal Squid"], answer: 0, level: "HARD" }
  ]
};

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

function getFallbackQuestions() {
  return [
    ...fallbackBank.cricket.map(shuffleOptions),
    ...fallbackBank.space.map(shuffleOptions),
    ...fallbackBank.animals.map(shuffleOptions)
  ];
}

// AI Question Generator using recommended Interactions API
async function generateQuizQuestions(t1, t2, t3) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    console.error('❌ [AI Error] GEMINI_API_KEY is missing from Render Environment Variables!');
    return getFallbackQuestions();
  }

  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'Technology';
  const topic3 = (t3 && t3.trim()) || 'World History';

  const prompt = `Return ONLY a valid JSON array of 10 trivia questions strictly matching these topics:
- 4 EASY questions on: "${topic1}"
- 3 MODERATE questions on: "${topic2}"
- 3 HARD questions on: "${topic3}"

FORMAT:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  // 1. Primary: Google AI Studio recommended Interactions endpoint
  try {
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
      let rawText = data.output_text || data.candidates?.[0]?.content?.parts?.[0]?.text || data.text;
      if (rawText) {
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const start = rawText.indexOf('[');
        const end = rawText.lastIndexOf(']');
        if (start !== -1 && end !== -1) rawText = rawText.substring(start, end + 1);
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`✅ [AI SUCCESS - Interactions API] Generated 10 questions for: ${topic1}, ${topic2}, ${topic3}`);
          return parsed.map(shuffleOptions);
        }
      }
    } else {
      console.warn('⚠️ Interactions API response:', res.status, data?.error?.message || data);
    }
  } catch (err) {
    console.error('❌ Interactions API error:', err.message);
  }

  // 2. Secondary fallback attempt via generateContent
  const models = ['gemini-3.8-flash', 'gemini-2.0-flash'];
  for (const m of models) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7 }
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
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`✅ [AI SUCCESS - ${m}] Generated 10 questions for: ${topic1}, ${topic2}, ${topic3}`);
            return parsed.map(shuffleOptions);
          }
        }
      }
    } catch (e) {
      console.error(`❌ [${m}] exception:`, e.message);
    }
  }

  console.warn('⚠️ Fallback questions served.');
  return getFallbackQuestions();
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

// Start listening on Render's assigned port
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz server running on port ${PORT}`);
});

module.exports = app;
