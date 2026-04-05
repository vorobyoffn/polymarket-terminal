// This script is loaded via --require BEFORE the main app
// It patches axios to route CLOB requests through the residential proxy

const proxyUrl = process.env.CLOB_PROXY_URL;
if (proxyUrl) {
  console.log(`[proxy-preload] Setting up proxy: ${proxyUrl.replace(/:[^:]+@/, ':***@')}`);

  // Set env vars that axios respects
  process.env.https_proxy = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.HTTP_PROXY = proxyUrl;

  // Also directly patch axios when it loads
  const Module = await import('node:module');
  const origRequire = Module.default.prototype.require;

  Module.default.prototype.require = function patchedRequire(id) {
    const result = origRequire.apply(this, arguments);

    if (id === 'axios' && result?.default?.defaults && !result._proxyPatched) {
      result._proxyPatched = true;
      import('https-proxy-agent').then(({ HttpsProxyAgent }) => {
        const agent = new HttpsProxyAgent(proxyUrl);
        result.default.defaults.httpsAgent = agent;
        result.default.defaults.httpAgent = agent;
        result.default.defaults.proxy = false;
        console.log('[proxy-preload] ✅ Axios patched with proxy agent');
      }).catch(e => {
        console.error('[proxy-preload] Failed to patch axios:', e.message);
      });
    }

    return result;
  };
}
