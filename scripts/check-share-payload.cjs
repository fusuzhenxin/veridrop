const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { transformSync } = require('esbuild');
const code = transformSync(fs.readFileSync('src/report-share.jsx','utf8'), {loader:'jsx',format:'cjs'}).code;
const context = vm.createContext({module:{exports:{}}, require:() => ({}), URL, Intl, Date});
vm.runInContext(code,context);
const {publicSharePayload, sharePosterInfo} = context.module.exports;
const source = {id:'candy-fixture123',suite:'candy',base:'https://name:password@relay.test/v1?apiKey=SECRET',
  model:'样例模型',host:'relay.test',started:1794090000000,finishedAt:1794090076000,
  key:'PRIVATE_CUSTOM_KEY',keyMask:'PRIVATE',rows:[{id:'candy',label:'糖果测试',status:'pass',raw:'PRIVATE_CUSTOM_KEY',summary:'PRIVATE_CUSTOM_KEY Bearer super-secret-token'}],
  candyRows:[{dimension:'数量关系',prompt:'test',picked:'PRIVATE_CUSTOM_KEY',ok:true}]};
const payload = publicSharePayload(source,['PRIVATE_CUSTOM_KEY']);
assert(!JSON.stringify(payload).includes('PRIVATE'));
assert(!JSON.stringify(payload).includes('super-secret-token'));
assert(!JSON.stringify(payload).includes('password'));
assert.equal(payload.base,'https://relay.test');
assert.equal(source.key,'PRIVATE_CUSTOM_KEY','Sharing never changes local source');
const info = sharePosterInfo(payload,'https://www.veridrop.cn/check/candy?share=abcdefghijklmnopqrstuvwx');
assert.equal(info.title,'糖果测试'); assert.equal(info.score,100);
const pelican = sharePosterInfo({...payload,suite:'pelican',rows:[{id:'pelican',label:'鹈鹕骑车',status:'pass'}]},'https://example.test');
assert.equal(pelican.score,null,'A picture test has no invented score'); assert.equal(pelican.mark,'通过');
console.log('PASS: client key stripping, URL credential stripping, unchanged local data, candy poster metrics, no fake pelican score.');
