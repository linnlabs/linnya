import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectAskPresentation } from './projectAskPresentation';

const inputArgs = {
  questions: [{ id: 'q_1', type: 'text' as const, question: '请输入主题' }],
};

function project(overrides: Partial<ToolPresentationProjectorInput> = {}) {
  return projectAskPresentation({
    sourceToolName: 'ask',
    uiKey: 'ask',
    toolCallId: 'call_1',
    args: inputArgs,
    result: undefined,
    status: 'loading',
    phase: 'update',
    ...overrides,
  });
}

const successResult = {
  data: {
    questionnaireId: 'qn_1',
    allowSkip: true,
    submitLabel: '提交',
    skipLabel: '跳过',
    questions: inputArgs.questions,
  },
  observation: 'Waiting for user input.',
  control: {
    requireUser: true,
    questionnaireId: 'qn_1',
    resumeStrategy: 'continue',
  },
};

describe('projectAskPresentation', () => {
  it('只在 start/loading 接纳严格空参数占位', () => {
    expect(project({ args: {}, phase: 'start' }).data.questionnaire).toEqual({
      kind: 'placeholder',
    });
    expect(project({ args: {}, phase: 'update' }).data.questionnaire).toEqual({
      kind: 'placeholder',
    });
    expect(project({ args: { pending: true }, phase: 'start' }).data.questionnaire).toEqual({
      kind: 'placeholder',
    });
  });

  it('完整 loading 参数形成不可提交的 preview', () => {
    expect(project().data).toEqual({
      toolCallId: 'call_1',
      toolName: 'ask',
      questionnaire: { kind: 'preview', data: inputArgs },
      interaction: { type: 'pending' },
    });
  });

  it('历史 ask_questions 只改变 source tool name，问卷合同保持一致', () => {
    expect(project({ sourceToolName: 'ask_questions', uiKey: 'ask_questions' }).data).toMatchObject(
      {
        toolCallId: 'call_1',
        toolName: 'ask_questions',
        questionnaire: { kind: 'preview', data: inputArgs },
      }
    );
  });

  it('成功结果与 active interaction 形成可恢复的正式问卷', () => {
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: successResult,
        interaction: {
          status: 'active',
          interactionId: 'interaction_1',
          runId: 'run_1',
          checkpointRevision: 1,
          resumeToken: 'resume_1',
        },
      }).data
    ).toMatchObject({
      questionnaire: { kind: 'canonical', data: successResult.data },
      interaction: { type: 'active' },
    });
  });

  it('等待用户事件在 loading/update 生命周期接纳 canonical form data', () => {
    const presentation = project({
      status: 'loading',
      phase: 'update',
      result: successResult,
      interaction: {
        status: 'active',
        interactionId: 'interaction_1',
        runId: 'run_1',
        checkpointRevision: 1,
        resumeToken: 'resume_1',
      },
    });

    expect(presentation).toMatchObject({
      data: {
        questionnaire: { kind: 'canonical', data: successResult.data },
        interaction: { type: 'active' },
      },
    });
  });

  it('submitted response 必须满足 ask 答案合同', () => {
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: successResult,
        interaction: {
          status: 'submitted',
          submittedAt: 123,
          response: {
            answers: {},
            multiAnswers: {},
            textAnswers: { q_1: '主题' },
            otherAnswers: {},
          },
        },
      }).data.interaction
    ).toEqual({
      type: 'submitted',
      timestamp: 123,
      userAnswers: {
        answers: {},
        multiAnswers: {},
        textAnswers: { q_1: '主题' },
        otherAnswers: {},
      },
    });

    expect(() =>
      project({
        status: 'success',
        phase: 'complete',
        result: successResult,
        interaction: { status: 'submitted', response: { textAnswers: {} } },
      })
    ).toThrow();
  });

  it('展示投影不再依赖 runtime control，并拒绝不属于问卷的终态', () => {
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: { data: successResult.data, observation: successResult.observation },
      }).data.questionnaire
    ).toEqual({ kind: 'canonical', data: successResult.data });
    expect(() =>
      project({
        status: 'success',
        phase: 'complete',
        result: successResult,
        interaction: { status: 'approved' },
      })
    ).toThrow('Unsupported ask interaction status');
  });
});
