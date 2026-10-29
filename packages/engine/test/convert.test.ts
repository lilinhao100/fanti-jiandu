import { describe, expect, it } from 'vitest';
import { convertText, DEFAULT_OPTIONS, ENGINE_VERSION, QUOTE_MAP, VERTICAL_PUNCT_MAP } from '../src/index';
import { opts } from './env';

const tw = opts({ variant: 'tw' });
const twNoVocab = opts({ variant: 'tw', vocabulary: false });
const hk = opts({ variant: 'hk' });
const generic = opts({ variant: 't' });

describe('基本', () => {
  it('ENGINE_VERSION 是正整数', () => {
    expect(Number.isInteger(ENGINE_VERSION)).toBe(true);
    expect(ENGINE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('默认选项', () => {
    expect(DEFAULT_OPTIONS).toEqual({
      convert: true,
      vocabulary: true,
      quotes: true,
      cleanup: true,
      horizontal: true,
      variant: 'tw',
    });
  });

  it('字形：幣 → 币', () => {
    expect(convertText('燈塔日記', tw)).toBe('灯塔日记');
    expect(convertText('燈塔日記', hk)).toBe('灯塔日记');
    expect(convertText('燈塔日記', generic)).toBe('灯塔日记');
  });

  it('简体、英文、数字、空串原样', () => {
    for (const s of ['灯塔日记', 'Hello, world 123', '', '  ', '2024-01-01', 'https://example.com/幣']) {
      const out = convertText(s, tw);
      if (s.includes('幣')) expect(out).toBe('https://example.com/币');
      else expect(out).toBe(s);
    }
  });

  it('convert 关掉：什么都不转', () => {
    const o = opts({ convert: false, horizontal: false });
    expect(convertText('燈塔「軟體」', o)).toBe('燈塔「軟體」');
  });

  it('同样输入两次结果一致（确定性）', () => {
    const s = '燈塔的軟體與網路，「你好」。';
    expect(convertText(s, tw)).toBe(convertText(s, tw));
  });

  it('同音异义的一对多字按上下文取词', () => {
    expect(convertText('頭髮', tw)).toBe('头发');
    expect(convertText('發財', tw)).toBe('发财');
    expect(convertText('乾淨', tw)).toBe('干净');
    expect(convertText('乾坤', tw)).toBe('乾坤');
    expect(convertText('後面', tw)).toBe('后面');
    expect(convertText('皇后', tw)).toBe('皇后');
    expect(convertText('裡面', tw)).toBe('里面');
  });
});

describe('词汇层：台湾用语（tw → twp）', () => {
  // 期望值以 opencc-js 的实际输出为准，已人工核对过大陆用语是否合理
  const cases: [string, string][] = [
    ['軟體', '软件'],
    ['網路', '网络'],
    ['影片', '视频'],
    ['資訊', '信息'],
    ['程式', '程序'],
    ['滑鼠', '鼠标'],
    ['記憶體', '内存'],
    ['硬碟', '硬盘'],
    ['伺服器', '服务器'],
    ['資料庫', '数据库'],
    ['資料', '资料'],
    ['社群', '社群'],
    ['物件', '物件'],
    ['物件導向', '面向对象'],
    ['印表機', '打印机'],
    ['螢幕', '屏幕'],
    ['隨身碟', 'U盘'],
    ['行動電話', '移动电话'],
    ['計程車', '出租车'],
    ['腳踏車', '自行车'],
    ['使用者', '用户'],
    ['檔案', '文件'],
    ['作業系統', '操作系统'],
    ['演算法', '算法'],
    ['光碟', '光盘'],
    ['解析度', '分辨率'],
    ['列印', '打印'],
    ['登入', '登录'],
    ['連結', '链接'],
    ['訊息', '消息'],
    ['簡訊', '短信'],
    ['視訊', '视频'],
    ['頻寬', '带宽'],
    ['晶片', '芯片'],
    ['人工智慧', '人工智能'],
    ['雷射', '激光'],
    ['網際網路', '互联网'],
    ['數位', '数字'],
    ['筆記型電腦', '笔记本电脑'],
    ['軟體工程師', '软件工程师'],
    ['駭客', '黑客'],
    ['搜尋引擎', '搜索引擎'],
    ['專案', '项目'],
    ['鉅額', '巨额'],
  ];

  it('至少 30 组', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  for (const [from, to] of cases) {
    it(`${from} → ${to}`, () => {
      expect(convertText(from, tw)).toBe(to);
    });
  }

  it('关掉词汇层后只转字形', () => {
    expect(convertText('軟體', twNoVocab)).toBe('软体');
    expect(convertText('網路', twNoVocab)).toBe('网路');
    expect(convertText('影片', twNoVocab)).toBe('影片');
    expect(convertText('資訊', twNoVocab)).toBe('资讯');
    expect(convertText('滑鼠', twNoVocab)).toBe('滑鼠');
    expect(convertText('計程車', twNoVocab)).toBe('计程车');
  });

  describe('词汇层例外：OpenCC 偏计算机术语、会误伤一般文章的词只转字形', () => {
    const cases: [string, string][] = [
      ['滿滿當當的行程：會見部長', '满满当当的行程：会见部长'], // 不是“进程”
      ['防止程序出問題', '防止程序出问题'], // 不是“进程”
      ['公開的法庭文件', '公开的法庭文件'], // 不是“文档”
      ['團隊的執行力很強', '团队的执行力很强'], // 不是“运行力”
      ['只關注核心要素與核心團隊', '只关注核心要素与核心团队'], // 不是“内核”
    ];
    for (const [from, to] of cases) {
      it(`${from} → ${to}`, () => {
        expect(convertText(from, tw)).toBe(to);
      });
    }

    it('例外词的前后文仍然做词汇替換', () => {
      expect(convertText('軟體的核心程序在網路上執行', tw)).toBe('软件的核心程序在网络上执行');
      expect(convertText('核心', tw)).toBe('核心');
      expect(convertText('程式與程序', tw)).toBe('程序与程序');
    });

    it('只作用于 tw 词汇层：关掉词汇层、hk、t 与原来一致', () => {
      expect(convertText('行程與文件', twNoVocab)).toBe('行程与文件');
      expect(convertText('行程與文件', hk)).toBe('行程与文件');
      expect(convertText('行程與文件', generic)).toBe('行程与文件');
    });
  });

  it('句子里的词汇', () => {
    expect(convertText('這個軟體需要網路連線', tw)).toBe('这个软件需要网络连接');
    expect(convertText('把檔案存到硬碟', tw)).toBe('把文件存到硬盘');
  });
});

describe('词汇层：香港用语（hk，没有词汇层）', () => {
  const cases: [string, string][] = [
    ['軟件', '软件'],
    ['電腦', '电脑'],
    ['互聯網', '互联网'],
    ['網絡', '网络'],
    ['數碼', '数码'],
    ['手提電話', '手提电话'],
    ['單車', '单车'],
    ['冷氣', '冷气'],
    ['的士', '的士'],
    ['地鐵', '地铁'],
    ['轉賬', '转账'],
    ['廣東話', '广东话'],
    ['恆生指數', '恒生指数'],
    ['灣仔', '湾仔'],
    ['屋邨', '屋邨'],
  ];

  it('至少 10 组', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const [from, to] of cases) {
    it(`${from} → ${to}`, () => {
      expect(convertText(from, hk)).toBe(to);
    });
  }

  it('hk 没有词汇层：台湾词汇不换，vocabulary 开关无影响', () => {
    expect(convertText('軟體', hk)).toBe('软体');
    expect(convertText('網路', hk)).toBe('网路');
    expect(convertText('軟體', opts({ variant: 'hk', vocabulary: false }))).toBe('软体');
    expect(convertText('影片', hk)).toBe('影片');
  });

  it('通用繁体 t 也没有词汇层', () => {
    expect(convertText('軟體', generic)).toBe('软体');
    expect(convertText('電腦', generic)).toBe('电脑');
    expect(convertText('軟體', opts({ variant: 't', vocabulary: false }))).toBe('软体');
  });
});

describe('标点：quotes', () => {
  it('「」→ “”，『』→ ‘’', () => {
    expect(convertText('他說：「你好」', tw)).toBe('他说：“你好”');
    expect(convertText('『書名』', tw)).toBe('‘书名’');
  });

  it('嵌套引号', () => {
    expect(convertText('「他說『好』」', tw)).toBe('“他说‘好’”');
  });

  it('quotes 关掉保留原样', () => {
    const o = opts({ quotes: false });
    expect(convertText('「你好」『再見』', o)).toBe('「你好」『再见』');
  });

  it('QUOTE_MAP 完整', () => {
    expect(QUOTE_MAP).toEqual({ '「': '“', '」': '”', '『': '‘', '』': '’' });
  });

  it('不该改的：已经是弯引号、书名号、括号', () => {
    expect(convertText('“好”‘的’《書》（括號）', tw)).toBe('“好”‘的’《书》（括号）');
  });

  it('convert 关掉时不转引号', () => {
    expect(convertText('「好」', opts({ convert: false, horizontal: false }))).toBe('「好」');
  });
});

describe('标点：竖排专用标点（horizontal）', () => {
  // [竖排字符码点, 期望（quotes 开）, 期望（quotes 关）]
  const table: [number, string, string][] = [
    [0xfe10, '，', '，'],
    [0xfe11, '、', '、'],
    [0xfe12, '。', '。'],
    [0xfe13, '：', '：'],
    [0xfe14, '；', '；'],
    [0xfe15, '！', '！'],
    [0xfe16, '？', '？'],
    [0xfe17, '〖', '〖'],
    [0xfe18, '〗', '〗'],
    [0xfe19, '…', '…'],
    [0xfe30, '：', '：'],
    [0xfe31, '—', '—'],
    [0xfe32, '–', '–'],
    [0xfe33, '_', '_'],
    [0xfe34, '_', '_'],
    [0xfe35, '（', '（'],
    [0xfe36, '）', '）'],
    [0xfe37, '｛', '｛'],
    [0xfe38, '｝', '｝'],
    [0xfe39, '〔', '〔'],
    [0xfe3a, '〕', '〕'],
    [0xfe3b, '【', '【'],
    [0xfe3c, '】', '】'],
    [0xfe3d, '《', '《'],
    [0xfe3e, '》', '》'],
    [0xfe3f, '〈', '〈'],
    [0xfe40, '〉', '〉'],
    [0xfe41, '“', '「'],
    [0xfe42, '”', '」'],
    [0xfe43, '‘', '『'],
    [0xfe44, '’', '』'],
    [0xfe47, '［', '［'],
    [0xfe48, '］', '］'],
  ];

  it('映射表覆盖：表里每一项都有测试', () => {
    expect(Object.keys(VERTICAL_PUNCT_MAP).length).toBe(table.length);
    for (const [cp] of table) expect(VERTICAL_PUNCT_MAP[String.fromCodePoint(cp)]).toBeDefined();
  });

  for (const [cp, withQuotes, withoutQuotes] of table) {
    const ch = String.fromCodePoint(cp);
    const label = 'U+' + cp.toString(16).toUpperCase();
    it(`${label} → ${withQuotes}`, () => {
      expect(convertText(ch, opts({ horizontal: true, quotes: true }))).toBe(withQuotes);
      expect(convertText(ch, opts({ horizontal: true, quotes: false }))).toBe(withoutQuotes);
    });
  }

  it('常见写法：﹁書名﹂︵註︶︽書︾', () => {
    const s = [0xfe41, 0xfe42, 0xfe35, 0xfe36, 0xfe3d, 0xfe3e].map((c) => String.fromCodePoint(c));
    const text = `${s[0]}書名${s[1]}${s[2]}註${s[3]}${s[4]}書${s[5]}`;
    expect(convertText(text, tw)).toBe('“书名”（注）《书》');
  });

  it('horizontal 关掉时竖排标点保持原样', () => {
    const ch = String.fromCodePoint(0xfe35);
    expect(convertText(ch, opts({ horizontal: false }))).toBe(ch);
  });

  it('convert 关、horizontal 开：竖排标点仍然还原，字形不转', () => {
    const o = opts({ convert: false, horizontal: true });
    const ch = String.fromCodePoint(0xfe35);
    expect(convertText(`${ch}幣${String.fromCodePoint(0xfe36)}`, o)).toBe('（幣）');
  });

  it('不在表里的竖排兼容字符不动（着重号 ﹅ ﹆ 等）', () => {
    const odd = String.fromCodePoint(0xfe45) + String.fromCodePoint(0xfe49);
    expect(convertText(odd, opts())).toBe(odd);
  });
});

describe('长度不变', () => {
  it('常见文本转换后长度不变（按块拼接再拆回的前提）', () => {
    const samples = ['燈塔日記：幸運、韌性與保護用戶的回憶錄', '軟體與網路', '「你好」『再見』', '頭髮與發財'];
    for (const s of samples) expect(convertText(s, tw).length).toBe(s.length);
  });
});
