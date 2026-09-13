const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const { stampStyleReferencePlate, isCurrentStyleReferencePlateUrl, STYLE_REFERENCE_PLATE_VARIANT } = require('../src/utils/styleReferenceImage');

test('old cached plates are regenerated; only the new font-safe variant is reused', () => {
  assert.equal(isCurrentStyleReferencePlateUrl('https://example.test/style_profile_grid_id_compact-v2_123.jpg'), false);
  assert.equal(isCurrentStyleReferencePlateUrl(`https://example.test/style_profile_grid_id_${STYLE_REFERENCE_PLATE_VARIANT}_123.jpg`), true);
  assert.equal(isCurrentStyleReferencePlateUrl(null), false);
});

test('style, color and staging labels fit narrow/wide inputs without covering the photo', async () => {
  for (const [width, height, label] of [[524,652,undefined],[1042,1298,'STYLE REFERENCE · CODE SR-1'],[180,320,'COLOR 1'],[120,120,'STAGING · REFERENCE'],[600,300,'A & B <REFERENCE>']]) {
    const input = await sharp({create:{width,height,channels:3,background:'#879BAE'}}).png().toBuffer();
    const result = await stampStyleReferencePlate(input, label);
    const { data, info } = await sharp(result).removeAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,width);assert.equal(info.height,height+Math.min(72,Math.max(40,Math.round(height*.045))));
    // Reference pixels remain above the appended label; glyphs stay inside it.
    assert.ok(Math.abs(data[0]-135)<5);
    let white=0,minX=width,maxX=0,minY=info.height,maxY=0;
    for(let y=height;y<info.height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*3;
      if(data[i]>190 && data[i+1]>190 && data[i+2]>190){white++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
    }
    assert.ok(white>15);assert.ok(minX>=4 && maxX<width-4);assert.ok(minY>height && maxY<info.height-1);
  }
});

test('bundled glyph rasterization works identically without installed system fonts', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diress-font-test-'));
  try {
    const config=path.join(dir,'fonts.conf');
    fs.writeFileSync(config,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><cachedir>${dir}/cache</cachedir></fontconfig>`);
    const renderer=path.resolve(__dirname,'../src/utils/referenceLabel.js');
    const render=(output,env)=>{
      const script=`const {renderReferenceLabel}=require(${JSON.stringify(renderer)});require('fs').writeFileSync(${JSON.stringify(output)},renderReferenceLabel({width:524,height:40,label:'STYLE REFERENCE · CODE SR-1',fontSize:18}));`;
      const run=spawnSync(process.execPath,['-e',script],{env,encoding:'utf8'});
      assert.equal(run.status,0,run.stderr);
    };
    const normal=path.join(dir,'normal.png'),isolated=path.join(dir,'isolated.png');
    render(normal,process.env);
    render(isolated,{...process.env,FONTCONFIG_FILE:config,FONTCONFIG_PATH:dir});
    assert.deepEqual(fs.readFileSync(isolated),fs.readFileSync(normal));
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
});
