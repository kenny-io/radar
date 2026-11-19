import { scriptOf,phraseOffset,type Alignment,type Plan,type Timeline } from './model';
import { captionFits } from './draw';
export function checkAlignment(a:Alignment,duration:number){
 const n=a?.characters?.length;if(!n||n>15000||a.character_start_times_seconds?.length!==n||a.character_end_times_seconds?.length!==n)throw new Error('Narration timing is incomplete');
 let prev=0;for(let i=0;i<n;i++){const s=a.character_start_times_seconds[i],e=a.character_end_times_seconds[i];if(typeof a.characters[i]!=='string'||!Number.isFinite(s)||!Number.isFinite(e)||s<prev-0.02||s<0||e<s||e>duration+1)throw new Error('Narration timing is invalid');prev=s;}
}
const words=(s:string)=>s.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)||[];
export function timelineFor(plan:Plan,a:Alignment,audioDuration:number):Timeline{
 checkAlignment(a,audioDuration);const text=a.characters.join('');
 if(words(text).join(' ')!==words(scriptOf(plan)).join(' '))throw new Error('Narration does not match the reviewed script');
 const tokens=[...text.matchAll(/\S+/g)].map(m=>({text:m[0],start:m.index!,end:m.index!+m[0].length-1}));
 const offset=0.5;const scenes:Timeline['scenes']=[];let cursor=0;
 for(const scene of plan.scenes){const count=words(scene.narration).length;let consumed=0,start=cursor;
  while(cursor<tokens.length&&consumed<count){consumed+=words(tokens[cursor].text).length;cursor++;}
  if(consumed!==count||!tokens[start])throw new Error('Scene timing could not be aligned');
  const first=tokens[start].start,last=tokens[cursor-1].end;
  const sceneText=text.slice(first,last+1);const originalWords=[...scene.narration.matchAll(/[\p{L}\p{N}]+/gu)],alignedWords=[...sceneText.matchAll(/[\p{L}\p{N}]+/gu)];const cues=scene.cues.map(cue=>{const at=phraseOffset(scene.narration,cue.phrase,cue.occurrence);const from=originalWords.findIndex(w=>w.index!+w[0].length>at);let to=from;while(to+1<originalWords.length&&originalWords[to+1].index!<at+cue.phrase.length)to++;const startWord=alignedWords[from],endWord=alignedWords[to];if(!startWord||!endWord)throw new Error('A drawing cue could not be aligned to spoken words');return {kind:cue.kind,target:cue.target,start:a.character_start_times_seconds[first+startWord.index!]+offset,end:a.character_end_times_seconds[first+endWord.index!+endWord[0].length-1]+offset};});
  scenes.push({scene,cues,start:a.character_start_times_seconds[first]+offset,end:a.character_end_times_seconds[last]+offset});
 }
 const captions:Timeline['captions']=[];let at=0;
 while(at<tokens.length){let best=-1,bestScore=-Infinity;
  for(let end=at+1;end<=Math.min(tokens.length,at+20);end++){const phrase=tokens.slice(at,end).map(w=>w.text).join(' ');if(!captionFits(phrase))continue;
   const last=tokens[end-1].text,next=tokens[end]?.text||'';const count=end-at;if(count<3&&end<tokens.length)continue;
   const dangling=/^(?:a|an|the|of|to|for|with|and|or|if|when|before|after|at|in|on|should|can|will|have|has|go|record)$/i.test(last);
   const remaining=tokens.slice(end).findIndex(t=>/[.!?;,:]$/.test(t.text));if(remaining===0&&end<tokens.length&&!/[.!?;,:]$/.test(last))continue;
   let score=count*3;if(/[.!?]$/.test(last))score+=100;else if(/[;,:]$/.test(last))score+=65;else if(/^(?:if|before|after|because|when|and|but|so)$/i.test(next))score+=35;if(dangling)score-=100;
   if(score>bestScore){best=end;bestScore=score;}if(/[.!?]$/.test(last))break;
  }
  if(best<0)throw new Error('Narration needs shorter caption phrases');const group=tokens.slice(at,best);captions.push({start:a.character_start_times_seconds[group[0].start]+offset,end:a.character_end_times_seconds[group.at(-1)!.end]+offset,text:group.map(w=>w.text).join(' ')});at=best;
 }
 return {duration:audioDuration+offset+0.8,scenes,captions};
}
export function captionsVtt(t:Timeline){const stamp=(n:number)=>new Date(Math.round(n*1000)).toISOString().slice(11,23);return 'WEBVTT\n\n'+t.captions.map(c=>`${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');}
