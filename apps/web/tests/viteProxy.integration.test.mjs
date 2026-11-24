import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { test } from 'node:test'

test('Vite proxies API requests to the configured API port', async () => {
  let receivedUrl
  const apiServer = createHttpServer((request, response) => {
    receivedUrl = request.url
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ service: 'api' }))
  })

  await new Promise((resolve, reject) => {
    apiServer.once('error', reject)
    apiServer.listen(0, '127.0.0.1', resolve)
  })

  const apiPort = apiServer.address().port
  const previousPort = process.env.PORT
  const previousApiPort = process.env.API_PORT
  const previousProxyTarget = process.env.API_PROXY_TARGET
  const previousLocalOnly = process.env.WATCHTUBE_LOCAL_ONLY
  const previousApiBaseUrl = process.env.VITE_API_BASE_URL
  process.env.PORT = '5173'
  process.env.API_PORT = String(apiPort)
  process.env.API_PROXY_TARGET = 'https://api.example.invalid'
  process.env.VITE_API_BASE_URL = 'https://api.example.invalid'
  process.env.WATCHTUBE_LOCAL_ONLY = '1'

  let viteServer
  try {
    viteServer = await createViteServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: true },
    })
    await viteServer.listen()

    const address = viteServer.httpServer.address()
    assert.ok(address && typeof address !== 'string')
    const healthResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`)
    assert.equal(healthResponse.status, 200)
    assert.deepEqual(await healthResponse.json(), { service: 'api' })
    assert.equal(receivedUrl, '/api/v1/health')

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/videos?page=2`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { service: 'api' })
    assert.equal(receivedUrl, '/api/v1/videos?page=2')

    const { apiClient } = await viteServer.ssrLoadModule('/src/api/apiClient.ts')
    assert.equal(apiClient.defaults.baseURL, undefined)
  } finally {
    await viteServer?.close()
    if (previousPort === undefined) delete process.env.PORT
    else process.env.PORT = previousPort
    if (previousApiPort === undefined) delete process.env.API_PORT
    else process.env.API_PORT = previousApiPort
    if (previousProxyTarget === undefined) delete process.env.API_PROXY_TARGET
    else process.env.API_PROXY_TARGET = previousProxyTarget
    if (previousApiBaseUrl === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = previousApiBaseUrl
    if (previousLocalOnly === undefined) delete process.env.WATCHTUBE_LOCAL_ONLY
    else process.env.WATCHTUBE_LOCAL_ONLY = previousLocalOnly
    await new Promise((resolve, reject) => {
      apiServer.close((error) => error ? reject(error) : resolve())
    })
  }
})

test('Vite does not use the web PORT as the API port', async () => {
  const previousPort = process.env.PORT
  const previousApiPort = process.env.API_PORT
  const previousProxyTarget = process.env.API_PROXY_TARGET
  const previousLocalOnly = process.env.WATCHTUBE_LOCAL_ONLY
  process.env.PORT = '5173'
  delete process.env.API_PORT
  delete process.env.API_PROXY_TARGET
  delete process.env.WATCHTUBE_LOCAL_ONLY

  let viteServer
  try {
    let apiPort
    for (const filename of ['.env', '.env.local', '.env.development', '.env.development.local']) {
      const path = resolve(fileURLToPath(new URL('../..', import.meta.url)), 'api', filename)
      if (existsSync(path)) {
        const configuredPort = parseEnv(readFileSync(path, 'utf8')).API_PORT
        if (configuredPort) apiPort = configuredPort
      }
    }

    viteServer = await createViteServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
    })

    assert.equal(
      viteServer.config.server.proxy['/api'].target,
      `http://127.0.0.1:${apiPort || '3001'}`,
    )
  } finally {
    await viteServer?.close()
    if (previousPort === undefined) delete process.env.PORT
    else process.env.PORT = previousPort
    if (previousApiPort === undefined) delete process.env.API_PORT
    else process.env.API_PORT = previousApiPort
    if (previousProxyTarget === undefined) delete process.env.API_PROXY_TARGET
    else process.env.API_PROXY_TARGET = previousProxyTarget
    if (previousLocalOnly === undefined) delete process.env.WATCHTUBE_LOCAL_ONLY
    else process.env.WATCHTUBE_LOCAL_ONLY = previousLocalOnly
  }
})

test('Vite normalizes localhost API overrides to IPv4 and preserves API paths', async () => {
  let receivedUrl
  const apiServer = createHttpServer((request, response) => {
    receivedUrl = request.url
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ service: 'api' }))
  })

  await new Promise((resolve, reject) => {
    apiServer.once('error', reject)
    apiServer.listen(0, '127.0.0.1', resolve)
  })

  const apiPort = apiServer.address().port
  const previousPort = process.env.PORT
  const previousApiPort = process.env.API_PORT
  const previousProxyTarget = process.env.API_PROXY_TARGET
  const previousLocalOnly = process.env.WATCHTUBE_LOCAL_ONLY
  process.env.PORT = '5173'
  process.env.API_PORT = String(apiPort)
  process.env.API_PROXY_TARGET = `http://localhost:${apiPort}`
  delete process.env.WATCHTUBE_LOCAL_ONLY

  let viteServer
  try {
    viteServer = await createViteServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
    })
    await viteServer.listen()

    const address = viteServer.httpServer.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/me`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { service: 'api' })
    assert.equal(receivedUrl, '/api/v1/auth/me')
  } finally {
    await viteServer?.close()
    if (previousPort === undefined) delete process.env.PORT
    else process.env.PORT = previousPort
    if (previousApiPort === undefined) delete process.env.API_PORT
    else process.env.API_PORT = previousApiPort
    if (previousProxyTarget === undefined) delete process.env.API_PROXY_TARGET
    else process.env.API_PROXY_TARGET = previousProxyTarget
    if (previousLocalOnly === undefined) delete process.env.WATCHTUBE_LOCAL_ONLY
    else process.env.WATCHTUBE_LOCAL_ONLY = previousLocalOnly
    await new Promise((resolve, reject) => {
      apiServer.close((error) => error ? reject(error) : resolve())
    })
  }
})

test('Vite rejects a non-loopback API proxy target in normal development mode', async () => {
  const previousProxyTarget = process.env.API_PROXY_TARGET
  const previousLocalOnly = process.env.WATCHTUBE_LOCAL_ONLY
  process.env.API_PROXY_TARGET = 'https://api.example.invalid'
  delete process.env.WATCHTUBE_LOCAL_ONLY

  try {
    await assert.rejects(
      createViteServer({
        configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
        root: fileURLToPath(new URL('..', import.meta.url)),
        logLevel: 'silent',
      }),
      /loopback API_PROXY_TARGET/,
    )
  } finally {
    if (previousProxyTarget === undefined) delete process.env.API_PROXY_TARGET
    else process.env.API_PROXY_TARGET = previousProxyTarget
    if (previousLocalOnly === undefined) delete process.env.WATCHTUBE_LOCAL_ONLY
    else process.env.WATCHTUBE_LOCAL_ONLY = previousLocalOnly
  }
})

test('local Vite reports an API gateway failure when its loopback API is unavailable', async () => {
  const reservation = createHttpServer()
  await new Promise((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const apiPort = reservation.address().port
  await new Promise((resolve, reject) => {
    reservation.close((error) => error ? reject(error) : resolve())
  })

  const previousApiPort = process.env.API_PORT
  const previousProxyTarget = process.env.API_PROXY_TARGET
  const previousLocalOnly = process.env.WATCHTUBE_LOCAL_ONLY
  const previousApiBaseUrl = process.env.VITE_API_BASE_URL
  process.env.API_PORT = String(apiPort)
  process.env.API_PROXY_TARGET = 'https://api.example.invalid'
  process.env.VITE_API_BASE_URL = 'https://api.example.invalid'
  process.env.WATCHTUBE_LOCAL_ONLY = '1'

  let viteServer
  try {
    viteServer = await createViteServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
    })
    await viteServer.listen()

    const address = viteServer.httpServer.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/feed/trending`)
    assert.equal(response.status, 502)

    const { apiClient, getApiErrorMessage } = await viteServer.ssrLoadModule('/src/api/apiClient.ts')
    assert.equal(apiClient.defaults.baseURL, undefined)
    assert.match(
      getApiErrorMessage({ isAxiosError: true, response: { status: response.status } }, 'fallback'),
      /WatchTube API could not be reached/,
    )
  } finally {
    await viteServer?.close()
    if (previousApiPort === undefined) delete process.env.API_PORT
    else process.env.API_PORT = previousApiPort
    if (previousProxyTarget === undefined) delete process.env.API_PROXY_TARGET
    else process.env.API_PROXY_TARGET = previousProxyTarget
    if (previousApiBaseUrl === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = previousApiBaseUrl
    if (previousLocalOnly === undefined) delete process.env.WATCHTUBE_LOCAL_ONLY
    else process.env.WATCHTUBE_LOCAL_ONLY = previousLocalOnly
  }
})
