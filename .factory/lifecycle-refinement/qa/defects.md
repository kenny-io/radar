# LC2 independent QA defects

## LC2-05-D1 — Long bounded names expand mobile email tables

Severity P2; criterion LC2-05 mobile/render quality. Initial source f616862c plus in-progress shared/legacy copy frames. Reproduce `node --import tsx .factory/lifecycle-refinement/qa/stress-render.ts`: actual weekly lesson renderer with80char unbroken business name/100char offering/audience, and actual invitation builder with160char inviter/business names. Use installed Chrome at390px, real deployable logo fulfilled locally, no provider calls. Expected: complete content wraps within390px. Actual: education document1314px; invitation3106px, requiring horizontal scroll.

Original evidence: stress/original-results.json and original-*.png. Source baseline templates already lacked long-word wrapping; this was exposed by LC2's explicit stress requirement, and the new invitation card also needed protection. It is not asserted to be a wholly new product regression.

PM added inline overflow wrapping/word breaking and fixed table layout to the affected HTML frames, retaining all input limits and original test data. Independent identical-input retest results are in stress/results.json and current screenshots. Status: CLOSED. Identical-input independent real-Chrome retest2/2pass: both documents remain390px wide on390px viewport. No input limit or assertion was weakened.
