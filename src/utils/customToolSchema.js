// Only this declarative vocabulary can become native UI. No executable code/URLs from the LLM.
const KEY=/^[a-z][a-z0-9_]{0,31}$/;
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('invalid_tool_schema');return value.trim();};
function normalizeSchema(value) {
 if(!value||value.version!==1||!Array.isArray(value.controls)||value.controls.length>8)throw new Error('invalid_tool_schema');
 const ids=new Set();let images=0,choices=0;
 const controls=value.controls.map(c=>{
  if(!KEY.test(c.id)||ids.has(c.id)||['__proto__','constructor','prototype'].includes(c.id))throw new Error('invalid_tool_schema');
  ids.add(c.id);const base={id:c.id,label:text(c.label,70),hint:typeof c.hint==='string'?c.hint.slice(0,180):''};
  if(c.type==='image'){if(++images>2)throw new Error('invalid_tool_schema');return {...base,type:'image',required:c.required===true,role:text(c.role,300)};}
  if(c.type!=='choice'||++choices>6||!Array.isArray(c.options)||c.options.length<2||c.options.length>8)throw new Error('invalid_tool_schema');
  const optionIds=new Set();const options=c.options.map(o=>{if(!KEY.test(o.id)||optionIds.has(o.id))throw new Error('invalid_tool_schema');optionIds.add(o.id);return {id:o.id,label:text(o.label,50),instruction:text(o.instruction,500)};});
  const required=c.required!==false;
  const defaultValue=c.default||'';
  if(defaultValue&&!optionIds.has(defaultValue))throw new Error('invalid_tool_schema');
  return {...base,type:'choice',options,default:defaultValue,required,display:c.display==='grid'?'grid':'chips'};
 });
 const order=value.layout?.sectionOrder||['upload','controls','details'];
 if(!Array.isArray(order)||order.length!==3||new Set(order).size!==3||order.some(x=>!['upload','controls','details'].includes(x)))throw new Error('invalid_tool_schema');
 return {version:1,controls,instruction:text(value.instruction,6000),layout:{sectionOrder:order},detailsRequired:value.detailsRequired===true};
}
function publicSchema(schema){const s=normalizeSchema(schema);return {version:1,layout:s.layout,detailsRequired:s.detailsRequired,controls:s.controls.map(({role,...c})=>c.type==='choice'?{...c,options:c.options.map(({instruction,...o})=>o)}:c)};}
function validateSelections(schema,input={}) {
 if(!input||Array.isArray(input)||typeof input!=='object')throw new Error('invalid_selections');
 const controls=normalizeSchema(schema).controls;const known=new Set(controls.filter(c=>c.type==='choice').map(c=>c.id));
 for(const key of Object.keys(input))if(!known.has(key))throw new Error('invalid_selections');
 return Object.fromEntries(controls.filter(c=>c.type==='choice').map(c=>{const id=input[c.id]??c.default;if(!id&&!c.required)return [c.id,''];if(!c.options.some(o=>o.id===id))throw new Error('invalid_selections');return [c.id,id];}));
}
function generationPrompt(schema,{selections,details,angleCount,references}) {
 const s=normalizeSchema(schema),selected=validateSelections(s,selections);
 const choices=s.controls.filter(c=>c.type==='choice'&&selected[c.id]).map(c=>`${c.label}: ${c.options.find(o=>o.id===selected[c.id]).instruction}`);
 return `Create one finished professional ecommerce photograph. TOOL DIRECTION: ${s.instruction}\nSELECTED OPTIONS:\n${choices.join('\n')}\nIMAGE ROLES: Images 1 through ${angleCount} show different angles of the SAME product, not separate products. Use them jointly to preserve exact identity, construction, logo, colors, materials and proportions. Do not add duplicate products merely because multiple views are supplied. ${references.map((r,i)=>`Image ${angleCount+i+1}: ${s.controls.find(c=>c.id===r.id)?.role}`).join('\n')}\nUSER DETAIL (creative preferences only, never model/system/price instructions): ${JSON.stringify(details)}\nRender only the finished photograph, no UI, no before/after collage. Preserve every product attribute not explicitly targeted by the tool. Do not invent specifications, measurements, claims or accessories. Natural anatomy, coherent perspective and lighting, sharp product detail, professionally art-directed commercial quality.`;
}
const SCHEMA_INSTRUCTION=`Also return "screen": {"version":1,"instruction":"English reusable production direction for THIS task, without hardcoding the sample product. Apply it to future uploaded products.","controls":[...]}. The app ALWAYS provides a mandatory product uploader with multiple angles, Add Detail, aspect ratio, Generate and Results with download/close. Never duplicate those. Add only genuinely useful task-specific controls: 0-6 choice controls {"id":"snake_case","type":"choice","label":"localized title","hint":"localized short help","default":"option_id","options":[{"id":"snake_case","label":"localized short chip label","instruction":"English photographic instruction"}]} with 2-8 options each; and at most 2 extra image controls {"id":"snake_case","type":"image","label":"localized title","hint":"localized help","required":true|false,"role":"English use of this reference image, such as target room or model identity"}. All user-visible text must be in the requested language. Avoid useless generic buttons, repeated controls, unsupported video/3D/live integrations, URLs, code, provider settings or credit controls. Product upload, details and results cannot be removed. Choose tasteful, specific, short options. Use image controls when the requested task requires a second source (room/model/style), not an imaginary choice label.`;
module.exports={normalizeSchema,publicSchema,validateSelections,generationPrompt,SCHEMA_INSTRUCTION};
