import {describe,expect,it} from 'vitest';
import {findMangaBubbles,collectMangaRegions} from '@/src/features/image-translation/services/mangaBubbles';
const image=(w:number,h:number)=>new Uint8ClampedArray(w*h*4);
function rect(p:Uint8ClampedArray,w:number,x:number,y:number,width:number,height:number,color=[255,255,255,255]){for(let yy=y;yy<y+height;yy++)for(let xx=x;xx<x+width;xx++)p.set(color,(yy*w+xx)*4);}
const text=(value:string,x:number,y:number,width=40,height=12)=>({text:value,confidence:.99,box:{x,y,width,height}});
const box=(x:number,y:number,w=80,h=80)=>({x0:x,y0:y,x1:x+w,y1:y+h});
describe('漫画局部气泡识别边界',()=>{
    it('普通截图 Paddle 保留源行供严格段落分组，局部放大结果替换重复检测', () => {
        const page = {results: [text('wrong small', 25, 30), text('Title', 160, 180, 90, 16), text('Body line', 160, 200, 200, 12)],
            bubbles: [{bbox: box(10, 10), results: [text('First', 20, 20), text('second', 20, 34)]}]};
        const lines = collectMangaRegions(page, 'en', 400, 400, 'image');
        expect(lines.map(line => line.text)).toEqual(['First', 'second', 'Title', 'Body line']);
        expect(lines.every(line => line.sourceBoxes === undefined)).toBe(true);
        expect(collectMangaRegions({results: []}, 'en', 400, 400, 'image')).toEqual([]);
    });
    it('拒绝无效尺寸和像素预算，定位封闭浅色气泡而非页面背景',()=>{
        for(const [w,h] of [[0,100],[1.5,100],[100,NaN],[4097,4097],[200,200]])expect(findMangaBubbles(image(1,1),w,h)).toEqual([]);
        const p=image(300,300);rect(p,300,30,40,40,40);rect(p,300,170,150,60,40);rect(p,300,0,0,20,300);
        expect(findMangaBubbles(p,300,300)).toEqual([box(170,150,60,40),box(30,40,40,40)]);
    });
    it('排除四条页面边界、过小、过大、透明和稀疏区域',()=>{
        const p=image(800,800);rect(p,800,0,100,40,40);rect(p,800,100,0,40,40);rect(p,800,760,100,40,40);rect(p,800,100,760,40,40);
        rect(p,800,200,200,29,60);rect(p,800,240,200,60,29);rect(p,800,310,200,30,30);rect(p,800,360,200,350,350);
        rect(p,800,200,400,100,8);rect(p,800,200,400,8,100);rect(p,800,30,600,40,40,[255,255,255,127]);
        rect(p,800,100,600,40,40,[235,255,255,255]);rect(p,800,160,600,40,40,[255,235,255,255]);rect(p,800,220,600,40,40,[255,255,235,255]);
        expect(findMangaBubbles(p,800,800)).toEqual([]);
    });
    it('像素相邻且只使用四邻域，候选最多二十四个',()=>{
        const p=image(900,900);for(let y=0;y<6;y++)for(let x=0;x<6;x++)rect(p,900,10+x*140,10+y*140,35,35);
        expect(findMangaBubbles(p,900,900)).toHaveLength(24);
        const edge=image(100,100);rect(edge,100,0,0,1,100);rect(edge,100,0,0,100,1);rect(edge,100,99,0,1,100);rect(edge,100,0,99,100,1);
        expect(findMangaBubbles(edge,100,100)).toEqual([]);
    });
    it('局部识别替换整页重复结果，不跨气泡拼句',()=>{
        const page={results:[text('small incorrect',25,32),text('Outside caption',160,180)],bubbles:[{bbox:box(10,10),results:[text('Hello',20,20),text('world',20,36)]}]};
        expect(collectMangaRegions(page,'en',400,400).map(r=>r.text)).toEqual(['Hello world','Outside caption']);
        expect(collectMangaRegions({results:page.results},'en',400,400)).toHaveLength(2);
    });
    it('独立气泡中略宽行距的英文保持整句，原始修补框不扩张，整页仍不跨框合并',()=>{
        const lines=[text('I ALREADY HAD',40,40,92,8),text('THE BIRD OPEN',40,55,92,7),text("IT, IT'S FINE.",51,69,70,8)];
        const page={results:[],bubbles:[{bbox:box(20,20,130,90),results:lines},{bbox:box(180,20,130,90),results:[text('Next speaker.',200,55,90,8)]}]};
        const regions=collectMangaRegions(page,'en',400,400);
        expect(regions.map(region=>region.text)).toEqual(["I ALREADY HAD THE BIRD OPEN IT, IT'S FINE.",'Next speaker.']);
        expect(regions[0]).toMatchObject({fontSize:8,bbox:{x0:40,y0:40,x1:132,y1:77},sourceBoxes:[{x0:40,y0:40,x1:132,y1:48},{x0:40,y0:55,x1:132,y1:62},{x0:51,y0:69,x1:121,y1:77}]});
        expect(collectMangaRegions({results:lines},'en',400,400)).toHaveLength(3);
        expect(collectMangaRegions({results:[],bubbles:[{bbox:box(20,20,130,200),results:[text('First',40,40,60,8),text('Distant',40,80,60,8)]}]},'en',400,400)).toHaveLength(2);
    });
    it('气泡内加宽行距仍不跨两个紧邻且同宽的独立气泡连接台词', () => {
        const first=text('First speaker',40,40,110,20),second=text('Next speaker',40,85,110,20);
        const page={results:[],bubbles:[{bbox:box(20,20,150,50),results:[first]},{bbox:box(20,75,150,50),results:[second]}]};
        expect(collectMangaRegions(page,'en',400,400).map(region=>region.text)).toEqual(['First speaker','Next speaker']);
    });
    it('其他对白和空气泡不会删除可靠的单行旁白或气泡内全页回退',()=>{
        const page={results:[text('Noise',150,200),text('short',150,240),text('row',150,254),text('Reliable caption',200,290),text('second line',200,306),text('Below',25,90),text('Left',0,30),text('Right',90,30)],
            bubbles:[{bbox:box(10,10),results:[text('Hello',20,20)]},{bbox:box(200,10),results:[text('Again',210,20)]},{bbox:box(10,110),results:[]}]};
        const regions=collectMangaRegions(page,'en',400,400);
        expect(regions.map(r=>r.text)).toEqual(['Again','Hello Left','Right','Below','Noise','short row','Reliable caption second line']);
        expect(collectMangaRegions({results:[],bubbles:[{bbox:box(10,10),results:[]}]},'en',400,400)).toEqual([]);
    });
    it('局部 OCR 为空或低置信度时保留全页原文，局部漏行与可靠局部行合成同一句', () => {
        const first = text('Small original', 30, 25, 60, 12), last = text('last line', 30, 42, 60, 12);
        const bbox = box(10, 10, 120, 90);
        for (const profile of ['manga', 'image'] as const) {
            expect(collectMangaRegions({results: [first, last], bubbles: [{bbox, results: []}]}, 'en', 400, 400, profile).map(r=>r.text))
                .toEqual(profile === 'manga' ? ['Small original last line'] : ['Small original', 'last line']);
            expect(collectMangaRegions({results: [first], bubbles: [{bbox, results: [{...first, text:'unreliable', confidence:.4}]}]}, 'en', 400, 400, profile).map(r=>r.text))
                .toEqual(['Small original']);
        }
        const result = collectMangaRegions({results: [first, last], bubbles: [{bbox, results: [{...first, text:'Correct first'}]}]}, 'en', 400, 400);
        expect(result.map(r=>r.text)).toEqual(['Correct first last line']);
        expect(result[0].sourceBoxes).toEqual([{x0:30,y0:25,x1:90,y1:37},{x0:30,y0:42,x1:90,y1:54}]);
    });
    it('很小的局部碎片不能删除全页整行，也不会按合并后中心丢掉气泡外行', () => {
        const page = {results:[text('Complete source sentence', 20, 20, 160, 12)], bubbles:[{bbox:box(10,10,200,100),results:[text('word',20,20,30,12)]}]};
        const imageLines = collectMangaRegions(page,'en',400,400,'image');
        expect(imageLines.map(r=>r.text)).toContain('Complete source sentence');
        const separated = collectMangaRegions({results:[text('Inside',20,20),text('Outside',20,37)],bubbles:[{bbox:box(10,10,70,22),results:[]}]},'en',400,400);
        expect(separated.map(r=>r.text)).toEqual(['Inside','Outside']);
    });
    it('气泡中的高置信度大单字无论来自局部还是全页回退均保留，外部仍过滤', () => {
        const single=text('え',40,40,70,70), bbox=box(20,20,120,120);
        for (const profile of ['manga','image'] as const) {
            expect(collectMangaRegions({results:[],bubbles:[{bbox,results:[single]}]},'ja',400,400,profile).map(r=>r.text)).toEqual(['え']);
            expect(collectMangaRegions({results:[single],bubbles:[{bbox,results:[]}]},'ja',400,400,profile).map(r=>r.text)).toEqual(['え']);
            expect(collectMangaRegions({results:[single]},'ja',400,400,profile)).toEqual([]);
        }
    });
});
