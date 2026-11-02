import { llmsFullText, textResponse } from '@/lib/seo';
export const dynamic = 'force-static';
export function GET() { return textResponse(llmsFullText()); }
