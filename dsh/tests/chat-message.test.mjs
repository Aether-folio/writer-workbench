import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverWorkbenchMessage} from '../src/chat-message.mjs';

function fixture({fail=false,unsupported=false}={}) {
  let draft='已有问题和附件说明',focused=false;
  const sent=[];
  const scope={get:name=>name==='conversation' && !unsupported?{async send(text){if(fail)throw new Error('发送被拒绝');sent.push(text);}}:undefined};
  return {sent,get draft(){return draft;},get focused(){return focused;},
    run:send=>deliverWorkbenchMessage({params:{content:[{type:'text',text:'写作请求'}],_meta:{'openai/message':{target:'active',send}}},sessionId:'active-session',sessions:{scope:id=>{assert.equal(id,'active-session');return scope;}},conversation:{input:{for:received=>{assert.equal(received,scope);return {state:{getSnapshot:()=>({draft})},setDraft:text=>{draft=text;}};}}},focusComposer:()=>{focused=true;}})};
}
test('direct sending uses the active session and preserves the existing composer',async()=>{
  const f=fixture();await f.run(true);
  assert.deepEqual(f.sent,['写作请求']);assert.equal(f.draft,'已有问题和附件说明');assert.equal(f.focused,false);
});
test('ordinary quotes still append to a draft without sending',async()=>{
  const f=fixture();await f.run(false);
  assert.deepEqual(f.sent,[]);assert.equal(f.draft,'已有问题和附件说明\n\n写作请求');assert.equal(f.focused,true);
});
test('rejected and unsupported direct sends do not change drafts or report success',async()=>{
  for(const options of [{fail:true},{unsupported:true}]) {
    const f=fixture(options);await assert.rejects(f.run(true));
    assert.deepEqual(f.sent,[]);assert.equal(f.draft,'已有问题和附件说明');
  }
});
