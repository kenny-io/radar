// Billing errors with user-facing copy (architecture §5.3, §10). Codes are the contract with the trial page (T4).
import { RadarError } from '../errors';

const e = (msg: string, status: number, code: string) => () => new RadarError(msg, status, code);
export const BillingError = {
  alreadyActive: e('Your Radar subscription is already active.', 409, 'already_active'),
  restartRequired: e('Your free trial has been used. Restart your subscription to continue.', 409, 'restart_required'),
  notLapsed: e('Start your free trial to continue.', 409, 'not_lapsed'),
  trialUsed: e('This card has already been used for a free trial. Try a different card.', 409, 'trial_used'),
  invalidPaymentMethod: e('Radar couldn’t use this card. Try a different card.', 400, 'invalid_payment_method'),
  /** The previous $1 is still being processed by the bank (rare; cards settle synchronously). Not designed. */
  paymentProcessing: e('Your card is still being confirmed. Try again in a minute.', 409, 'payment_processing'),
  notYours: e('You don’t have permission to do that.', 403, 'not_yours'),
  /** The client retries this code, then polls GET /api/billing/state (the webhook may get there first). */
  notSucceeded: e('Radar couldn’t confirm your card. Try again.', 409, 'payment_not_succeeded'),
  activationFailed: e('Your card is confirmed, but your trial didn’t start yet. Try again in a minute. You won’t be charged twice.', 502, 'activation_failed'),
  unavailable: e('Payments aren’t available right now. Try again in a few minutes.', 503, 'billing_unavailable'),
  noSubscription: e('There’s no subscription on this account yet.', 409, 'no_subscription'),
};
