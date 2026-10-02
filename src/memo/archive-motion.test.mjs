import test from 'node:test';
import assert from 'node:assert/strict';
import {runMemoMotion} from './archive-motion.js';
test('motion finishes, rejection settles, and reduced motion never animates',async()=>{
  let calls=0;
  const element={animate(){calls++;return {finished:Promise.resolve(),cancel(){}};}};
  await runMemoMotion(element,[],{duration:1});assert.equal(calls,1);
  await runMemoMotion(element,[],{duration:1,reducedMotion:true});assert.equal(calls,1);
  await runMemoMotion(null,[],{duration:1});
  await runMemoMotion({animate(){return {finished:Promise.reject(Error('cancelled')),cancel(){}};}},[],{duration:1});
});
test('abort cancels a never finishing animation and settles',async()=>{
  const abort=new AbortController();let cancelled=false;
  const pending=runMemoMotion({animate(){return {finished:new Promise(()=>{}),cancel(){cancelled=true;}};}},[],{duration:1,signal:abort.signal});
  abort.abort();await pending;assert.equal(cancelled,true);
});
