/** Errors with copy safe to show users. Never include model or provider names (README §2.5 #7). */
export class RadarError extends Error {
  constructor(public userMessage: string, public status = 400, public code = 'bad_request') { super(userMessage); }
}
export const notFound = (what = 'That') => new RadarError(`${what} wasn’t found.`, 404, 'not_found');
export const forbidden = () => new RadarError('You don’t have permission to do that.', 403, 'forbidden');
export const unauthorized = () => new RadarError('Sign in to continue.', 401, 'unauthorized');
export const GENERIC_AI_ERROR = 'Radar couldn’t finish this. Try again.';
