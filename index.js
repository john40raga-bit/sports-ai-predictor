import dotenv from 'dotenv';
import mongoose from 'mongoose';
import express from 'express';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log("Database connected."))
        .catch(err => console.error("Database error:", err));
}

const predictionSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    content: String
});
const Prediction = mongoose.model('Prediction', predictionSchema);
// Add this configuration to your Gemini API fetch request in index.js
const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }] // This line enables real-time web search
};
// (The fetchUpcomingOdds, generateAIPredictions, and sendTelegramMessage functions stay the same as before)
async function fetchUpcomingOdds() {
    const url = `https://api.the-odds-api.com/v4/sports/upcoming/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,eu&markets=h2h,spreads,totals&dateFormat=iso`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.slice(0, 15).map(event => ({
            sport: event.sport_title,
            teams: `${event.home_team} vs ${event.away_team}`,
            bookmakers: event.bookmakers.slice(0, 1).map(b => ({ name: b.title, markets: b.markets }))
        }));
    } catch (err) {
        console.error("Odds error:", err); return [];
    }
}

async function generateAIPredictions(oddsData) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const prompt = `You are an expert sports quantitative analyst. Analyze this data: ${JSON.stringify(oddsData)}
    Provide exactly two predictions formatted nicely with emojis for Telegram:
    1. THE GOLDEN SINGLE: One match (odds 1.85-2.15).
    2. THE SAFE DOUBLE: Two safe matches combining to ~2.00 odds.`;
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const result = await response.json();
        return result.candidates[0].content.parts[0].text;
    } catch (err) {
        console.error("AI error:", err); return null;
    }
}

async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.error("Telegram error:", err);
    }
}

// 🛑 THIS IS THE NEW TRIGGER ENDPOINT
app.get('/run-predictor', async (req, res) => {
    console.log("External trigger received! Running predictor...");
    res.send("Predictor started in the background."); // Reply immediately to the trigger service
    
    try {
        const odds = await fetchUpcomingOdds();
        if (odds.length > 0) {
            const aiPrediction = await generateAIPredictions(odds);
            if (aiPrediction) {
                await sendTelegramMessage(aiPrediction);
                if (process.env.MONGODB_URI) {
                    await Prediction.create({ content: aiPrediction });
                }
            }
        }
    } catch (err) {
        console.error("Execution failed:", err);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is awake and listening on port ${PORT}`);
});

