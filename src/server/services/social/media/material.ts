/** A minimum factual-context gate, not a substitute for the mechanism/source reviewers.
 * Identity, formatting and generated field headings cannot turn an empty profile into evidence.
 */
export function referenceFacts(value: string | null | undefined): string[] {
  return String(value || '').split(/\n+|(?<=[.!?])\s+(?=[\p{L}\p{N}])/u).map(line => line.trim()).filter(line => {
    if (/^(?:none(?: listed)?|n\/a|not (?:set|provided|specified|available)|unknown|undefined|null|tbd)$/i.test(line)) return false;
    if (!line || /^#+\s/.test(line) || /^[\p{L}\p{N} ()/_-]+:\s*$/u.test(line)) return false;
    if (/^(?:page title|article title|name|business name|website|domain|site|source url|target keyword|post angle|search topic|business-profile angle|upcoming content topic|brand voice|language|markets|priority keywords|competitors?[^:]*):/i.test(line)) return false;
    if (/^(?:use only|do not|never |treat .*reference|publication date)/i.test(line)) return false;
    if (/^(?:known facts|business profile|article text|content|outline)\s*:?[\s]*$/i.test(line)) return false;
    if (/^(?:tone|voice|style|format|presentation)\s*:/i.test(line)) return false;
    if (/^(?:(?:our|the|a|an)\s+)?(?:brand\s+)?(?:voice|tone|style|language|presentation|delivery)\b/i.test(line) && /\b(?:warm|friendly|calm|formal|casual|curious|patient|concise|engaging|upbeat|slow|fast|energetic)\b/i.test(line)) return false;
    // Explicit presentation requests are directions for the rendering, not claims about the topic.
    if (/^(?:please\s+)?(?:use|write|speak|keep|make|render|animate|draw|prefer|avoid)\b/i.test(line) && /\b(?:tone|voice|style|language|accent|font|captions?|colou?rs?|hand.drawn|concise|friendly|warm|casual|formal|seconds?|minutes?)\b/i.test(line)) return false;
    if (/^(?:(?:a|an|the)\s+)?(?:warm|friendly|casual|formal|curious|patient|concise|playful|professional|calm|clear)\b.{0,45}\b(?:voice|tone|style|delivery)\b/i.test(line)) return false;
    return true;
  }).map(line => line
    .replace(/^(?:idea from the user|summary|description|angle|written for|why it matters|search data|why now|relevant profile fact|related page on the site)\s*:\s*/i, '')
    .replace(/^[-*]\s+/, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim()).filter(Boolean);
}

export function hasMaterialEvidence(fragments: (string | null | undefined)[]): boolean {
  // The same topic copied into several headings is still one fragment of information.
  const facts = [...new Set(fragments.flatMap(referenceFacts).map(s => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')))];
  const text = facts.join(' ');
  const characters = text.match(/[\p{L}\p{N}]/gu) || [];
  // Count CJK characters individually, so real prose without spaces is not rejected as one word.
  const units = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu) || [];
  return characters.length >= 24 && units.length >= 4;
}
