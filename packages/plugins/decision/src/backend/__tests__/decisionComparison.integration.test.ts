import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecisionRecordSchema } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { decisionPluginCli } from '../features/decision-cli/orchestration/prepareDecisionCli';
import { remoteOfferModel, remoteOfferRecommendation } from './fixtures/remoteOffer';

describe('read-only version impact through project CLI',()=>{
 let db:Database.Database;
 beforeEach(()=>{db=new Database(':memory:');db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');");for(const migration of decisionMigrations)migration.up(db);});
 afterEach(()=>db.close());
 function run(argv:readonly string[],project='p'){const command=parseDecisionCli(argv);if(command.kind==='file')throw new Error('Inline fixture');return executeDecisionCommand(command,db,project);}
 function create(){const result=run(['create','--json',JSON.stringify(remoteOfferModel())]);if(typeof result!=='object'||result===null||!('record' in result))throw new Error('Record expected');return DecisionRecordSchema.parse(result.record);}
 function compare(id:string,from:number,to:number){const result=run(['compare',id,'--from',String(from),'--to',String(to)]);if(typeof result!=='object'||result===null||!('kind' in result)||result.kind!=='comparison')throw new Error('Comparison expected');return result;}
 const confirmation=(value:boolean,status:'available'|'withdrawn'='available',origin='测试书面依据')=>({id:'a_remote',label:'A有适用的全远程书面确认',kind:'fact',value,origin,status});
 function update(id:string,revision:number,inputs:unknown[]){run(['update',id,'--expected-revision',String(revision),'--json',JSON.stringify({reason:'更新条件',inputs})]);}
 function recommend(id:string,revision:number,selected:string[]){run(['recommend',id,'--expected-revision',String(revision),'--json',JSON.stringify(remoteOfferRecommendation(selected))]);}

 it('distinguishes confirmation changes from unchanged arithmetic and checks the old selection under the target model',()=>{
  const r=create();recommend(r.id,1,[]);update(r.id,2,[confirmation(true)]);recommend(r.id,3,['a']);
  const delta=compare(r.id,2,4);
  expect(delta.changes.inputs.changed).toHaveLength(1);
  expect(delta.changes.inputs.changed[0]).toMatchObject({id:'a_remote',fields:['value','origin']});
  expect(delta.effects.calculations.changed).toEqual([]);
  expect(delta.effects.checks.changed).toMatchObject([{id:'a_remote',before:{passes:null},after:{passes:true}}]);
  expect(delta.effects.dependencies).toEqual([{inputId:'a_remote',before:{calculationIds:[],checkIds:['a_remote']},after:{calculationIds:[],checkIds:['a_remote']}}]);
  expect(delta.recommendations).toMatchObject({from:{optionIds:[]},to:{status:'current',optionIds:['a']},contentChanged:true});
  update(r.id,4,[confirmation(true,'withdrawn','依据已撤回')]);
  const withdrawn=compare(r.id,4,5);
  expect(withdrawn.changes.inputs.changed[0]?.fields).toEqual(['status','origin']);
  expect(withdrawn.effects.previousSelectionInTarget).toMatchObject([{optionId:'a',state:{status:'undetermined',unknownCheckIds:['a_remote']}}]);
  expect(withdrawn.recommendations.to.status).toBe('needs_review');
 });

 it('reports origin-only changes without numerical effects and supports either explicit comparison direction',()=>{
  const r=create();update(r.id,1,[confirmation(false)]);recommend(r.id,2,['b']);update(r.id,3,[confirmation(false,'available','同一已知事实的来源补充')]);
  const rows=db.prepare('SELECT * FROM decision_record_versions').all();
  const delta=compare(r.id,3,4);expect(delta.changes.inputs.changed[0]?.fields).toEqual(['origin']);
  expect(delta.effects.calculations.changed).toEqual([]);expect(delta.effects.checks.changed).toEqual([]);
  expect(delta.effects.previousSelectionInTarget).toMatchObject([{optionId:'b',state:{status:'pass'}}]);
  expect(compare(r.id,4,3).changes.inputs.changed[0]?.after.origin).toBe('测试书面依据');
  expect(compare(r.id,4,4).changes.inputs.changed).toEqual([]);
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(rows);
 });

 it('reports changed formula, removed option and removed checks instead of attributing all effects to input values',()=>{
  const r=create();update(r.id,1,[confirmation(true)]);recommend(r.id,2,['a']);const source=remoteOfferModel();
  const next={reason:'A退出候选，B费用模型修订',options:source.options.filter(option=>option.id==='b'),checks:source.checks.filter(check=>check.optionId==='b'),
   calculations:source.calculations.map(calculation=>calculation.id==='b_surplus'?{...calculation,expression:{op:'subtract',left:{input:'b_income'},right:{literal:10000}}}:calculation)};
  run(['update',r.id,'--expected-revision','3','--json',JSON.stringify(next)]);
  const delta=compare(r.id,3,4);expect(delta.changes.options.removed.map(item=>item.id)).toEqual(['a']);
  expect(delta.changes.calculations.changed.map(item=>item.id)).toEqual(['b_surplus']);
  expect(delta.changes.checks.removed.map(item=>item.id)).toEqual(['a_budget','a_remote']);
  expect(delta.effects.calculations.changed[0]).toMatchObject({id:'b_surplus',before:{result:{value:17000}},after:{result:{value:16000}}});
  expect(delta.effects.previousSelectionInTarget).toMatchObject([{optionId:'a',state:{status:'removed'}}]);
 });

 it('rejects cross-project and missing versions and uses the same admitted read-only bridge capability',async()=>{
  const r=create();const rows=db.prepare('SELECT * FROM decision_record_versions').all();
  expect(()=>run(['compare',r.id,'--from','1','--to','1'],'other')).toThrow('not found');
  expect(()=>compare(r.id,1,99)).toThrow('not found');
  const prepared=decisionPluginCli.prepare({argv:['compare',r.id,'--from','1','--to','1'],conversationRoot:'/not-used',invocationId:'comparison'});
  if(prepared.status!=='ready')throw new Error('Expected ready');
  expect(prepared.plan.access.conversationFiles).toBe('none');
  const result=await prepared.plan.execute({conversationId:'test',projectId:'p',signal:new AbortController().signal,hostContext:{databaseService:{getDb:()=>db}}});
  expect(result.exitCode).toBe(0);
  const reply:unknown=JSON.parse(result.stdout);expect(reply).toEqual(compare(r.id,1,1));
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(rows);
 });
});
