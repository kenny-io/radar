// Central env access. Every external integration reads its credentials here.
// RADAR_DEV_STUBS=1 swaps external providers for deterministic local stubs (development and automated tests only).
const e = process.env;
export const env = {
  appUrl: (e.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  secretKey: e.RADAR_SECRET_KEY || '',
  devStubs: e.RADAR_DEV_STUBS === '1',
  isProd: e.NODE_ENV === 'production',
  // Auth
  googleClientId: e.GOOGLE_CLIENT_ID || '',
  googleClientSecret: e.GOOGLE_CLIENT_SECRET || '',
  // AI providers (Radar's own models)
  anthropicKey: e.ANTHROPIC_API_KEY || '',
  openaiKey: e.OPENAI_API_KEY || '',
  xaiKey: e.XAI_API_KEY || '',
  // AI visibility engines (measurement targets)
  perplexityKey: e.PERPLEXITY_API_KEY || '',
  geminiKey: e.GEMINI_API_KEY || '',
  // AI visibility engine model ids (official APIs; override per deployment)
  visChatgptModel: e.VIS_CHATGPT_MODEL || 'gpt-6-sol',
  visPerplexityModel: e.VIS_PERPLEXITY_MODEL || 'sonar-pro',
  visGeminiModel: e.VIS_GEMINI_MODEL || 'gemini-2.5-flash',
  visClaudeModel: e.VIS_CLAUDE_MODEL || 'claude-sonnet-5-5',
  visGrokModel: e.VIS_GROK_MODEL || 'grok-4.7',
  // Data providers
  dataforseoLogin: e.DATAFORSEO_LOGIN || '',
  dataforseoPassword: e.DATAFORSEO_PASSWORD || '',
  youtubeKey: e.YOUTUBE_API_KEY || '',
  openPageRankKey: e.OPENPAGERANK_API_KEY || '',
  // Social sources (Daily Brief)
  redditClientId: e.REDDIT_CLIENT_ID || '',
  redditClientSecret: e.REDDIT_CLIENT_SECRET || '',
  redditUserAgent: e.REDDIT_USER_AGENT || 'web:radar:1.0 (by /u/radar)',
  xBearer: e.X_BEARER_TOKEN || '',
  // Blog connectors (OAuth apps)
  webflowClientId: e.WEBFLOW_CLIENT_ID || '', webflowClientSecret: e.WEBFLOW_CLIENT_SECRET || '',
  notionClientId: e.NOTION_CLIENT_ID || '', notionClientSecret: e.NOTION_CLIENT_SECRET || '',
  wixClientId: e.WIX_CLIENT_ID || '', wixClientSecret: e.WIX_CLIENT_SECRET || '',
  shopifyClientId: e.SHOPIFY_CLIENT_ID || '', shopifyClientSecret: e.SHOPIFY_CLIENT_SECRET || '',
  wpcomClientId: e.WPCOM_CLIENT_ID || '', wpcomClientSecret: e.WPCOM_CLIENT_SECRET || '',
  githubClientId: e.GITHUB_CLIENT_ID || '', githubClientSecret: e.GITHUB_CLIENT_SECRET || '',
  // Email
  resendKey: e.RESEND_API_KEY || '',
  mailFrom: e.MAIL_FROM || 'Radar <hello@radar.local>',
  supportInbox: e.SUPPORT_INBOX || '',
  // Storage
  storageDir: e.STORAGE_DIR || '.data/uploads',
  s3Bucket: e.S3_BUCKET || '', s3Region: e.S3_REGION || 'us-east-1', s3Endpoint: e.S3_ENDPOINT || '', s3PublicUrl: e.S3_PUBLIC_URL || '',
  crawlerUserAgent: e.CRAWLER_USER_AGENT || 'RadarBot/1.0 (+https://radar.app/bot)',
};
export const oauthRedirect = (provider: string) => `${env.appUrl}/api/oauth/${provider}/callback`;
