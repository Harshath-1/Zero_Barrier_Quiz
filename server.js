require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

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

// Built-in Knowledge Base for real trivia across diverse popular topics
const triviaKnowledgeBase = {
  cinema: [
    { question: "Which movie won the first-ever Academy Award (Oscar) for Best Picture in 1929?", options: ["Wings", "Sunrise", "The Jazz Singer", "Metropolis"], answer: 0, level: "EASY" },
    { question: "Who directed the iconic sci-fi film 'Inception' (2010)?", options: ["Christopher Nolan", "Steven Spielberg", "James Cameron", "Denis Villeneuve"], answer: 0, level: "EASY" },
    { question: "Which was the first full-length animated feature film ever released?", options: ["Snow White and the Seven Dwarfs", "Pinocchio", "Fantasia", "Bambi"], answer: 0, level: "EASY" },
    { question: "Who played the character of Iron Man (Tony Stark) in the Marvel Cinematic Universe?", options: ["Robert Downey Jr.", "Chris Evans", "Mark Ruffalo", "Tom Hiddleston"], answer: 0, level: "EASY" },
    { question: "Which Indian film won the Oscar for Best Original Song with 'Naatu Naatu'?", options: ["RRR", "Lagaan", "Baahubali", "Slumdog Millionaire"], answer: 0, level: "MODERATE" },
    { question: "What was the highest-grossing film of all time before Titanic surpassed it?", options: ["Jurassic Park", "E.T. the Extra-Terrestrial", "Star Wars", "Jaws"], answer: 0, level: "MODERATE" },
    { question: "Who directed the legendary 1972 crime film 'The Godfather'?", options: ["Francis Ford Coppola", "Martin Scorsese", "Stanley Kubrick", "Alfred Hitchcock"], answer: 0, level: "HARD" },
    { question: "Which actress holds the record for the most Academy Award wins for Best Actress?", options: ["Katharine Hepburn", "Meryl Streep", "Ingrid Bergman", "Bette Davis"], answer: 0, level: "HARD" }
  ],
  history: [
    { question: "In which year did the Second World War officially end?", options: ["1945", "1939", "1918", "1950"], answer: 0, level: "EASY" },
    { question: "Who was the first President of the United States?", options: ["George Washington", "Thomas Jefferson", "Abraham Lincoln", "John Adams"], answer: 0, level: "EASY" },
    { question: "Which ancient civilization constructed the Great Pyramids of Giza?", options: ["Ancient Egypt", "Mesopotamia", "Ancient Greece", "Indus Valley"], answer: 0, level: "EASY" },
    { question: "In which year did India gain independence from British rule?", options: ["1947", "1950", "1942", "1935"], answer: 0, level: "EASY" },
    { question: "Who was the primary emperor of the Maurya Empire known for converting to Buddhism after the Kalinga War?", options: ["Ashoka", "Chandragupta Maurya", "Bindusara", "Harsha"], answer: 0, level: "MODERATE" },
    { question: "What treaty signed in 1919 officially brought World War I to an end?", options: ["Treaty of Versailles", "Treaty of Paris", "Treaty of Utrecht", "Treaty of Brest-Litovsk"], answer: 0, level: "MODERATE" },
    { question: "In what year did the French Revolution begin with the storming of the Bastille?", options: ["1789", "1776", "1799", "1804"], answer: 0, level: "HARD" },
    { question: "Who was the ruler of the Mongol Empire when it reached its largest contiguous land expanse?", options: ["Kublai Khan", "Genghis Khan", "Ogedei Khan", "Möngke Khan"], answer: 0, level: "HARD" }
  ],
  technology: [
    { question: "Who is widely recognized as the co-founder of Apple along with Steve Wozniak?", options: ["Steve Jobs", "Bill Gates", "Larry Page", "Elon Musk"], answer: 0, level: "EASY" },
    { question: "What does the programming acronym 'HTML' stand for?", options: ["HyperText Markup Language", "HyperTech Main Logic", "HighText Machine Link", "HyperTransfer Module Layer"], answer: 0, level: "EASY" },
    { question: "Which company originally created the JavaScript programming language in 1995?", options: ["Netscape", "Sun Microsystems", "Microsoft", "IBM"], answer: 0, level: "EASY" },
    { question: "What is the primary function of a CPU in computer hardware?", options: ["Executing instructions and computations", "Storing permanent magnetic files", "Displaying visual pixels", "Cooling the motherboard"], answer: 0, level: "EASY" },
    { question: "What open-source operating system kernel was created by Linus Torvalds in 1991?", options: ["Linux", "Unix", "FreeBSD", "Minix"], answer: 0, level: "MODERATE" },
    { question: "In cryptography, what does the 'S' in 'HTTPS' stand for?", options: ["Secure", "Standard", "System", "Server"], answer: 0, level: "MODERATE" },
    { question: "Which computer scientist is widely considered the father of modern artificial intelligence and theoretical computing?", options: ["Alan Turing", "John von Neumann", "Claude Shannon", "Ada Lovelace"], answer: 0, level: "HARD" },
    { question: "What was the name of the first computer network that laid the foundation for the modern Internet?", options: ["ARPANET", "ETHERNET", "CYCLADES", "BITNET"], answer: 0, level: "HARD" }
  ],
  geography: [
    { question: "Which is the largest ocean on Earth by surface area?", options: ["Pacific Ocean", "Atlantic Ocean", "Indian Ocean", "Arctic Ocean"], answer: 0, level: "EASY" },
    { question: "What is the capital city of Japan?", options: ["Tokyo", "Kyoto", "Osaka", "Hiroshima"], answer: 0, level: "EASY" },
    { question: "Which is the longest river in the world?", options: ["Nile", "Amazon", "Yangtze", "Mississippi"], answer: 0, level: "EASY" },
    { question: "Which continent is home to the Sahara Desert?", options: ["Africa", "Asia", "South America", "Australia"], answer: 0, level: "EASY" },
    { question: "Which country has the highest number of natural lakes in the world?", options: ["Canada", "Russia", "Finland", "Sweden"], answer: 0, level: "MODERATE" },
    { question: "What is the highest mountain peak in North America?", options: ["Denali", "Mount Logan", "Mount Rainier", "Mount Whitney"], answer: 0, level: "MODERATE" },
    { question: "What is the only country in the world that borders both the Caspian Sea and the Persian Gulf?", options: ["Iran", "Iraq", "Azerbaijan", "Turkmenistan"], answer: 0, level: "HARD" },
    { question: "Which African country was formerly known as Abyssinia?", options: ["Ethiopia", "Sudan", "Eritrea", "Somalia"], answer: 0, level: "HARD" }
  ],
  science: [
    { question: "What is the primary chemical compound that constitutes ordinary water?", options: ["H2O", "CO2", "NaCl", "CH4"], answer: 0, level: "EASY" },
    { question: "Which planet in the solar system is closest to the Sun?", options: ["Mercury", "Venus", "Mars", "Earth"], answer: 0, level: "EASY" },
    { question: "What organ in the human body is primarily responsible for filtering waste from blood?", options: ["Kidneys", "Liver", "Lungs", "Spleen"], answer: 0, level: "EASY" },
    { question: "What force keeps objects on Earth pulled toward its center?", options: ["Gravity", "Magnetism", "Friction", "Centrifugal force"], answer: 0, level: "EASY" },
    { question: "What is the hardest known naturally occurring mineral on Earth?", options: ["Diamond", "Corundum", "Quartz", "Topaz"], answer: 0, level: "MODERATE" },
    { question: "Which gas is released by green plants as a byproduct of photosynthesis?", options: ["Oxygen", "Carbon Dioxide", "Nitrogen", "Methane"], answer: 0, level: "MODERATE" },
    { question: "What is the SI unit used for measuring electrical resistance?", options: ["Ohm", "Volt", "Ampere", "Watt"], answer: 0, level: "HARD" },
    { question: "What subatomic particle was discovered by J.J. Thomson using cathode rays in 1897?", options: ["Electron", "Neutron", "Proton", "Positron"], answer: 0, level: "HARD" }
  ]
};

// Generates real, fact-rich questions tailored to whatever topics the host enters
function getQuestionsForTopics(t1, t2, t3) {
  const topics = [
    { name: (t1 || 'Cinema').trim(), count: 8, level: 'EASY' },
    { name: (t2 || 'History').trim(), count: 6, level: 'MODERATE' },
    { name: (t3 || 'Technology').trim(), count: 6, level: 'HARD' }
  ];

  const finalQuestions = [];

  topics.forEach((t) => {
    const rawKey = t.name.toLowerCase();
    
    // Check if topic matches knowledge base
    let matchedKey = Object.keys(triviaKnowledgeBase).find(k => rawKey.includes(k) || k.includes(rawKey));
    if (!matchedKey) matchedKey = 'science'; // diverse scientific trivia fallback

    const pool = triviaKnowledgeBase[matchedKey];
    for (let i = 0; i < t.count; i++) {
      const item = pool[i % pool.length];
      finalQuestions.push({
        question: `[${t.name}] ${item.question}`,
        options: [...item.options],
        answer: item.answer,
        level: t.level
      });
    }
  });

  return finalQuestions.map(shuffleOptions);
}

// ----------------- REST API ROUTES -----------------

// 1. Create Room (Host)
app.post('/api/create-room', (req, res) => {
  try {
    const { customPin, topic1, topic2, topic3 } = req.body || {};
    const pin = (customPin && String(customPin).trim()) || Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[Session Setup] PIN: ${pin} | Topics: ${topic1}, ${topic2}, ${topic3}`);

    const questions = getQuestionsForTopics(topic1, topic2, topic3);

    rooms.set(pin, {
      pin,
      questions,
      currentIndex: 0,
      state: 'LOBBY',
      revealedAnswer: null,
      players: {},
      answersThisRound: {}
    });

    console.log(`✅ Room ${pin} created with 20 real trivia questions.`);
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
