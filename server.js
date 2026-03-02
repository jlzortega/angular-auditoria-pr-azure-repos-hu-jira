const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { HttpsProxyAgent } = require('https-proxy-agent');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const corporateProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
let agent = null;

console.log('--- STARTING UNIFIED PRODUCTION SERVER ---');

if (corporateProxy) {
    console.log(`[PROXY DETECTED] Using corporate proxy: ${corporateProxy}`);
    agent = new HttpsProxyAgent(corporateProxy);
}

// 1. Proxy para JIRA
app.use(createProxyMiddleware({
    target: 'https://atlassian.net',
    changeOrigin: true,
    pathFilter: '/jira-api',
    pathRewrite: { '^/jira-api': '' },
    agent: agent,
    secure: false,
    onProxyReq: (proxyReq, req, res) => {
        const jHost = req.headers['x-jira-host'] || 'atlassian.net';
        const targetHost = jHost.replace(/^https?:\/\//, '');
        proxyReq.setHeader('host', targetHost);
        proxyReq.setHeader('Accept', 'application/json');
        proxyReq.setHeader('X-Atlassian-Token', 'no-check');
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0');
    },
    router: (req) => {
        const jHost = req.headers['x-jira-host'] || 'atlassian.net';
        return jHost.includes('://') ? jHost : `https://${jHost}`;
    }
}));

// 2. Proxy para Azure
app.use(createProxyMiddleware({
    target: 'https://dev.azure.com',
    changeOrigin: true,
    pathFilter: '/Soluciones-Corporativas',
    agent: agent,
    secure: false,
    onProxyReq: (proxyReq, req, res) => {
        proxyReq.setHeader('host', 'dev.azure.com');
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0');
    },
    onError: (err, req, res) => {
        console.error(`[AZURE PROXY_ERR]`, err.code, err.message);
        res.status(502).send('Proxy Error (Azure Connection Timeout/Failure)');
    }
}));

// 3. Servir archivos estáticos
const distPath = path.join(__dirname, 'dist', 'dashboard-azure', 'browser');
app.use(express.static(distPath));

// 4. SPA Fallback
app.use((req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Unified server running at http://localhost:${PORT}`);
    console.log(`Serving Angular from: ${distPath}`);
    console.log(`Accessible on LAN via your machine's IP address.`);
});
