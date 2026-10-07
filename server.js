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

// Curated trivia knowledge bank for popular academic/general topics
const curatedTrivia = {
  maths: [
    { question: "What is the only even prime number in mathematics?", options: ["2", "4", "0", "1"], answer: 0, level: "EASY" },
    { question: "What is the value of Pi (π) rounded to two decimal places?", options: ["3.14", "3.16", "3.12", "3.18"], answer: 0, level: "EASY" },
    { question: "What is the sum of interior angles in any Euclidean triangle?", options: ["180°", "360°", "90°", "270°"], answer: 0, level: "EASY" },
    { question: "What is the square root of 144?", options: ["12", "14", "16", "11"], answer: 0, level: "EASY" },
    { question: "What is the longest side of a right-angled triangle called?", options: ["Hypotenuse", "Perpendicular", "Adjacent", "Radius"], answer: 0, level: "EASY" },
    { question: "What is 2 raised to the power of 6 (2⁶)?", options: ["64", "32", "128", "16"], answer: 0, level: "EASY" },
    { question: "Who is widely considered the father of geometry?", options: ["Euclid", "Pythagoras", "Archimedes", "Descartes"], answer: 0, level: "EASY" },
    { question: "What is the mathematical term for a polygon with eight sides?", options: ["Octagon", "Hexagon", "Heptagon", "Decagon"], answer: 0, level: "EASY" }
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

// Realistic topic trivia builder
function buildTopicTrivia(t1, t2, t3) {
  const clean1 = (t1 || 'Maths').trim();
  const clean2 = (t2 || 'Physics').trim();
  const clean3 = (t3 || 'Chemistry').trim();

  const k1 = clean1.toLowerCase();
  const k2 = clean2.toLowerCase();
  const k3 = clean3.toLowerCase();

  const pool1 = curatedTrivia[k1] || curatedTrivia.maths;
  const pool2 = curatedTrivia[k2] || curatedTrivia.physics;
  const pool3 = curatedTrivia[k3] || curatedTrivia.chemistry;

  const res = [];
  for (let i = 0; i < 8; i++) {
    const q = pool1[i % pool1.length];
    res.push({
      question: `[${clean1}] ${q.question}`,
      options: [...q.options],
      answer: q.answer,
      level: "EASY"
    });
  }
  for (let i = 0; i < 6; i++) {
    const q = pool2[i % pool2.length];
    res.push({
      question: `[${clean2}] ${q.question}`,
      options: [...q.options],
      answer: q.answer,
      level: "MODERATE"
    });
  }
  for (let i = 0; i < 6; i++) {
    const q = pool3[i % pool3.length];
    res.push({
      question: `[${clean3}] ${q.question}`,
      options: [...q.options],
      answer: q.answer,
      level: "HARD"
    });
  }
  return res.map(shuffleOptions);
}

// Gemini API Generator with safe fallback
async function generateQuizQuestions(t1, t2, t3) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const topic1 = (t1 && t1.trim()) || 'Maths
