'use client'

import { wagmiAdapter, projectId } from '@/app/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react' 
import { mainnet, arbitrum, base, optimism } from '@reown/appkit/networks'
import React, { type ReactNode } from 'react'
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi'

// 1. 设置查询客户端
const queryClient = new QueryClient()

if (!projectId) {
  throw new Error('Project ID is not defined')
}

// 2. 配置 AppKit (钱包连接弹窗)
const metadata = {
  name: 'Intent Hacker',
  description: 'Hackathon Demo for Intent Parsing',
  url: 'https://intent-demo.vercel.app', // 演示用，上线后改
  icons: ['https://avatars.githubusercontent.com/u/37784886']
}

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [mainnet, arbitrum, base, optimism],
  defaultNetwork: arbitrum,
  metadata: metadata,
  features: {
    analytics: true // Optional
  }
})

export default function ContextProvider({ children, cookies }: { children: ReactNode; cookies: string | null }) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies)

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}