import React, { useState } from "react";
import { Send, LineChart, Loader2, RefreshCw } from "lucide-react";
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  ComposedChart,
} from "recharts";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChartDataPoint {
  year: number;
  p5: number;
  p50: number;
  p95: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  chartData?: ChartDataPoint[];
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hello! I am your Wealth Optimization AI. Let's start by establishing your underlying 'Ground Truth'. Could you tell me about your family composition, location, wealth & asset breakdown, and your regular income/expenses?",
    },
  ]);
  const [inputMsg, setInputMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null);

  const currentChartData = messages
    .slice()
    .reverse()
    .find((m) => m.chartData)?.chartData;

  const sendMessage = async () => {
    if (!inputMsg.trim()) return;
    const newMessages = [...messages, { role: "user", text: inputMsg }];
    setMessages(newMessages as ChatMessage[]);
    setInputMsg("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: inputMsg,
          previousInteractionId: interactionId,
        }),
      });

      const data = await res.json();
      if (!data.error) {
        let text = data.text;
        let chartData: ChartDataPoint[] | undefined;

        const jsonMatch =
          text.match(/```json\s+chartData([\s\S]+?)```/i) ||
          text.match(/```json\s*\n([\s\S]*?"chartData"[\s\S]*?)\n```/i);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1].trim());
            if (parsed.chartData) {
              chartData = parsed.chartData;
            } else if (Array.isArray(parsed)) {
              chartData = parsed;
            }
          } catch (e) {
            console.error("Failed to parse chart json", e);
          }
          text = text
            .replace(/```json\s+chartData[\s\S]+?```/i, "")
            .replace(/```json\s*\n[\s\S]*?"chartData"[\s\S]*?\n```/i, "")
            .trim();
        }

        setInteractionId(data.interactionId);
        setMessages([...newMessages, { role: "assistant", text, chartData }]);
      } else {
        setMessages([
          ...newMessages,
          { role: "assistant", text: "Error: " + data.error },
        ]);
      }
    } catch (e) {
      console.error(e);
      setMessages([
        ...newMessages,
        { role: "assistant", text: "Error connecting to optimization engine." },
      ]);
    }

    setLoading(false);
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
      <div className="w-[45%] min-w-[400px] max-w-[800px] border-r border-slate-200 bg-white flex flex-col shadow-sm z-10">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <LineChart className="text-blue-600" />
          <h1 className="font-semibold text-slate-800 tracking-tight">
            Wealth Simulator
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`px-4 py-3 rounded-2xl max-w-[90%] ${
                  m.role === "user"
                    ? "bg-blue-600 text-white rounded-br-none"
                    : "bg-slate-100 text-slate-800 rounded-bl-none shadow-sm border border-slate-200"
                }`}
              >
                <div
                  className={`prose prose-sm max-w-none leading-relaxed ${m.role === "user" ? "text-white prose-p:text-white prose-strong:text-white prose-headings:text-white prose-li:text-white" : "prose-slate"}`}
                >
                  <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-start">
              <div className="px-4 py-3 bg-slate-100 text-slate-800 rounded-2xl rounded-bl-none border border-slate-200 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                <span className="text-sm text-slate-500">
                  Running 10,000 simulations...
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-white border-t border-slate-100">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              placeholder="Enter ground truth or scenario..."
              className="flex-1 px-4 py-2 border border-slate-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-slate-50 text-sm"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !inputMsg.trim()}
              className="p-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      <div className="flex-1 bg-slate-50 flex flex-col items-center justify-center p-8 relative">
        <div className="absolute top-6 left-6 text-slate-400 font-medium tracking-wide text-xs flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">
          <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
          MONTE CARLO ENGINE
        </div>

        {currentChartData ? (
          <div className="w-full h-full max-w-5xl max-h-[800px] flex flex-col bg-white rounded-3xl shadow-xl border border-slate-200 p-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-2 font-sans tracking-tight">
              Wealth Trajectory Analysis
            </h2>
            <p className="text-slate-500 mb-8 font-mono text-sm">
              10,000 Iterations • P5 / P50 / P95 Confidence Intervals
            </p>
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={currentChartData}
                  margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    dx={-10}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "none",
                      boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                    }}
                    formatter={(value: number) =>
                      `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    }
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" />

                  <Line
                    type="monotone"
                    dataKey="p95"
                    stroke="#93c5fd"
                    strokeWidth={2}
                    dot={false}
                    strokeDasharray="5 5"
                    name="Optimistic (P95)"
                  />
                  <Line
                    type="monotone"
                    dataKey="p50"
                    stroke="#2563eb"
                    strokeWidth={4}
                    dot={{ r: 4, fill: "#2563eb", strokeWidth: 0 }}
                    activeDot={{ r: 8 }}
                    name="Median (P50)"
                  />
                  <Line
                    type="monotone"
                    dataKey="p5"
                    stroke="#f87171"
                    strokeWidth={2}
                    dot={false}
                    strokeDasharray="5 5"
                    name="Pessimistic (P5)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-slate-400 max-w-sm text-center">
            <div className="w-24 h-24 mb-6 rounded-3xl bg-white shadow-sm border border-slate-200 flex items-center justify-center">
              <LineChart className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-2">
              Awaiting Ground Truth
            </h3>
            <p className="text-sm">
              Provide your financial baseline and scenario in the chat. The
              completely sandboxed Monte Carlo engine will visualize your wealth
              trajectory here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
