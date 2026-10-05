require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Optimized Socket.IO configuration
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: 1e6
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.static(__dirname, { maxAge: '1h' }));

// Player route fallback
app.get(['/player', '/player.html', '/plyer', '/plyer.html'], (req, res) => {
  const possiblePaths = [
    path.join(__dirname, 'public', 'player.html'),
    path.join(__dirname, 'player.html'),
    path.join(__dirname, 'public', 'plyer.html'),
    path.join(__dirname, 'plyer.html')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).send('Player HTML not found');
});

// In-memory room store
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

// Shuffling helper utilities
function shuffleArray(arr) {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

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

// Generate questions strictly matching host-specified topics with fallback to active lite models
async function generateQuizQuestions(t1, t2, t3) {
  const topic1 = (t1 && t1.trim()) || 'General Knowledge';
  const topic2 = (t2 && t2.trim()) || 'Technology';
  const topic3 = (t3 && t3.trim()) || 'World History';

  console.log(`\n========================================`);
  console.log(`[AI Generation] Requesting questions for:`);
  console.log(`Tier 1 (Easy 7 Qs):     ${topic1}`);
  console.log(`Tier 2 (Moderate 7 Qs): ${topic2}`);
  console.log(`Tier 3 (Hard 6 Qs):     ${topic3}`);
  console.log(`========================================\n`);

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {
    console.error('❌ [AI Error] GEMINI_API_KEY is missing from .env!');
    return getFallbackQuestions();
  }

  const prompt = `You are a trivia quiz generator. Generate exactly 20 trivia questions strictly based on the following topics:

TOPICS:
- Exactly 7 EASY questions strictly on: "${topic1}"
- Exactly 7 MODERATE questions strictly on: "${topic2}"
- Exactly 6 HARD questions strictly on: "${topic3}"

FORMAT:
Return ONLY a valid JSON array of 20 objects. No markdown backticks, no explanatory text:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "level": "EASY"
  }
]`;

  // Targeting gemini-3.5-flash-lite as requested by Google API
  const modelCandidates = [
    { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', name: 'gemini-3.5-flash-lite (v1beta)' },
    { url: 'https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash-lite:generateContent', name: 'gemini-3.5-flash-lite (v1)' },
    { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', name: 'gemini-3.8-flash (v1beta)' }
  ];

  for (const candidate of modelCandidates) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[AI] Querying ${candidate.name} (attempt ${attempt})...`);

        const response = await fetch(candidate.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              responseMimeType: 'application/json'
            }
          })
        });

        const data = await response.json();

        if (!response.ok) {
          console.warn(`⚠️ [AI Status ${response.status}] on ${candidate.name}:`, data?.error?.message || '');
          if (response.status === 503) {
            await new Promise((res) => setTimeout(res, 1200));
            continue;
          }
          break;
        }

        let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) continue;

        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length >= 10) {
          console.log(`\n✅ [AI SUCCESS] Generated ${parsed.length} dynamic questions on your topics via ${candidate.name}!\n`);
          return parsed.map(shuffleOptions);
        }
      } catch (err) {
        console.error(`❌ [AI Exception on ${candidate.name}]:`, err.message);
        break;
      }
    }
  }

  console.warn('\n⚠️ [AI Alert] All model candidates busy. Using offline fallback bank.\n');
  return getFallbackQuestions();
}

function getFallbackQuestions() {
  console.log('[AI Fallback] Using offline fallback bank.');
  return [
    ...shuffleArray(fallbackBank.cricket || []).map(shuffleOptions),
    ...shuffleArray(fallbackBank.space || []).map(shuffleOptions),
    ...shuffleArray(fallbackBank.animals || []).map(shuffleOptions)
  ];
}

// Socket handlers
io.on('connection', (socket) => {
  // HOST: Create room
  socket.on('HOST_CREATE_ROOM', async (data) => {
    const rawPin = data.customPin || Math.floor(100000 + Math.random() * 900000).toString();
    const pin = String(rawPin).trim();
    console.log(`Generating Session PIN ${pin}`);

    const questions = await generateQuizQuestions(data.topic1, data.topic2, data.topic3);

    rooms.set(pin, {
      hostSocketId: socket.id,
      questions,
      currentIndex: 0,
      players: new Map(),
      onlineCount: 0,
      answersThisRound: new Set()
    });

    socket.join(pin);
    socket.data = { pin, isHost: true };
    socket.emit('ROOM_CREATED', { pin });
  });

  // PLAYER: Join or Re-join room
  const handlePlayerJoin = ({ pin, name }) => {
    const cleanPin = String(pin || '').trim();
    const room = rooms.get(cleanPin);

    if (!room) {
      return socket.emit('JOIN_ERROR', 'Room not found. Check the PIN.');
    }

    const cleanName = (name && String(name).trim()) || 'Player';
    const playerKey = cleanName.toLowerCase();

    let player = room.players.get(playerKey);
    if (!player) {
      player = { name: cleanName, score: 0, correctCount: 0, socketId: socket.id, isOnline: true };
      room.players.set(playerKey, player);
      room.onlineCount++;
    } else {
      if (!player.isOnline) {
        player.isOnline = true;
        room.onlineCount++;
      }
      player.socketId = socket.id;
    }

    socket.join(cleanPin);
    socket.data = { pin: cleanPin, playerKey, isHost: false };

    socket.emit('JOIN_SUCCESS', { pin: cleanPin, name: cleanName, score: player.score });

    const namesList = Array.from(room.players.values()).filter(p => p.isOnline).map(p => p.name);
    io.to(room.hostSocketId).emit('UPDATE_PLAYER_COUNT', {
      count: room.onlineCount,
      players: namesList
    });

    if (room.currentIndex > 0 && room.currentIndex <= room.questions.length) {
      const q = room.questions[room.currentIndex - 1];
      socket.emit('PLAYER_SHOW_QUESTION', {
        index: room.currentIndex,
        total: room.questions.length,
        level: q.level,
        question: q.question,
        options: q.options
      });
    }
  };

  socket.on('PLAYER_JOIN', handlePlayerJoin);
  socket.on('PLAYER_JOIN_ROOM', handlePlayerJoin);

  // HOST: Next Question
  socket.on('HOST_NEXT_QUESTION', (rawPin) => {
    const pin = String(rawPin).trim();
    const room = rooms.get(pin);
    if (!room) return;

    if (room.currentIndex >= room.questions.length) {
      const leaderboard = Array.from(room.players.values())
        .sort((a, b) => b.score - a.score)
        .map((p, idx) => ({ ...p, rank: idx + 1 }));

      io.to(pin).emit('GAME_OVER', {
        leaderboard,
        topPerformer: leaderboard[0] || null,
        totalQuestions: room.questions.length
      });
      return;
    }

    room.answersThisRound.clear();
    const q = room.questions[room.currentIndex];
    room.currentIndex++;

    const payload = {
      index: room.currentIndex,
      total: room.questions.length,
      level: q.level,
      question: q.question,
      options: q.options
    };

    io.to(room.hostSocketId).emit('HOST_SHOW_QUESTION', payload);
    io.to(pin).emit('PLAYER_SHOW_QUESTION', payload);
  });

  // HOST: Reveal Answer
  socket.on('HOST_REVEAL_ANSWER', (rawPin) => {
    const pin = String(rawPin).trim();
    const room = rooms.get(pin);
    if (!room || room.currentIndex === 0) return;

    const currentQ = room.questions[room.currentIndex - 1];
    io.to(pin).emit('HOST_ANSWER_KEY', currentQ.answer);
  });

  // PLAYER: Submit Answer
  socket.on('PLAYER_SUBMIT_ANSWER', ({ pin, answerIndex }) => {
    const cleanPin = String(pin || '').trim();
    const room = rooms.get(cleanPin);
    if (!room || room.currentIndex === 0) return;

    const playerKey = socket.data && socket.data.playerKey;
    if (!playerKey || room.answersThisRound.has(playerKey)) return;
    room.answersThisRound.add(playerKey);

    const currentQ = room.questions[room.currentIndex - 1];
    const player = room.players.get(playerKey);

    if (player && answerIndex === currentQ.answer) {
      player.score += 100;
      player.correctCount++;
    }

    io.to(room.hostSocketId).emit('LIVE_ANSWER_COUNT', {
      received: room.answersThisRound.size,
      total: room.onlineCount
    });
  });

  // HOST: End Session
  socket.on('HOST_END_SESSION', (rawPin) => {
    const pin = String(rawPin).trim();
    const room = rooms.get(pin);
    if (!room) return;

    const leaderboard = Array.from(room.players.values())
      .sort((a, b) => b.score - a.score)
      .map((p, idx) => ({ ...p, rank: idx + 1 }));

    io.to(pin).emit('GAME_OVER', {
      leaderboard,
      topPerformer: leaderboard[0] || null,
      totalQuestions: room.currentIndex
    });
    rooms.delete(pin);
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    if (!socket.data || !socket.data.pin) return;

    const { pin, playerKey, isHost } = socket.data;
    const room = rooms.get(pin);
    if (!room) return;

    if (isHost) return;

    if (playerKey && room.players.has(playerKey)) {
      const player = room.players.get(playerKey);
      if (player.isOnline) {
        player.isOnline = false;
        room.onlineCount = Math.max(0, room.onlineCount - 1);

        const namesList = Array.from(room.players.values()).filter(p => p.isOnline).map(p => p.name);
        io.to(room.hostSocketId).emit('UPDATE_PLAYER_COUNT', {
          count: room.onlineCount,
          players: namesList
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Quiz server listening on port ${PORT}`);
});

module.exports = app;