import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "Hackathon Demo" },
});

// --- 1. 扩充知识库 (新增 USDT, DAI) ---
const TOKEN_WHITELIST = {
  "42161": { // Arbitrum
    "USDC": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "ETH": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "USDT": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    "DAI": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"
  },
  "8453": { // Base
    "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "ETH": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    "DAI": "0x50c5725949a6f0c72e6c4a641f24049a917db0cb"
  },
  "1": { // Mainnet
    "ETH": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "USDT": "0xdac17f958d2ee523a2206206994597c13d831ec7",
    "DAI": "0x6b175474e89094c44da98b954eedeac495271d0f"
  }
};
const CHAIN_ID_MAP = { "ethereum": 1, "mainnet": 1, "optimism": 10, "arbitrum": 42161, "base": 8453 };

async function getEthPrice() {
  try {
    const res = await fetch('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD');
    const data = await res.json();
    return data.USD || 3000;
  } catch (e) { return 3000; }
}

// --- 2. 升级代币识别逻辑 (包含新地址) ---
function identifyToken(address: string) {
  if (!address) return 'OTHER';
  const addr = address.toLowerCase();
  
  // ETH & WETH
  if ([
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // Native
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // Mainnet WETH
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // Arb WETH
    "0x4200000000000000000000000000000000000006"  // Base WETH
  ].includes(addr)) return 'ETH';

  // Stablecoins (USDC, USDT, DAI)
  if ([
    // USDC
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    // USDT
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
    "0xdac17f958d2ee523a2206206994597c13d831ec7",
    // DAI
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
    "0x6b175474e89094c44da98b954eedeac495271d0f"
  ].includes(addr)) return 'STABLE';

  return 'OTHER';
}

export async function POST(req: Request) {
  try {
    const { prompt, userAddress, currentChainId } = await req.json();
    const ethPrice = await getEthPrice();
    
    const systemPrompt = `
      You are a DeFi Intent Parser.
      Context: UserChain=${currentChainId || 42161}, UserAddr=${userAddress}
      
      CRITICAL RULES:
      1. DIRECTION: "Swap A for B" means Input=A, Output=B. DO NOT REVERSE.
      2. AMBIGUITY: If destination chain is set but output token is unknown (e.g. "to Mainnet"), status="ambiguous".
      3. DEFAULT CHAIN: If user says "on Mainnet" for a swap, BOTH source and destination are 1.
      
      STRICT JSON (No nesting):
      {
        "status": "success" | "ambiguous",
        "message": "string (if ambiguous)",
        "sourceChainId": number, 
        "destinationChainId": number,
        "inputTokenAddress": "0x...", 
        "inputAmount": "string",
        "outputTokenAddress": "0x...",
        "minOutputAmount": "0",
        "recipient": "string"
      }
      
      Tokens: ${JSON.stringify(TOKEN_WHITELIST)}
      Chains: ${JSON.stringify(CHAIN_ID_MAP)}
    `;

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-5.2", 
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, 
    });

    let result = JSON.parse(completion.choices[0].message.content || "{}");
    
    if (result.data) result = { ...result, ...result.data };
    if (result.intent) result = { ...result, ...result.intent };

    if (prompt.toLowerCase().includes("swap") && prompt.toLowerCase().includes("mainnet")) {
        if (!result.sourceChainId || result.sourceChainId === 42161) {
            result.sourceChainId = 1;
        }
    }

    if (result.status === 'ambiguous') return NextResponse.json(result);
    
    if (!result.sourceChainId) result.sourceChainId = currentChainId || 42161;
    if (!result.recipient) result.recipient = userAddress;

    if (result.status === 'success') {
      const amount = parseFloat(result.inputAmount || "0");
      const inputType = identifyToken(result.inputTokenAddress);
      const outputType = identifyToken(result.outputTokenAddress);

      let calculatedAmount = 0;
      // 逻辑升级：支持任意 Stable <-> ETH 和 Stable <-> Stable
      if (inputType === 'STABLE' && outputType === 'ETH') {
        calculatedAmount = (amount / ethPrice) * 0.99;
      } else if (inputType === 'ETH' && outputType === 'STABLE') {
        calculatedAmount = (amount * ethPrice) * 0.99;
      } else {
        // 同类互换 (Stable -> Stable 或 ETH -> ETH)
        // 这里包含了 USDT -> USDC 或 DAI -> USDT 的情况，默认 1:1 (忽略微小汇率差)
        calculatedAmount = amount * 0.99;
      }
      result.minOutputAmount = calculatedAmount.toFixed(6);
    }
    
    if (result.status === 'success' && result.recipient?.endsWith('.eth')) {
      try {
        const ensAddress = await publicClient.getEnsAddress({ name: result.recipient });
        if (ensAddress) result.recipient = ensAddress;
      } catch (e) { if (!result.recipient.startsWith('0x')) result.recipient = userAddress; }
    }

    return NextResponse.json(result);

  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}