# MCP Expose Checklist — YouTube Studio

## Server Info
- **Source MCP:** /Users/oreph/Desktop/APPs/financestackmcps/YouTubeStudioMCP/mcp-server/
- **Service Name:** youtube-studio
- **API Client Class:** YouTubeStudioClient (stateless — accessToken passed per-call)
- **Constructor Args:** none (token injected into tool args)
- **Tool Count:** 18
- **Target Directory:** /Users/oreph/Desktop/APPs/financestackmcps/General/Exposed/youtube-studio-mcp-http/
- **Started:** 2026-05-25

## Phase 1: Read Source
- [x] Read api-client.ts — stateless client, each method takes accessToken as first param
- [x] Read tools.ts — 18 tools, all require accessToken in args
- [x] Read index.ts — stdio transport
- [x] Read package.json — googleapis, google-auth-library deps
- [x] Read tsconfig.json — ES2022, ESNext modules

## Phase 2: Scaffold
- [x] Created target directory
- [x] Created package.json
- [x] Created tsconfig.json
- [x] Created .gitignore
- [x] Created .env.example
- [x] Copied api-client.ts (unchanged)
- [x] Copied tools.ts (unchanged)
- [x] Copied logo.png from youtube-transcript-mcp-http
- [x] Created index.ts with Streamable HTTP transport + dual-mode auth
- [x] Auth model: Bearer = Google OAuth token, injected into tool args as accessToken
- [x] Phase 7.7: Google OAuth /authorize and /authorize/callback routes
- [x] Branded landing page, authorize page, success page

## Phase 3: Build & Local Test
- [x] npm install
- [x] npx tsc — 0 errors

## Phase 4: GitHub
- [x] git init + commit
- [x] Created repo: agenticledger/youtube-studio-mcp-http
- [x] Pushed to main branch

## Phase 5: Railway Deploy
- [ ] Railway API token expired — needs refresh
- [ ] Create service "youtube-studio-mcp" in FinanceMCPs project
- [ ] Set env vars: PORT=3100
- [ ] Connect GitHub repo: agenticledger/youtube-studio-mcp-http, branch: main
- [ ] Wait for deployment SUCCESS
- [ ] Create public railway domain
- [ ] Create custom domain: youtubestudiomcp.agenticledger.ai
- [ ] Set SERVER_BASE_URL=https://youtubestudiomcp.agenticledger.ai
- [ ] Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (optional, for /authorize flow)

## Phase 5.5: DNS (Namecheap)
- [ ] Get verification token from Railway
- [ ] Add CNAME: youtubestudiomcp -> (railway domain)
- [ ] Add TXT: _railway-verify.youtubestudiomcp -> railway-verify=(token)
- [ ] Verify custom domain on Railway

## Phase 6: End-to-End Tests
- [ ] GET / returns JSON self-description
- [ ] /health returns status
- [ ] /.well-known/oauth-authorization-server returns discovery
- [ ] POST /mcp without auth returns 401
- [ ] Bearer passthrough works (Google OAuth token)
- [ ] OAuth client_credentials exchange works
- [ ] /authorize page renders
