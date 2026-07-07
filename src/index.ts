#!/usr/bin/env node
/**
 * YouTube Studio MCP Server — Exposed via Streamable HTTP
 *
 * Auth model: Dual-mode — supports both direct Bearer passthrough
 * and OAuth 2.0 Client Credentials grant.
 *
 * The Bearer token IS the user's Google OAuth refresh token.
 * The client auto-exchanges it for access tokens with caching (Gmail MCP pattern).
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
import { YouTubeStudioClient } from './api-client.js';
import { tools } from './tools.js';

function zodToJsonSchema(schema: any): any {
  return _zodToJsonSchema(schema);
}

const PORT = parseInt(process.env.PORT || '3100', 10);
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`;
const SLUG = 'youtube-studio';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = `${SERVER_BASE_URL}/authorize/callback`;
const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- OAuth token store (in-memory, ephemeral) ---
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

interface OAuthToken {
  accessKey: string; // The Google OAuth access token passed as client_secret
  expiresAt: number;
}

const oauthTokens = new Map<string, OAuthToken>();

// Cleanup expired tokens every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of oauthTokens) {
    if (now > data.expiresAt) oauthTokens.delete(token);
  }
}, 10 * 60 * 1000);

// --- Static assets (logo) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/static', express.static(path.join(__dirname, 'public')));

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'youtube-studio-mcp-http',
    version: '1.0.0',
    tools: tools.length,
    transport: 'streamable-http',
    auth: 'dual-mode',
    auth_modes: ['bearer-passthrough', 'oauth-client-credentials'],
  });
});

// --- OAuth 2.0 Discovery ---
// Claude-CLI OAuth-trap fix: OAuth Authorization Server metadata de-advertised.
// The spec discovery path /.well-known/oauth-authorization-server now 404s, so Claude CLI
// falls back to Bearer passthrough (Mode-B broker) instead of a self-hosted OAuth dance.
app.get('/_disabled/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: SERVER_BASE_URL,
    token_endpoint: `${SERVER_BASE_URL}/oauth/token`,
    revocation_endpoint: `${SERVER_BASE_URL}/oauth/revoke`,
    authorization_endpoint: `${SERVER_BASE_URL}/authorize`,
    grant_types_supported: ['client_credentials', 'authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    response_types_supported: ['token', 'code'],
    scopes_supported: YOUTUBE_SCOPES.split(' '),
    service_documentation: `https://financemcps.agenticledger.ai/${SLUG}/`,
  });
});

// --- OAuth 2.0 Token Exchange ---
app.post('/oauth/token', (req, res) => {
  const { grant_type, client_id, client_secret } = req.body;

  if (grant_type !== 'client_credentials') {
    res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only client_credentials is supported' });
    return;
  }

  if (client_id !== SLUG) {
    res.status(400).json({ error: 'invalid_client', error_description: `client_id must be "${SLUG}"` });
    return;
  }

  if (!client_secret) {
    res.status(400).json({ error: 'invalid_request', error_description: 'client_secret is required (pass your Google OAuth access/refresh token)' });
    return;
  }

  const accessToken = `mcp_${randomUUID().replace(/-/g, '')}`;
  const expiresIn = TOKEN_TTL_MS / 1000;

  oauthTokens.set(accessToken, {
    accessKey: client_secret, // The Google OAuth token
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  res.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
  });
});

// --- OAuth 2.0 Token Revocation ---
app.post('/oauth/revoke', (req, res) => {
  const { token } = req.body;
  if (token) oauthTokens.delete(token);
  res.status(200).json({ status: 'revoked' });
});

// --- Phase 7.7: Google OAuth Authorization Flow ---

// GET /authorize — show branded authorization page
app.get('/authorize', (_req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(500).json({ error: 'Google OAuth not configured — missing GOOGLE_CLIENT_ID env var' });
    return;
  }
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&scope=${encodeURIComponent(YOUTUBE_SCOPES)}&access_type=offline&prompt=consent&state=${randomUUID()}`;
  res.send(AUTHORIZE_HTML.replace('{{AUTH_URL}}', authUrl));
});

// GET /authorize/callback — exchange code for tokens
app.get('/authorize/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    res.status(400).send(`<html><body><h1>Authorization Failed</h1><p>${error || 'No code received'}</p></body></html>`);
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: GOOGLE_REDIRECT_URI,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
      }),
    });
    const data = await tokenRes.json() as any;

    if (data.error) {
      res.status(400).send(`<html><body><h1>Token Exchange Failed</h1><p>${data.error_description || data.error}</p></body></html>`);
      return;
    }

    res.send(SUCCESS_HTML
      .replace('{{ACCESS_TOKEN}}', data.access_token || '')
      .replace('{{REFRESH_TOKEN}}', data.refresh_token || 'Not provided — you may already have one')
      .replace('{{EXPIRES_IN}}', String(data.expires_in || 3600))
    );
  } catch (err: any) {
    res.status(500).send(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
  }
});

// --- Smart root route: content negotiation ---
app.get('/', (req, res) => {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    res.send(BRANDED_LANDING_HTML);
    return;
  }
  res.json({
    name: 'YouTube Studio MCP Server',
    provider: 'AgenticLedger',
    version: '1.0.0',
    description: 'Manage YouTube channels — upload videos, update metadata, manage playlists, read analytics, moderate comments. Requires Google OAuth access token.',
    mcpEndpoint: '/mcp',
    transport: 'streamable-http',
    tools: tools.length,
    auth: {
      type: 'dual-mode',
      description: 'Pass your Google OAuth access token as the Bearer token. The token is injected into every tool call as accessToken.',
      modes: {
        bearer: {
          description: 'Pass your Google OAuth access token directly',
          header: 'Authorization: Bearer <google-oauth-access-token>',
        },
        oauth: {
          description: 'Exchange your Google token for a time-limited MCP token',
          token_endpoint: `${SERVER_BASE_URL}/oauth/token`,
          client_id: SLUG,
          client_secret: '<your-google-oauth-access-token>',
          grant_type: 'client_credentials',
        },
      },
    },
    authorize: `${SERVER_BASE_URL}/authorize`,
    configTemplate: {
      mcpServers: {
        'youtube-studio': {
          url: `${SERVER_BASE_URL}/mcp`,
          headers: { Authorization: 'Bearer <your-google-oauth-access-token>' }
        }
      }
    },
    links: {
      health: '/health',
      authorize: '/authorize',
      documentation: `https://financemcps.agenticledger.ai/${SLUG}/`,
      oauth_discovery: '/.well-known/oauth-authorization-server',
    }
  });
});

// --- Auth resolver ---
function resolveRefreshToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;

  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  // Mode 1: OAuth-issued token — look up the stored Google token
  if (token.startsWith('mcp_')) {
    const entry = oauthTokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      oauthTokens.delete(token);
      return null;
    }
    return entry.accessKey;
  }

  // Mode 2: Raw Bearer token — IS the Google OAuth refresh token
  return token;
}

// --- Per-session state ---
interface SessionState {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, SessionState>();

function createMCPServer(client: YouTubeStudioClient): Server {
  const server = new Server(
    { name: 'youtube-studio-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await tool.handler(client, args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// --- Streamable HTTP endpoint ---
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — requires Bearer token (Google OAuth refresh token)
  const refreshToken = resolveRefreshToken(req);
  if (!refreshToken) {
    res.status(401).json({
      error: 'Missing or invalid Authorization header.',
      note: 'Pass your Google OAuth refresh token as the Bearer token. Visit /authorize to get one.',
      modes: {
        bearer: 'Authorization: Bearer <google-oauth-refresh-token>',
        oauth: `POST ${SERVER_BASE_URL}/oauth/token with client_id=${SLUG}&client_secret=<google-refresh-token>&grant_type=client_credentials`,
        authorize: `${SERVER_BASE_URL}/authorize`,
      },
    });
    return;
  }

  const client = new YouTubeStudioClient(refreshToken, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createMCPServer(client);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      console.log(`[mcp] Session closed: ${sid}`);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  const newSessionId = transport.sessionId;
  if (newSessionId) {
    sessions.set(newSessionId, { server, transport });
    console.log(`[mcp] New session: ${newSessionId}`);
  }
});

// GET /mcp — SSE stream for server notifications
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session. Send initialization POST first.' });
    return;
  }
  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// DELETE /mcp — close session
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { transport, server } = sessions.get(sessionId)!;
  await transport.close();
  await server.close();
  sessions.delete(sessionId);
  res.status(200).json({ status: 'session closed' });
});

// ==================== BRANDED HTML PAGES ====================

const AUTHORIZE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize YouTube Studio MCP — AgenticLedger</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#2563EB;--primary-dark:#1D4ED8;--primary-light:#DBEAFE;--primary-50:#EFF6FF;--fg:#0F172A;--muted:#64748B;--surface:#F8FAFC;--border:#E2E8F0;--success:#10B981;--success-light:#D1FAE5;--red:#DC2626;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'DM Sans',sans-serif;color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--surface);background-image:linear-gradient(135deg,var(--primary-50) 0%,var(--surface) 50%,#FEF2F2 100%);}
    .card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:40px;max-width:500px;width:100%;margin:20px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);}
    .header{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border);}
    .header img{height:36px;}
    .header span{font-size:18px;font-weight:700;color:var(--fg);}
    .desc{font-size:14px;color:var(--muted);line-height:1.6;margin-bottom:24px;}
    .scope-list{background:var(--primary-50);border:1px solid var(--primary-light);border-radius:10px;padding:16px;margin-bottom:24px;}
    .scope-list h4{font-size:13px;font-weight:600;color:var(--fg);margin-bottom:8px;}
    .scope-list ul{list-style:none;padding:0;}
    .scope-list li{font-size:12px;color:var(--muted);padding:4px 0;padding-left:16px;position:relative;}
    .scope-list li::before{content:'\\2713';position:absolute;left:0;color:var(--success);font-weight:bold;}
    .auth-btn{display:block;width:100%;padding:14px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;transition:background .15s;}
    .auth-btn:hover{background:var(--primary-dark);}
    .footer{padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--muted);margin-top:24px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><img src="/static/logo.png" alt="AgenticLedger"><span>YouTube Studio MCP</span></div>
    <p class="desc">Authorize this MCP server to manage your YouTube channel. You will be redirected to Google to grant access. Your tokens are shown to you — we do not store them.</p>
    <div class="scope-list">
      <h4>Permissions Requested</h4>
      <ul>
        <li>Manage your YouTube videos (upload, edit, delete)</li>
        <li>Manage playlists</li>
        <li>Read channel analytics</li>
        <li>Manage comments</li>
      </ul>
    </div>
    <a href="{{AUTH_URL}}" class="auth-btn">Authorize with Google</a>
    <div class="footer">Your credentials are never stored on this server.</div>
  </div>
</body>
</html>`;

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Complete — YouTube Studio MCP</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#2563EB;--primary-dark:#1D4ED8;--primary-light:#DBEAFE;--primary-50:#EFF6FF;--fg:#0F172A;--muted:#64748B;--surface:#F8FAFC;--border:#E2E8F0;--success:#10B981;--success-light:#D1FAE5;--warn:#F59E0B;--warn-light:#FEF3C7;--warn-border:#FDE68A;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'DM Sans',sans-serif;color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--surface);background-image:linear-gradient(135deg,var(--success-light) 0%,var(--surface) 50%,var(--primary-50) 100%);}
    .card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:40px;max-width:620px;width:100%;margin:20px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);}
    .header{display:flex;align-items:center;gap:14px;margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--border);}
    .header img{height:36px;}
    .header span{font-size:18px;font-weight:700;color:var(--fg);}
    .success-badge{display:inline-flex;align-items:center;gap:6px;background:var(--success-light);border:1px solid #A7F3D0;border-radius:20px;padding:6px 14px;font-size:13px;font-weight:600;color:#065F46;margin-bottom:20px;}
    .success-badge::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--success);}
    .token-section{margin-bottom:20px;}
    .token-label{font-size:13px;font-weight:600;color:var(--fg);margin-bottom:6px;}
    .token-box{position:relative;background:#1E293B;border-radius:10px;padding:14px 50px 14px 14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#E2E8F0;word-break:break-all;line-height:1.5;}
    .token-copy{position:absolute;top:8px;right:8px;background:rgba(255,255,255,.1);color:#CBD5E1;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;transition:all .15s;}
    .token-copy:hover{background:rgba(255,255,255,.2);color:#fff;}
    .token-copy.copied{background:rgba(16,185,129,.3);color:#86EFAC;}
    .warn-box{background:var(--warn-light);border:1px solid var(--warn-border);border-radius:10px;padding:12px 16px;font-size:13px;color:#92400E;margin-bottom:20px;line-height:1.5;}
    .section-title{font-size:14px;font-weight:600;color:var(--fg);margin:24px 0 10px;}
    .config-block{position:relative;}
    .config-pre{background:#1E293B;border-radius:12px;padding:20px;overflow-x:auto;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;margin:0 0 20px;color:#E2E8F0;white-space:pre;}
    .config-copy{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.1);color:#CBD5E1;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;transition:all .15s;}
    .config-copy:hover{background:rgba(255,255,255,.2);color:#fff;}
    .config-copy.copied{background:rgba(16,185,129,.3);color:#86EFAC;}
    .info-row{font-size:12px;color:var(--muted);margin-bottom:4px;}
    .footer{padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--muted);margin-top:20px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><img src="/static/logo.png" alt="AgenticLedger"><span>YouTube Studio MCP</span></div>
    <div class="success-badge">Authorization Successful</div>

    <div class="token-section">
      <div class="token-label">Access Token (expires in {{EXPIRES_IN}}s)</div>
      <div class="token-box" id="accessToken">{{ACCESS_TOKEN}}<button class="token-copy" onclick="copyEl('accessToken',this)">Copy</button></div>
    </div>

    <div class="token-section">
      <div class="token-label">Refresh Token (long-lived — use as Bearer for permanent access)</div>
      <div class="token-box" id="refreshToken">{{REFRESH_TOKEN}}<button class="token-copy" onclick="copyEl('refreshToken',this)">Copy</button></div>
    </div>

    <div class="warn-box">Keep your refresh token secret. Anyone with it can manage your YouTube channel. The refresh token can be used as your Bearer token for permanent MCP access.</div>

    <div class="section-title">MCP Configuration (Claude Desktop / Claude Code)</div>
    <p class="info-row">Add to your <strong>claude_desktop_config.json</strong> or <strong>.mcp.json</strong>:</p>
    <div class="config-block">
      <button class="config-copy" onclick="copyBlock('configBlock',this)">Copy</button>
      <pre class="config-pre" id="configBlock"></pre>
    </div>

    <div class="footer">Powered by AgenticLedger &middot; Tokens are displayed only — not stored on server.</div>
  </div>
  <script>
    function copyEl(id,btn){
      var el=document.getElementById(id);
      var text=el.textContent.replace('Copy','').trim();
      navigator.clipboard.writeText(text).then(function(){
        btn.textContent='Copied!';btn.classList.add('copied');
        setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
      });
    }
    function copyBlock(id,btn){
      var text=document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(function(){
        btn.textContent='Copied!';btn.classList.add('copied');
        setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
      });
    }
    (function(){
      var rt=document.getElementById('refreshToken').textContent.replace('Copy','').trim();
      var token=rt.startsWith('Not provided')?'<your-refresh-token>':rt;
      var config=JSON.stringify({mcpServers:{"youtube-studio":{url:"${SERVER_BASE_URL}/mcp",headers:{Authorization:"Bearer "+token}}}},null,2);
      document.getElementById('configBlock').textContent=config;
    })();
  </script>
</body>
</html>`;

const BRANDED_LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube Studio MCP Server — AgenticLedger</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#2563EB;--primary-dark:#1D4ED8;--primary-light:#DBEAFE;--primary-50:#EFF6FF;--fg:#0F172A;--muted:#64748B;--surface:#F8FAFC;--border:#E2E8F0;--success:#10B981;--success-light:#D1FAE5;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'DM Sans',sans-serif;color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--surface);background-image:linear-gradient(135deg,var(--primary-50) 0%,var(--surface) 50%,#FEF2F2 100%);background-size:400% 400%;animation:gradientShift 15s ease infinite;}
    @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    .card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:40px;max-width:560px;width:100%;margin:20px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);animation:slideUp .5s ease-out;}
    @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .header{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border);}
    .header img{height:36px;}
    .header span{font-size:18px;font-weight:700;color:var(--fg);}
    .status-badge{display:inline-flex;align-items:center;gap:6px;background:var(--success-light);border:1px solid #A7F3D0;border-radius:20px;padding:6px 14px;font-size:13px;font-weight:600;color:#065F46;margin-bottom:20px;}
    .status-badge::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--success);animation:pulse 2s infinite;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .info-grid{display:grid;gap:12px;margin-bottom:24px;}
    .info-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--primary-50);border-radius:10px;font-size:13px;}
    .info-row .label{color:var(--muted);font-weight:500;}
    .info-row .value{color:var(--fg);font-weight:600;font-family:'JetBrains Mono',monospace;font-size:12px;}
    .note-box{background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:12px 16px;font-size:13px;color:#92400E;margin-bottom:24px;line-height:1.5;}
    .section-title{font-size:14px;font-weight:600;color:var(--fg);margin:24px 0 10px;display:flex;align-items:center;gap:8px;}
    .config-block{position:relative;}
    .config-pre{background:#1E293B;border-radius:12px;padding:20px;overflow-x:auto;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;margin:0 0 24px;color:#E2E8F0;white-space:pre;}
    .config-copy{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.1);color:#CBD5E1;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 12px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;transition:all .15s;}
    .config-copy:hover{background:rgba(255,255,255,.2);color:#fff;}
    .config-copy.copied{background:rgba(16,185,129,.3);color:#86EFAC;}
    .auth-link{display:inline-block;margin-bottom:24px;padding:10px 20px;background:var(--primary);color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;transition:background .15s;}
    .auth-link:hover{background:var(--primary-dark);}
    .trust{display:flex;gap:16px;flex-wrap:wrap;padding-top:20px;border-top:1px solid var(--border);}
    .trust-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);}
    .trust-item svg{width:14px;height:14px;color:var(--success);}
    .footer{padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--muted);margin-top:20px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><img src="/static/logo.png" alt="AgenticLedger"><span>YouTube Studio MCP</span></div>
    <div class="status-badge">Server Online</div>
    <div class="info-grid">
      <div class="info-row"><span class="label">Tools</span><span class="value">${tools.length}</span></div>
      <div class="info-row"><span class="label">Transport</span><span class="value">Streamable HTTP</span></div>
      <div class="info-row"><span class="label">Auth</span><span class="value">Google OAuth (Bearer)</span></div>
    </div>

    <div class="note-box">This server requires a Google OAuth access token. Use the authorize button below to get one, or pass an existing token as the Bearer header.</div>

    <a href="/authorize" class="auth-link">Get Google OAuth Token</a>

    <div class="section-title">MCP Configuration (Claude Desktop / Claude Code)</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">Add to your <strong style="color:var(--fg)">claude_desktop_config.json</strong> or <strong style="color:var(--fg)">.mcp.json</strong>:</p>
    <div class="config-block">
      <button class="config-copy" onclick="copyBlock('configBlock',this)">Copy</button>
      <pre class="config-pre" id="configBlock"></pre>
    </div>

    <div class="section-title">OAuth Configuration (Claude.ai / Agent Platforms)</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">For platforms that require OAuth Client Credentials:</p>
    <div class="config-block">
      <button class="config-copy" onclick="copyBlock('oauthBlock',this)">Copy</button>
      <pre class="config-pre" id="oauthBlock"></pre>
    </div>

    <div class="trust">
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>No credentials stored</div>
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>Token injected per-call</div>
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>Official YouTube API</div>
    </div>
    <div class="footer">Powered by AgenticLedger &middot; <a href="https://financemcps.agenticledger.ai/" target="_blank" style="color:var(--primary);text-decoration:none">Explore Other MCPs</a></div>
  </div>
  <script>
    function updateConfig(){
      var config=JSON.stringify({mcpServers:{"youtube-studio":{url:"${SERVER_BASE_URL}/mcp",headers:{Authorization:"Bearer <your-google-oauth-token>"}}}},null,2);
      document.getElementById('configBlock').textContent=config;
      var oauth="Token URL:      ${SERVER_BASE_URL}/oauth/token\\nClient ID:      youtube-studio\\nClient Secret:  <your-google-oauth-token>\\nGrant Type:     client_credentials";
      document.getElementById('oauthBlock').textContent=oauth;
    }
    function copyBlock(id,btn){
      var text=document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(function(){
        btn.textContent='Copied!';btn.classList.add('copied');
        setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
      });
    }
    updateConfig();
  </script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log(`YouTube Studio MCP HTTP Server running on port ${PORT}`);
  console.log(`  MCP endpoint:    ${SERVER_BASE_URL}/mcp`);
  console.log(`  OAuth token:     ${SERVER_BASE_URL}/oauth/token`);
  console.log(`  OAuth discovery: ${SERVER_BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`  Authorize:       ${SERVER_BASE_URL}/authorize`);
  console.log(`  Health check:    ${SERVER_BASE_URL}/health`);
  console.log(`  Landing page:    ${SERVER_BASE_URL}/`);
  console.log(`  Tools:           ${tools.length}`);
  console.log(`  Transport:       Streamable HTTP`);
  console.log(`  Auth:            Dual-mode (Bearer passthrough + OAuth Client Credentials)`);
});
