import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../env';
import { type AcctCtx, type PublishInput } from './api';
import { instagramAdapter, instagramExchange, instagramMe } from './instagram';
import { tiktokAdapter, tiktokCreatorInfo, tiktokExchange } from './tiktok';
import { youtubeAdapter, youtubeExchange, youtubeMe } from './youtube';
import { scopesOk } from './oauth';
import { adapterFor, channelsAvailable } from './accounts';
import { stubIdentity, stubTokens } from './stubs';

const response = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
const a = (ch: 'instagram' | 'tiktok' | 'youtube'): AcctCtx => ({ ch, remoteId: '42', handle: '@radar', token: 'test-token' });
const photo = { bytes: Buffer.from('jpeg'), type: 'image/jpeg', url: 'https://media.example.test/tenant/photo.jpg' };
const video = { bytes: Buffer.from('video-bytes'), type: 'video/mp4', url: 'https://media.example.test/tenant/movie.mp4', durationSec: 30 };
const creator = { creator_username: 'radar', creator_nickname: 'Radar', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 60 };
const tt = { privacyLevel: 'PUBLIC_TO_EVERYONE' as const, allowComment: false, allowDuet: false, allowStitch: false, commercialContent: false, brandOrganic: false, brandedContent: false, consent: true };
const yt = { title: 'A useful video', privacy: 'private' as const, madeForKids: false };
let requests: { url: string; init: RequestInit }[];
const savedEnv = { ...env };
function fetchWith(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: RequestInit = {}) => { requests.push({ url: String(url), init }); return fn(String(url), init); }));
}
const ttResponse = (data: any) => response({ data, error: { code: 'ok' } });
beforeEach(() => { requests = []; env.devStubs = false; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); Object.assign(env, savedEnv); });

describe('provider configuration and scopes', () => {
  it('registers real adapters without any fallback to LinkedIn', () => {
    expect(adapterFor('instagram', null)).toBe(instagramAdapter);
    expect(adapterFor('tiktok', null)).toBe(tiktokAdapter);
    expect(adapterFor('youtube', null)).toBe(youtubeAdapter);
  });
  it('advertises only configured new OAuth apps, or all in development stubs', () => {
    Object.assign(env, { instagramClientId: '', instagramClientSecret: '', tiktokClientKey: '', tiktokClientSecret: '', youtubeClientId: '', youtubeClientSecret: '' });
    expect(channelsAvailable()).not.toContain('instagram');
    Object.assign(env, { instagramClientId: 'id', instagramClientSecret: 'secret', tiktokClientKey: 'key', tiktokClientSecret: 'secret', youtubeClientId: 'id', youtubeClientSecret: 'secret' });
    expect(channelsAvailable()).toEqual(expect.arrayContaining(['instagram', 'tiktok', 'youtube']));
    env.devStubs = true;
    expect(channelsAvailable()).toHaveLength(6);
  });
  it('checks complete granted scope sets and creates channel-specific stub identities', () => {
    expect(scopesOk('instagram', 'instagram_business_basic')).toBe(false);
    expect(scopesOk('instagram', 'instagram_business_basic,instagram_business_content_publish')).toBe(true);
    expect(scopesOk('tiktok', 'user.info.basic')).toBe(false);
    expect(scopesOk('youtube', 'https://www.googleapis.com/auth/youtube.upload')).toBe(false);
    for (const ch of ['instagram', 'tiktok', 'youtube'] as const) {
      expect(scopesOk(ch, stubTokens(ch).scope)).toBe(true);
      expect(stubIdentity(ch, { businessName: 'Radar', userName: 'Test', userId: 'test-user' }).remoteId).toContain(ch);
    }
  });
});

describe('Instagram Login and publication', () => {
  it('exchanges the wrapped short token for a refreshable long token and reads the professional identity', async () => {
    fetchWith((url, init) => {
      if (url.includes('api.instagram.com/oauth/access_token')) { expect(init.body).toBeInstanceOf(FormData); return response({ data: [{ access_token: 'short', permissions: 'instagram_business_basic,instagram_business_content_publish' }] }); }
      if (url.includes('/access_token?')) return response({ access_token: 'long', expires_in: 5184000 });
      return response({ user_id: 'ig-user', username: 'radar', name: 'Radar' });
    });
    const tokens = await instagramExchange('code', 'https://app.example.test/callback');
    expect(tokens).toMatchObject({ access_token: 'long', refresh_token: 'long' });
    expect(await instagramMe(tokens.access_token)).toEqual({ remoteId: 'ig-user', name: 'Radar', handle: '@radar' });
  });
  it('refuses ambiguous token exchanges', async () => {
    fetchWith(() => response({ data: [{ access_token: 'one' }, { access_token: 'two' }] }));
    await expect(instagramExchange('code', 'https://app.example.test/callback')).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it('persists the container before publishing and returns the real permalink', async () => {
    const progress = vi.fn(async () => {});
    fetchWith((url) => {
      if (url.endsWith('/42/media')) return response({ id: '123' });
      if (url.includes('status_code')) { expect(progress).toHaveBeenCalledWith('123'); return response({ status_code: 'FINISHED' }); }
      if (url.endsWith('/media_publish')) return response({ id: '987' });
      return response({ permalink: 'https://www.instagram.com/p/real-post/' });
    });
    expect(await instagramAdapter.publish!(a('instagram'), { text: 'caption', images: [photo], progress })).toEqual({ remoteId: '987', url: 'https://www.instagram.com/p/real-post/' });
  });
  it('resumes processing without creating a second container', async () => {
    fetchWith(() => response({ status_code: 'IN_PROGRESS' }));
    expect(await instagramAdapter.resume!(a('instagram'), '123')).toMatchObject({ pending: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].init.method).toBeUndefined();
  });
  it('recognizes PUBLISHED after a lost media_publish response without posting again', async () => {
    fetchWith(() => response({ status_code: 'PUBLISHED' }));
    expect(await instagramAdapter.resume!(a('instagram'), '123')).toEqual({ remoteId: '123', url: 'https://www.instagram.com/radar/' });
    expect(requests).toHaveLength(1);
  });
  it('rejects PNG and inaccessible media before making any request', async () => {
    fetchWith(() => { throw new Error('unexpected'); });
    await expect(instagramAdapter.publish!(a('instagram'), { text: 'caption', images: [{ ...photo, type: 'image/png' }] })).rejects.toMatchObject({ code: 'media' });
    await expect(instagramAdapter.publish!(a('instagram'), { text: 'caption', images: [{ ...photo, url: '/api/files/private' }] })).rejects.toMatchObject({ code: 'media' });
    expect(requests).toHaveLength(0);
  });
  it('creates video reels and never retries a publish503 as a safe failure', async () => {
    fetchWith((url) => url.endsWith('/42/media') ? response({ id: '123' }) : url.includes('status_code') ? response({ status_code: 'FINISHED' }) : response({}, 503));
    await expect(instagramAdapter.publish!(a('instagram'), { text: 'caption', images: [], video })).rejects.toMatchObject({ kind: 'unknown' });
    expect(new URLSearchParams(String(requests[0].init.body)).get('media_type')).toBe('REELS');
  });
  it('refreshes long-lived tokens and classifies expired tokens definitively', async () => {
    fetchWith(() => response({ access_token: 'renewed', expires_in: 5184000 }));
    expect(await instagramAdapter.refresh({ access_token: 'old', refresh_token: 'old', expires_at: Date.now() + 60_000 })).toMatchObject({ access_token: 'renewed', refresh_token: 'renewed' });
    await expect(instagramAdapter.refresh({ access_token: 'old', expires_at: 1 })).rejects.toMatchObject({ definitive: true });
  });
});

describe('TikTok direct posting', () => {
  it('maps current creator privacy, interaction and duration settings', async () => {
    fetchWith(() => ttResponse(creator));
    expect(await tiktokCreatorInfo('token')).toMatchObject({ username: 'radar', nickname: 'Radar', privacyLevels: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], duetDisabled: true, maxVideoDurationSec: 60 });
  });
  it('requires explicit consent and validates current creator settings before initialization', async () => {
    fetchWith(() => ttResponse(creator));
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [photo] })).rejects.toMatchObject({ code: 'rejected' });
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [photo], options: { tiktok: { ...tt, privacyLevel: 'FOLLOWER_OF_CREATOR' } } })).rejects.toMatchObject({ code: 'rejected' });
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [], video, options: { tiktok: { ...tt, allowDuet: true } } })).rejects.toMatchObject({ code: 'rejected' });
    expect(requests.every(r => r.url.includes('creator_info'))).toBe(true);
  });
  it('refuses commercial posts without brand disclosure and private paid partnerships', async () => {
    fetchWith(() => ttResponse(creator));
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [photo], options: { tiktok: { ...tt, commercialContent: true } } })).rejects.toMatchObject({ code: 'rejected' });
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [photo], options: { tiktok: { ...tt, commercialContent: true, brandedContent: true, privacyLevel: 'SELF_ONLY' } } })).rejects.toMatchObject({ code: 'rejected' });
  });
  it('uses direct photo PULL_FROM_URL with AI disclosure and persists publish_id before checking status', async () => {
    const progress = vi.fn(async () => {});
    fetchWith((url) => {
      if (url.includes('creator_info')) return ttResponse(creator);
      if (url.includes('content/init')) return ttResponse({ publish_id: 'tracking-1' });
      expect(progress).toHaveBeenCalledWith('tracking-1');
      return ttResponse({ status: 'PROCESSING_DOWNLOAD' });
    });
    expect(await tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [photo], options: { tiktok: tt }, aiMedia: true, progress })).toMatchObject({ remoteId: 'tracking-1', pending: true });
    expect(JSON.parse(String(requests[1].init.body))).toMatchObject({ media_type: 'PHOTO', post_mode: 'DIRECT_POST', is_aigc: true, source_info: { source: 'PULL_FROM_URL', photo_images: [photo.url] } });
  });
  it('never treats the initialization ID as confirmation and resumes status without another init', async () => {
    fetchWith(() => ttResponse({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['real-post-id'] }));
    expect(await tiktokAdapter.resume!(a('tiktok'), 'tracking-1')).toEqual({ remoteId: 'real-post-id', url: 'https://www.tiktok.com/@radar' });
    expect(requests[0].url).toContain('/status/fetch/');
    expect(requests).toHaveLength(1);
  });
  it('confirmed private publication uses the profile URL rather than a fake tracking-ID post link', async () => {
    fetchWith(() => ttResponse({ status: 'PUBLISH_COMPLETE' }));
    expect(await tiktokAdapter.resume!(a('tiktok'), 'tracking-1')).toEqual({ remoteId: 'tracking-1', url: 'https://www.tiktok.com/@radar' });
  });
  it('uses server-hosted video PULL_FROM_URL and refuses overlong videos for the current creator', async () => {
    fetchWith((url) => url.includes('creator_info') ? ttResponse(creator) : url.includes('init/') ? ttResponse({ publish_id: 'tracking' }) : ttResponse({ status: 'PROCESSING_DOWNLOAD' }));
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [], video: { ...video, durationSec: 90 }, options: { tiktok: tt } })).rejects.toMatchObject({ code: 'media' });
    requests = [];
    await tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [], video, options: { tiktok: tt } });
    expect(JSON.parse(String(requests[1].init.body)).source_info).toEqual({ source: 'PULL_FROM_URL', video_url: video.url });
  });
  it('maps init503 and reference persistence failures to unknown; failed processing is definitive', async () => {
    fetchWith((url) => url.includes('creator_info') ? ttResponse(creator) : response({}, 503));
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [photo], options: { tiktok: tt } })).rejects.toMatchObject({ kind: 'unknown' });
    fetchWith((url) => url.includes('creator_info') ? ttResponse(creator) : ttResponse({ publish_id: 'tracking' }));
    await expect(tiktokAdapter.publish!(a('tiktok'), { text: 'caption', images: [photo], options: { tiktok: tt }, progress: async () => { throw new Error('db failed'); } })).rejects.toMatchObject({ kind: 'unknown' });
    fetchWith(() => ttResponse({ status: 'FAILED', fail_reason: 'picture_size_check_failed' }));
    await expect(tiktokAdapter.resume!(a('tiktok'), 'tracking')).rejects.toMatchObject({ kind: 'definitive', code: 'media' });
  });
  it('uses response token expiry and rotates the refresh token', async () => {
    fetchWith(() => response({ access_token: 'access2', refresh_token: 'refresh2', expires_in: 7200, refresh_expires_in: 15552000, scope: 'user.info.basic,video.publish' }));
    const tokens = await tiktokExchange('code', 'https://app.example.test/callback');
    expect(tokens).toMatchObject({ access_token: 'access2', refresh_token: 'refresh2' });
    expect(await tiktokAdapter.refresh({ ...tokens, refresh_token: 'refresh1' })).toMatchObject({ refresh_token: 'refresh2' });
  });
});

describe('YouTube video publishing', () => {
  it('exchanges with PKCE and identifies the actual authorized channel', async () => {
    fetchWith((url) => url.includes('/token') ? response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }) : response({ items: [{ id: 'channel123', snippet: { title: 'Radar videos', customUrl: '@radar' } }] }));
    expect(await youtubeExchange('code', 'verifier', 'https://app.example.test/callback')).toMatchObject({ refresh_token: 'refresh' });
    expect(new URLSearchParams(String(requests[0].init.body)).get('code_verifier')).toBe('verifier');
    expect(await youtubeMe('access')).toEqual({ remoteId: 'channel123', name: 'Radar videos', handle: '@radar' });
  });
  it('blocks missing video, title, visibility and audience before uploading', async () => {
    fetchWith(() => { throw new Error('unexpected'); });
    await expect(youtubeAdapter.publish!(a('youtube'), { text: 'description', images: [photo], options: yt })).rejects.toMatchObject({ code: 'media' });
    await expect(youtubeAdapter.publish!(a('youtube'), { text: 'description', images: [], video, options: { title: 'Video' } })).rejects.toMatchObject({ code: 'rejected' });
    expect(requests).toHaveLength(0);
  });
  it('uploads video bytes with declared title, privacy, audience and AI status, then waits for processing', async () => {
    const progress = vi.fn(async () => {});
    fetchWith((url, init) => {
      if (url.includes('upload/youtube')) {
        const body = Buffer.from(init.body as Uint8Array).toString();
        expect(body).toContain('video-bytes'); expect(body).toContain('"privacyStatus":"private"'); expect(body).toContain('"selfDeclaredMadeForKids":false'); expect(body).toContain('"containsSyntheticMedia":true');
        return response({ id: 'actual-id' }, 200);
      }
      expect(progress).toHaveBeenCalledWith('actual-id');
      return response({ items: [{ id: 'actual-id', status: { uploadStatus: 'uploaded' }, processingDetails: { processingStatus: 'processing' } }] });
    });
    expect(await youtubeAdapter.publish!(a('youtube'), { text: 'description', images: [], video, options: yt, aiMedia: true, progress })).toMatchObject({ remoteId: 'actual-id', pending: true });
  });
  it('resumes processing with a read-only query and only confirms processed videos', async () => {
    fetchWith(() => response({ items: [{ id: 'actual-id', status: { uploadStatus: 'processed' } }] }));
    expect(await youtubeAdapter.resume!(a('youtube'), 'actual-id')).toEqual({ remoteId: 'actual-id', url: 'https://www.youtube.com/watch?v=actual-id' });
    expect(requests).toHaveLength(1); expect(requests[0].init.method).toBeUndefined();
  });
  it('maps create503 and lost progress persistence to unknown, quota refusal to definitive', async () => {
    fetchWith(() => response({}, 503));
    const input: PublishInput = { text: 'description', images: [], video, options: yt };
    await expect(youtubeAdapter.publish!(a('youtube'), input)).rejects.toMatchObject({ kind: 'unknown' });
    fetchWith(() => response({ id: 'actual-id' }));
    await expect(youtubeAdapter.publish!(a('youtube'), { ...input, progress: async () => { throw new Error('db failed'); } })).rejects.toMatchObject({ kind: 'unknown' });
    fetchWith(() => response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403));
    await expect(youtubeAdapter.publish!(a('youtube'), input)).rejects.toMatchObject({ kind: 'definitive', code: 'quota' });
  });
  it('treats a successful upload without a video id as unknown rather than allowing retry', async () => {
    fetchWith(() => response({}));
    await expect(youtubeAdapter.publish!(a('youtube'), { text: 'description', images: [], video, options: yt })).rejects.toMatchObject({ kind: 'unknown' });
  });
  it('retains refresh token when Google omits a replacement', async () => {
    fetchWith(() => response({ access_token: 'access2', expires_in: 3600 }));
    expect(await youtubeAdapter.refresh({ access_token: 'access1', refresh_token: 'refresh1' })).toMatchObject({ access_token: 'access2', refresh_token: 'refresh1' });
  });
});

describe('accepted-publication status uncertainty regression', () => {
  const adapters = [
    { ch: 'instagram' as const, adapter: instagramAdapter, ref: '123' },
    { ch: 'tiktok' as const, adapter: tiktokAdapter, ref: 'tracking' },
    { ch: 'youtube' as const, adapter: youtubeAdapter, ref: 'video-id' },
  ];
  for (const { ch, adapter, ref } of adapters) {
    it.each([403, 404])(`${ch} status HTTP%d never claims confirmed nonpublication`, async status => {
      fetchWith(() => response({ error: { code: 'forbidden', errors: [{ reason: 'forbidden' }] } }, status));
      let error: any;
      try { await adapter.resume!(a(ch), ref); } catch (e) { error = e; }
      expect(error).toBeDefined();
      expect(error.kind).not.toBe('definitive');
      expect(error.confirmedUnpublished).toBe(false);
      expect(requests).toHaveLength(1);
    });
  }
  it.each([
    { ch: 'instagram' as const, adapter: instagramAdapter, ref: '123', body: { status_code: 'ERROR' } },
    { ch: 'tiktok' as const, adapter: tiktokAdapter, ref: 'tracking', body: { data: { status: 'FAILED' }, error: { code: 'ok' } } },
    { ch: 'youtube' as const, adapter: youtubeAdapter, ref: 'video-id', body: { items: [{ id: 'video-id', status: { uploadStatus: 'rejected' } }] } },
  ])('$ch explicit terminal provider rejection confirms nonpublication', async ({ ch, adapter, ref, body }) => {
    fetchWith(() => response(body));
    await expect(adapter.resume!(a(ch), ref)).rejects.toMatchObject({ kind: 'definitive', confirmedUnpublished: true });
  });
  it('Instagram publish HTTP400 after a prior attempt is uncertain until container status confirms outcome', async () => {
    fetchWith(url => url.includes('status_code') ? response({ status_code: 'FINISHED' }) : response({ error: { message: 'Container cannot be published' } }, 400));
    await expect(instagramAdapter.resume!(a('instagram'), '123')).rejects.toMatchObject({ kind: 'unknown', confirmedUnpublished: false });
  });
  it('YouTube rejects multibyte descriptions beyond5000 UTF8 bytes before upload', async () => {
    fetchWith(() => { throw new Error('unexpected'); });
    await expect(youtubeAdapter.publish!(a('youtube'), { text: '🙂'.repeat(1251), images: [], video, options: yt })).rejects.toMatchObject({ code: 'too_long' });
    expect(requests).toHaveLength(0);
  });
});
