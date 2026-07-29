import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

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
        
        return data.slice(0, 15).map(event => ({
            sport: event.sport_title,
            teams: `${event.home_team} vs ${event.away_team}`,
            bookmakers: event.bookmakers.slice(0, 1).map(b => ({
                name: b.title,
                markets: b.markets
            }))
        }));
    } catch (err) {
        console.error("Error fetching odds:", err.message);
        return [];
    }
}

async function generateAIPredictions(oddsData) {
    console.log("Analyzing with AI...");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const prompt = `
    You are an expert sports quantitative analyst. Analyze the following odds data for upcoming sports matches:
    ${JSON.stringify(oddsData, null, 2)}

    Your task is to generate EXACTLY two daily prediction picks based on maximum probability and statistical edge:
    
    1. **THE GOLDEN SINGLE**: Select ONE match with single-selection odds around 1.85 to 2.15 that has the highest win likelihood across all sports. Provide detailed reasoning.
    2. **THE SAFE DOUBLE**: Select TWO separate safe matches (individual odds around 1.35 to 1.50) that combine to ~2.00 odds total. Provide detailed safety reasoning.

    Format the final response nicely with emojis for Telegram text format. Do not send raw JSON, send clean structured text with headings.
    `;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const result = await response.json();
        return result.candidates[0].content.parts[0].text;
    } catch (err) {
        console.error("Error generating AI response:", err.message);
        return null;
    }
}

async function sendTelegramMessage(text) {
    console.log("Sending to Telegram...");
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: 'Markdown'
            })
        });
        console.log("Message successfully sent to Telegram!");
    } catch (err) {
        console.error("Error sending to Telegram:", err.message);
    }
}

async function main() {
    try {
        if (process.env.MONGODB_URI) {
            await mongoose.connect(process.env.MONGODB_URI);
            console.log("Database connected successfully.");
        }

        const odds = await fetchUpcomingOdds();
        if (!odds.length) {
            console.log("No odds found. Exiting.");
            return;
        }

        const aiPrediction = await generateAIPredictions(odds);
        if (aiPrediction) {
            await sendTelegramMessage(aiPrediction);
            
            if (process.env.MONGODB_URI) {
                await Prediction.create({ content: aiPrediction });
                console.log("Prediction saved to MongoDB.");
            }
        }
    } catch (err) {
        console.error("Execution failed:", err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

main();
