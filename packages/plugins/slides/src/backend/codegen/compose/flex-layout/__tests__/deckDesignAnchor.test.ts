import { describe, it, expect } from 'vitest';
import {
  buildDeckDesignAnchor,
  emptyDeckDesignAnchor,
  serializeDeckDesignAnchor,
} from '../deckDesignAnchor.js';
import type { ThemeSpec } from '@plugin/slides/shared';

function makeFullTheme(): ThemeSpec {
  return {
    colors: {
      accent1: '#0B2545',
      accent2: '#1A6B4A',
      accent3: '#C45B28',
      background: '#FFFFFF',
      text: '#1A1A1A',
      muted: '#777777',
    },
    fonts: {
      major: 'PingFang SC',
      minor: 'PingFang SC',
    },
  };
}

describe('buildDeckDesignAnchor', () => {
  it('returns null when theme is undefined / null', () => {
    expect(buildDeckDesignAnchor(undefined)).toBeNull();
    expect(buildDeckDesignAnchor(null)).toBeNull();
  });

  it('maps the persisted theme into palette + fonts subset', () => {
    const anchor = buildDeckDesignAnchor(makeFullTheme());
    expect(anchor).toEqual({
      palette: {
        accent1: '#0B2545',
        accent2: '#1A6B4A',
        accent3: '#C45B28',
        background: '#FFFFFF',
        text: '#1A1A1A',
        muted: '#777777',
      },
      fonts: {
        major: 'PingFang SC',
        minor: 'PingFang SC',
      },
    });
  });

  it('omits empty / blank string fields without throwing', () => {
    const theme: ThemeSpec = {
      ...makeFullTheme(),
      colors: {
        accent1: '#0B2545',
        accent2: '   ',
        accent3: '',
        background: '#FFFFFF',
        text: '#1A1A1A',
        muted: '',
      },
      fonts: {
        major: '',
        minor: 'PingFang SC',
      },
    };
    const anchor = buildDeckDesignAnchor(theme);
    expect(anchor).toEqual({
      palette: {
        accent1: '#0B2545',
        background: '#FFFFFF',
        text: '#1A1A1A',
      },
      fonts: {
        minor: 'PingFang SC',
      },
    });
  });

  it('still returns an anchor (with empty subsections) when no fields are valid', () => {
    const theme: ThemeSpec = {
      ...makeFullTheme(),
      colors: {
        accent1: '',
        accent2: '',
        accent3: '',
        background: '',
        text: '',
        muted: '',
      },
      fonts: { major: '', minor: '' },
    };
    const anchor = buildDeckDesignAnchor(theme);
    expect(anchor).not.toBeNull();
    expect(anchor?.palette).toEqual({});
    expect(anchor?.fonts).toEqual({});
  });

  it('trims surrounding whitespace before assigning', () => {
    const theme: ThemeSpec = {
      ...makeFullTheme(),
      colors: {
        ...makeFullTheme().colors,
        accent1: '  #112233  ',
      },
      fonts: { major: '  PingFang  ', minor: 'Arial' },
    };
    const anchor = buildDeckDesignAnchor(theme);
    expect(anchor?.palette.accent1).toBe('#112233');
    expect(anchor?.fonts.major).toBe('PingFang');
  });
});

describe('serializeDeckDesignAnchor', () => {
  it('null 入参返回空骨架（永远是对象，避免 sandbox 端 NPE）', () => {
    const result = serializeDeckDesignAnchor(null);
    expect(result).not.toBeNull();
    expect(result).toEqual({ palette: {}, fonts: {} });
  });

  it('produces a plain JSON-safe object copy', () => {
    const anchor = buildDeckDesignAnchor(makeFullTheme());
    const serialized = serializeDeckDesignAnchor(anchor);
    expect(serialized).toEqual({
      palette: {
        accent1: '#0B2545',
        accent2: '#1A6B4A',
        accent3: '#C45B28',
        background: '#FFFFFF',
        text: '#1A1A1A',
        muted: '#777777',
      },
      fonts: {
        major: 'PingFang SC',
        minor: 'PingFang SC',
      },
    });
    serialized.palette.accent1 = '#000';
    expect(anchor?.palette.accent1).toBe('#0B2545');
  });

  it('空字段 anchor 序列化后仍是空骨架（与 null 入参等价）', () => {
    const anchor = buildDeckDesignAnchor({
      ...makeFullTheme(),
      colors: {
        accent1: '',
        accent2: '',
        accent3: '',
        background: '',
        text: '',
        muted: '',
      },
      fonts: { major: '', minor: '' },
    });
    const serialized = serializeDeckDesignAnchor(anchor);
    expect(serialized).toEqual({ palette: {}, fonts: {} });
  });
});

describe('emptyDeckDesignAnchor', () => {
  it('返回独立可变的空骨架（每次调用都是新对象，避免共享引用）', () => {
    const a = emptyDeckDesignAnchor();
    const b = emptyDeckDesignAnchor();
    expect(a).toEqual({ palette: {}, fonts: {} });
    expect(b).toEqual({ palette: {}, fonts: {} });
    expect(a).not.toBe(b);
    expect(a.palette).not.toBe(b.palette);
    expect(a.fonts).not.toBe(b.fonts);
  });
});
