'use client';

import { useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { parseAbiParameters, encodeAbiParameters, parseUnits, keccak256, toHex } from 'viem';

const ORIGIN_SETTLER = "0x0000000000000000000000000000000000007683" as const;

// 简单的 SVG 图标组件
const Icons = {
  ArrowRight: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>,
  Wallet: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>,
  User: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>,
  Sparkles: () => <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>,
  Check: () => <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>,
  Ens: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg> // 简化的标识
};

export default function Home() {
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  
  const [prompt, setPrompt] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [intent, setIntent] = useState<any>(null);
  const [signature, setSignature] = useState<string>('');
  const [step, setStep] = useState(0); 

  // --- 逻辑层 ---
  const handleParse = async () => {
    if (!prompt) return;
    setIsParsing(true);
    setIntent(null);
    setStep(0);
    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, userAddress: address, currentChainId: chainId })
      });
      const data = await response.json();
      if (data.status === 'ambiguous') {
        alert(`🤖 AI 提示: ${data.message || "请明确目标代币类型"}`);
        return; 
      }
      setIntent(data);
      setStep(1); 
    } catch (error) {
      console.error(error);
      alert('AI 解析失败');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSign = async () => {
    if (!intent || !address) return;
    setIsSigning(true);
    try {
      if (chainId !== intent.sourceChainId) {
        try { await switchChainAsync({ chainId: intent.sourceChainId }); } 
        catch (e) { alert("请在钱包中确认切换网络"); setIsSigning(false); return; }
      }
      const orderDataSchema = parseAbiParameters('address, uint256, address, uint256, uint256, address');
      const encodedOrderData = encodeAbiParameters(orderDataSchema, [
        intent.inputTokenAddress as `0x${string}`, parseUnits(intent.inputAmount, 6), 
        intent.outputTokenAddress as `0x${string}`, parseUnits(intent.minOutputAmount, 18), 
        BigInt(intent.destinationChainId), intent.recipient as `0x${string}`
      ]);
      const domain = { name: 'Across', version: '1', chainId: intent.sourceChainId, verifyingContract: ORIGIN_SETTLER } as const;
      const types = {
        GaslessCrossChainOrder: [
          { name: 'originSettler', type: 'address' }, { name: 'user', type: 'address' },
          { name: 'nonce', type: 'uint256' }, { name: 'originChainId', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' }, { name: 'fillDeadline', type: 'uint32' },
          { name: 'orderDataType', type: 'bytes32' }, { name: 'orderData', type: 'bytes' },     
        ],
      } as const;
      const message = {
        originSettler: ORIGIN_SETTLER, user: address, nonce: BigInt(Date.now()), 
        originChainId: BigInt(intent.sourceChainId), openDeadline: Math.floor(Date.now() / 1000), 
        fillDeadline: Math.floor(Date.now() / 1000) + 3600, orderDataType: keccak256(toHex('CrossChainTransfer')), 
        orderData: encodedOrderData, 
      };
      const sig = await signTypedDataAsync({ domain, types, primaryType: 'GaslessCrossChainOrder', message });
      setSignature(sig);
      setStep(2); 
    } catch (error) { console.error(error); alert("签名取消"); } finally { setIsSigning(false); }
  };

  // 辅助函数：获取代币符号 (升级版：包含 USDT 和 DAI)
  const getTokenSymbol = (addr: string) => {
    if (!addr) return '???';
    const a = addr.toLowerCase();
    
    // ETH & WETH (Arb, Base, Mainnet)
    if (a.includes("eeee") || a.includes("82af") || a.includes("c02a") || a.includes("4200")) return 'ETH';
    
    // USDC (Arb, Base, Mainnet)
    if (a.includes("af88") || a.includes("8335") || a.includes("a0b8")) return 'USDC';
    
    // USDT (Arb, Base, Mainnet) - 修复点：加入 Mainnet dac1, Base fde4
    if (a.includes("fd08") || a.includes("fde4") || a.includes("dac1")) return 'USDT';
    
    // DAI (Arb, Base, Mainnet) - 修复点：加入 DAI 识别
    if (a.includes("da10") || a.includes("50c5") || a.includes("6b17")) return 'DAI';
    
    return 'TOKEN';
  };

  const getChainName = (id: number) => {
    if (id === 1) return 'Ethereum';
    if (id === 10) return 'Optimism';
    if (id === 8453) return 'Base';
    if (id === 42161) return 'Arbitrum';
    return `Chain ${id}`;
  };

  return (
    <main className="min-h-screen bg-[#050505] text-gray-100 font-sans selection:bg-blue-500/30 overflow-x-hidden">
      {/* 背景光效 */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* 顶部导航 */}
      <nav className="fixed top-0 w-full border-b border-white/5 bg-[#050505]/80 backdrop-blur-md z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-lg flex items-center justify-center font-bold text-white">I</div>
            <span className="font-bold text-xl tracking-tight">Intent Solver</span>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-mono border border-blue-500/20">BETA</span>
          </div>
          <button 
            onClick={() => open()} 
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all text-sm font-medium"
          >
            {isConnected ? (
              <><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"/> {address?.slice(0,6)}...{address?.slice(-4)}</>
            ) : (
              <><Icons.Wallet /> Connect Wallet</>
            )}
          </button>
        </div>
      </nav>

      {/* 主内容区 */}
      <div className="pt-32 pb-20 px-4 max-w-4xl mx-auto relative z-10 flex flex-col items-center">
        
        {/* Step 0: 输入面板 */}
        <div className={`w-full max-w-3xl transition-all duration-700 ease-in-out transform ${step === 0 ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10 hidden'}`}>
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-gray-500 mb-4 tracking-tight">
              What's your intent?
            </h1>
            <p className="text-gray-400 text-lg">Describe your cross-chain goal in natural language.</p>
          </div>

          <div className="group relative bg-[#111] rounded-2xl border border-white/10 shadow-2xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/50 transition-all">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-50" />
            <textarea 
              className="w-full h-40 bg-transparent p-6 text-xl text-white placeholder:text-gray-600 focus:outline-none resize-none font-mono"
              placeholder="e.g. Bridge 100 USDC from Arbitrum to Base for ETH..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="bg-white/5 p-4 flex justify-between items-center border-t border-white/5">
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Icons.Sparkles /> Powered by GPT-5.2
              </span>
              <button 
                onClick={handleParse}
                disabled={isParsing || !isConnected}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold rounded-lg transition-all flex items-center gap-2"
              >
                {isParsing ? 'Analyzing...' : <>Parse Intent <Icons.ArrowRight /></>}
              </button>
            </div>
          </div>
        </div>

        {/* Step 1: 意图确认卡片 */}
        {intent && (
          <div className={`w-full max-w-3xl transition-all duration-700 ease-out transform ${step === 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 hidden'}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm">1</span>
                Confirm Intent
              </h2>
              <button onClick={() => setStep(0)} className="text-sm text-gray-500 hover:text-white underline">Modify</button>
            </div>

            <div className="bg-[#111] rounded-2xl border border-white/10 shadow-2xl overflow-hidden relative">
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500" />
              
              <div className="p-8">
                {/* 链路信息 */}
                <div className="flex justify-between items-center mb-8">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 uppercase tracking-wider mb-1">From</span>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]"></div>
                      <span className="text-xl font-medium text-white">{getChainName(intent.sourceChainId)}</span>
                    </div>
                  </div>
                  <div className="flex-1 border-b border-dashed border-gray-700 mx-6 relative top-2 opacity-50"></div>
                  <div className="flex flex-col text-right">
                    <span className="text-xs text-gray-500 uppercase tracking-wider mb-1">To</span>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xl font-medium text-white">{getChainName(intent.destinationChainId)}</span>
                      <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                    </div>
                  </div>
                </div>

                {/* 核心金额 */}
                <div className="bg-white/5 rounded-xl p-6 mb-6 flex justify-between items-center border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-3xl md:text-4xl font-bold text-white tracking-tighter">{intent.inputAmount}</span>
                    <span className="text-sm text-gray-400 font-mono mt-1">{getTokenSymbol(intent.inputTokenAddress)}</span>
                  </div>
                  <Icons.ArrowRight />
                  <div className="flex flex-col text-right">
                    <span className="text-3xl md:text-4xl font-bold text-green-400 tracking-tighter">≈ {intent.minOutputAmount}</span>
                    <span className="text-sm text-gray-400 font-mono mt-1">{getTokenSymbol(intent.outputTokenAddress)}</span>
                  </div>
                </div>

                {/* 接收者信息 */}
                <div className="bg-blue-900/10 rounded-xl p-4 border border-blue-500/20 flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white shadow-lg">
                      <Icons.User />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-blue-400 font-bold uppercase tracking-wider flex items-center gap-2">
                        Recipient (Destination)
                        {intent.recipient.toLowerCase() !== address?.toLowerCase() && (
                          <span className="px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-[10px] border border-blue-500/30">External</span>
                        )}
                      </span>
                      <span className="font-mono text-sm text-gray-200 break-all group-hover:text-white transition-colors">
                        {intent.recipient}
                      </span>
                    </div>
                  </div>
                  <div className="text-blue-500/50"><Icons.Check /></div>
                </div>
              </div>

              {/* 底部按钮 */}
              <div className="bg-white/5 p-6 border-t border-white/5">
                <button 
                  onClick={handleSign}
                  disabled={isSigning}
                  className="w-full py-4 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(22,163,74,0.3)] transition-all transform hover:scale-[1.01] flex justify-center items-center gap-2"
                >
                  {isSigning ? 'Requesting Signature...' : 'Sign with imToken ✍️'}
                </button>
                <p className="text-center text-xs text-gray-600 mt-3">Gasless signature • EIP-712 Standard</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: 成功状态 */}
        {step === 2 && (
          <div className="w-full max-w-3xl text-center animate-fade-in">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.3)]">
              <Icons.Check />
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">Intent Submitted!</h2>
            <p className="text-gray-400 mb-8">Solver network is now executing your order.</p>
            <div className="bg-[#111] p-4 rounded-xl border border-gray-800 text-left mb-8 max-w-xl mx-auto">
              <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider">Cryptographic Proof (Signature)</p>
              <p className="text-green-500 font-mono text-xs break-all leading-relaxed">{signature}</p>
            </div>
            <button onClick={() => { setPrompt(''); setStep(0); }} className="px-6 py-2 border border-gray-700 rounded-lg text-gray-300 hover:bg-white/5 transition-all">Start New Intent</button>
          </div>
        )}

        {/* --- 底部特性网格 (2x2 布局) --- */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl opacity-80">
          
          {/* Card 1: AI */}
          <FeatureCard 
            title="Natural Language AI" 
            icon="🧠" 
            desc="Context-aware intent extraction engine." 
            items={['Ambiguity Check', 'Smart Routing', 'No-Code Interface']} 
            color="border-blue-500/20"
          />

          {/* Card 2: ENS (独立高亮) */}
          <FeatureCard 
            title="ENS Resolution" 
            icon="🦄" 
            desc="Native integration with Ethereum Name Service." 
            items={['On-chain Lookup', 'Cross-chain Mapping', 'Identity Verified']} 
            color="border-pink-500/20"
          />

          {/* Card 3: Standard */}
          <FeatureCard 
            title="ERC-7683 Standard" 
            icon="⚡" 
            desc="Fully compliant cross-chain intent structure." 
            items={['Gasless Signing', 'Solver Network', 'EIP-712 Auth']} 
            color="border-green-500/20"
          />

          {/* Card 4: Ecosystem */}
          <FeatureCard 
            title="Multi-Chain Support" 
            icon="🌐" 
            desc="Unified liquidity across major L2s." 
            items={['Arbitrum', 'Optimism', 'Base', 'Ethereum Mainnet']} 
            color="border-yellow-500/20"
          />

        </div>
      </div>
    </main>
  );
}

// 小组件：特性卡片 (增加颜色参数)
function FeatureCard({ title, icon, desc, items, color }: { title: string, icon: string, desc: string, items: string[], color: string }) {
  return (
    <div className={`p-6 rounded-xl border ${color} bg-white/[0.02] hover:bg-white/[0.05] transition-all hover:scale-[1.01]`}>
      <div className="text-3xl mb-4">{icon}</div>
      <h3 className="font-bold text-gray-100 mb-2 text-lg">{title}</h3>
      <p className="text-sm text-gray-400 mb-4 h-10">{desc}</p>
      <div className="flex flex-wrap gap-2">
        {items.map(i => (
          <span key={i} className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-md bg-white/5 text-gray-300 border border-white/10">{i}</span>
        ))}
      </div>
    </div>
  );
}