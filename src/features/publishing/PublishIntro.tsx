'use client';
// CONTRACT (owned by the publishing area): platform picker modal. Port of PublishIntro (radar-publish.jsx).
export interface PublishIntroProps { open: boolean; onClose: () => void; onPick: (type: string) => void; onSkip?: (() => void) | null; title?: string; sub?: string; existing?: string[] }
export function PublishIntro(_p: PublishIntroProps): any { return null; }
