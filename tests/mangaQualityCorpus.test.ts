/** 漫画场景质量门禁：实际识别值与独立 source truth 对照，漏字、重复和艺术误报不能互相抵消。 */
import {describe,expect,it} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {normalizeOcrAnchor,countAnchorOccurrences,validateQualityFixtureExpectations,evaluateQualityFixture}=require('../scripts/testing/manga-quality-corpus.cjs');
const box=(x0:number,y0:number,x1:number,y1:number)=>({x0,y0,x1,y1});
const text=(sourceText:string,bbox=box(10,10,90,30),sourceBoxes?:ReturnType<typeof box>[])=>({text:'受控译文',sourceText,bbox,...(sourceBoxes?{sourceBoxes}:{})});
const fixture=(overrides:any={})=>({name:'actual-quality',width:400,height:300,expectedSource:['WAIT FOR ME','WAIT FOR ME','GO NOW'],expectedAnchors:['WAIT FOR ME','GO NOW'],anchorOccurrences:{'WAIT FOR ME':2,'GO NOW':1},regions:[{id:'line-1',bbox:box(10,10,90,30)}],forbiddenRegions:[{id:'robot',bbox:box(200,100,300,250)}],...overrides});

describe('漫画 source truth、重复锚点与负场景质量门禁',()=>{
    it('Unicode全角及空白规范化不改变真实重复次数，并保留重叠子串计数',()=>{
        expect(normalizeOcrAnchor(' Ｎｏｔｅ ０７、図書館！')).toBe('NOTE07図書館');
        expect(countAnchorOccurrences('AAAA','AA')).toBe(3);
        expect(countAnchorOccurrences('AAAA','')).toBe(0);
    });
    it('同一句真实对白出现两次时必须识别两次，不把第二句当瓦片重复删除',()=>{
        const f=fixture();expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        const result=evaluateQualityFixture(f,{texts:['Wait for me.','WAIT FOR ME','GO NOW'],lines:[text('Wait for me.'),text('WAIT FOR ME'),text('GO NOW')]});
        expect(result.anchors[0]).toMatchObject({expectedOccurrences:2,occurrences:2,found:true});expect(result.qualityFailures).toEqual([]);
    });
    it('多一份、少一份与认错字符各自保持严格失败，不通过修改期望次数消除问题',()=>{
        const f=fixture();
        expect(evaluateQualityFixture(f,{texts:['WAIT FOR ME WAIT FOR ME WAIT FOR ME GO NOW'],lines:[text('duplicate')]}).qualityFailures[0]).toMatchObject({type:'duplicate-anchor',expectedOccurrences:2,occurrences:3});
        expect(evaluateQualityFixture(f,{texts:['WAIT FOR ME GO NOW'],lines:[text('missing')]}).qualityFailures[0]).toMatchObject({type:'ocr-anchor',expectedOccurrences:2,occurrences:1});
        expect(evaluateQualityFixture(f,{texts:['WAIT FOR ME WAIT FOR ME G0 NOW'],lines:[text('G0 NOW')]}).qualityFailures[0]).toMatchObject({type:'ocr-anchor',anchor:'GO NOW',occurrences:0});
    });
    it('manifest声明的次数必须来自源文字，规范化后重复锚点与空锚点均拒绝',()=>{
        expect(()=>validateQualityFixtureExpectations(fixture({anchorOccurrences:{'WAIT FOR ME':1,'GO NOW':1}}))).toThrow('Occurrence metadata agrees');
        expect(()=>validateQualityFixtureExpectations(fixture({expectedAnchors:['GO NOW','ＧＯ ＮＯＷ']}))).toThrow('distinct after normalization');
        expect(()=>validateQualityFixtureExpectations(fixture({expectedAnchors:['!']}))).toThrow('normalized OCR anchors');
        expect(()=>validateQualityFixtureExpectations(fixture({expectedSource:['']}))).toThrow('exact source text');
    });
    it('艺术误识别有独立门禁，全部正锚点通过也不能掩盖新增詩書段落',()=>{
        const f=fixture();const result=evaluateQualityFixture(f,{texts:['WAIT FOR ME WAIT FOR ME GO NOW','詩書'],lines:[text('WAIT FOR ME'),text('詩書',box(210,120,290,150))]});
        expect(result.anchors.every((anchor:any)=>anchor.found)).toBe(true);
        expect(result.negativeDetections).toEqual([{regionId:'robot',lineIndex:1,sourceText:'詩書',sourceBoxes:[box(210,120,290,150)]}]);
        expect(result.qualityFailures).toEqual([expect.objectContaining({type:'artwork-ocr-false-positive',sourceText:'詩書'}),expect.objectContaining({type:'unexpected-ocr-characters',excess:[{character:'詩',expected:0,actual:1,excess:1},{character:'書',expected:0,actual:1,excess:1}]})]);
    });
    it('全部锚点正确但合法文字框内多出READ时仍拒绝，实际sourceText优先于送翻译的文字子集',()=>{
        const f=fixture(),recognized='WAIT FOR ME WAIT FOR ME GO NOW';
        const result=evaluateQualityFixture(f,{texts:[recognized],lines:[text(recognized),text('READ',box(10,40,90,60))]});
        expect(result.anchors.every((anchor:any)=>anchor.found)).toBe(true);expect(result.negativeDetections).toEqual([]);
        expect(result.sourceCharacterInventory.actual.R).toBe(3);expect(result.sourceCharacterInventory.expected.R).toBe(2);
        expect(result.qualityFailures).toEqual([expect.objectContaining({type:'unexpected-ocr-characters'})]);
        // 删除一整句没有产生多余字符，但必须继续被原有次数锚点拦截。
        const missing=evaluateQualityFixture(f,{texts:['WAIT FOR ME GO NOW'],lines:[text('WAIT FOR ME GO NOW')]});
        expect(missing.sourceCharacterInventory.excess).toEqual([]);expect(missing.qualityFailures).toContainEqual(expect.objectContaining({type:'ocr-anchor',expectedOccurrences:2,occurrences:1}));
    });
    it('负区域只检查实际原始行框，不用覆盖行间画面的段落大框制造误报',()=>{
        const f=fixture();const paragraph=text('WAIT FOR ME WAIT FOR ME GO NOW',box(10,10,350,280),[box(10,10,90,30),box(10,260,350,280)]);
        expect(evaluateQualityFixture(f,{texts:['WAIT FOR ME WAIT FOR ME GO NOW'],lines:[paragraph]}).qualityFailures).toEqual([]);
        const boundary=text('edge',box(180,100,200,150));
        expect(evaluateQualityFixture(f,{texts:['WAIT FOR ME WAIT FOR ME GO NOW'],lines:[boundary]}).negativeDetections).toEqual([]);
    });
    it('完全无字页必须没有文字请求及返回行，标点形噪声也不能被规范化过滤掩盖',()=>{
        const f=fixture({expectedNoText:true,expectedSource:[],expectedAnchors:[],anchorOccurrences:{},regions:[]});
        expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        expect(evaluateQualityFixture(f,{texts:[],lines:[]}).qualityFailures).toEqual([]);
        expect(evaluateQualityFixture(f,{texts:['!!!'],lines:[]}).qualityFailures).toEqual([expect.objectContaining({type:'wordless-page-text'})]);
        expect(evaluateQualityFixture(f,{texts:[],lines:[text('詩書',box(20,40,70,80))]}).qualityFailures).toContainEqual(expect.objectContaining({type:'wordless-page-text'}));
        expect(()=>validateQualityFixtureExpectations({...f,expectedSource:['invented']})).toThrow('cannot invent');
    });
    it('负区域不得含ground truth文字或越界，不允许通过错误标注排除实际对白',()=>{
        expect(()=>validateQualityFixtureExpectations(fixture({forbiddenRegions:[{id:'not-art',bbox:box(0,0,100,100)}]}))).toThrow('contains no declared source text');
        expect(()=>validateQualityFixtureExpectations(fixture({forbiddenRegions:[{id:'outside',bbox:box(200,100,500,250)}]}))).toThrow('inside the source image');
        expect(()=>validateQualityFixtureExpectations(fixture({forbiddenRegions:[{id:'same',bbox:box(200,100,300,150)},{id:'same',bbox:box(200,160,300,250)}]}))).toThrow('identifiers are unique');
    });
    it('没有实际layout观测时明确失败，不能以空数组冒充未发生误报',()=>{
        expect(()=>evaluateQualityFixture(fixture(),{texts:['GO NOW']})).toThrow('layout was captured');
        expect(()=>evaluateQualityFixture(fixture(),{texts:[],lines:[text('bad',box(-1,0,20,20))]})).toThrow('valid image coordinates');
    });
    it('竖排主列顺序显式引用主文字，较小注音可独立记录而不强行混入段落断言',()=>{
        const f=fixture({regions:[{id:'main-right',bbox:box(150,20,180,90),vertical:true},{id:'main-left',bbox:box(100,20,130,90),vertical:true},{id:'furigana',bbox:box(185,20,195,50),vertical:true}],readingOrder:['main-right','main-left']});
        expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        expect(()=>validateQualityFixtureExpectations({...f,readingOrder:['main-right','missing']})).toThrow('references actual vertical source regions');
        expect(()=>validateQualityFixtureExpectations({...f,readingOrder:['main-right','main-right']})).toThrow('distinct text region IDs');
    });
});
