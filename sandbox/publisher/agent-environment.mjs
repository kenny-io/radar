/**
 * Explicit environment boundary for the Claude Agent SDK subprocess.
 *
 * The SDK's `env` option replaces the inherited environment. Daytona injects the CA bundle and proxy routing its
 * restricted network needs (HTTP_PROXY, HTTPS_PROXY, NO_PROXY, NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, CURL_CA_BUNDLE
 * and their relatives), so those values must survive this boundary. Nothing else is forwarded: no other variable
 * of the runner process reaches the model's subprocess, and no flag that disables TLS verification.
 *
 * The only secret here is the per-run model capability, which arrives in ANTHROPIC_API_KEY at exec time.
 */

/**
 * Sandbox transport variables, forwarded unchanged when the sandbox sets them. Routing and trust anchors only:
 * never a credential, never NODE_TLS_REJECT_UNAUTHORIZED or any other switch that weakens verification.
 */
export const TRANSPORT_VARIABLES = Object.freeze([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_ENV_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
]);

/**
 * Build the agent's model, runtime and trusted sandbox transport environment.
 * @param {Record<string, string | undefined>} environment
 * @returns {Record<string, string | undefined>}
 */
export function buildAgentEnvironment(environment) {
  const agentEnvironment = {
    ANTHROPIC_API_KEY: environment.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: environment.ANTHROPIC_BASE_URL,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // The proxy meters the complete replayed context. Provider-side compaction would generate hidden context
    // outside that boundary.
    DISABLE_AUTO_COMPACT: '1',
    USE_API_CONTEXT_MANAGEMENT: '0',
    PATH: environment.PATH,
    HOME: environment.HOME,
  };
  for (const name of TRANSPORT_VARIABLES) {
    if (typeof environment[name] === 'string') agentEnvironment[name] = environment[name];
  }
  return agentEnvironment;
}
