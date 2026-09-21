const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeSchema,publicSchema,validateSelections,generationPrompt}=require('../src/utils/customToolSchema');
const schema={version:1,instruction:'Place the uploaded product in a professional room photograph.',controls:[{id:'light',type:'choice',label:'Light',default:'soft',options:[{id:'soft',label:'Soft',instruction:'Soft window light'},{id:'sun',label:'Sun',instruction:'Direct warm sunlight'}]},{id:'room',type:'image',label:'Room',required:true,role:'Target room, retain its architecture'}]};
test('server only accepts supported declarative controls, never executable UI or duplicate IDs',()=>{
 assert.equal(normalizeSchema(schema).controls.length,2);
 assert.throws(()=>normalizeSchema({...schema,controls:[{id:'script',type:'javascript',label:'Script'}]}));
 assert.throws(()=>normalizeSchema({...schema,controls:[schema.controls[0],schema.controls[0]]}));
 assert.throws(()=>normalizeSchema({...schema,controls:[{...schema.controls[0],id:'__proto__'}]}));
 assert.throws(()=>normalizeSchema({...schema,controls:[{...schema.controls[0],default:'invented'}]}));
});
test('client receives labels and options, never internal production instructions',()=>{
 const output=publicSchema(schema);assert.equal(output.instruction,undefined);assert.equal(output.controls[0].options[0].instruction,undefined);assert.equal(output.controls[1].role,undefined);
});
test('forged pricing/provider selections rejected, valid selection instructions rendered server-side',()=>{
 assert.throws(()=>validateSelections(schema,{price:0}));assert.throws(()=>validateSelections(schema,{light:'free'}));
 assert.deepEqual(validateSelections(schema,{}),{light:'soft'});
 const prompt=generationPrompt(schema,{selections:{light:'sun'},details:'Warm tones',angleCount:3,references:[{id:'room'}]});
 assert.match(prompt,/Direct warm sunlight/);assert.match(prompt,/Images 1 through 3/);assert.match(prompt,/Image 4: Target room/);assert.match(prompt,/SAME product/);
});
test('extra uploaded reference IDs cannot become invented prompt instructions',()=>{
 assert.throws(()=>validateSelections(schema,JSON.parse('{"__proto__":{"price":0}}')));
});
