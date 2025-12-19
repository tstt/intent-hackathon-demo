import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// 使用主网解析 ENS
const publicClient = createPublicClient({ chain: mainnet, transport: http() });

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "Hackathon Demo" },
});

// 知识库
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

function identifyToken(address: string) {
  if (!address) return 'OTHER';
  const addr = address.toLowerCase();
  if (["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "0x4200000000000000000000000000000000000006"].includes(addr)) return 'ETH';
  if (["0xaf88d065e77c8cc2239327c5edb3a432268e5831", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", "0xdac17f958d2ee523a2206206994597c13d831ec7", "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", "0x6b175474e89094c44da98b954eedeac495271d0f"].includes(addr)) return 'STABLE';
  return 'OTHER';
}

export async function POST(req: Request) {
  try {
    const { prompt, userAddress, currentChainId } = await req.json();
    const ethPrice = await getEthPrice();
    
    // --- 升级 Prompt: 强调 ENS 提取 ---
    const systemPrompt = `
      You are a DeFi Intent Parser.
      Context: UserChain=${currentChainId || 42161}, UserAddr=${userAddress}
      
      RULES:
      1. INTENT TYPE: 
         - "Swap/Bridge/Exchange/Transfer/Send" -> "swap"
         - "Deposit/Save/Invest/Earn/APY/Yield" -> "invest"
      2. RECIPIENT HANDLING (CRITICAL):
         - If user mentions an ENS name (e.g., "peijie.eth", "vitalik.eth"), field "recipient" MUST be that exact string. Do not try to resolve it.
         - If no recipient specified, leave it null (or "undefined").
      3. FOR "invest": 
         - Extract "protocol" (e.g. Uniswap).
      
      STRICT JSON:
      {
        "status": "success" | "ambiguous",
        "message": "string (if ambiguous)",
        "intentType": "swap" | "invest",
        "protocol": "string", 
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

    // --- 模拟理财逻辑 ---
    if (result.status === 'success' && result.intentType === 'invest') {
        result.apy = "12.5%";
        result.protocol = result.protocol || "Uniswap V3";
        if (!result.destinationChainId) result.destinationChainId = result.sourceChainId;
        if (!result.recipient || result.recipient === userAddress) {
            result.recipient = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640"; 
        }
        if (!result.outputTokenAddress) result.outputTokenAddress = "0x0000000000000000000000000000000000000000";
    }

    // --- ENS 解析逻辑 (必须在兜底逻辑之前执行) ---
    // 只有当 recipient 是 .eth 结尾时，才去解析
    if (result.status === 'success' && result.recipient && typeof result.recipient === 'string' && result.recipient.endsWith('.eth')) {
      console.log(`🔍 正在解析 ENS: ${result.recipient}`);
      try {
        const ensAddress = await publicClient.getEnsAddress({ name: result.recipient });
        if (ensAddress) {
            console.log(`✅ ENS 解析成功: ${result.recipient} -> ${ensAddress}`);
            result.recipient = ensAddress;
        } else {
            console.warn("⚠️ ENS 解析结果为空");
        }
      } catch (e) { 
        console.error("❌ ENS 解析出错", e);
        // 如果解析出错（比如网络问题），为了演示不卡死，可以回退到用户地址，或者保留原样看前端怎么处理
        // 这里选择回退到 User Address 以保证流程能走通
        if (!result.recipient.startsWith('0x')) result.recipient = userAddress; 
      }
    }

    // 常规逻辑
    if (result.status === 'ambiguous') return NextResponse.json(result);
    if (!result.sourceChainId) result.sourceChainId = currentChainId || 42161;
    
    // 🔥 兜底逻辑：只有在 ENS 解析尝试之后，如果还没值，再填用户地址
    if (!result.recipient || result.recipient === 'undefined') {
        result.recipient = userAddress;
    }

    // 价格计算
    if (result.status === 'success' && result.intentType !== 'invest') {
      const amount = parseFloat(result.inputAmount || "0");
      const inputType = identifyToken(result.inputTokenAddress);
      const outputType = identifyToken(result.outputTokenAddress);
      let calculatedAmount = 0;
      if (inputType === 'STABLE' && outputType === 'ETH') calculatedAmount = (amount / ethPrice) * 0.99;
      else if (inputType === 'ETH' && outputType === 'STABLE') calculatedAmount = (amount * ethPrice) * 0.99;
      else calculatedAmount = amount * 0.99;
      result.minOutputAmount = calculatedAmount.toFixed(6);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}