import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const monorepoRoot = resolve(process.cwd(), '..', '..')
  const localOnly = process.env.WATCHTUBE_LOCAL_ONLY === '1'
  const readRuntimeEnv = (directory: string) => {
    const values: Record<string, string> = {}
    for (const filename of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
      const path = resolve(directory, filename)
      if (!existsSync(path)) continue
      Object.assign(values, parseEnv(readFileSync(path, 'utf8')))
    }
    return values
  }

  const readLocalApiPort = () => {
    let apiPort: string | undefined
    for (const filename of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
      const path = resolve(monorepoRoot, 'apps/api', filename)
      if (!existsSync(path)) continue
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = /^\s*API_PORT\s*=\s*['"]?(\d+)['"]?\s*(?:#.*)?$/.exec(line)
        if (match) apiPort = match[1]
      }
    }
    return apiPort
  }

  const apiEnv = localOnly ? {} : readRuntimeEnv(resolve(monorepoRoot, 'apps/api'))
  const webEnv = localOnly ? {} : readRuntimeEnv(process.cwd())
  const apiPort = localOnly
    ? process.env.API_PORT || readLocalApiPort() || '3001'
    : process.env.API_PORT || apiEnv.API_PORT || '3001'
  if (!/^\d+$/.test(apiPort) || Number(apiPort) < 1 || Number(apiPort) > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.')
  }
  const proxyTarget = localOnly
    ? `http://127.0.0.1:${apiPort}`
    : process.env.API_PROXY_TARGET
      || webEnv.API_PROXY_TARGET
      || apiEnv.API_PROXY_TARGET
      || `http://127.0.0.1:${apiPort}`
  let resolvedProxyTarget = proxyTarget

  if (!localOnly && mode === 'development' && process.env.WATCHTUBE_ALLOW_EXTERNAL_SERVICES !== '1') {
    let proxyUrl: URL
    try {
      proxyUrl = new URL(proxyTarget)
    } catch {
      throw new Error('API_PROXY_TARGET must be a valid URL.')
    }
    const hostname = proxyUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (
      !['http:', 'https:'].includes(proxyUrl.protocol)
      || !['localhost', '127.0.0.1', '::1'].includes(hostname)
    ) {
      throw new Error('Local Vite development requires a loopback API_PROXY_TARGET.');
    }
    if (hostname === 'localhost' || hostname === '::1') {
      proxyUrl.hostname = '127.0.0.1'
      resolvedProxyTarget = proxyUrl.toString().replace(/\/$/, '')
    }
  }

  return {
    plugins: [react()],
    ...(localOnly ? { define: { 'import.meta.env.VITE_API_BASE_URL': '""' } } : {}),
    server: {
      proxy: {
        '/api': {
          target: resolvedProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
