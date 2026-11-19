import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
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
