const test=require('node:test');const assert=require('node:assert/strict');
const {isFashionCampaignShoot,isCleanWhiteStudio,buildFashionCampaignDirection,buildFashionCampaignEnhanceInstruction}=require('../src/utils/fashionCampaignPrompt');
test('campaign direction is restricted to clothing creation, including legacy unclassified requests',()=>{
 for(const settings of [{productCategory:'clothing'},{},null])assert.equal(isFashionCampaignShoot(settings),true);
 for(const productCategory of ['shoes','jewelry'])assert.equal(isFashionCampaignShoot({productCategory}),false);
 for(const key of ['isColorChange','isPoseChange','isEditMode','isRefinerMode','isBackSideAnalysis'])assert.equal(isFashionCampaignShoot({}, {[key]:true}),false);
});
test('seamless white applies to selected backdrops, not white garments or other locations',()=>{
 for(const location of ['Clean White Photography Studio Background','White cyclorama','Beyaz stüdyo fonu'])assert.equal(isCleanWhiteStudio({location}),true);
 for(const location of ['Snowy Street','White House Garden','Photography Studio','Black Studio'])assert.equal(isCleanWhiteStudio({location,productColor:'white'}),false);
 assert.match(buildFashionCampaignDirection({settings:{location:'Clean White Photography Studio Background'}}),/CLEAN WHITE BACKDROP/);
 assert.doesNotMatch(buildFashionCampaignDirection({settings:{location:'Snowy Street'}}),/CLEAN WHITE BACKDROP/);
});
test('explicit style references bypass defaults; user emotions and deliberate equipment requests retain priority',()=>{
 assert.equal(buildFashionCampaignDirection({settings:{location:'White studio'},hasStyleReference:true}),'');
 const p=buildFashionCampaignDirection({settings:{location:'White studio'}});
 assert.match(p,/explicitly requested broad smile or laugh must remain broad/);
 assert.match(p,/behind-the-scenes equipment take precedence/);
 assert.match(p,/babies are safely supported/);
});
test('enhancer retains selected settings, details and multi-angle vs outfit semantics',()=>{
 const p=buildFashionCampaignEnhanceInstruction({settings:{location:'White studio'},originalPrompt:'Age 29. Hand in pocket.',customDetail:'Laugh openly',context:'framing: full_body; hijab: true',multipleAnglesCount:4,kombinItemCount:2});
 for(const part of ['Age 29. Hand in pocket.','Laugh openly','framing: full_body; hijab: true','4 views of ONE product','every distinct supplied product'])assert.ok(p.includes(part));
});

test('preset and uploaded poses are flexible while explicit written requirements keep priority',()=>{
 const {buildFashionPoseContext}=require('../src/utils/fashionCampaignPrompt');
 const strict='Match this uploaded pose exactly';
 assert.equal(buildFashionPoseContext({hasUserPose:false,posePromptSection:strict}),'');
 for (const poseType of ['default','custom']) {
  const p=buildFashionPoseContext({settings:{poseType,pose:'Hand in pocket'},hasUserPose:true,posePromptSection:strict});
  assert.match(p,/Hand in pocket/);
  assert.match(p,/nearby/);
  assert.match(p,/Additional details/);
  assert.doesNotMatch(p,/Match this uploaded pose exactly/);
 }
});
test('final user lock relaxes pose only when fashion interpretation is enabled',()=>{
 const {buildUserInstructionLock}=require('../src/utils/userInstructionLock');
 const args={settings:{pose:'Standing',mood:'happy',framing:'full_body'},customDetail:'Keep both hands raised',hasPoseReference:true};
 const strict=buildUserInstructionLock(args);
 assert.match(strict,/Match the attached pose/);
 const relaxed=buildUserInstructionLock({...args,allowFashionPoseInterpretation:true});
 assert.match(relaxed,/flexible inspiration/);
 assert.match(relaxed,/Keep both hands raised/);
 assert.match(relaxed,/MOOD.*happy/);
 assert.match(relaxed,/head-to-toe/);
 assert.doesNotMatch(relaxed,/Match the attached pose/);
});

test('upper-body focus leaves scene space while an explicit framing selection takes priority',()=>{
 const {buildFashionFocusDirective}=require('../src/utils/fashionCampaignPrompt');
 const upper=buildFashionFocusDirective({focusArea:'upper_body'});
 assert.match(upper,/complete upper garment/);
 assert.match(upper,/visible environment beside both arms/);
 assert.doesNotMatch(upper,/hard, non-negotiable/);
 const explicit=buildFashionFocusDirective({focusArea:'upper_body',framing:'full_body'});
 assert.match(explicit,/explicitly selected full_body/);
 assert.doesNotMatch(explicit,/Frame the head, torso/);
 for(const focusArea of ['auto','detail','close_up']) assert.equal(buildFashionFocusDirective({focusArea}), '');
});

test('scene integration relights identity and respects close-up and user-written exceptions',()=>{
 const {buildSceneIntegrationDirection}=require('../src/utils/fashionCampaignPrompt');
 const scene=buildSceneIntegrationDirection({settings:{location:'Ancient Marble Columns'}});
 for(const text of ['discard the reference portrait', 'same key light', 'one horizon', 'venue inventory', 'explicit' ]) assert.ok(scene.toLowerCase().includes(text.toLowerCase()));
 const tight=buildSceneIntegrationDirection({settings:{focusArea:'detail'}});
 assert.match(tight,/Honor the explicitly selected close-up/);
 assert.doesNotMatch(tight,/moderate focal length/);
 const {buildUserInstructionLock}=require('../src/utils/userInstructionLock');
 const lock=buildUserInstructionLock({settings:{locationEnhancedPrompt:'Wide shot of an empty marble plaza',focusArea:'upper_body'},customDetail:'No modificar el bordado',locationDescriptionIsSceneContext:true});
 assert.match(lock,/venue inventory/);
 assert.match(lock,/No modificar el bordado/);
 assert.doesNotMatch(lock,/attached location reference/);
});

test('fashion body direction specifies both arms without imposing one repeated pose or overriding explicit requests',()=>{
 const {buildFashionBodyLanguageDirection}=require('../src/utils/fashionCampaignPrompt');
 const p=buildFashionBodyLanguageDirection();
 for(const phrase of ['THIS garment','No prescribed hand position','age, abilities','explicit user-written pose requirements','scene-matched lighting']) assert.ok(p.includes(phrase));
 const final=buildFashionCampaignDirection({settings:{location:'White studio'}});
 assert.match(final,/FASHION BODY LANGUAGE/);
 assert.match(final,/CLEAN WHITE BACKDROP/);
 const enhance=buildFashionCampaignEnhanceInstruction({settings:{},customDetail:'Stand symmetrically with both arms straight'});
 assert.match(enhance,/Do not impose a signature stance/);
 assert.doesNotMatch(p,/hand-on-hip|hand-in-pocket|hair-adjusting|bent elbow|weight shifted onto/);
 assert.match(enhance,/Stand symmetrically with both arms straight/);
});

test('campaign brief commissions a new performance rather than a background replacement',()=>{
 const p=buildFashionCampaignEnhanceInstruction({settings:{location:'Ancient ruins'},customDetail:'Preserve the embroidery'});
 assert.match(p,/Start with "Create a new fashion campaign photograph"/);
 assert.match(p,/First decide the visual idea/);
 assert.doesNotMatch(p,/Start with "Replace"|distinctive but restrained/);
 assert.match(p,/physically shared light/);
 assert.match(p,/Preserve the embroidery/);
 assert.match(p,/No prescribed hand position/);
});
