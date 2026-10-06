require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Serve static public assets
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.static(__dirname, { maxAge: '1h' }));

// Global in-memory room storage
const rooms = new Map();

// Authentic trivia fallback bank
const fallbackBank = {
  cricket: [
    { question: "Who holds the record for the highest individual score in Test cricket (400*)?", options: ["Brian Lara", "Sachin Tendulkar", "Don Bradman", "Matthew Hayden"], answer: 0, level: "EASY" },
    { question: "Which bowler has taken the most wickets in international Test cricket history?", options: ["Muttiah Muralitharan", "Shane Warne", "James Anderson", "Anil Kumble"], answer: 0, level: "EASY" },
    { question: "Who was the first batsman to score a double century in Men's ODI cricket?", options: ["Sachin Tendulkar", "Virender Sehwag", "Rohit Sharma", "Chris Gayle"], answer: 0, level: "EASY" },
    { question: "In which year did India win its first ICC Men's Cricket World Cup?", options: ["1983", "1975", "1987", "2011"], answer: 0, level: "EASY" },
    { question: "Which country won the inaugural ICC Men's T20 World Cup in 2007?", options: ["India", "Pakistan", "Australia", "West Indies"], answer: 0, level: "EASY" },
    { question: "How many deliveries make up one standard legal over in cricket?", options: ["6", "8", "5", "10"], answer: 0, level: "EASY" },
    { question: "What is the standard distance between the two sets of wickets on a pitch?", options: ["22 yards", "20 yards", "24 yards", "18 yards"], answer: 0, level: "EASY" }
  ],
  space: [
    { question: "What is the closest planet to the Sun in our Solar System?", options: ["Mercury", "Venus", "Mars", "Earth"], answer: 0, level: "MODERATE" },
    { question: "Which planet is famously known as the 'Red Planet'?", options: ["Mars", "Jupiter", "Saturn", "Mercury"], answer: 0, level: "MODERATE" },
    { question: "What is the largest moon of Saturn, known for its dense atmosphere?", options: ["Titan", "Europa", "Ganymede", "Callisto"], answer: 0, level: "MODERATE" },
    { question: "Which galaxy is the closest large spiral galaxy to the Milky Way?", options: ["Andromeda", "Triangulum", "Whirlpool", "Sombrero"], answer: 0, level: "MODERATE" },
    { question: "What is the visible surface layer of the Sun called?", options: ["Photosphere", "Corona", "Chromosphere", "Stratosphere"], answer: 0, level: "MODERATE" },
    { question: "In which year did the Apollo 11 mission land the first humans on the Moon?", options: ["1969", "1965", "1972", "1959"], answer: 0, level: "MODERATE" },
    { question: "What boundary around a black hole marks the point of no return for light?", options: ["Event Horizon", "Singularity", "Photon Sphere", "Accretion Disk"], answer: 0, level: "MODERATE" }
  ],
  animals: [
    { question: "Which marine animal is known to have three hearts and blue blood?", options: ["Octopus", "Blue Whale", "Great White Shark", "Giant Squid"], answer: 0, level: "HARD" },
    { question: "Which bird is the only known avian species capable of flying backwards?", options: ["Hummingbird", "Kingfisher", "Swift", "Swallow"], answer: 0, level: "HARD" },
    { question: "What is the largest living species of mammal currently on Earth?", options: ["Blue Whale", "African Bush Elephant", "Fin Whale", "Colossal Squid"], answer: 0, level: "HARD" },
    { question: "Which animal produces the thickest and densest fur of any living mammal?", options: ["Sea Otter", "Polar Bear", "Chinchilla", "Arctic Fox"], answer: 0, level: "HARD" },
    { question: "What is the collective noun used to describe a group of flamingos?", options: ["Flamboyance", "Colony", "Pride", "Murder"], answer: 0, level: "HARD" },
    { question: "Which organ do snakes primarily use to detect airborne scent molecules?", options: ["Jacobson's Organ", "Pit Organ", "Tympanum", "Olfactory Bulb"], answer: 0, level: "HARD" }
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

async function generateQuizQuestions(t1, t2, t3) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return getFallbackQuestions();

  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'Technology';
  const topic3 = (t3 && t3.trim()) || 'World History';

  const prompt = `Return strictly a JSON array of 20 trivia questions: 7 EASY on "${topic1}", 7 MODERATE on "${topic2}", 6 HARD on "${topic3}".
Format:
[
  {
    "question": "Question text?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
      })
    });

    if (response.ok) {
      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length >= 10) {
          return parsed.map(shuffleOptions);
        }
      }
    }
  } catch (err) {
    console.warn('[AI Warning] Falling back to default bank:', err.message);
  }
  return getFallbackQuestions();
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Host)
app.post('/api/create-room', async (req, res) => {
  try {
    const { customPin, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();
    const questions = await generateQuizQuestions(topic1, topic2, topic3);

    rooms.set(pin, {
      pin,
      questions,
      currentIndex: 0,
      state: 'LOBBY', // LOBBY, QUESTION, REVEAL, FINISHED
      revealedAnswer: null,
      players: {},
      answersThisRound: {}
    });

    return res.status(200).json({ success: true, pin, count: questions.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Poll Room State (Host & Player)
app.get('/api/room-status', (req, res) => {
  const pin = String(req.query.pin || '').trim();
  const room = rooms.get(pin);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const playerNames = Object.values(room.players).map(p => p.name);
  const currentQ = (room.currentIndex > 0 && room.currentIndex <= room.questions.length) 
    ? room.questions[room.currentIndex - 1] 
    : null;

  return res.status(200).json({
    pin: room.pin,
    state: room.state,
    currentIndex: room.currentIndex,
    totalQuestions: room.questions.length,
    playerCount: playerNames.length,
    players: playerNames,
    responsesCount: Object.keys(room.answersThisRound).length,
    question: currentQ ? {
      index: room.currentIndex,
      total: room.questions.length,
      level: currentQ.level,
      question: currentQ.question,
      options: currentQ.options
    } : null,
    revealedAnswer: room.revealedAnswer,
    leaderboard: Object.values(room.players).sort((a, b) => b.score - a.score)
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

// 5. Player Answer
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

module.exports = app;
