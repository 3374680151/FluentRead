import {describe,expect,it,vi} from 'vitest';
import {layoutMangaTranslationText} from '@/src/features/image-translation/services/mangaTypography';
import {drawMangaTranslations,sampleMangaBackgrounds} from '@/src/features/image-translation/services/mangaRendering';
const measure = (text: string,size: number) => Array.from(text).length * size;
function context() {return {save:vi.fn(),restore:vi.fn(),fillRect:vi.fn(),font:'',fillStyle:'',strokeStyle:'',lineWidth:0,
    beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),measureText:vi.fn(function(this:{font:string},text:string){return {width:measure(text,Number(this.font.match(/ ([\d.]+)px/)![1]))};}),strokeText:vi.fn(),fillText:vi.fn()};}
describe('漫画专用完整排版',()=>{
    it('闭标点不会独自挤到下一行，开标点跟随下一字',()=>{
        const layout=layoutMangaTranslationText('你好。再见！「好的」',30,150,measure,10);
        expect(layout.lines.join('')).toBe('你好。再见！「好的」');
        expect(layout.lines.every(line=>!/^([。！？」])/u.test(line))).toBe(true);
        expect(layout.lines).toEqual(['你好。','再见！','「好','的」']);
        expect(layoutMangaTranslationText('你好.再见',20,100,measure,10).lines).toEqual(['你','好.','再见']);
    });
    it('末行很短时平衡气泡行宽，字号和行数保持不变',()=>{
        expect(layoutMangaTranslationText('我早就确认过了。',70,50,measure,10))
            .toEqual({lines:['我早就确','认过了。'],fontSize:10,lineHeight:12});
        expect(layoutMangaTranslationText('x Hello',60,100,measure,10).lines).toEqual(['x','Hello']);
        expect(layoutMangaTranslationText('你好\n再见',20,40,measure,10).lines).toEqual(['你好','再见']);
    });
    it('缺少字素分段器时仍按 Unicode 码点保留长词',async()=>{
        vi.resetModules();
        vi.stubGlobal('Intl',new Proxy(Intl,{get:(target,key)=>key==='Segmenter'?undefined:Reflect.get(target,key)}));
        try {const {layoutMangaTranslationText: fallback}=await import('@/src/features/image-translation/services/mangaTypography');expect(fallback('abc😊def',20,100,measure,10).lines.join('')).toBe('abc😊def');}
        finally {vi.unstubAllGlobals();vi.resetModules();}
    });
    it('英文单词、混排空格、长单词和显式空行均保留',()=>{
        const layout=layoutMangaTranslationText('Hello world\r\n\r中文 OK',60,160,measure,10);
        expect(layout.lines).toEqual(['Hello','world','','中文 OK']);
        expect(layoutMangaTranslationText('Supercalifragilistic',40,160,measure,10).lines.join('')).toBe('Supercalifragilistic');
    });
    it('适配超长译文与极窄区域，不截字或压扁，保留开标点结尾',()=>{
        const text='非常完整的长译文。'.repeat(100),layout=layoutMangaTranslationText(text,80,80,measure,30);
        expect(layout.lines.join('')).toBe(text);expect(layout.lines.length*layout.lineHeight).toBeLessThanOrEqual(80);
        expect(layout.lines.every(line=>measure(line,layout.fontSize)<=80)).toBe(true);
        expect(layoutMangaTranslationText('「',5,5,measure,20).lines.join('')).toBe('「');
        expect(layoutMangaTranslationText('（「你好」）',20,80,measure,10).lines.join('')).toBe('（「你好」）');
    });
    it('组合音标和 emoji 的字素在必须拆长词时仍完整',()=>{
        const text='e\u0301👨‍👩‍👧‍👦e\u0301👨‍👩‍👧‍👦';
        const layout=layoutMangaTranslationText(text,12,180,(text,size)=>Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)).length*size,10);
        expect(layout.lines).toEqual(['e\u0301','👨‍👩‍👧‍👦','e\u0301','👨‍👩‍👧‍👦']);
    });
    it('空段、首标点及无效预算不会丢内容或产生无效字形',()=>{
        expect(layoutMangaTranslationText('。你好',100,100,measure,10).lines.join('')).toBe('。你好');
        for(const args of [['',10,10,10],['x',0,10,10],['x',10,NaN,10],['x',10,10,Infinity]] as const)
            expect(layoutMangaTranslationText(args[0],args[1],args[2],measure,args[3])).toEqual({lines:[],fontSize:0,lineHeight:0});
    });
});
describe('原图背景与字体层次',()=>{
    const width=1000,height=400,pixels=new Uint8ClampedArray(width*height*4).fill(255);
    const region={text:'你好世界',fontSize:70,bbox:{x0:100,y0:100,x1:400,y1:250}};
    it('均匀气泡按源行和描边余量清字，段落空隙保留原图而不整块铺白', () => {
        const c=context(), boxes=[{x0:100,y0:100,x1:220,y1:120},{x0:100,y0:160,x1:220,y1:180}];
        drawMangaTranslations(c as any,pixels,width,height,[{text:'完整译文',fontSize:20,bbox:{x0:100,y0:100,x1:220,y1:180},sourceBoxes:boxes}],true,[{color:'rgb(255,255,255)',uniform:true}]);
        expect(c.fillRect.mock.calls).toEqual([[96,96,128,28],[96,156,128,28]]);
        expect(c.fillRect).not.toHaveBeenCalledWith(100,100,120,80);
        expect(c.rect).toHaveBeenCalledWith(100,100,120,80);
        expect(c.fillText.mock.calls.map(call=>call[0]).join('')).toBe('完整译文');
    });
    it('七八像素高的短行不会被固定内边距挤成三像素，仍裁剪在原始识别范围',()=>{
        for(const height of [7,8]){
            const c=context(),bbox={x0:40,y0:40,x1:132,y1:40+height};
            drawMangaTranslations(c as any,pixels,width,400,[{text:'已准备好。',fontSize:height,bbox}],true,[{color:'rgb(255,255,255)',uniform:true}]);
            const size=Number(c.font.match(/ ([\d.]+)px/)![1]);
            expect(size).toBeGreaterThan(height*.65);expect(size*1.2).toBeLessThanOrEqual(height);
            expect(c.fillText.mock.calls.map(call=>call[0]).join('')).toBe('已准备好。');
            expect(c.rect).toHaveBeenCalledWith(40,40,92,height);expect(c.fillRect).toHaveBeenCalledWith(40,40,92,height);
        }
    });
    it('对白适度粗体且短译文不放大，标题使用源字号与白色描边',()=>{
        const c=context();drawMangaTranslations(c as any,pixels,width,height,[region],true,[{color:'rgb(255,255,255)',uniform:true}]);
        expect(c.font).toMatch(/^600 34px /);expect(c.fillStyle).toBe('#111111');expect(c.lineWidth).toBeCloseTo(1.19);
        drawMangaTranslations(c as any,pixels,width,height,[region],true,[{color:'rgb(100,100,100)',uniform:false}]);
        expect(c.font).toMatch(/^800 /);expect(c.strokeStyle).toBe('#ffffff');expect(c.lineWidth).toBeGreaterThan(5);
        drawMangaTranslations(c as any,pixels,width,height,[{...region,vertical:true}],true,[{color:'rgb(100,100,100)',uniform:false}]);
        expect(c.font).toMatch(/^600 /);
    });
    it('修补后像素均匀也沿用原图复杂背景分类，禁止重新铺白底',()=>{
        const c=context();drawMangaTranslations(c as any,pixels,width,height,[region],true,[{color:'rgb(170,140,100)',uniform:false}]);
        expect(c.fillRect).not.toHaveBeenCalled();
        drawMangaTranslations(c as any,pixels,width,height,[region],false,[{color:'rgb(170,140,100)',uniform:false}]);expect(c.fillRect).toHaveBeenCalledOnce();
        expect(sampleMangaBackgrounds(pixels,width,height,[region])).toEqual([{color:'rgb(255,255,255)',uniform:true}]);
    });
    it('黑底保留白字，空译文不绘字，异常 Canvas 仍恢复状态',()=>{
        const c=context();drawMangaTranslations(c as any,pixels,width,height,[region],true,[{color:'rgb(0,0,0)',uniform:true}]);expect(c.fillStyle).toBe('#ffffff');
        const empty=context();drawMangaTranslations(empty as any,pixels,width,height,[{...region,text:''}]);expect(empty.fillText).not.toHaveBeenCalled();expect(empty.restore).toHaveBeenCalledOnce();
        c.measureText.mockImplementationOnce(()=>{throw new Error('canvas failed');});
        expect(()=>drawMangaTranslations(c as any,pixels,width,height,[region])).toThrow('canvas failed');expect(c.restore).toHaveBeenCalledTimes(2);
    });
    it('相同字体和字号的度量仅在本次绘制内复用',()=>{
        const c=context();drawMangaTranslations(c as any,pixels,width,height,[region,region]);
        const count=c.measureText.mock.calls.length;expect(c.fillText).toHaveBeenCalledTimes(2);
        drawMangaTranslations(c as any,pixels,width,height,[region]);expect(c.measureText.mock.calls.length).toBe(count*2);
    });
    it('大段译文超出临时度量预算仍完整绘制',()=>{
        const c=context(),text='完整译文。'.repeat(120);
        drawMangaTranslations(c as any,pixels,width,height,[{...region,text}]);
        expect(c.fillText.mock.calls.map(call=>call[0]).join('')).toBe(text);
    });
});
