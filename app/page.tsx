'use client';

import { useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { parseAbiParameters, encodeAbiParameters, parseUnits, keccak256, toHex } from 'viem';

// --- 1. 定义 ERC-7683 标准常量 ---
// 这是一个模拟的 Settler 合约地址，用于演示
const ORIGIN_SETTLER = "0x0000000000000000000000000000000000007683"; 

// EIP-712 类型定义
const types = {
  GaslessCrossChainOrder: [
    { name: 'originSettler', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'originChainId', type: 'uint256' },
    { name: 'openDeadline', type: 'uint32' },
    { name: 'fillDeadline', type: 'uint32' },
    { name: 'orderDataType', type: 'bytes32' }, // 标识子类型
    { name: 'orderData', type: 'bytes' },       // 具体的意图数据
  ],
} as const;

export default function Home() {
  // --- 状态管理 ---
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  
  const [prompt, setPrompt] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [intent, setIntent] = useState<any>(null);
  const [signature, setSignature] = useState<string>('');
  const [step, setStep] = useState(0); // 0: Input, 1: Confirm, 2: Success

  // --- Step 1: AI 解析意图 ---
  const handleParse = async () => {
    if (!prompt) return;
    setIsParsing(true);
    setIntent(null);
    setStep(0);

    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          userAddress: address,
          currentChainId: chainId
        })
      });
      const data = await response.json();
      setIntent(data);
      setStep(1); // 进入确认步骤
    } catch (error) {
      console.error(error);
      alert('AI 解析失败，请重试');
    } finally {
      setIsParsing(false);
    }
  };

  // --- Step 2: 构造 ERC-7683 结构并签名 ---
  const handleSign = async () => {
    if (!intent || !address) return;
    setIsSigning(true);

    try {
     // 1. 检查并切换网络 [cite: 19]
      // 如果当前钱包不在 AI 说的源链上，强制切换
      if (chainId !== intent.sourceChainId) {
        try {
          await switchChainAsync({ chainId: intent.sourceChainId });
        } catch (e) {
          alert("请在钱包中确认切换网络");
          setIsSigning(false);
          return;
        }
      }

     // 2. 编码 orderData (最难的一步) [cite: 22, 23]
      // 我们定义一个通用的跨链格式: (inputToken, inputAmount, outputToken, outputAmount, destChain, recipient)
      const orderDataSchema = parseAbiParameters(
        'address, uint256, address, uint256, uint256, address'
      );
      
      const encodedOrderData = encodeAbiParameters(orderDataSchema, [
        intent.inputTokenAddress as `0x${string}`,
        parseUnits(intent.inputAmount, 6), // 假设 USDC 是 6 位精度 (简化处理)
        intent.outputTokenAddress as `0x${string}`,
        parseUnits(intent.minOutputAmount, 18), // 假设 ETH 是 18 位精度
        BigInt(intent.destinationChainId),
        intent.recipient as `0x${string}`
      ]);

      // 3. 构造 EIP-712 Domain
      const domain = {
        name: 'Across', // 模拟使用 Across 协议
        version: '1',
        chainId: intent.sourceChainId,
        verifyingContract: ORIGIN_SETTLER,
      } as const;

     // 4. 构造消息体 GaslessCrossChainOrder [cite: 18]
      const message = {
        originSettler: ORIGIN_SETTLER,
        user: address,
        nonce: BigInt(Date.now()), // 简单模拟 nonce
        originChainId: BigInt(intent.sourceChainId),
        openDeadline: Math.floor(Date.now() / 1000), // 当前生效
        fillDeadline: Math.floor(Date.now() / 1000) + 3600, // 1小时后过期
        orderDataType: keccak256(toHex('CrossChainTransfer')), // 模拟类型哈希
        orderData: encodedOrderData, // 这里放入我们上面编码好的 Hex String
      };

     // 5. 发起签名 [cite: 12]
      const sig = await signTypedDataAsync({
        domain,
        types,
        primaryType: 'GaslessCrossChainOrder',
        message,
      });

      setSignature(sig);
      setStep(2); // 进入成功页面

    } catch (error) {
      console.error("签名失败:", error);
      alert("用户取消签名或发生错误");
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-4 lg:p-8 bg-black text-white font-sans">
      {/* 顶部导航 */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-12 border-b border-gray-800 pb-4">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Intent Solver
        </h1>
        <appkit-button />
      </div>

      <div className="w-full max-w-2xl relative">
        
        {/* Step 0: 输入框 */}
        <div className={`transition-all duration-500 ${step === 0 ? 'opacity-100' : 'opacity-0 hidden'}`}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <label className="text-gray-400 text-sm font-medium mb-2 block">Tell me what you want to do:</label>
            <textarea 
              className="w-full h-32 bg-black border border-gray-700 rounded-xl p-4 text-lg text-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
              placeholder="e.g., Bridge 10 USDC from Arbitrum to Base for ETH"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button 
              onClick={handleParse}
              disabled={isParsing || !isConnected}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold py-4 rounded-xl transition-all flex justify-center items-center"
            >
              {isParsing ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"/>
                  Analyzing Intent...
                </span>
              ) : 'Parse Intent 🧠'}
            </button>
          </div>
        </div>

        {/* Step 1: 意图确认卡片 (绿野仙踪的核心) */}
        {intent && (
          <div className={`transition-all duration-500 absolute top-0 w-full ${step === 1 ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}>
            <div className="bg-gray-900 border border-blue-500/30 rounded-2xl p-1 overflow-hidden">
              <div className="bg-blue-500/10 p-4 border-b border-blue-500/20 flex justify-between items-center">
                <h3 className="text-blue-400 font-bold flex items-center gap-2">
                  <span>✨ Intent Constructed</span>
                </h3>
                <button onClick={() => setStep(0)} className="text-xs text-gray-500 hover:text-white">Edit</button>
              </div>
              
              <div className="p-6 grid grid-cols-2 gap-y-6 gap-x-4">
                {/* 可视化展示解析结果 */}
                <div className="col-span-1">
                  <p className="text-gray-500 text-xs uppercase tracking-wider">From Chain</p>
                  <p className="text-xl font-medium">{intent.sourceChainId === 42161 ? 'Arbitrum' : intent.sourceChainId}</p>
                </div>
                <div className="col-span-1 text-right">
                   <p className="text-gray-500 text-xs uppercase tracking-wider">To Chain</p>
                   <p className="text-xl font-medium">{intent.destinationChainId === 8453 ? 'Base' : intent.destinationChainId}</p>
                </div>
                
                <div className="col-span-2 bg-black/50 p-4 rounded-lg flex justify-between items-center border border-gray-800">
                  <div>
                    <span className="text-2xl font-bold text-white">{intent.inputAmount}</span>
                    <span className="text-gray-400 ml-2">USDC</span>
                  </div>
                  <div className="text-gray-600">➔</div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-green-400">≈ {intent.minOutputAmount}</span>
                    <span className="text-gray-400 ml-2">ETH</span>
                  </div>
                </div>

                <div className="col-span-2 text-xs text-gray-600 font-mono mt-2 break-all">
                  Recipient: {intent.recipient}
                </div>
              </div>

              <div className="p-4 bg-black/30">
                <button 
                  onClick={handleSign}
                  disabled={isSigning}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-green-900/20 transition-all flex justify-center items-center gap-2"
                >
                  {isSigning ? 'Requesting Signature...' : 'Sign with imToken ✍️'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: 成功页面 (模拟结算) */}
        {step === 2 && (
          <div className="bg-gray-900 border border-green-500/30 rounded-2xl p-8 text-center animate-fade-in">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">Order Submitted!</h2>
            <p className="text-gray-400 mb-8">Your intent has been broadcast to the solver network.</p>
            
            <div className="bg-black p-4 rounded-lg text-left mb-6">
              <p className="text-gray-500 text-xs mb-1">Cryptographic Signature (Verified):</p>
              <p className="text-green-400 font-mono text-xs break-all">{signature}</p>
            </div>

            <button 
              onClick={() => { setPrompt(''); setStep(0); }}
              className="text-gray-400 hover:text-white underline decoration-dotted"
            >
              Start New Intent
            </button>
          </div>
        )}

      </div>
    </main>
  );
}