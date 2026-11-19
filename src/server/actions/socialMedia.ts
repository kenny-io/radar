import { z } from 'zod';
import { VIDEO_STYLE_IDS } from '@/lib/videoStyles';
import { action,type ActionMap } from './define';
import { prepareMedia,generateMedia,cancelMedia,retryMedia,mediaNotes,saveMediaStyle } from '../services/social/media';
const Platform=z.enum(['instagram','tiktok','youtube']);
const Pack=z.string().min(1).max(100);const Notes=z.string().max(4000).optional();
export const actions:ActionMap={
 'social.mediaPrepare':action({input:z.object({packId:Pack,platforms:z.array(Platform).min(1).max(3),sourceNotes:Notes,generateAfterPrepare:z.boolean().optional(),choices:z.array(z.object({platform:Platform,format:z.enum(['recommended','video','carousel']),videoStyle:z.enum(VIDEO_STYLE_IDS).optional()})).min(1).max(3).optional()}),run:(c,i)=>prepareMedia(c.bid,i.packId,i.platforms,i.sourceNotes,{generateAfterPrepare:i.generateAfterPrepare,choices:i.choices})}),
 'social.mediaGenerate':action({input:z.object({packId:Pack,choices:z.array(z.object({platform:Platform,format:z.enum(['recommended','video','carousel']),videoStyle:z.enum(VIDEO_STYLE_IDS).optional()})).min(1).max(3),requestId:z.string().uuid().optional(),sourceNotes:Notes}),run:(c,i)=>generateMedia(c.bid,i.packId,i.choices,i.requestId,i.sourceNotes)}),
 'social.mediaCancel':action({input:z.object({packId:Pack,platform:Platform,requestId:z.string().uuid()}),run:(c,i)=>cancelMedia(c.bid,i.packId,i.platform,i.requestId)}),
 'social.mediaStyle':action({input:z.object({packId:Pack,platform:Platform,videoStyle:z.enum(VIDEO_STYLE_IDS),expectedMediaRevision:z.number().int().min(0)}).strict(),run:(c,i)=>saveMediaStyle(c.bid,i.packId,i.platform,i.videoStyle,i.expectedMediaRevision)}),
 'social.mediaRetry':action({input:z.object({generationId:z.string().uuid(),acknowledgePossibleCharge:z.boolean().optional()}),run:(c,i)=>retryMedia(c.bid,i.generationId,i.acknowledgePossibleCharge)}),
 'social.mediaNotes':action({read:true,role:'Viewer',input:z.object({generationId:z.string().uuid(),artifact:z.enum(['script','sources','storyboard','captions','alignment'])}),run:(c,i)=>mediaNotes(c.bid,i.generationId,i.artifact)}),
};
