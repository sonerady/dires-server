const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStarterModelNamesPrompt, validateStarterModelNames, generateStarterModelNames } = require('../src/utils/starterModelNames');
test('the LLM receives language and modern-name instructions without any name examples',async()=>{
  let received;
  const result=await generateStarterModelNames(async(prompt)=>{received=prompt;return '["Özgü","İlay","Derin"]';},'woman','tr-TR');
  assert.deepEqual(result,['Özgü','İlay','Derin']);
  assert.match(received,/tr-TR/);
  assert.match(received,/contemporary, fresh, modern/);
  assert.match(received,/Avoid old-fashioned, traditional-sounding/);
  assert.doesNotMatch(received,/Alina|Naomi|Mika|Adrian|Malik|Ren|Ada|Mira|Lina|Atlas|Aras|Ege|example|e\.g\./);
  assert.notEqual(received,buildStarterModelNamesPrompt('woman','tr-TR')); 
});
test('native scripts survive validation; duplicate or malformed names are rejected',()=>{
  assert.deepEqual(validateStarterModelNames(['蓮','湊','蒼']),['蓮','湊','蒼']);
  assert.deepEqual(validateStarterModelNames(['ليان','رُبى','تالا']),['ليان','رُبى','تالا']);
  for(const names of [['same','Same','Other'],['A','B'],['A','B','<tag>']])assert.throws(()=>validateStarterModelNames(names));
});
test('invalid output is retried with a fresh naming variation and never falls back to fixed names',async()=>{
  const prompts=[];
  await assert.rejects(generateStarterModelNames(async(p)=>{prompts.push(p);return 'not-json';},'man','ja'));
  assert.equal(prompts.length,2);assert.notEqual(prompts[0],prompts[1]);
});

 test('existing names are excluded and repeated suggestions are retried', async()=>{
  const prompts=[];
  const result=await generateStarterModelNames(async prompt=>{prompts.push(prompt);return prompts.length===1?'["Derin","Simay","Duru"]':'["Özgü","İlay","Nehir"]';},'woman','tr',{excludeNames:['derin','Simay']});
  assert.deepEqual(result,['Özgü','İlay','Nehir']);
  assert.equal(prompts.length,2);
  assert.match(prompts[0],/\["derin","Simay"\]/);
 });
 test('recent names are not reused after deletion, but are scoped to their owner',async()=>{
  const old=['Derin','Simay','Duru'];
  await generateStarterModelNames(async()=>JSON.stringify(old),'woman','tr',{scope:'owner-a'});
  let received;
  await generateStarterModelNames(async prompt=>{received=prompt;return '["Özgü","İlay","Nehir"]';},'woman','tr',{scope:'owner-a'});
  assert.match(received,/Derin/);assert.match(received,/Simay/);
  await assert.rejects(generateStarterModelNames(async()=>JSON.stringify(old),'woman','tr',{scope:'owner-a'}),/already used/);
  assert.deepEqual(await generateStarterModelNames(async()=>JSON.stringify(old),'woman','tr',{scope:'owner-b'}),old);
 });
