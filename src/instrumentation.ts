// Next's Node request hook also captures render/route failures outside the RPC wrapper.
export async function onRequestError(error: unknown, _request: unknown, context: { routePath: string; routeType: string }) {
  // A positive runtime branch lets Next exclude the Node-only reporter from its Edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportFailure, shouldReportFailure } = await import('./server/observability/failures');
    if (shouldReportFailure(error)) await reportFailure(error, { source: 'http', operation: `${context.routeType} ${context.routePath}` });
  }
}
