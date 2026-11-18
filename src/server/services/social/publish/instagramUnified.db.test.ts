import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_SOCIAL_PUBLISHING = 'all'; });
import { and, eq } from 'drizzle-orm';
import { db, schema as S } from '../../../db';
import { ACTIONS } from '../../../actions';
import { requireRole } from '../../../access';
import { defaultProfile, getBiz, loadWorkspace } from '../../../workspace';
import { env } from '../../../env';
import { oauthProvider } from '../../../oauth/registry';
import '../../../oauth/providers';
import { readPendingSocial, savePendingSocial, tokensOf, ensureToken } from './accounts';
import type { Tokens } from './api';
import type { User } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const state = { mode: 'unified' as const, appId: '1610310810347180', configId: '1509864327716679', apiVersion: 'v27.0' };
const saved = { ...env }; const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let owner: User, viewer: User, outsider: User, bid: string, otherBid: string;
async function act(name: string, input: unknown, user = owner) { const def = ACTIONS[name]; const role = await requireRole(bid, user.id, def.role || (def.read ? 'Viewer' : 'Editor')); return def.run({ user, bid, role, biz: await getBiz(bid) }, def.input ? def.input.parse(input) : input); }
const accounts = () => db.select().from(S.socialAccounts).where(eq(S.socialAccounts.businessId, bid));
const token: Tokens = { access_token: 'system-test-token', refresh_token: null, expires_at: null, refresh_expires_at: null, instagram: { mode: 'unified', clientBusinessId: '555', configId: state.configId, apiVersion: 'v27.0' } };
const identities = [{ remoteId: '9001', name: 'First account', handle: '@first' }, { remoteId: '9002', name: 'Second account', handle: '@second' }];
const pending = (who = owner, business = bid, list = identities) => savePendingSocial(business, who.id, 'instagram', { tokens: token, id: { remoteId: '', name: 'Instagram account' }, identities: list });

describe.skipIf(!ON)('Instagram Unified Login encrypted account selection', () => {
  beforeAll(async () => {
    const tag = Date.now().toString(36);
    [owner, viewer, outsider] = await db.insert(S.users).values([{ name: 'Unified Owner', email: `unified-owner-${tag}@test.local` }, { name: 'Unified Viewer', email: `unified-viewer-${tag}@test.local` }, { name: 'Unified Outsider', email: `unified-other-${tag}@test.local` }]).returning() as any;
    const rows = await db.insert(S.businesses).values([{ ownerId: owner.id, domain: `${tag}.test`, status: 'active', profile: defaultProfile(`${tag}.test`) }, { ownerId: outsider.id, domain: `other-${tag}.test`, status: 'active', profile: defaultProfile(`other-${tag}.test`) }]).returning(); bid = rows[0].id; otherBid = rows[1].id;
    await db.insert(S.members).values([{ businessId: bid, userId: owner.id, email: owner.email, role: 'Owner' }, { businessId: bid, userId: viewer.id, email: viewer.email, role: 'Viewer' }, { businessId: otherBid, userId: outsider.id, email: outsider.email, role: 'Owner' }]);
  });
  beforeEach(async () => { Object.assign(env, { devStubs: false, metaAppId: state.appId, metaAppSecret: 'test-secret', instagramConfigId: state.configId, metaGraphApiVersion: 'v27.0' }); process.env.RADAR_SOCIAL_PUBLISHING = 'all'; await db.delete(S.socialAccounts).where(eq(S.socialAccounts.businessId, bid)); });
  afterAll(async () => {
    Object.assign(env, saved); vi.unstubAllGlobals(); vi.restoreAllMocks();
    if (bid) await db.delete(S.businesses).where(eq(S.businesses.id, bid)); if (otherBid) await db.delete(S.businesses).where(eq(S.businesses.id, otherBid));
    for (const user of [owner, viewer, outsider]) if (user) await db.delete(S.users).where(eq(S.users.id, user.id));
  });
  it('uses saved server mode rather than callback/environment values and exposes only a pending picker reference', async () => {
    const fetchMock = vi.fn(async (url: any) => String(url).includes('/oauth/access_token') ? reply({ access_token: token.access_token, scope: 'instagram_basic,instagram_content_publish' }) : String(url).includes('assigned_instagram_accounts') ? reply({ data: identities.map(a => ({ id: a.remoteId, username: a.handle.slice(1) })) }) : reply({ id: 'not-instagram', client_business_id: '555' }));
    vi.stubGlobal('fetch', fetchMock);
    // The callback is bound to the earlier server state even if configuration selection has since changed.
    env.instagramConfigId = 'different-config';
    const result = await oauthProvider('instagram')!.callback({ user: owner, bid, data: { instagram: state }, redirectUri: 'https://radar.example/api/oauth/instagram/callback', params: new URLSearchParams({ code: 'code', mode: 'instagram', config_id: 'malicious' }) });
    expect(result).toMatchObject({ ok: true, result: { ch: 'instagram', pickAccount: true } });
    expect(JSON.stringify(result)).not.toMatch(/system-test-token|clientBusinessId|identities/);
    const pend = await readPendingSocial(bid, owner.id, result.result.oauthRef, 'instagram');
    expect(pend?.id.remoteId).toBe(''); expect(pend?.identities?.map(a => a.remoteId)).toEqual(['9001', '9002']); expect(pend?.tokens.instagram).toEqual(token.instagram);
    expect((await act('social.instagramAccounts', { oauthRef: result.result.oauthRef })).accounts).toEqual([{ id: '9001', name: '@first', followers: null }, { id: '9002', name: '@second', followers: null }]);
    await expect(act('social.connect', { ch: 'instagram', oauthRef: result.result.oauthRef })).rejects.toMatchObject({ code: 'invalid' });
    const connected = await act('social.connect', { ch: 'instagram', oauthRef: result.result.oauthRef, accountId: '9002' });
    expect(connected.account).toMatchObject({ ch: 'instagram', name: 'second', handle: '@second' }); expect((await accounts())[0].remoteId).toBe('9002');
    expect(tokensOf((await accounts())[0])?.instagram).toEqual(token.instagram);
    const workspace = await loadWorkspace(bid, owner.id, 'Owner'); expect(JSON.stringify(workspace.social.accounts)).not.toMatch(/system-test-token|clientBusinessId|configId/);
    const calls = fetchMock.mock.calls.length;
    await ensureToken(connected.account.id); await act('social.disconnect', { acctId: connected.account.id });
    expect(fetchMock.mock.calls.length).toBe(calls); // Never SUAT neither refreshed nor sent to legacy revoke.
  });
  it('refuses viewers, other users/businesses, unshared identities and expired pending authorizations', async () => {
    const ref = await pending();
    await expect(act('social.instagramAccounts', { oauthRef: ref }, viewer)).rejects.toMatchObject({ status: 403 });
    expect((await act('social.instagramAccounts', { oauthRef: await pending(outsider) })).error).toContain('expired');
    expect((await act('social.instagramAccounts', { oauthRef: await pending(outsider, otherBid) })).error).toContain('expired');
    await expect(act('social.connect', { ch: 'instagram', oauthRef: ref, accountId: 'not-shared' })).rejects.toMatchObject({ status: 404 });
    expect(await accounts()).toHaveLength(0);
    await db.update(S.oauthStates).set({ createdAt: new Date(Date.now() - 3601_000) }).where(eq(S.oauthStates.state, ref));
    await expect(act('social.connect', { ch: 'instagram', oauthRef: ref, accountId: '9001' })).rejects.toMatchObject({ code: 'auth_expired' });
  });
  it('reconnects only the previously selected account and preserves account id and scheduled publications', async () => {
    const first = await act('social.connect', { ch: 'instagram', oauthRef: await pending(), accountId: '9002' });
    const id = first.account.id;
    await db.insert(S.socialPubs).values({ businessId: bid, sid: 's:unified-test:instagram', src: 'pack', platform: 'instagram', ch: 'instagram', kind: 'post', acctId: id, acctLabel: '@second', status: 'scheduled', date: '2026-12-01', time: '10:00', dueAt: new Date(Date.now() + 86400000) });
    await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, id));
    await expect(act('social.connect', { ch: 'instagram', oauthRef: await pending(), accountId: '9001' })).rejects.toMatchObject({ code: 'other_account' });
    await expect(act('social.connect', { ch: 'instagram', oauthRef: await pending(owner, bid, [identities[0]]) })).rejects.toMatchObject({ code: 'not_admin' });
    const reconnected = await act('social.connect', { ch: 'instagram', oauthRef: await pending() });
    expect(reconnected).toMatchObject({ reconnected: true, released: 1, account: { id, expired: false } });
    expect((await db.select().from(S.socialPubs).where(and(eq(S.socialPubs.businessId, bid), eq(S.socialPubs.acctId, id))))).toHaveLength(1);
  });
});
