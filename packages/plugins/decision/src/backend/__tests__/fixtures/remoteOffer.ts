import type { DecisionExpression, DecisionModel, DecisionRecommendation } from '../../../shared';
const input = (id: string): DecisionExpression => ({ input: id });
const surplus = (prefix: string): DecisionExpression => ({ op: 'subtract', left: input(`${prefix}_income`), right: input(`${prefix}_cost`) });

/** 合成场景：工作安排是独立硬条件，不把书面确认未知偷偷转换成0或false。 */
export function remoteOfferModel(): DecisionModel {
  return {
    title: '合成offer取舍', question: '结余与书面远程条件均满足时优先A',
    inputs: [
      ...[['a_income',30000],['a_cost',12000],['b_income',26000],['b_cost',9000],['minimum',16000]].map(([id,value])=>({id:String(id),label:String(id),kind:'fact' as const,value:Number(value),unit:'CNY/月',origin:'合成用户给定',status:'available' as const})),
      {id:'a_remote',label:'A有适用的全远程书面确认',kind:'fact',value:null,origin:'用户表示尚未确定',status:'available'},
      {id:'b_remote',label:'B有适用的全远程书面确认',kind:'fact',value:true,origin:'用户明确确认',status:'available'},
      {id:'preference',label:'均满足时偏好A',kind:'preference',value:'A_then_B',origin:'用户明确偏好',status:'available'},
    ],
    options:[{id:'a',label:'A',description:'30000收入，12000固定支出'},{id:'b',label:'B',description:'26000收入，9000固定支出'}],
    calculations:['a','b'].map(id=>({id:`${id}_surplus`,label:`${id}结余`,unit:'CNY/月',expression:surplus(id)})),
    checks:['a','b'].flatMap(optionId=>[
      {id:`${optionId}_budget`,optionId,label:'月结余底线',operator:'gte' as const,left:surplus(optionId),right:input('minimum')},
      {id:`${optionId}_remote`,optionId,label:'全远程书面确认',operator:'is' as const,inputId:`${optionId}_remote`,value:true},
    ]),
  };
}
export function remoteOfferRecommendation(optionIds: string[] = []): DecisionRecommendation {
  return {
    optionIds,rationale:'先满足硬条件，再按明确偏好选择',changeConditions:'书面确认或可支配结余变化后重算',nextAction:'取得可适用的书面工作安排',unresolved:['A远程是否已确认'],
    numericBasis:{calculationIds:['a_surplus','b_surplus'],boundaries:[{checkId:'a_budget',inputId:'a_income'}]},
    conditionalAdvice:{preference:{inputIds:['preference'],optionOrder:['a','b'],reason:'用户明确顺序'},whenNonePass:'调整真实条件或增加候选',whenUndetermined:'先核实缺失的书面条件'},
  };
}
