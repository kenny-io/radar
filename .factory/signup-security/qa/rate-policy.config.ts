import{defineConfig}from'vitest/config';import path from'node:path';
export default defineConfig({test:{include:['.factory/signup-security/qa/rate-policy.test.ts']},resolve:{alias:{'@':path.resolve(process.cwd(),'src')}}});
