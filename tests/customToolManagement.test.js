const test=require('node:test'),assert=require('node:assert/strict');
const {publicTool,toolHue}=require('../src/utils/customStudioBrief');
test('cover is ready before introduction rendering finishes',()=>{
 const tool=publicTool({status:'processing',before_url:'before',after_url:'after',intro_examples:[]});
 assert.equal(tool.coverReady,true);assert.equal(tool.examplesReady,false);
});
test('localized copy uses requested locale, region fallback, then original',()=>{
 const row={language:'tr',title:'Başlık',brief:'Açıklama',translations:{tr:{title:'Türkçe'},en:{title:'English',description:'Description'},fr:{title:'Français'}}};
 assert.equal(publicTool(row,'en-US').title,'English');assert.equal(publicTool(row,'fr').title,'Français');assert.equal(publicTool(row,'ko').title,'Türkçe');assert.equal(publicTool(row,'ko').description,'Açıklama');
});
test('assigned hue survives renaming and jewelry receives an amber default',()=>{
 assert.equal(toolHue({title:'Jewelry Retouch'}),38);assert.equal(toolHue({title:'changed',button_hue:38}),38);
});
