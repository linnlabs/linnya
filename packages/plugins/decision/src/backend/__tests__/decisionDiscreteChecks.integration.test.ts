import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecisionRecordSchema } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { remoteOfferModel, remoteOfferRecommendation } from './fixtures/remoteOffer';

describe('mixed numeric and discrete constraints through the project CLI',()=>{
 let db:Database.Database;
 beforeEach(()=>{db=new Database(':memory:');db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");for(const migration of decisionMigrations)migration.up(db);});
 afterEach(()=>db.close());
 function run(argv:readonly string[]){const command=parseDecisionCli(argv);if(command.kind==='file')throw new Error('Inline fixture');return executeDecisionCommand(command,db,'p');}
 function create(source=remoteOfferModel()){const r=run(['create','--json',JSON.stringify(source)]);if(typeof r!=='object'||r===null||!('record' in r))throw new Error('Expected record');return DecisionRecordSchema.parse(r.record);}
 function read(id:string,revision?:number){const r=run(['read',id,...(revision?['--revision',String(revision)]:[])]);if(typeof r!=='object'||r===null||!('evaluation' in r))throw new Error('Expected projection');return r;}
 function save(id:string,revision:number,choices:string[]=[]){return run(['recommend',id,'--expected-revision',String(revision),'--json',JSON.stringify(remoteOfferRecommendation(choices))]);}

 it('keeps unknown, false and type mismatch distinct and tracks discrete dependencies in each hypothetical case',()=>{
  const record=create();save(record.id,1);
  expect(read(record.id).conditionalAdvice).toMatchObject({baseline:{options:[{status:'undetermined'},{status:'pass'}],outcome:{status:'needs_information'}}});
  const r=run(['simulate',record.id,'--expected-revision','2','--json',JSON.stringify({cases:[null,false,true,'true',1].map((value,index)=>({id:`case${index}`,label:'确认状况',inputs:[{inputId:'a_remote',value}]}))})]);
  if(typeof r!=='object'||r===null||!('cases' in r))throw new Error('Expected simulation');
  expect(r.cases.map(item=>item.evaluation.checks.find(check=>check.id==='a_remote')?.passes)).toEqual([null,false,true,null,null]);
  expect(r.cases.map(item=>item.references[0]?.checkIds)).toEqual(Array.from({length:5},()=>['a_remote']));
  expect(r.cases.every(item=>item.unreferencedInputIds.length===0)).toBe(true);
  expect(read(record.id).record.model.inputs.find(item=>item.id==='a_remote')?.value).toBeNull();
 });

 it('accepts confirmed preference, invalidates the old choice on withdrawal and preserves the original value in history',()=>{
  const record=create();run(['update',record.id,'--expected-revision','1','--json',JSON.stringify({reason:'取得书面确认',inputs:[{ quantityType: 'other',id:'a_remote',label:'A有适用全远程确认',kind:'fact',value:true,origin:'新书面依据',status:'available'}]})]);
  save(record.id,2,['a']);
  expect(read(record.id).conditionalAdvice).toMatchObject({baseline:{outcome:{status:'ranked_choice',optionIds:['a']}}});
  run(['update',record.id,'--expected-revision','3','--json',JSON.stringify({reason:'确认依据撤回',inputs:[{ quantityType: 'other',id:'a_remote',label:'A有适用全远程确认',kind:'fact',value:true,origin:'已撤回的书面依据',status:'withdrawn'}]})]);
  expect(read(record.id).conditionalAdvice).toEqual({status:'needs_review',basedOnInputRevision:2});
  save(record.id,4);
  const current=read(record.id);expect(current.conditionalAdvice).toMatchObject({baseline:{outcome:{status:'needs_information'}}});
  expect(current.record.model.inputs.find(item=>item.id==='a_remote')).toMatchObject({value:true,status:'withdrawn'});
  expect(read(record.id,3).conditionalAdvice).toMatchObject({baseline:{outcome:{status:'ranked_choice',optionIds:['a']}}});
 });

 it('keeps a fixed discrete failure in every numeric region and never invents a continuous boundary for a discrete variable',()=>{
  const source=remoteOfferModel();source.inputs=source.inputs.map(item=>item.id==='a_remote'?{...item,value:false}:item);
  const record=create(source);save(record.id,1,['b']);
  const view=read(record.id).recommendationBasis;if(view?.status!=='current')throw new Error('Expected numeric basis');
  expect(view.optionRanges[0]?.rows).toMatchObject([{lower:null,upper:null,options:[{optionId:'a',status:'fail'},{optionId:'b',status:'pass'}]}]);
  const content=remoteOfferRecommendation(['b']);content.numericBasis={calculationIds:[],boundaries:[{checkId:'a_remote',inputId:'a_remote'}]};
  run(['recommend',record.id,'--expected-revision','2','--json',JSON.stringify(content)]);
  const second=read(record.id).recommendationBasis;if(second?.status!=='current')throw new Error('Expected basis');
  expect(second.boundaries[0]?.result.status).toBe('unavailable');
 });

 it('matches text exactly and rejects unknown input references without changing the current record',()=>{
  const source=remoteOfferModel();source.inputs=source.inputs.map(item=>item.id==='a_remote'?{...item,value:'remote'}:item);
  source.checks=source.checks.map(check=>check.id==='a_remote'?{id:check.id,optionId:check.optionId,label:'工作方式原文',operator:'is',inputId:'a_remote',value:'remote'}:check);
  const record=create(source);save(record.id,1,['a']);
  expect(read(record.id).evaluation.checks.find(check=>check.id==='a_remote')).toMatchObject({passes:true,left:{status:'available',value:'remote'}});
  const changed=source.checks.map(check=>check.id==='a_remote'?{id:check.id,optionId:check.optionId,label:check.label,operator:'is',inputId:'missing',value:true}:check);
  expect(()=>run(['update',record.id,'--expected-revision','2','--json',JSON.stringify({reason:'非法引用',checks:changed})])).toThrow('Unknown input');
  expect(read(record.id).record.revision).toBe(2);
 });
});
