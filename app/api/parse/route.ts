import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// 1. 初始化 OpenAI 客户端 (连接到 OpenRouter)
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1", // 指向 OpenRouter
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000", // OpenRouter 要求
    "X-Title": "Intent Hackathon Demo",
  },
});

// 2. 定义白名单知识库 (硬编码的世界状态) [cite: 50, 55]
const TOKEN_WHITELIST = {
  "42161": { // Arbitrum One
    "USDC": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "ETH": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  },
  "8453": { // Base
    "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "ETH": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  },
  "10": { // Optimism
    "USDT": "0x94b008aa00579c1307b0ef2c499ad98a8ce98706",
    "ETH": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  },
  "1": { // Mainnet
    "ETH": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  }
};

const CHAIN_ID_MAP = {
  "ethereum": 1,
  "mainnet": 1,
  "optimism": 10,
  "op": 10,
  "arbitrum": 42161,
  "arb": 42161,
  "base": 8453
};

export async function POST(req: Request) {
  try {
    const { prompt, userAddress, currentChainId } = await req.json();

    console.log("收到意图请求:", prompt);

    // 3. 构建 System Prompt [cite: 42, 46, 158]
    const systemPrompt = `
      You are a professional Cross-Chain DeFi Intent Parser.
      Your task is to convert user natural language into a strict JSON object.

      Context:
      - User Current Address: ${userAddress || "0x0000000000000000000000000000000000000000"}
      - User Current Chain ID: ${currentChainId || 42161}
      
      Knowledge Base (Token Whitelist):
      ${JSON.stringify(TOKEN_WHITELIST, null, 2)}
      
      Chain ID Map:
      ${JSON.stringify(CHAIN_ID_MAP, null, 2)}

      Rules:
      1. Identify sourceChainId, destinationChainId, inputTokenAddress, inputAmount, outputTokenAddress, recipient.
      2. IF source chain is not specified, use User Current Chain ID.
      3. IF destination chain is not specified, infer from context (e.g., "bridge to Base"). If cannot infer, error.
      4. inputAmount should be a STRING (e.g., "100.5"). Do NOT convert units (keep it as decimal representation).
      5. minOutputAmount should be inputAmount * 0.99 (simulating 1% slippage/fee).
      6. recipient defaults to User Current Address unless specified otherwise.
      7. Return JSON ONLY. No markdown formatting.

      Required JSON Schema:
      {
        "intentType": "cross-chain-swap",
        "sourceChainId": number,
        "destinationChainId": number,
        "inputTokenAddress": "0x...",
        "inputAmount": "string",
        "outputTokenAddress": "0x...",
        "minOutputAmount": "string",
        "recipient": "0x..."
      }
    `;

    // 4. 调用 AI (使用 gpt-4o 或类似高智商模型以确保 JSON 格式准确) [cite: 33, 120]
    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o-2024-08-06", // OpenRouter 支持此模型，适合结构化输出
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }, // 强制 JSON 模式
      temperature: 0.1, // 降低随机性
    });

    const content = completion.choices[0].message.content;
    
    if (!content) {
      throw new Error("AI returned empty response");
    }

    const parsedIntent = JSON.parse(content);
    
    console.log("AI 解析结果:", parsedIntent);

    return NextResponse.json(parsedIntent);

  } catch (error) {
    console.error("AI Error:", error);
    return NextResponse.json(
      { error: "Failed to parse intent" },
      { status: 500 }
    );
  }
}