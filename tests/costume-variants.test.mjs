import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCostumes, expandBaseTokens, resolveCostumeWear, promoteCostumeToDefault, mergeCostumeLists, reuseCreatedCostumePicks } from '../.test-build/character-costume.mjs';
import { insertCharacterPlaceholders } from '../.test-build/character-placeholders.mjs';

test('appearance variants inherit only explicit base and retain empty clothing', () => {
  const rec = { appearance: 'girl', hair_color: 'black hair', costumes: [
    {name:'default', attire:'shirt',bottoms:'skirt',accessories:''},
    {name:'magic',hair_color:'pink hair',appearance:' [base] ',attire:'',bottoms:'[base]',accessories:''},
  ]};
  const {costumes} = ensureCostumes(rec);
  assert.equal(costumes.length,2);
  assert.equal(costumes[1].eye_color,'[base]');
  const look = resolveCostumeWear(rec,'magic');
  assert.equal(look.appearance,'girl'); assert.equal(look.hair_color,'pink hair');
  assert.equal(look.attire,''); assert.equal(look.bottoms,'skirt');
  assert.ok(!JSON.stringify(look).includes('[base]'));
  const promoted = promoteCostumeToDefault(costumes,costumes[1]);
  assert.equal(promoted[0].bottoms,'skirt'); assert.equal(promoted[0].hair_color,'pink hair');
});
test('[base] expands token-wise: mixed fields inherit default plus extras', () => {
  assert.equal(expandBaseTokens('[base], happy', 'coat'), 'coat, happy');
  assert.equal(expandBaseTokens('[base]', 'coat'), 'coat');
  assert.equal(expandBaseTokens('[base]', '[base]'), '');
  assert.equal(expandBaseTokens('happy', 'coat'), 'happy');
  assert.equal(expandBaseTokens('', 'coat'), '');
  const rec = { appearance: 'girl, black hair', costumes: [
    {name:'default', attire:'coat', accessories:''},
    {name:'party', appearance:'[base], happy', attire:'[base], ribbon'},
  ]};
  const look = resolveCostumeWear(rec, 'party');
  assert.equal(look.appearance, 'girl, black hair, happy');
  assert.equal(look.attire, 'coat, ribbon');
  assert.ok(!JSON.stringify(look).includes('[base]'));
});
test('same clothes with different looks survive; automatic imports protect default', () => {
  const base = {name:'default',hair_color:'black hair',attire:'dress',accessories:''};
  const variants = mergeCostumeLists([base],[{...base,name:'magic',hair_color:'pink hair'}],{protectDefault:true});
  assert.equal(variants.length,2);
  const kept = mergeCostumeLists(variants,[{...base,hair_color:'blue hair',attire:'coat'}],{protectDefault:true});
  assert.equal(kept[0].hair_color,'black hair'); assert.equal(kept[0].attire,'dress');
});
test('character placeholders use original order and preserve excluded negatives', () => {
  const captions = [{prompt:'A',uc:'bad A',center_x:.2},{prompt:'B',uc:'bad B',center_x:.8}];
  const part=insertCharacterPlaceholders('scene @ch2@ @ch2@ @ch9@','blur',captions);
  assert.equal(part.main,'scene B B '); assert.deepEqual(part.captions,[captions[0]]);
  assert.equal(part.neg,'blur, bad B');
  const all=insertCharacterPlaceholders('@ch1@ @ch2@','',captions);
  assert.deepEqual(all.captions,[]); assert.equal(all.main,'A B');
  assert.deepEqual(insertCharacterPlaceholders(all.main,all.neg,all.captions),all);
});

test('generated aliases reuse the matching appearance rather than the last active set', () => {
 const costumes=[{name:'default',attire:'coat',accessories:''},{name:'magic',hair_color:'pink hair',attire:'dress',accessories:''}];
 const shots=[{characters:[{name:'Alice',costume:'new_magic'}]}];
 reuseCreatedCostumePicks(shots,[{name:'Alice',costumes:[{...costumes[1],name:'new_magic'}]}],[{name:'Alice',costumes}]);
 assert.equal(shots[0].characters[0].costume,'magic');
});


test('duplicate default repair preserves different looks and remaps the selected duplicate',()=>{
 const row={name:'default',attire:'dress',note:'daily',hair_color:'black hair'};
 const result=ensureCostumes({costumes:[row,{...row},{...row,hair_color:'pink hair'}],active_costume:2});
 assert.equal(result.costumes.length,2);
 assert.equal(result.active_costume,1);
 assert.equal(result.costumes[1].name,'default_2');
 assert.equal(result.costumes[1].hair_color,'pink hair');
 assert.deepEqual(ensureCostumes(result),result);
 const once=promoteCostumeToDefault(result.costumes,result.costumes[1]);
 assert.deepEqual(promoteCostumeToDefault(once,once[0]),once);
 const changed=promoteCostumeToDefault(once,{...once[0],hair_color:'blue hair'});
 assert.ok(changed.some(row=>row.hair_color==='pink hair'));
 assert.ok(changed.some(row=>row.hair_color==='black hair'));
});
