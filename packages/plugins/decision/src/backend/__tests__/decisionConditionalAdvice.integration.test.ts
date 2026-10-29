import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionModel, type DecisionRecommendation, type DecisionExpression } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';

const input = (id: string): DecisionExpression => ({ input: id });
const literal = (value: number): DecisionExpression => ({ literal: value });
const add = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'add', left, right });
const multiply = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'multiply', left, right });
const scenario = (id: string, inputId: string, value: number | boolean | null, nextAction?: string) => ({ id, label: id, inputs: [{ inputId, value }], ...(nextAction ? { nextAction } : {}) });

function software(): DecisionModel {
  const totals = [add(add(literal(120), multiply(literal(28), input('people'))), input('a_fee')),
    add(add(literal(198), multiply(literal(16), input('people'))), input('b_fee'))];
  return {
    title: '合成套餐', question: '每月预算与容量均满足时偏好A',
    inputs: [['people',6,'人'],['data',26,'GB'],['budget',300,'CNY/月'],['a_capacity',20,'GB'],['b_capacity',30,'GB'],['a_fee',0,'CNY/月'],['b_fee',0,'CNY/月']]
      .map(([id,value,unit]) => ({ quantityType: 'other', id:String(id),label:String(id),kind:'fact',value:Number(value),unit:String(unit),origin:'合成用户条件',status:'available' })),
    options: [{id:'a',label:'A',description:'120+28/人，20GB'},{id:'b',label:'B',description:'198+16/人，30GB'}],
    calculations: totals.map((expression,index)=>({ quantityType: 'money',id:index===0?'a_total':'b_total',label:index===0?'A月费':'B月费',unit:'CNY/月',expression})),
    checks: ['a','b'].flatMap((optionId,index)=>{
      const expression=totals[index];
      if(!expression) throw new Error('Missing test expression');
      return [
        {id:`${optionId}_budget`,optionId,label:'预算',left:expression,operator:'lte' as const,right:input('budget')},
        {id:`${optionId}_capacity`,optionId,label:'容量',left:input('data'),operator:'lte' as const,right:input(`${optionId}_capacity`)},
      ];
    }),
  };
}
function withPreference(source = software()): DecisionModel {
  return {...source,inputs:[...source.inputs,{ quantityType: 'other',id:'prefer_a',label:'两者满足时偏好A',kind:'preference',value:true,status:'available',origin:'用户明确偏好'}]};
}
function recommendation(): DecisionRecommendation {
  return {
    optionIds:['b'],rationale:'容量与预算同时成立选B',changeConditions:'完整自由条件仍保留',nextAction:'核对容量口径',unresolved:['是否含备份','是否有其他方案资料'],
    numericBasis:{calculationIds:['a_total','b_total'],boundaries:[{checkId:'a_capacity',inputId:'data'},{checkId:'b_budget',inputId:'b_fee'},{checkId:'b_budget',inputId:'people'}]},
    conditionalAdvice:{
      preference:{inputIds:['prefer_a'],optionOrder:['a','b'],reason:'用户只在均满足时偏好A'},
      cases:[scenario('seven','people',7,'两者超预算，核对提高预算至310或其他方案'),scenario('fee6','b_fee',6),scenario('fee601','b_fee',6.01),
        scenario('data20','data',20),scenario('data2001','data',20.01),scenario('data30','data',30),scenario('data31','data',31)],
      whenNonePass:'先核对失败约束，再调整条件或寻找其他方案',whenUndetermined:'先取得缺失信息，再重新比较',
    },
  };
}

describe('conditional choices through versioned project CLI',()=>{
  let db: Database.Database;
  let directory: string;
  beforeEach(()=>{
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'decision-advice-'));
    db=new Database(path.join(directory,'state.sqlite'));
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p'),('other');");
    for(const migration of decisionMigrations) migration.up(db);
  });
  afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  function run(argv: readonly string[],project='p') {
    const command=parseDecisionCli(argv);
    if(command.kind==='file') throw new Error('Test uses the admitted inline path');
    return executeDecisionCommand(command,db,project);
  }
  function projection(id:string,revision?:number) {
    const result=run(['read',id,...(revision?['--revision',String(revision)]:[])]);
    if(typeof result!=='object'||result===null||!('conditionalAdvice' in result)) throw new Error('Expected projection');
    return result;
  }
  function create(source=withPreference()) {
    const result=run(['create','--json',JSON.stringify(source)]);
    if(typeof result!=='object'||result===null||!('record' in result)) throw new Error('Expected record');
    return DecisionRecordSchema.parse(result.record);
  }
  function save(id:string,content=recommendation(),revision=1) {run(['recommend',id,'--expected-revision',String(revision),'--json',JSON.stringify(content)]);}

  it('persists the complete hypothesis list and recomputes all-option choices after SQLite reopen without changing facts',()=>{
    const initial=create(); const content=recommendation(); save(initial.id,content);
    db.close(); db=new Database(path.join(directory,'state.sqlite'));
    const view=projection(initial.id); const advice=view.conditionalAdvice;
    if(advice?.status!=='current') throw new Error('Expected current advice');
    expect(advice.baseline.outcome).toEqual({status:'ranked_choice',optionIds:['b']});
    expect(advice.cases.map(item=>[item.id,item.outcome.status,item.outcome.optionIds])).toEqual([
      ['seven','no_option_passes',[]],['fee6','ranked_choice',['b']],['fee601','no_option_passes',[]],
      ['data20','ranked_choice',['a']],['data2001','ranked_choice',['b']],['data30','ranked_choice',['b']],['data31','no_option_passes',[]],
    ]);
    expect(advice.cases[0]?.evaluation.calculations.map(item=>item.result)).toEqual([{status:'available',value:316},{status:'available',value:310}]);
    expect(advice.cases[0]?.authorNextAction).toContain('310');
    expect(advice.cases[0]?.outcome).toMatchObject({authorAction:content.conditionalAdvice?.whenNonePass});
    expect(view.record.model.inputs).toEqual(initial.model.inputs);
    expect(view.record.recommendation?.content).toEqual(content);
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get()).toEqual({n:2});
    expect(projection(initial.id).conditionalAdvice).toEqual(advice);
    expect(()=>run(['read',initial.id],'other')).toThrow('not found');
    const range=view.recommendationBasis;
    if(range?.status!=='current') throw new Error('Expected current numeric basis');
    expect(range.optionRanges.find(item=>item.input.id==='data')?.rows).toMatchObject([
      {lower:null,upper:20,upperInclusive:true,options:[{status:'pass'},{status:'pass'}]},
      {lower:20,upper:30,lowerInclusive:false,upperInclusive:true,options:[{status:'fail'},{status:'pass'}]},
      {lower:30,upper:null,lowerInclusive:false,options:[{status:'fail'},{status:'fail'}]},
    ]);
    expect(range.optionRanges.find(item=>item.input.id==='b_fee')?.rows[0]?.options[0]?.status).toBe('fail');
  });

  it('records no current choice when every option fails, rather than inventing a feasible waiting option',()=>{
    const source=withPreference(); source.inputs=source.inputs.map(item=>item.id==='people'?{...item,value:7}:item);
    const initial=create(source); const content={...recommendation(),optionIds:[]};
    save(initial.id,content);
    const advice=projection(initial.id).conditionalAdvice;
    if(advice?.status!=='current') throw new Error('Expected current advice');
    expect(advice.baseline.outcome).toEqual({status:'no_option_passes',optionIds:[],authorAction:content.conditionalAdvice?.whenNonePass});
    const numeric=projection(initial.id).recommendationBasis;
    if(numeric?.status!=='current') throw new Error('Expected numeric basis');
    expect(numeric.optionRanges.find(item=>item.input.id==='data')?.rows).toMatchObject([{lower:null,upper:null,options:[{status:'fail'},{status:'fail'}]}]);
    expect(projection(initial.id).record.model.options).toHaveLength(2);
  });

  it('does not carry a preference order into changed, unknown or withdrawn evidence, and does not treat missing checks as passing',()=>{
    const initial=create(); const content=recommendation();
    if(!content.conditionalAdvice) throw new Error('Expected test advice');
    content.conditionalAdvice.cases=[scenario('changed','prefer_a',false),scenario('unknown_capacity','a_capacity',null)]; save(initial.id,content);
    const advice=projection(initial.id).conditionalAdvice;
    if(advice?.status!=='current') throw new Error('Expected current advice');
    expect(advice.cases.map(item=>item.outcome.status)).toEqual(['preference_needs_review','needs_information']);
    const source=withPreference(); source.inputs=source.inputs.map(item=>item.id==='prefer_a'?{...item,status:'withdrawn'}:item);
    const withdrawn=create(source); save(withdrawn.id,{...content,optionIds:[]});
    expect(projection(withdrawn.id).conditionalAdvice).toMatchObject({baseline:{outcome:{status:'needs_information',optionIds:[]}}});
    const absent=withPreference(); absent.checks=absent.checks.filter(check=>check.optionId!=='a');
    const unchecked=create(absent); save(unchecked.id,{...content,numericBasis:undefined});
    expect(projection(unchecked.id).conditionalAdvice).toMatchObject({baseline:{options:[{status:'undetermined'},{status:'pass'}],outcome:{status:'needs_information'}}});
  });

  it('keeps qualitative cases unsorted and rejects incomplete orders, bad scenarios and inconsistent choices atomically',()=>{
    const source=withPreference(); source.checks=[]; source.calculations=[];
    const qualitative=create(source);
    const plain:DecisionRecommendation={optionIds:[],rationale:'定性比较尚缺信息',changeConditions:'继续核实',nextAction:'询问目标',unresolved:['价值取舍'],
      conditionalAdvice:{whenNonePass:'调整选项',whenUndetermined:'先了解偏好'}};
    save(qualitative.id,plain);
    expect(projection(qualitative.id).conditionalAdvice).toMatchObject({baseline:{outcome:{status:'needs_information'}}});
    const initial=create(); const good=recommendation();
    if(!good.conditionalAdvice?.preference) throw new Error('Missing test preference');
    const order=good.conditionalAdvice.preference;
    for(const content of [
      {...good,optionIds:['a']},{...good,optionIds:[]},
      {...good,conditionalAdvice:undefined,optionIds:[]},
      {...good,conditionalAdvice:{...good.conditionalAdvice,preference:{...order,optionOrder:['a']}}},
      {...good,conditionalAdvice:{...good.conditionalAdvice,preference:{...order,optionOrder:['a','a']}}},
      {...good,conditionalAdvice:{...good.conditionalAdvice,preference:{...order,inputIds:['budget']}}},
      {...good,conditionalAdvice:{...good.conditionalAdvice,cases:[scenario('bad','missing',1)]}},
      {...good,conditionalAdvice:{...good.conditionalAdvice,cases:[scenario('same','data',1),scenario('same','data',2)]}},
    ]) expect(()=>save(initial.id,content)).toThrow();
    expect(projection(initial.id).record.revision).toBe(1);
    const unranked={...good,conditionalAdvice:{...good.conditionalAdvice,preference:undefined}};
    save(initial.id,unranked);
    expect(projection(initial.id).conditionalAdvice).toMatchObject({baseline:{outcome:{status:'selection_required',optionIds:[]}}});
  });

  it('marks old branches for review without interpreting deleted inputs and reconstructs historical results exactly',()=>{
    const initial=create(); save(initial.id);
    const historical=projection(initial.id);
    const update={reason:'用户改变偏好和模型',inputs:[{ quantityType: 'other',id:'prefer_a',label:'改为偏好B',kind:'preference',value:false,status:'available',origin:'用户本轮更新'}],checks:[]};
    run(['update',initial.id,'--expected-revision','2','--json',JSON.stringify(update)]);
    expect(projection(initial.id).conditionalAdvice).toEqual({status:'needs_review',basedOnInputRevision:1});
    expect(projection(initial.id).recommendationBasis).toEqual({status:'needs_review',basedOnInputRevision:1});
    expect(projection(initial.id,2)).toEqual(historical);
    expect(()=>save(initial.id,{...recommendation(),numericBasis:null},2)).toThrow('Revision conflict');
  });

  it('preserves equality singletons and reports nonlinear parameter ranges as undetermined',()=>{
    const source=withPreference();
    source.options=source.options.filter(option=>option.id==='b');
    source.checks=[{id:'same',optionId:'b',label:'容量恰好等于当前数据',left:input('data'),operator:'eq',right:literal(26)}];
    const record=create(source);
    const content:DecisionRecommendation={...recommendation(),numericBasis:{calculationIds:[],boundaries:[{checkId:'same',inputId:'data'}]},
      conditionalAdvice:{preference:{inputIds:['prefer_a'],optionOrder:['b'],reason:'合成顺序'},whenNonePass:'调整条件',whenUndetermined:'补齐信息'}};
    save(record.id,content);
    const view=projection(record.id).recommendationBasis;
    if(view?.status!=='current') throw new Error('Expected ranges');
    expect(view.optionRanges[0]?.rows).toMatchObject([
      {lower:null,upper:26,upperInclusive:false,options:[{status:'fail'}]},
      {lower:26,upper:26,lowerInclusive:true,upperInclusive:true,options:[{status:'pass'}]},
      {lower:26,upper:null,lowerInclusive:false,options:[{status:'fail'}]},
    ]);
    source.checks=[{id:'nonlinear',optionId:'b',label:'平方约束',left:multiply(input('people'),input('people')),operator:'lte',right:literal(100)}];
    const nonlinear=create(source);
    save(nonlinear.id,{...content,numericBasis:{calculationIds:[],boundaries:[{checkId:'nonlinear',inputId:'people'}]}});
    const other=projection(nonlinear.id).recommendationBasis;
    if(other?.status!=='current') throw new Error('Expected ranges');
    expect(other.optionRanges[0]?.rows).toMatchObject([{lower:null,upper:null,options:[{status:'undetermined'}]}]);
    expect(other.optionRanges[0]?.boundaries[0]?.checks[0]?.result.status).toBe('unavailable');
  });

  it('keeps every selected course boundary and the closed equality points when projecting whole-option ranges',()=>{
    const source:DecisionModel={title:'课程',question:'8次全部准时，2200元/期，已满足时偏好A',
      inputs:[['budget',2200],['departure',1050],['a_tuition',1800],['a_book',200],['a_transport',20],['a_travel',40],['b_tuition',2100],['b_book',0],['b_transport',12]]
        .map(([id,value])=>({ quantityType: 'other',id:String(id),label:String(id),kind:'fact',value:Number(value),origin:'合成用户',status:'available'})),
      options:[{id:'a',label:'A',description:'18:30开课'},{id:'b',label:'B',description:'18:45开课'}],calculations:[],checks:[]};
    const aTotal=add(add(input('a_tuition'),input('a_book')),multiply(literal(8),input('a_transport')));
    const bTotal=add(add(input('b_tuition'),input('b_book')),multiply(literal(8),input('b_transport')));
    source.checks=[{id:'a_budget',optionId:'a',label:'A预算',left:aTotal,operator:'lte',right:input('budget')},
      {id:'b_budget',optionId:'b',label:'B预算',left:bTotal,operator:'lte',right:input('budget')},
      {id:'a_time',optionId:'a',label:'A准时',left:add(input('departure'),input('a_travel')),operator:'lte',right:literal(1110)},
      {id:'b_time',optionId:'b',label:'B准时',left:add(input('departure'),literal(25)),operator:'lte',right:literal(1125)}];
    const initial=create(withPreference(source));
    const content:DecisionRecommendation={...recommendation(),optionIds:['a'],numericBasis:{calculationIds:[],boundaries:[
      {checkId:'a_time',inputId:'a_travel'},{checkId:'a_time',inputId:'departure'},
      ...['a_tuition','a_book','a_transport'].map(inputId=>({checkId:'a_budget',inputId})),
      ...['b_tuition','b_book','b_transport'].map(inputId=>({checkId:'b_budget',inputId})),
    ]},conditionalAdvice:{preference:{inputIds:['prefer_a'],optionOrder:['a','b'],reason:'用户偏好'},whenNonePass:'调整可出发条件或换班次，不缺课',whenUndetermined:'先核对时刻',
      cases:[scenario('book1','b_book',1),scenario('book4','b_book',4),scenario('book401','b_book',4.01),scenario('time1750','departure',1070),scenario('time1751','departure',1071),scenario('time1820','departure',1100),scenario('time1821','departure',1101)]}};
    save(initial.id,content);
    const view=projection(initial.id);const basis=view.recommendationBasis;const advice=view.conditionalAdvice;
    if(basis?.status!=='current'||advice?.status!=='current') throw new Error('Expected projections');
    for(const [inputId,threshold] of [['a_travel',60],['a_book',240],['a_transport',25],['b_tuition',2104],['b_transport',12.5]] as const) {
      expect(basis.optionRanges.find(range=>range.input.id===inputId)?.rows[0]).toMatchObject({upper:threshold,upperInclusive:true});
    }
    expect(advice.cases.map(item=>[item.outcome.status,item.outcome.optionIds])).toEqual([
      ['ranked_choice',['a']],['ranked_choice',['a']],['ranked_choice',['a']],['ranked_choice',['a']],['ranked_choice',['b']],['ranked_choice',['b']],['no_option_passes',[]],
    ]);
  });
});
