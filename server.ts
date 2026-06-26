import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { retryOptions: { attempts: 1 } }
});

const LOOPS = 10000;
const MIN_YEARS = 5;
const MAX_YEARS = 50;
const FIRE_THRESHOLD = 0.85;
const DEFAULT_WITHDRAWAL_RATE = 0.04;
const DEFAULT_TOKEN_LIMIT = 1_048_576;

const modelLimitCache = new Map<string, number>();

async function getModelLimit(model: string): Promise<number> {
  if (modelLimitCache.has(model)) {
    return modelLimitCache.get(model)!;
  }
  try {
    const modelInfo = await ai.models.get({ model });
    const limit = modelInfo.inputTokenLimit || DEFAULT_TOKEN_LIMIT;
    modelLimitCache.set(model, limit);
    return limit;
  } catch (err) {
    console.error(`Failed to fetch model limit for ${model}:`, err);
    return DEFAULT_TOKEN_LIMIT;
  }
}

function extractModelOutput(interaction: any): string {
  let output = "";
  if (interaction && interaction.steps) {
    for (const step of interaction.steps) {
      if (step.type === "model_output") {
        const textContent = step.content?.find((c: any) => c.type === "text") as any;
        if (textContent && textContent.text) {
          output += textContent.text;
        }
      }
    }
  }
  return output;
}

const SYSTEM_INSTRUCTION = `You are a Wealth Optimization AI Assistant.
For the simulation, we use a high-performance local Node.js TypeScript execution engine.

### Step-by-Step Logic
**Step 1: Ground Truth.**
When the user connects, ask for their "Ground Truth": Family, Location, Wealth/Assets, and Income/Expenses. Keep it conversational and brief.

**Step 2: Scenario Intake.**
Once gathered, ask what scenario they want to model (e.g., FIRE age, buying a house). Make transparent default assumptions (tax rates, inflation, stock growth) if missing. Note that the maximum simulation horizon is 50 years.

**Step 3: Triggering the Simulation Engine.**
When ready to simulate, output a JSON block containing the simulation parameters so the backend can run the 10,000 Monte Carlo loops. Use EXACTLY this format:

\`\`\`json simulationParams
{
  "currentWealth": 500000,
  "annualSavings": 50000,
  "annualExpenses": 40000,
  "withdrawalRate": 0.04,
  "years": 30,
  "stockGrowthMean": 0.08,
  "stockGrowthStdDev": 0.15,
  "inflationMean": 0.03,
  "inflationStdDev": 0.02
}
\`\`\`

### Formatting Rules
Your response MUST be concise and strictly include ONLY:
1. **Scenario Modeled:** [short confirmation]
2. **Assumed Variables:** [brief bulleted list matching the JSON]
[JSON BLOCK]

Do NOT state any Result, projection, probability, or FIRE age in this turn. The simulation has not run yet. Results will be supplied separately.
Do not manually include the \`chartData\` JSON block or the \`[Session Context Consumed]\` tracker.`;

const SYSTEM_INSTRUCTION_TOOL = `You are a Wealth Optimization AI Assistant.
For the simulation, we use a high-performance local Node.js TypeScript execution engine.

### Step-by-Step Logic
**Step 1: Ground Truth.**
When the user connects, ask for their "Ground Truth": Family, Location, Wealth/Assets, and Income/Expenses. Keep it conversational and brief.

**Step 2: Scenario Intake.**
Once gathered, ask what scenario they want to model (e.g., FIRE age, buying a house). Make transparent default assumptions (tax rates, inflation, stock growth) if missing. Note that the maximum simulation horizon is 50 years.

**Step 3: Triggering the Simulation Engine.**
When ready to simulate, you MUST call the \`run_monte_carlo\` tool. Do NOT output a raw JSON block.

### Formatting Rules
After calling the tool, your response MUST be concise and strictly include:
1. **Scenario Modeled:** [short confirmation]
2. **Assumed Variables:** [brief bulleted list matching the tool arguments]
3. **Result:** [verbal projection, FIRE age, etc. based on tool results]

Do not manually include the \`chartData\` JSON block or the \`[Session Context Consumed]\` tracker.`;

interface SimParams {
  currentWealth?: number;
  annualSavings?: number;
  years?: number;
  stockGrowthMean?: number;
  stockGrowthStdDev?: number;
  inflationMean?: number;
  inflationStdDev?: number;
  annualExpenses?: number;
  withdrawalRate?: number;
}

function runMonteCarlo(params: SimParams) {
  const { currentWealth, annualSavings, years, stockGrowthMean, stockGrowthStdDev, inflationMean, inflationStdDev, annualExpenses, withdrawalRate } = params;
  const safeYears = Math.min(Math.max(years || 30, MIN_YEARS), MAX_YEARS);
  const resultsByYear: { p5: number, p50: number, p95: number, year: number, prob?: number }[] = [];
  
  const target = (annualExpenses || 0) > 0 ? (annualExpenses! / (withdrawalRate || DEFAULT_WITHDRAWAL_RATE)) : null;
  let fireYear: number | null = null;
  
  const currentWealths = new Float64Array(LOOPS);
  currentWealths.fill(currentWealth || 0);

  for (let y = 1; y <= safeYears; y++) {
    for (let i = 0; i < LOOPS; i++) {
      // Standard Box-Muller Transform for standard normal distribution variables
      const u1 = Math.random(), u2 = Math.random();
      const zStock = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const zInfl = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
      
      const growth = (stockGrowthMean || 0.08) + zStock * (stockGrowthStdDev || 0.15);
      const infl = (inflationMean || 0.03) + zInfl * (inflationStdDev || 0.02);
      
      const realGrowth = (1 + growth) / (1 + infl) - 1;
      currentWealths[i] = currentWealths[i] * (1 + realGrowth) + (annualSavings || 0);
    }
    
    const endpoints = new Float64Array(currentWealths);
    endpoints.sort();
    
    let prob = 0;
    if (target !== null) {
      let idx = LOOPS;
      for (let k = 0; k < LOOPS; k++) {
         if (endpoints[k] >= target) {
             idx = k;
             break;
         }
      }
      prob = (LOOPS - idx) / LOOPS;
      if (fireYear === null && prob >= FIRE_THRESHOLD) {
         fireYear = new Date().getFullYear() + y;
      }
    }

    resultsByYear.push({
      year: new Date().getFullYear() + y,
      p5: Math.round(endpoints[Math.floor(LOOPS * 0.05)]),
      p50: Math.round(endpoints[Math.floor(LOOPS * 0.5)]),
      p95: Math.round(endpoints[Math.floor(LOOPS * 0.95)]),
      ...(target !== null ? { prob } : {})
    });
  }
  return { resultsByYear, fireYear, target };
}

app.post("/api/chat", async (req, res) => {
  try {
    let apiCallCount = 0;
    let { message, previousInteractionId, priorTokens } = req.body;
    
    let mode = "tool";
    let model = "gemini-3.1-flash-lite";
    let isModeTool = false;
    let isModelOverride = false;
    let dropConfig = false;
    let padTokens = 0;

    let turnDelta = 0;

    const CONTEXT_BUDGET_PCT = 1;

    const modeRegex = /(?:^|\s)mode:(local|tool)(?=\s|$)/i;
    const modelRegex = /(?:^|\s)model:([^\s]+)(?=\s|$)/i;
    const dropConfigRegex = /(?:^|\s)dropconfig:on(?=\s|$)/i;
    const padRegex = /(?:^|\s)pad:(\d+)(?=\s|$)/i;

    const modeMatch = message.match(modeRegex);
    if (modeMatch) {
      mode = modeMatch[1].toLowerCase();
      message = message.replace(modeRegex, " ");
      if (mode === "tool") isModeTool = true;
    }

    const modelMatch = message.match(modelRegex);
    if (modelMatch) {
      model = modelMatch[1];
      message = message.replace(modelRegex, " ");
      isModelOverride = true;
    }

    const dropConfigMatch = message.match(dropConfigRegex);
    if (dropConfigMatch) {
      dropConfig = true;
      message = message.replace(dropConfigRegex, " ");
    }

    const padMatch = message.match(padRegex);
    if (padMatch) {
      padTokens = parseInt(padMatch[1], 10);
      message = message.replace(padRegex, " ");
    }

    message = message.trim();
    
    if (padTokens > 0) {
      const filler = Array(padTokens).fill("lorem").join(" ");
      message = filler + "\n\n" + message;
    }
    
    let fullOutput = "";
    let finalInteraction: any = null;
    let chartDataBlock = "";

    const omitConfig = dropConfig && !!previousInteractionId;

    if (mode === "tool") {
      apiCallCount++;
      const interaction = await ai.interactions.create({
        model: model,
        system_instruction: omitConfig ? undefined : SYSTEM_INSTRUCTION_TOOL,
        input: message,
        previous_interaction_id: previousInteractionId || undefined,
        tools: omitConfig ? undefined : [{
          type: "function",
          name: "run_monte_carlo",
          description: "Run the Monte Carlo simulation to project wealth.",
          parameters: {
            type: "object",
            properties: {
              currentWealth: { type: "number" },
              annualSavings: { type: "number" },
              annualExpenses: { type: "number" },
              withdrawalRate: { type: "number" },
              years: { type: "number" },
              stockGrowthMean: { type: "number" },
              stockGrowthStdDev: { type: "number" },
              inflationMean: { type: "number" },
              inflationStdDev: { type: "number" }
            },
            required: ["currentWealth", "annualSavings", "annualExpenses", "withdrawalRate", "years", "stockGrowthMean", "stockGrowthStdDev", "inflationMean", "inflationStdDev"]
          }
        }]
      });

      turnDelta += interaction.usage?.total_tokens || 0;
      finalInteraction = interaction;

      const fnCall = interaction.steps.find((s: any) => s.type === "function_call") as any;
      if (fnCall && fnCall.name === "run_monte_carlo") {
        try {
          const params = typeof fnCall.arguments === "string" ? JSON.parse(fnCall.arguments) : fnCall.arguments;
          const { resultsByYear, fireYear, target } = runMonteCarlo(params);
          
          apiCallCount++;
          finalInteraction = await ai.interactions.create({
            model: model,
            previous_interaction_id: interaction.id,
            input: [{
               type: "function_result",
               call_id: fnCall.id,
               name: fnCall.name,
               result: { chartData: resultsByYear, fireYear, target }
            }]
          });
          turnDelta += finalInteraction.usage?.total_tokens || 0;
          
          chartDataBlock = `\n\n\`\`\`json chartData\n${JSON.stringify({ chartData: resultsByYear })}\n\`\`\``;
        } catch (err) {
          console.error("Failed executing tool run_monte_carlo", err);
        }
      }

      fullOutput += extractModelOutput(finalInteraction);

      fullOutput += chartDataBlock;

    } else {
      // mode:local path
      // Note: This path now makes 2 model calls per turn.
      apiCallCount++;
      const interaction = await ai.interactions.create({
        model: model,
        system_instruction: omitConfig ? undefined : SYSTEM_INSTRUCTION,
        input: message,
        previous_interaction_id: previousInteractionId || undefined,
      });

      turnDelta += interaction.usage?.total_tokens || 0;
      finalInteraction = interaction;

      fullOutput += extractModelOutput(interaction);

      // Intercept Simulation Params to run our local fast TS 10,000-loop Monte Carlo
      const paramMatch = fullOutput.match(/```json\s+simulationParams([\s\S]+?)```/i) || fullOutput.match(/```json(?:.*?)\n([\s\S]*?"currentWealth"[\s\S]*?)\n```/i);
      
      let turn1Text = fullOutput;
      
      if (paramMatch) {
        try {
          let rawJson = paramMatch[1].trim();
          // remove trailing commas just in case
          rawJson = rawJson.replace(/,\s*}/g, "}");
          const params = JSON.parse(rawJson);
          const { resultsByYear, fireYear, target } = runMonteCarlo(params);
          
          // Strip simulationParams JSON from chat output
          if (turn1Text.match(/```json\s+simulationParams([\s\S]+?)```/i)) {
             turn1Text = turn1Text.replace(/```json\s+simulationParams[\s\S]+?```/gi, '').trim();
          } else {
             turn1Text = turn1Text.replace(/```json(?:.*?)\n([\s\S]*?"currentWealth"[\s\S]*?)\n```/gi, '').trim();
          }
          
          const milestones = [
            resultsByYear[4],
            resultsByYear[9],
            resultsByYear[14],
            resultsByYear[resultsByYear.length - 1]
          ].filter(Boolean);
          
          const milestoneText = milestones.map(m => 
            `Year ${m.year}: P5=$${m.p5}, P50=$${m.p50}, P95=$${m.p95}, Prob of FIRE=${((m.prob||0)*100).toFixed(1)}%`
          ).join('\n');
          
          const secondTurnInput = `SIMULATION RESULTS:
FIRE Target: $${Math.round(target || 0)}
FIRE Year (>=85% prob): ${fireYear ? fireYear : 'Not reached within simulation timeframe'}

Milestones:
${milestoneText}

INSTRUCTION:
Write the "3. Result:" section based strictly on the above numbers. Do not invent any numbers. Keep it concise with appropriate uncertainty.`;

          apiCallCount++;
          const turn2Interaction = await ai.interactions.create({
            model: model,
            input: secondTurnInput,
            previous_interaction_id: interaction.id,
          });
          
          turnDelta += turn2Interaction.usage?.total_tokens || 0;
          finalInteraction = turn2Interaction;
          
          let turn2Text = extractModelOutput(turn2Interaction);
          
          fullOutput = turn1Text + "\n\n" + turn2Text;
          
          // Pass JSON chart data transparently to frontend
          chartDataBlock = `\n\n\`\`\`json chartData\n${JSON.stringify({ chartData: resultsByYear })}\n\`\`\``;
          
        } catch (err) {
          console.error("Failed executing local TS simulation", err);
          fullOutput = turn1Text;
        }
      }
      
      fullOutput += chartDataBlock;
    }

    const maxTokens = await getModelLimit(model);
    
    let newCumulative = (priorTokens || 0) + turnDelta;
    const contextConsumed = ((newCumulative / maxTokens) * 100).toFixed(4);
    
    fullOutput += `\n\n[Session Context Consumed: ${contextConsumed}% - cumulative, summed client-side because per-call counts are not cumulative]`;

    if (Number(contextConsumed) > CONTEXT_BUDGET_PCT) {
      fullOutput += `\n⚠ Context budget exceeded (${contextConsumed}% > ${CONTEXT_BUDGET_PCT}%). The Interactions API emits no native event for this - tracked client-side.`;
    }

    if (isModeTool || isModelOverride || dropConfig) {
      const dropLabel = dropConfig ? " | config dropped" : "";
      fullOutput += `\n\n[path: ${mode} | model: ${model}${dropLabel}]`;
    }

    console.log(`Total API calls for request: ${apiCallCount}`);

    res.json({
      text: fullOutput,
      interactionId: finalInteraction.id,
      totalTokens: newCumulative,
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    const rawError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
    res.status(500).json({ error: rawError });
  }
});

async function startServer() {
  try {
    await getModelLimit("gemini-3.5-flash");
    await getModelLimit("gemini-2.5-flash");
    await getModelLimit("gemini-3.1-flash-lite");
  } catch (err) {
    console.error("Failed to pre-warm model limits", err);
  }

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
