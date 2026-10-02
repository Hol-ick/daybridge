import test from 'node:test';
import assert from 'node:assert/strict';
import {formatArchiveTime} from './archive-presentation.js';
test('local day labels preserve minutes across year boundaries',()=>{
  const now=new Date(2026,0,1,9).getTime();
  assert.match(formatArchiveTime(new Date(2026,0,1,8,5).getTime(),now),/^오늘 · .*8:05$/);
  assert.match(formatArchiveTime(new Date(2025,11,31,15,20).getTime(),now),/^어제 · .*3:20$/);
  assert.match(formatArchiveTime(new Date(2025,11,30,15,20).getTime(),now),/^2025\. 12\. 30\./);
});
test('invalid dates remain readable',()=>{
  for(const value of [NaN,Infinity,1e25])assert.equal(formatArchiveTime(value),'날짜 없음');
});
