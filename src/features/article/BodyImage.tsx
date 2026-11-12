'use client';
import React from 'react';
import { Btn, Status } from '@/components/ui';
import type { ArticleBodyImage, ImageIssueReason } from '@/lib/types';

/** The stored image appears in the article view; it is never part of an editable text block. */
export function BodyImage({ image }: { image: ArticleBodyImage }) {
  return <figure data-body-image={image.id} contentEditable={false} style={{ margin: '28px 0 36px' }}>
    {/* Stored visuals are already cropped; native images work with local files and configured object storage. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.url} alt={image.alt} width={1200} height={675} loading="lazy" style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12 }} />
  </figure>;
}

/** `error`: the body-image job the person started has failed. `issue`: the last draft had to leave the images out.
 *  One message at a time: progress, then the job error, then the issue. */
export function BodyImagesPanel({ images, busy, disabled, completed, total, error, issue, onGenerate }: {
  images: ArticleBodyImage[]; busy: boolean; disabled: boolean; completed: number; total: number;
  error: boolean; issue?: ImageIssueReason | null; onGenerate: () => void;
}) {
  return <section aria-labelledby="body-images-heading" className="col" style={{ gap: 12, borderTop: '1px solid var(--line)', paddingTop: 20 }}>
    <h3 id="body-images-heading" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Body images</h3>
    <p className="xs sub" style={{ margin: 0 }}>Section images appear throughout your article. Adding or regenerating them keeps your text and cover image.</p>
    {!!images.length && <div className="col" style={{ gap: 10 }}>{images.map((image, i) => <div key={image.id} className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt="" width={72} height={41} loading="lazy" style={{ width: 72, height: 41, objectFit: 'cover', borderRadius: 6, flex: 'none' }} />
      <span className="xs" style={{ overflowWrap: 'anywhere' }}>{image.after.heading || `Section image ${i + 1}`}</span>
    </div>)}</div>}
    {busy && <div role="status" aria-live="polite"><Status tone="signal" pulse>{total ? `Creating body images · ${completed} of ${total}` : 'Preparing body images…'}</Status></div>}
    {error && !busy && <p role="alert" className="xs" style={{ color: 'var(--bad)', margin: 0 }}>Radar couldn’t make the body images. Try again. Any existing images are kept.</p>}
    {!!issue && !error && !busy && <p role="status" className="xs" style={{ color: 'var(--warn)', margin: 0 }}>{issue === 'unavailable'
      ? 'Radar couldn’t add body images to this article. Image generation is unavailable right now. Your text and cover are not affected.'
      : 'Radar couldn’t make the body images for this article. Your text and cover are not affected.'}</p>}
    <Btn icon="refresh" loading={busy} disabled={disabled} onClick={onGenerate}>{error || issue ? 'Try again' : images.length ? 'Regenerate body images' : 'Add body images'}</Btn>
  </section>;
}
