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

async function fetchUpcomingOdds() {
    console.log("Fetching sports odds...");
    const url = `https://api.the-odds-api.com/v4/sports/upcoming/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=us,eu&markets=h2h,spreads,totals&dateFormat=iso`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Odds API Error: ${response.statusText}`);
        const data = await response.json();
        
        // Take first 15 upcoming matches across all sports to fit AI prompt limits
        return data.slice(0, 15).map(event => ({
            sport: event.sport_title,
            teams: `${event.home_team} vs ${event.away_team}`,
            bookmakers: event.bookmakers.slice(0, 1).map(b => ({ name: b.title, markets: b.markets }))
        }));
    } catch (err) {
        console.error("Odds error:", err.message); return [];
    }
}

async function generateAIPredictions(oddsData) {
    console.log("Analyzing with AI and Grounding with Google Search...");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const prompt = `
    You are an expert sports quantitative analyst. Analyze the following odds data for upcoming sports matches:
    ${JSON.stringify(oddsData, null, 2)}

    Your task is to generate EXACTLY two daily prediction picks based on maximum probability and statistical edge:
    
    1. **THE GOLDEN SINGLE**: Select ONE match with single-selection odds around 1.85 to 2.15 that has the highest win likelihood across all sports. Provide detailed reasoning.
    2. **THE SAFE DOUBLE**: Select TWO separate safe matches (individual odds around 1.35 to 1.50) that combine to ~2.00 odds total. Provide detailed safety reasoning.

    CRITICAL INSTRUCTION: Use the Google Search tool to verify breaking news, injuries, or drastic line movements for these specific matches before finalizing your picks.

    Format the final response nicely with emojis for Telegram text format. Do not send raw JSON, send clean structured text with headings.
    `;
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                // THIS ENABLES GOOGLE SEARCH GROUNDING
                tools: [
                    {
                        googleSearch: {}
                    }
                ]
            })
        });
        const result = await response.json();
        return result.candidates[0].content.parts[0].text;
    } catch (err) {
        console.error("AI error:", err.message); return null;
    }
}

async function sendTelegramMessage(text) {
    console.log("Sending to Telegram...");
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' })
        });
        console.log("Message successfully sent to Telegram!");
    } catch (err) {
        console.error("Telegram error:", err.message);
    }
}

// THIS IS THE TRIGGER ENDPOINT
app.get('/run-predictor', async (req, res) => {
    console.log("External trigger received! Running predictor...");
    res.send("Predictor started in the background. Check your Telegram."); 
    
    try {
        const odds = await fetchUpcomingOdds();
        if (odds.length > 0) {
            const aiPrediction = await generateAIPredictions(odds);
            if (aiPrediction) {
                await sendTelegramMessage(aiPrediction);
                if (process.env.MONGODB_URI) {
                    await Prediction.create({ content: aiPrediction });
                    console.log("Prediction saved to MongoDB.");
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
