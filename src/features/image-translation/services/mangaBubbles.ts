/**
 * @file src/features/image-translation/services/mangaBubbles.ts
 * 文件职责：从漫画像素定位封闭浅色气泡，让小字以局部高分辨率识别并排除绘画噪声。
 * 主要内容：以四邻域扫描亮色连通区域，排除页面边缘、过小、过大和稀疏背景，最多返回二十四个局部区域；逐行以可靠局部识别替换重叠的全页结果，保留局部漏行与失败时的全页回退；漫画在同一气泡内合并局部及回退行并保留气泡外可靠旁白，普通图片保留物理行供独立段落策略处理。
 * 模块边界：纯像素和坐标算法，不创建 Canvas、不访问网络、不运行模型；气泡本身不作为文字证据，只有后续识别出的有效文本进入翻译。
 */
import {groupMangaText,type MangaOcrItem,type MangaRegion} from './mangaRegions';
type Box=MangaRegion['bbox'];
export interface MangaOcrPage {results:MangaOcrItem[];bubbles?:Array<{bbox:Box;results:MangaOcrItem[]}>}

export function findMangaBubbles(pixels:Uint8ClampedArray,width:number,height:number):Box[]{
    const count=width*height;
    if(![width,height].every(v=>Number.isSafeInteger(v)&&v>0)||count>16_777_216||pixels.length<count*4)return [];
    const white=new Uint8Array(count),queue=new Uint32Array(count);
    for(let i=0;i<count;i++){const p=i*4;white[i]=Number(pixels[p]>235&&pixels[p+1]>235&&pixels[p+2]>235&&pixels[p+3]>=128);}
    const candidates:Array<{bbox:Box;area:number}>=[];
    for(let start=0;start<count;start++){
        if(!white[start])continue;
        let head=0,tail=1,left=width,top=height,right=0,bottom=0;queue[0]=start;white[start]=0;
        const add=(index:number)=>{if(white[index]){white[index]=0;queue[tail++]=index;}};
        while(head<tail){
            const index=queue[head++],x=index%width,y=Math.floor(index/width);
            left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
            if(x>0)add(index-1);if(x+1<width)add(index+1);if(y>0)add(index-width);if(y+1<height)add(index+width);
        }
        const w=right-left+1,h=bottom-top+1;
        if(left===0||top===0||right===width-1||bottom===height-1||w<30||h<30||tail<1000||tail/(w*h)<.45||tail>count*.15)continue;
        candidates.push({bbox:{x0:left,y0:top,x1:right+1,y1:bottom+1},area:tail});
    }
    return candidates.sort((a,b)=>b.area-a.area).slice(0,24).map(item=>item.bbox);
}

function itemCenterInside(item: MangaOcrItem, bbox: Box): boolean {
    const x = item.box.x + item.box.width / 2, y = item.box.y + item.box.height / 2;
    return x >= bbox.x0 && x < bbox.x1 && y >= bbox.y0 && y < bbox.y1;
}

/** 同一行的全页与局部检测框可能略有偏移；双方至少覆盖一半才是替代证据，局部碎字不能删除整行。 */
function overlapsOcrLine(item: MangaOcrItem, local: MangaOcrItem): boolean {
    const a = item.box, b = local.box;
    const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return overlap > 0 && overlap >= Math.max(a.width * a.height, b.width * b.height) * .5;
}

/** 不跨气泡拼句；局部识别本身才是替代证据，气泡几何或其他对白的存在不能删除可靠原文。 */
export function collectMangaRegions(page:MangaOcrPage,language:string,width:number,height:number,profile: 'manga' | 'image' = 'manga'):MangaRegion[]{
    const bubbles=page.bubbles??[];
    const context = (item: MangaOcrItem) => bubbles.some(bubble => itemCenterInside(item,bubble.bbox)) ? 'bubble' as const : 'page' as const;
    const reliable = (item: MangaOcrItem) => groupMangaText([item], language, width, height, context(item)).length > 0;
    // 先按原始物理行去重，再合段；否则跨气泡的包围框中心会误删整段，或局部漏行无法并回同一对白。
    const local = bubbles.map(bubble => bubble.results.filter(reliable));
    const remaining = page.results.filter(reliable).filter(item => !local.some(items => items.some(candidate => overlapsOcrLine(item, candidate))));
    if (profile === 'image') {
        // 普通截图不能套用漫画宽松气泡间距：保留可靠物理行，交给普通段落策略合并。
        return [...remaining, ...local.flat()]
            .flatMap(item => groupMangaText([item],language,width,height,context(item)))
            .map(({sourceBoxes: _boxes, ...line}) => line)
            .sort((a,b) => a.bbox.y0-b.bbox.y0 || a.bbox.x0-b.bbox.x0);
    }
    const fallback = bubbles.map(() => [] as MangaOcrItem[]), outsideItems: MangaOcrItem[] = [];
    for (const item of remaining) {
        const index = bubbles.findIndex(bubble => itemCenterInside(item, bubble.bbox));
        if (index < 0) outsideItems.push(item); else fallback[index].push(item);
    }
    const paragraphs=bubbles.map((_bubble,index)=>groupMangaText([...local[index],...fallback[index]],language,width,height,'bubble'));
    const outside=groupMangaText(outsideItems,language,width,height);
    return [...outside,...paragraphs.flat()].sort((a,b)=>a.bbox.y0-b.bbox.y0||b.bbox.x0-a.bbox.x0);
}
