/** Public visual choices only. No source, account, renderer or provider data belongs here. */
export const VIDEO_STYLE_IDS=['drawn','kinetic','editorial','paper-cut','blueprint'] as const;
export type VideoStyleId=typeof VIDEO_STYLE_IDS[number];
export const DEFAULT_VIDEO_STYLE:VideoStyleId='drawn';
export const VIDEO_STYLES=[
 {id:'drawn',label:'Drawn explainer',description:'Linked drawings that explain each step.',version:1},
 {id:'kinetic',label:'Kinetic type',description:'Moving words put the main idea first.',version:1},
 {id:'editorial',label:'Editorial',description:'A clean, paced story with clear takeaways.',version:1},
 {id:'paper-cut',label:'Paper cut',description:'Layered paper shapes bring the story to life.',version:1},
 {id:'blueprint',label:'Blueprint',description:'A precise schematic for how things connect.',version:1},
].map(style=>({...style,id:style.id as VideoStyleId,poster:`/social/video-styles/${style.id}.jpg`,preview:`/social/video-styles/${style.id}.mp4`})) as readonly {id:VideoStyleId;label:string;description:string;version:number;poster:string;preview:string}[];
export const isVideoStyle=(value:unknown):value is VideoStyleId=>VIDEO_STYLE_IDS.includes(value as VideoStyleId);
/** Missing legacy style means Drawn; unknown future/corrupt values must never masquerade as Drawn. */
export function legacyVideoStyle(value:VideoStyleId|null|undefined):VideoStyleId{if(value==null)return DEFAULT_VIDEO_STYLE;if(!isVideoStyle(value))throw new Error('Unsupported video style');return value;}
export function videoStylePreset(id:VideoStyleId){const preset=VIDEO_STYLES.find(style=>style.id===id);if(!preset)throw new Error('Unsupported video style');return preset;}
