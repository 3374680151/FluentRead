/** 漫画场景质量门禁：实际识别值与独立 source truth 对照，漏字、重复和艺术误报不能互相抵消。 */
import {describe,expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const {normalizeOcrAnchor,countAnchorOccurrences,validateQualityFixtureExpectations,evaluateQualityFixture,evaluateQualityReadingOrder}=require('../scripts/testing/manga-quality-corpus.cjs');
const box=(x0:number,y0:number,x1:number,y1:number)=>({x0,y0,x1,y1});
const text=(sourceText:string,bbox=box(10,10,90,30),sourceBoxes?:ReturnType<typeof box>[])=>({text:'受控译文',sourceText,bbox,...(sourceBoxes?{sourceBoxes}:{})});
const fixture=(overrides:any={})=>({name:'actual-quality',width:400,height:300,expectedSource:['WAIT FOR ME','WAIT FOR ME','GO NOW'],expectedAnchors:['WAIT FOR ME','GO NOW'],anchorOccurrences:{'WAIT FOR ME':2,'GO NOW':1},regions:[{id:'line-1',bbox:box(10,10,90,30)}],forbiddenRegions:[{id:'robot',bbox:box(200,100,300,250)}],...overrides});
const naturalRoot=new URL('./fixtures/manga-natural/',import.meta.url);
const naturalManifest=JSON.parse(readFileSync(new URL('manifest.json',naturalRoot),'utf8'));

describe('真实漫画runner多轮layout采集的有界容量',()=>{
    it('32景五轮保留全部160次响应及预留，承诺以外的记录仍有硬上限',async()=>{
        const source=readFileSync(new URL('../scripts/testing/run-manga-translation-test.cjs',import.meta.url),'utf8');
        const ast=ts.createSourceFile('runner.cjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
        let initializer='',observer='';
        const visit=(node:ts.Node)=>{
            if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='layoutTraceLimit')initializer=node.initializer!.getText(ast);
            if(ts.isCallExpression(node)&&node.expression.getText(ast)==='worker.evaluate'&&node.arguments[0]?.getText(ast).startsWith('({live,trace,traceLayout,layoutTraceLimit})=>'))observer=node.arguments[0].getText(ast);
            ts.forEachChild(node,visit);
        };
        visit(ast);expect(initializer).not.toBe('');expect(observer).not.toBe('');
        const limit=runInNewContext(initializer,{qualityFixtures:Array(32),pipelineRounds:5});
        expect(limit).toBeGreaterThanOrEqual(160);expect(limit).toBeLessThanOrEqual(168);
        const response={lines:[{text:'受控译文',sourceText:'actual source',bbox:box(10,10,90,30)}]};
        const chrome={runtime:{sendMessage:(_message:unknown,callback?:Function)=>{if(callback)callback(response);return Promise.resolve(response);},onMessage:{addListener:()=>undefined}}};
        const sandbox:any={chrome,fetch:()=>{throw new Error('Layout trace replay must not fetch');}};
        const observe=runInNewContext(`(${observer})`,sandbox);
        observe({live:false,trace:false,traceLayout:true,layoutTraceLimit:limit});
        for(let index=0;index<limit+3;index++){
            const message={type:'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN',requestId:String(index)};
            if(index%2)chrome.runtime.sendMessage(message,(value:unknown)=>expect(value).toBe(response));
            else expect(await chrome.runtime.sendMessage(message)).toBe(response);
        }
        const results=sandbox.__mangaTest.layoutResults;
        expect(results).toHaveLength(limit);expect(results[159].requestId).toBe('159');
        expect(results[159].lines[0].sourceText).toBe('actual source');
        await chrome.runtime.sendMessage({type:'UNRELATED',requestId:'host'});
        expect(results).toHaveLength(limit);
    });
});

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
        const f=fixture({expectedSource:['WAIT FOR ME','GO NOW','ふりがな'],expectedAnchors:['WAIT FOR ME','GO NOW','ふりがな'],anchorOccurrences:{'WAIT FOR ME':1,'GO NOW':1,'ふりがな':1},regions:[{id:'main-right',text:'WAIT FOR ME',anchor:'WAIT FOR ME',bbox:box(150,20,180,90),vertical:true},{id:'main-left',text:'GO NOW',anchor:'GO NOW',bbox:box(100,20,130,90),vertical:true},{id:'furigana',text:'ふりがな',anchor:'ふりがな',bbox:box(185,20,195,50),vertical:true}],readingOrder:['main-right','main-left']});
        expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        expect(()=>validateQualityFixtureExpectations({...f,readingOrder:['main-right','missing']})).toThrow('actual vertical source regions');
        expect(()=>validateQualityFixtureExpectations({...f,readingOrder:['main-right','main-right']})).toThrow('distinct text region IDs');
    });
    it('旧读序声明不能用false、0、空串或null关闭门禁，引用缺少有效锚点或有歧义的ID须提前拒绝',()=>{
        const regions=[{id:'right',text:'GO NOW',anchor:'GO NOW',bbox:box(100,20,130,90),vertical:true},{id:'left',text:'WAIT FOR ME',anchor:'WAIT FOR ME',bbox:box(50,20,80,90),vertical:true}];
        const f=fixture({regions,expectedSource:['GO NOW','WAIT FOR ME'],expectedAnchors:['GO NOW','WAIT FOR ME'],anchorOccurrences:{'GO NOW':1,'WAIT FOR ME':1},readingOrder:['right','left']});
        expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        for(const readingOrder of [false,0,'',null])expect(()=>validateQualityFixtureExpectations({...f,readingOrder})).toThrow();
        for(const anchor of [undefined,'','…'])expect(()=>validateQualityFixtureExpectations({...f,regions:regions.map((region,index)=>index===0?{...region,anchor}:region)})).toThrow();
        expect(()=>validateQualityFixtureExpectations({...f,regions:[...regions,{...regions[0],anchor:'AMBIGUOUS'}]})).toThrow();
    });
    it('两位说话人的竖排气泡分别声明读序，拒绝无效、重复或跨组复用文字ID',()=>{
        const regions=['RIGHT FIRST','RIGHT SECOND','LEFT FIRST','LEFT SECOND'].map((value,index)=>({id:`main-${index}`,text:value,anchor:value,bbox:box(20+index*30,20,40+index*30,90),vertical:true}));
        const source=regions.map(region=>region.text),groups=[['main-0','main-1'],['main-2','main-3']];
        const f=fixture({regions,expectedSource:source,expectedAnchors:source,anchorOccurrences:Object.fromEntries(source.map(value=>[value,1])),readingOrderGroups:groups});
        expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        for(const readingOrderGroups of [[['main-0','main-1']],[['main-0','main-0'],['main-2','main-3']],[['main-0','main-1'],['main-1','main-3']],[['main-0','missing'],['main-2','main-3']]]) {
            expect(()=>validateQualityFixtureExpectations({...f,readingOrderGroups})).toThrow();
        }
        expect(()=>validateQualityFixtureExpectations({...f,readingOrder:['main-0','main-1']})).toThrow();
        expect(()=>validateQualityFixtureExpectations({...f,regions:regions.map((region,index)=>index===3?{...region,vertical:false}:region)})).toThrow();
        for(const anchor of [undefined,'','…'])expect(()=>validateQualityFixtureExpectations({...f,regions:regions.map((region,index)=>index===2?{...region,anchor}:region)})).toThrow();
        expect(()=>validateQualityFixtureExpectations({...f,regions:[...regions,{...regions[2],anchor:'AMBIGUOUS'}]})).toThrow();
    });
    it('每个气泡内都必须先右后左且不同气泡各占实际段落，不能用合并段落掩盖错序',()=>{
        const source=['RIGHT FIRST','RIGHT SECOND','LEFT FIRST','LEFT SECOND'];
        const regions=source.map((value,index)=>({id:`main-${index}`,text:value,anchor:value,bbox:box(20+index*30,20,40+index*30,90),vertical:true}));
        const f=fixture({regions,expectedSource:source,expectedAnchors:source,anchorOccurrences:Object.fromEntries(source.map(value=>[value,1])),readingOrderGroups:[['main-0','main-1'],['main-2','main-3']]});
        const actual=['RIGHT FIRST RIGHT SECOND','LEFT FIRST LEFT SECOND'];
        expect(evaluateQualityReadingOrder(f,actual).qualityFailures).toEqual([]);
        expect(evaluateQualityReadingOrder(f,[actual[1],actual[0]]).qualityFailures).toEqual([]);
        for(const reversed of [['RIGHT SECOND RIGHT FIRST',actual[1]],[actual[0],'LEFT SECOND LEFT FIRST']]) {
            expect(evaluateQualityReadingOrder(f,reversed).qualityFailures).toContainEqual(expect.objectContaining({type:'vertical-paragraph-order'}));
        }
        expect(evaluateQualityReadingOrder(f,[actual.join(' ') ]).qualityFailures).toContainEqual(expect.objectContaining({type:'vertical-paragraph-separation'}));
        // 两个气泡说同一句话仍是两个真实段落，不能都绑定到first-match。
        const repeated=source.map((_value,index)=>index%2?'WAIT HERE':'COME ALONG');
        const duplicateDialogue={...f,regions:regions.map((region,index)=>({...region,text:repeated[index],anchor:repeated[index]})),expectedSource:repeated,expectedAnchors:['COME ALONG','WAIT HERE'],anchorOccurrences:{'COME ALONG':2,'WAIT HERE':2}};
        expect(()=>validateQualityFixtureExpectations(duplicateDialogue)).not.toThrow();
        expect(evaluateQualityReadingOrder(duplicateDialogue,['COME ALONG WAIT HERE','COME ALONG WAIT HERE']).qualityFailures).toEqual([]);
        expect(evaluateQualityReadingOrder(duplicateDialogue,['COME ALONG WAIT HERE']).qualityFailures).toContainEqual(expect.objectContaining({type:'vertical-paragraph-separation'}));
    });
    it('日英混排与全角价格保留精确文字，数字0误认成拉丁O必须失败',()=>{
        const f=fixture({expectedSource:['桃の紅茶 380円','PEACH TEA'],expectedAnchors:['桃の紅茶 380円','PEACH TEA'],anchorOccurrences:{'桃の紅茶 380円':1,'PEACH TEA':1}});
        const actual=['桃の紅茶 ３８０円','PEACH TEA'];
        expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        expect(evaluateQualityFixture(f,{texts:actual,lines:actual.map(value=>text(value))}).qualityFailures).toEqual([]);
        const confused=['桃の紅茶 38O円','PEACH TEA'];
        const result=evaluateQualityFixture(f,{texts:confused,lines:confused.map(value=>text(value))});
        expect(result.qualityFailures).toContainEqual(expect.objectContaining({type:'ocr-anchor',anchor:'桃の紅茶 380円',occurrences:0}));
        expect(result.sourceCharacterInventory.excess).toEqual([{character:'O',expected:0,actual:1,excess:1}]);
    });
    it('极小字中的独立数字即使未送翻译仍参与验收，字高不能成为忽略门禁的理由',()=>{
        const f=fixture({expectedSource:['KEEP YOUR TICKET','2048'],expectedAnchors:['KEEP YOUR TICKET'],anchorOccurrences:{'KEEP YOUR TICKET':1}});
        const original=[text('KEEP YOUR TICKET'),text('2048',box(10,60,34,66))];
        expect(evaluateQualityFixture(f,{texts:['KEEP YOUR TICKET'],lines:original}).qualityFailures).toEqual([]);
        const result=evaluateQualityFixture(f,{texts:['KEEP YOUR TICKET'],lines:[...original,text('2048',box(110,60,134,66))]});
        expect(result.anchors.every((anchor:any)=>anchor.found)).toBe(true);
        expect(result.sourceCharacterInventory.excess).toHaveLength(4);
        expect(result.sourceCharacterInventory.excess.every((entry:any)=>entry.expected===1&&entry.actual===2&&entry.excess===1)).toBe(true);
        expect(result.qualityFailures).toEqual([expect.objectContaining({type:'unexpected-ocr-characters'})]);
    });
    it('所有对白正确仍拒绝尾部或头像负区内的标点噪声，不因字符库存规范化为空而漏报',()=>{
        const f=fixture();const recognized='WAIT FOR ME WAIT FOR ME GO NOW';
        const result=evaluateQualityFixture(f,{texts:[recognized],lines:[text(recognized),text('…',box(230,120,234,126))]});
        expect(result.anchors.every((anchor:any)=>anchor.found)).toBe(true);
        expect(result.sourceCharacterInventory.excess).toEqual([]);
        expect(result.qualityFailures).toEqual([expect.objectContaining({type:'artwork-ocr-false-positive',sourceText:'…',regionId:'robot'})]);
    });
    it('真OT与07、OO、IT和混合序列号独立保留，不能以数字纠错覆盖合法字母',()=>{
        const labels=['NOTE OT','NOTE 07','CODE OO','CHECK IT','O0 I1 1I Z2 2Z S5 5S T7 7T B8 8B'];
        const source=[...labels,...labels],f=fixture({expectedSource:source,expectedAnchors:labels,anchorOccurrences:Object.fromEntries(labels.map(label=>[label,2]))});
        expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
        expect(evaluateQualityFixture(f,{texts:source,lines:source.map(value=>text(value))}).qualityFailures).toEqual([]);
        const replaced=source.map(value=>value.replace(/\bOT\b/gu,'07'));
        const result=evaluateQualityFixture(f,{texts:replaced,lines:replaced.map(value=>text(value))});
        expect(result.qualityFailures).toContainEqual(expect.objectContaining({type:'ocr-anchor',anchor:'NOTE OT',occurrences:0,expectedOccurrences:2}));
        expect(result.qualityFailures).toContainEqual(expect.objectContaining({type:'duplicate-anchor',anchor:'NOTE 07',occurrences:4,expectedOccurrences:2}));
        expect(result.qualityFailures).toContainEqual(expect.objectContaining({type:'unexpected-ocr-characters'}));
    });
    it('易混字符互换即使字符库存完全相同也失败，不能把库存等同序列号正确率',()=>{
        const exact='O0 I1 1I Z2 2Z S5 5S T7 7T B8 8B';
        const f=fixture({expectedSource:[exact],expectedAnchors:[exact],anchorOccurrences:{[exact]:1}});
        const shuffled='0O 1I I1 2Z Z2 5S S5 7T T7 8B B8';
        const result=evaluateQualityFixture(f,{texts:[shuffled],lines:[text(shuffled)]});
        expect(result.sourceCharacterInventory.excess).toEqual([]);
        expect(result.qualityFailures).toEqual([expect.objectContaining({type:'ocr-anchor',anchor:exact,occurrences:0})]);
    });
    it('斜告示首字、连接边框的第二行及框外旁白均是必需真值，其他正确行不能补偿缺字',()=>{
        const source=['WE ARE STILL HERE','I WILL KEEP THE NOTE','A QUIET STOP','THE SECOND LINE MUST STAY','A small note outside the frame.'];
        const f=fixture({expectedSource:source,expectedAnchors:source,anchorOccurrences:Object.fromEntries(source.map(value=>[value,1]))});
        for(const [index,replacement] of [[0,'E ARE STILL HERE'],[1,'WILL KEEP THE NOTE'],[2,'QUIET STOP'],[3,''],[4,'']] as const) {
            const actual=source.map((value,line)=>line===index?replacement:value).filter(Boolean);
            const result=evaluateQualityFixture(f,{texts:actual,lines:actual.map(value=>text(value))});
            expect(result.sourceCharacterInventory.excess).toEqual([]);
            expect(result.qualityFailures).toContainEqual(expect.objectContaining({type:'ocr-anchor',anchor:source[index],occurrences:0}));
        }
    });
});

describe('固定原创自然漫画的来源、PNG和独立source truth',()=>{
    it('四张PNG的长度、SHA与IHDR尺寸均匹配；十八条真值、无字区域和保护点坐标自洽',()=>{
        expect(naturalManifest.fixtures.map((f:any)=>f.name)).toEqual(['natural-station-journey-ink','natural-rain-market-color','natural-orbital-greenhouse-repair','natural-woodland-leaf-boat']);
        expect(naturalManifest.fixtures.reduce((count:number,f:any)=>count+f.expectedSource.length,0)).toBe(18);
        const provenance=JSON.parse(readFileSync(new URL('provenance.json',naturalRoot),'utf8'));
        expect(provenance).toMatchObject({mode:'built-in image_gen',regenerable:false});
        expect(provenance.inkPrompt).toContain('A QUIET MORNING');expect(provenance.colorPrompt).toContain('THE LAST BUS IS LATE.');
        expect(provenance.orbitalGreenhousePrompt).toContain('THE PUMP IS STILL WARM.');expect(provenance.woodlandLeafBoatPrompt).toContain('A LEAF CAN BE A BOAT.');
        for(const f of naturalManifest.fixtures) {
            const png=readFileSync(new URL(f.file,naturalRoot));
            expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
            expect(png.readUInt32BE(8)).toBe(13);expect(png.toString('ascii',12,16)).toBe('IHDR');
            expect(png.readUInt32BE(16)).toBe(f.width);expect(png.readUInt32BE(20)).toBe(f.height);
            expect(png.length).toBe(f.bytes);expect(createHash('sha256').update(png).digest('hex')).toBe(f.sha256);
            expect(f.provenance).toMatchObject({original:true,exactTextVisuallyChecked:true,creationDate:'2026-10-25'});
            expect(f.expectedSource).toEqual(f.regions.map((r:any)=>r.text));expect(f.expectedAnchors).toEqual(f.expectedSource);
            expect(()=>validateQualityFixtureExpectations(f)).not.toThrow();
            expect(new Set(f.regions.map((r:any)=>r.id)).size).toBe(f.regions.length);
            for(const r of f.regions) {
                expect(r.bbox.x0).toBeGreaterThanOrEqual(0);expect(r.bbox.y0).toBeGreaterThanOrEqual(0);
                expect(r.bbox.x1).toBeGreaterThan(r.bbox.x0);expect(r.bbox.y1).toBeGreaterThan(r.bbox.y0);
                expect(r.bbox.x1).toBeLessThanOrEqual(f.width);expect(r.bbox.y1).toBeLessThanOrEqual(f.height);
            }
            expect(f.protectedProbes.length).toBe(3);
            for(const probe of f.protectedProbes) {
                expect(Number.isInteger(probe.x)&&probe.x>=0&&probe.x<f.width).toBe(true);
                expect(Number.isInteger(probe.y)&&probe.y>=0&&probe.y<f.height).toBe(true);
                expect(probe.rgb).toHaveLength(3);expect(probe.rgb.every((v:number)=>Number.isInteger(v)&&v>=0&&v<=255)).toBe(true);
                expect(f.regions.some((r:any)=>probe.x>=r.bbox.x0&&probe.x<r.bbox.x1&&probe.y>=r.bbox.y0&&probe.y<r.bbox.y1)).toBe(false);
            }
        }
        // 单测不引入PNG解码依赖；原图像素与RGB的核对由固定SHA对应的Pillow证据承担。
    });
    for(const f of naturalManifest.fixtures)it(`${f.name}：完美真值通过，单字误认或正确锚点旁的艺术误识别均失败`,()=>{
        const lines=f.regions.map((r:any)=>text(r.text,r.bbox));
        expect(evaluateQualityFixture(f,{texts:f.expectedSource,lines}).qualityFailures).toEqual([]);
        const wrong=[...f.expectedSource];wrong[0]='Z'+wrong[0].slice(1);
        const confused=evaluateQualityFixture(f,{texts:wrong,lines:lines.map((line:any,index:number)=>index===0?{...line,sourceText:wrong[0]}:line)});
        expect(confused.qualityFailures).toContainEqual(expect.objectContaining({type:'ocr-anchor',anchor:f.expectedAnchors[0]}));
        expect(confused.qualityFailures).toContainEqual(expect.objectContaining({type:'unexpected-ocr-characters'}));
        const art=evaluateQualityFixture(f,{texts:f.expectedSource,lines:[...lines,text('X',f.forbiddenRegions[0].bbox)]});
        expect(art.anchors.every((anchor:any)=>anchor.found)).toBe(true);
        expect(art.qualityFailures).toContainEqual(expect.objectContaining({type:'artwork-ocr-false-positive',sourceText:'X'}));
        expect(art.qualityFailures).toContainEqual(expect.objectContaining({type:'unexpected-ocr-characters'}));
    });
});
