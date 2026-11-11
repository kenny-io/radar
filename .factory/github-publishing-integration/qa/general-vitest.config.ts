import {defineConfig} from 'vitest/config';
import path from 'node:path';
export default defineConfig({test:{include:[path.resolve(__dirname,'general-contract.test.ts'),path.resolve(__dirname,'general-replay.test.ts')]},resolve:{alias:{'@':path.resolve(__dirname,'../../../src')}}});
