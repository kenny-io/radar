# Signup security infrastructure evidence

4 November 2026 (Asia/Dubai). User requested reuse of existing Thally Turnstile configuration. This pass was read-only against Thally, Netlify, Railway and Cloudflare; no widget, hostname, deployment or remote environment variable was changed.

## Reused credentials

Existing Thally Cloud code already uses Turnstile on registration:

- `/Users/ekene/Developer/thally-suite/thally-cloud/src/components/turnstile-widget.tsx`: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, action `turnstile-spin-v2`.
- `/Users/ekene/Developer/thally-suite/thally-cloud/src/platform/auth/turnstile.ts`: `TURNSTILE_SECRET` for server-side Siteverify.

Local `.env`/`.env.local` contain no Turnstile values. Thally Cloud runs at `https://app.thally.io` on the existing Netlify site named `thally-cloud`; there is no matching Thally Cloud Railway project. Existing saved Netlify authentication permitted targeted read-only production environment retrieval. Both the public site key and private secret are present as unmasked values.

Public site key: `0x4AAAAAAEvL5Mo9wa3Y4Zlx`.

The reusable pair was mapped to Radar's `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` names and saved only in ignored `.data/signup-security/turnstile-env.json`, permissions `0600`. The private secret was not printed, placed in this record, committed, or copied into an external service. No Cloudflare management token was retained.

## What was verified

A real Siteverify request using the reused secret and an intentionally invalid dummy token returned `success:false` and `error-codes:["invalid-input-response"]`. This confirms the secret was recognized; an invalid-input-secret result was not returned. It does not prove a real browser challenge can complete on Radar, and does not establish the configured widget hostnames.

Cloudflare's current [hostname-management documentation](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/) states that adding a hostname automatically authorizes all its subdomains. Therefore an existing `thally.io` entry covers `radar.thally.io`; an entry restricted to `app.thally.io` does not cover the sibling Radar hostname.

## Remaining hostname verification

Widget metadata could not be read using the currently available Cloudflare authentication. Wrangler OAuth lacks Turnstile management scope (PM evidence). The Thally Cloud production environment's platform Cloudflare account configuration did not provide a valid widget-metadata route; the read-only request returned HTTP404/code7003. No hostnames were changed or guessed from that failure.

Before optional Turnstile activation (`RADAR_SIGNUP_TURNSTILE=1`), verify the existing widget permits `thally.io` or `radar.thally.io`, either through authorized widget metadata/dashboard access or a real browser challenge on `radar.thally.io` followed by Siteverify that confirms `success`, the expected hostname and action. Reuse the recovered pair; do not create or rotate the widget merely to inspect its allowed hosts. The browser challenge check is separate from the successful dummy-token secret check above.


## Current user decision: rate limits active, Turnstile optional

The user subsequently authorized signup protection through IP and rate limiting rather than delaying the fix for widget configuration. The default implementation therefore leaves `RADAR_SIGNUP_TURNSTILE` unset/off, requires production Resend configuration, and protects signup/resend through shared PostgreSQL IP/address/global budgets. The recovered Thally credentials are optional private material; their presence does not activate a widget. No Cloudflare configuration, secret rotation or hostname edit is needed for rate-limit mode.

Widget hostname/real-challenge evidence remains required only before explicitly opting into `RADAR_SIGNUP_TURNSTILE=1`. An enabled widget must fail closed on configuration/validation/provider failures rather than silently switching to rate mode. Production email receipt, genuine trusted-client-IP selection, combined signup/resend quota verification and safe legacy migration remain release checks in either mode.
