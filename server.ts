import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `You are a Wealth Optimization AI Assistant.
For the simulation, we use a high-performance local Node.js TypeScript execution engine.

### Step-by-Step Logic
**Step 1: Ground Truth.**
When the user connects, ask for their "Ground Truth": Family, Location, Wealth/Assets, and Income/Expenses. Keep it conversational and brief.

**Step 2: Scenario Intake.**
Once gathered, ask what scenario they want to model (e.g., FIRE age, buying a house). Make transparent default assumptions (tax rates, inflation, stock growth) if missing.

**Step 3: Triggering the Simulation Engine.**
When ready to simulate, output a JSON block containing the simulation parameters so the backend can run the 10,000 Monte Carlo loops. Use EXACTLY this format:

\`\`\`json simulationParams
{
  "currentWealth": 500000,
  "annualSavings": 50000,
  "years": 30,
  "stockGrowthMean": 0.08,
  "stockGrowthStdDev": 0.15,
  "inflationMean": 0.03,
  "inflationStdDev": 0.02
}
\`\`\`

### Formatting Rules
Your response MUST be concise and strictly include:
1. **Scenario Modeled:** [short confirmation]
2. **Assumed Variables:** [brief bulleted list matching the JSON]
3. **Result:** [verbal projection, FIRE age, etc. based on results]

Do not manually include the \`chartData\` JSON block or the \`[Session Context Consumed]\` tracker.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, previousInteractionId } = req.body;
    
    // Use gemini-3.5-flash as requested, bypassing sandbox limits via our local TS execution engine
    const interaction = await ai.interactions.create({
      model: "gemini-3.5-flash",
      system_instruction: SYSTEM_INSTRUCTION,
      input: message,
      previous_interaction_id: previousInteractionId || undefined,
    });

    let fullOutput = "";
    for (const step of interaction.steps) {
      if (step.type === "model_output") {
        const textContent = step.content?.find((c) => c.type === "text");
        if (textContent && textContent.text) {
          fullOutput += textContent.text;
        }
      }
    }

    // Intercept Simulation Params to run our local fast TS 10,000-loop Monte Carlo
    const paramMatch = fullOutput.match(/```json\s+simulationParams([\s\S]+?)```/i) || fullOutput.match(/```json(?:.*?)\n([\s\S]*?"currentWealth"[\s\S]*?)\n```/i);
    if (paramMatch) {
      try {
        let rawJson = paramMatch[1].trim();
        // remove trailing commas just in case
        rawJson = rawJson.replace(/,\s*}/g, "}");
        const params = JSON.parse(rawJson);
        const { currentWealth, annualSavings, years, stockGrowthMean, stockGrowthStdDev, inflationMean, inflationStdDev } = params;
        
        const safeYears = Math.min(Math.max(years || 30, 5), 50);
        const LOOPS = 10000;
        const resultsByYear: { p5: number, p50: number, p95: number, year: number }[] = [];
        
        for (let y = 1; y <= safeYears; y++) {
          const endpoints = new Float64Array(LOOPS);
          for (let i = 0; i < LOOPS; i++) {
            let wealth = currentWealth || 0;
            for (let j = 0; j < y; j++) {
              // Standard Box-Muller Transform for standard normal distribution variables
              const u1 = Math.random(), u2 = Math.random();
              const zStock = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
              const zInfl = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
              
              const growth = (stockGrowthMean || 0.08) + zStock * (stockGrowthStdDev || 0.15);
              const infl = (inflationMean || 0.03) + zInfl * (inflationStdDev || 0.02);
              
              const realGrowth = (1 + growth) / (1 + infl) - 1;
              wealth = wealth * (1 + realGrowth) + (annualSavings || 0);
            }
            endpoints[i] = wealth;
          }
          endpoints.sort();
          resultsByYear.push({
            year: new Date().getFullYear() + y,
            p5: Math.round(endpoints[Math.floor(LOOPS * 0.05)]),
            p50: Math.round(endpoints[Math.floor(LOOPS * 0.5)]),
            p95: Math.round(endpoints[Math.floor(LOOPS * 0.95)]),
          });
        }
        
        // Pass JSON chart data transparently to frontend
        fullOutput += `\n\n\`\`\`json chartData\n${JSON.stringify({ chartData: resultsByYear })}\n\`\`\``;
        
      } catch (err) {
        console.error("Failed executing local TS simulation", err);
      }
    }

    const totalTokens = interaction.usage?.total_tokens || 0;
    // Gemini 2.5 Flash has a context window of 1 million tokens (1000000)
    const contextConsumed = ((totalTokens / 1000000) * 100).toFixed(4);
    
    fullOutput += `\n\n[Session Context Consumed: ${contextConsumed}%]`;

    res.json({
      text: fullOutput,
      interactionId: interaction.id,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
