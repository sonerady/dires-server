const {normalizeSchema}=require('./customToolSchema');
const {publicTool}=require('./customStudioBrief');
const SEED=require('../data/productStudioSeed.json');
const BUILTINS=new Set(SEED.map(x=>x.builtin_id));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(v,max,optional=false){if(optional&&(v==null||v===''))return '';if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('invalid_input');return v.trim();}
function imageUrl(v){if(!v)return '';const u=new URL(text(v,2048));if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid_image_url');return u.href;}
function normalizeDraft(v,{builtinId=null,publish=false}={}){
 if(!v||v.version!==1||builtinId&&!BUILTINS.has(builtinId))throw Error('invalid_input');
 const language=/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(v.language)?v.language:'en';
 const title=text(v.title,70),description=text(v.description,500),translations={};
 for(const [locale,copy]of Object.entries(v.translations||{})){
  if(!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(locale))throw Error('invalid_locale');
  translations[locale]={title:text(copy.title,70),description:text(copy.description,500,true)};
  if(copy.controls){if(JSON.stringify(copy.controls).length>24000)throw Error('invalid_input');translations[locale].controls=copy.controls;}
 }
 translations[language]={...translations[language],title,description};
 if(!Number.isInteger(v.buttonHue)||v.buttonHue<0||v.buttonHue>359)throw Error('invalid_input');
 const pairs=v.introExamples||[];if(!Array.isArray(pairs)||pairs.length>3)throw Error('invalid_input');
 const result={version:1,language,title,description,translations,buttonHue:v.buttonHue,beforeUrl:imageUrl(v.beforeUrl),afterUrl:imageUrl(v.afterUrl),introExamples:pairs.map(p=>({beforeUrl:imageUrl(p.beforeUrl),afterUrl:imageUrl(p.afterUrl)})),screen:v.screen?normalizeSchema(v.screen):null};
 if(result.screen&&description.length<15)throw Error('invalid_input');
 if(publish&&(!builtinId||result.screen)&&(!result.screen||!result.beforeUrl||!result.afterUrl||result.introExamples.length!==3||result.introExamples.some(p=>!p.beforeUrl||!p.afterUrl)))throw Error('publish_incomplete');
 return result;
}
function catalogCard(row,language){
 const d=row.published;if(!row.enabled||!d)return null;
 const tool=publicTool({id:row.id,language:d.language,title:d.title,description:d.description,brief:d.description,translations:d.translations,button_hue:d.buttonHue,screen_schema:d.screen,status:'completed',before_url:d.beforeUrl,after_url:d.afterUrl,intro_examples:d.introExamples},language);
 return {...tool,id:d.screen?row.id:row.builtin_id,sourceId:row.builtin_id,catalogId:row.id,managed:true,custom:!!d.screen,position:row.position};
}
async function accessibleTool(db,id,owner){
 const result=await db.from('custom_studio_tools').select('*').eq('id',id).is('deleted_at',null).maybeSingle();if(result.error)throw result.error;
 const row=result.data;if(!row)return null;if(row.user_id===owner)return row;if(row.user_id!==null)return null;
 const c=await db.from('product_studio_catalog').select('id').eq('id',id).eq('enabled',true).not('published','is',null).maybeSingle();if(c.error)throw c.error;
 return c.data?{...row,catalogManaged:true}:null;
}
module.exports={normalizeDraft,catalogCard,accessibleTool,UUID,SEED};
