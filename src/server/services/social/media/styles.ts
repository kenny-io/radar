import {legacyVideoStyle,type VideoStyleId} from '@/lib/videoStyles';
export interface VisualTheme {id:VideoStyleId;family:'Radar Hand'|'Radar Sans';align:'left'|'center';labelSize:number;bg:string;line:string;input:string;output:string;attention:string;panel:string;captionBg:string;captionText:string;footer:string;fills:{input:string;output:string;other:string}}
const themes:Record<VideoStyleId,VisualTheme>={
 drawn:{id:'drawn',family:'Radar Hand',align:'center',labelSize:44,bg:'#10151d',line:'#f1ecdf',input:'#77b8f1',output:'#90d5ae',attention:'#f1cf6d',panel:'#10151d',captionBg:'#10151d',captionText:'#f1ecdf',footer:'#707985',fills:{input:'#10151d',output:'#10151d',other:'#10151d'}},
 kinetic:{id:'kinetic',family:'Radar Sans',align:'center',labelSize:48,bg:'#101216',line:'#f4f6ef',input:'#81d9f5',output:'#bce779',attention:'#e1ed8c',panel:'#23292e',captionBg:'#101216',captionText:'#f4f6ef',footer:'#929a9d',fills:{input:'#101216',output:'#101216',other:'#101216'}},
 editorial:{id:'editorial',family:'Radar Sans',align:'left',labelSize:44,bg:'#f5f0e5',line:'#242b31',input:'#204c6c',output:'#28563f',attention:'#725017',panel:'#eee8da',captionBg:'#242b31',captionText:'#fffaf0',footer:'#5d6263',fills:{input:'#e7edf0',output:'#e6ece3',other:'#f5f0e5'}},
 'paper-cut':{id:'paper-cut',family:'Radar Hand',align:'center',labelSize:44,bg:'#f6efe2',line:'#352a24',input:'#2a4c60',output:'#305338',attention:'#754127',panel:'#e8decc',captionBg:'#352a24',captionText:'#fff9ed',footer:'#6a5b50',fills:{input:'#d2e6ed',output:'#d2e3c8',other:'#eed8b3'}},
 blueprint:{id:'blueprint',family:'Radar Sans',align:'center',labelSize:44,bg:'#0b2038',line:'#e0edf6',input:'#8cd2f2',output:'#a0e5d5',attention:'#f6d48c',panel:'#102b47',captionBg:'#081b2e',captionText:'#e0edf6',footer:'#92a9bb',fills:{input:'#102b47',output:'#102b47',other:'#0b2038'}},
};
export const visualTheme=(style?:VideoStyleId)=>themes[legacyVideoStyle(style)];
export const fontFace=(family:'Radar Hand'|'Radar Sans')=>`"${family}", "Radar Sans"`;
