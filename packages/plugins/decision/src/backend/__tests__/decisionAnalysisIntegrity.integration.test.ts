import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecisionRecordSchema } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { remoteOfferModel, remoteOfferRecommendation } from './fixtures/remoteOffer';

describe('explicit replacement of persisted decision analysis',()=>{
 let db:Database.Database;
 beforeEach(()=>{db=new Database(':memory:');db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");for(const migration of decisionMigrations)migration.up(db);});
 afterEach(()=>db.close());
 function run(argv:readonly string[]){const c=parseDecisionCli(argv);if(c.kind==='file')throw new Error('Inline fixture');return executeDecisionCommand(c,db,'p');}
 function create(){const r=run(['create','--json',JSON.stringify(remoteOfferModel())]);if(typeof r!=='object'||r===null||!('record' in r))throw new Error('Expected record');return DecisionRecordSchema.parse(r.record);}
 function read(id:string){const r=run(['read',id]);if(typeof r!=='object'||r===null||!('record' in r))throw new Error('Expected projection');return r;}
 function save(id:string,revision:number,content:ReturnType<typeof remoteOfferRecommendation>){return run(['recommend',id,'--expected-revision',String(revision),'--json',JSON.stringify(content)]);}

 it('rejects omitted analyses after a condition update without inheriting the old plan or appending any recommendation',()=>{
  const r=create();save(r.id,1,remoteOfferRecommendation());
  run(['update',r.id,'--expected-revision','2','--json',JSON.stringify({reason:'取得确认',inputs:[{ quantityType: 'other',id:'a_remote',label:'A书面确认',kind:'fact',value:true,origin:'新事实',status:'available'}]})]);
  const rows=db.prepare('SELECT * FROM decision_record_versions').all();const content=remoteOfferRecommendation(['a']);
  for(const partial of [{...content,conditionalAdvice:undefined},{...content,numericBasis:undefined},{...content,conditionalAdvice:undefined,numericBasis:undefined}]) {
   expect(()=>save(r.id,3,partial)).toThrow('Existing analysis omitted');
   expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(rows);
  }
  expect(read(r.id).conditionalAdvice).toEqual({status:'needs_review',basedOnInputRevision:1});
  save(r.id,3,content);
  expect(read(r.id).conditionalAdvice).toMatchObject({baseline:{outcome:{status:'ranked_choice',optionIds:['a']}}});
 });

 it('allows first use without analysis, records explicit disabling and reports case/ref removals in compare',()=>{
  const r=create();const manual={...remoteOfferRecommendation(['b']),conditionalAdvice:undefined,numericBasis:undefined};save(r.id,1,manual);
  const full=remoteOfferRecommendation(['b']);if(!full.conditionalAdvice)throw new Error('Expected fixture');
  full.conditionalAdvice.cases=[{id:'lower_income',label:'收入变动假设',inputs:[{inputId:'a_income',value:28000}]},{id:'known_no',label:'明确没有确认',inputs:[{inputId:'a_remote',value:false}]}];
  save(r.id,2,full);
  save(r.id,3,{...full,conditionalAdvice:null,numericBasis:null});
  const current=read(r.id);expect(current.record.recommendation?.content.conditionalAdvice).toBeNull();expect(current.conditionalAdvice).toBeNull();expect(current.recommendationBasis).toBeNull();
  const delta=run(['compare',r.id,'--from','3','--to','4']);if(typeof delta!=='object'||delta===null||!('analysisChanges' in delta))throw new Error('Expected comparison');
  expect(delta.analysisChanges.conditionalAdvice).toMatchObject({beforeEnabled:true,afterEnabled:false,targetDisposition:'disabled'});
  expect(delta.analysisChanges.conditionalAdvice.cases.removed.map(item=>item.id)).toEqual(['lower_income','known_no']);
  expect(delta.analysisChanges.numericBasis.removedCalculationIds).toEqual(['a_surplus','b_surplus']);
  expect(delta.analysisChanges.numericBasis.boundaries.removed.map(item=>item.id)).toEqual(['a_budget/a_income']);
  const history=run(['read',r.id,'--revision','3']);if(typeof history!=='object'||history===null||!('record' in history))throw new Error('Expected history');
  expect(history.record.recommendation?.content.conditionalAdvice?.cases).toHaveLength(2);
 });
});
