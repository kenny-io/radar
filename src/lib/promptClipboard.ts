/** Await the real browser write. A denied or unavailable clipboard must remain a failure. */
export async function copyPromptText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);
}
