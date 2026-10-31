# FAQ browser verification

Run `node .factory/homepage-faq-refresh/qa/browser.mjs` with the local review app running on port3901. The harness uses Playwright with locally installed Google Chrome, checks all14 FAQ accordions at desktop/mobile sizes, and exercises the unchanged demo tabs and headlines. Generated screenshots, logs and JSON stay local and ignored; acceptance coverage, source evidence and exact fingerprints are recorded in ../verification.md and ../implementation-fingerprint.json.
