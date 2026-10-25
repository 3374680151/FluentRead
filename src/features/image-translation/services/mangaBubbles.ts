/**
 * @file src/features/image-translation/services/mangaBubbles.ts
 * 文件职责：从漫画像素定位封闭浅色气泡，让小字以局部高分辨率识别并排除绘画噪声。
 * 主要内容：以扫描行四邻域填充亮色连通区域，按待处理行段增长轻量栈，不为整图预分配逐像素队列；排除页面边缘、过小、过大和稀疏背景，最多返回二十四个局部区域；按最小局部候选优先消除嵌套候选对同一物理行的重复，逐行以可靠局部识别替换重叠的全页结果，保留局部漏行与失败时的全页回退；漫画在最紧的所属气泡内合并局部及回退行并保留气泡外可靠旁白，普通图片保留物理行供独立段落策略处理。
 * 模块边界：纯像素和坐标算法，不创建 Canvas、不访问网络、不运行模型；气泡本身不作为文字证据，只有后续识别出的有效文本进入翻译。
 */
import {groupMangaText,type MangaOcrItem,type MangaRegion} from './mangaRegions';
type Box=MangaRegion['bbox'];
export interface MangaOcrPage {results:MangaOcrItem[];bubbles?:Array<{bbox:Box;results:MangaOcrItem[]}>}

export function findMangaBubbles(pixels:Uint8ClampedArray,width:number,height:number):Box[]{
    const count=width*height;
    if(![width,height].every(v=>Number.isSafeInteger(v)&&v>0)||count>16_777_216||pixels.length<count*4)return [];
    const white=new Uint8Array(count);
    let stack=new Uint32Array(Math.min(count,4096)),size=0;
    for(let i=0;i<count;i++){const p=i*4;white[i]=Number(pixels[p]>235&&pixels[p+1]>235&&pixels[p+2]>235&&pixels[p+3]>=128);}
    const candidates:Array<{bbox:Box;area:number}>=[];
    // 每个相邻连续行段只压一个种子；状态 2 只表示已排队，横向扩张仍将其视为白色。
    const addRow=(row:number,left:number,right:number)=>{
        for(let x=left;x<=right;x++){
            if(!white[row+x])continue;
            if(white[row+x]===1){
                if(size===stack.length){const expanded=new Uint32Array(Math.min(count,stack.length*2));expanded.set(stack);stack=expanded;}
                stack[size++]=row+x;white[row+x]=2;
            }
            while(x<right&&white[row+x+1])x++;
        }
    };
    for(let start=0;start<count;start++){
        if(!white[start])continue;
        let area=0,left=width,top=height,right=0,bottom=0;stack[0]=start;size=1;
        while(size){
            const index=stack[--size];
            if(!white[index])continue;
            const x=index%width,y=Math.floor(index/width),row=y*width;
            let runLeft=x,runRight=x;
            while(runLeft>0&&white[row+runLeft-1])runLeft--;
            while(runRight+1<width&&white[row+runRight+1])runRight++;
            white.fill(0,row+runLeft,row+runRight+1);area+=runRight-runLeft+1;
            left=Math.min(left,runLeft);right=Math.max(right,runRight);top=Math.min(top,y);bottom=Math.max(bottom,y);
            if(y>0)addRow(row-width,runLeft,runRight);if(y+1<height)addRow(row+width,runLeft,runRight);
        }
        const w=right-left+1,h=bottom-top+1;
        if(left===0||top===0||right===width-1||bottom===height-1||w<30||h<30||area<1000||area/(w*h)<.45||area>count*.15)continue;
        candidates.push({bbox:{x0:left,y0:top,x1:right+1,y1:bottom+1},area});
    }
    return candidates.sort((a,b)=>b.area-a.area).slice(0,24).map(item=>item.bbox);
}

function itemCenterInside(item: MangaOcrItem, bbox: Box): boolean {
    const x = item.box.x + item.box.width / 2, y = item.box.y + item.box.height / 2;
    return x >= bbox.x0 && x < bbox.x1 && y >= bbox.y0 && y < bbox.y1;
}

/** 同一行的全页与局部检测框可能略有偏移；双方至少覆盖一半才是替代证据，局部碎字不能删除整行。 */
function overlapsOcrLine(item: MangaOcrItem, local: MangaOcrItem, minimum = .5): boolean {
    const a = item.box, b = local.box;
    const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return overlap > 0 && overlap >= Math.max(a.width * a.height, b.width * b.height) * minimum;
}

/** 不跨气泡拼句；局部识别本身才是替代证据，气泡几何或其他对白的存在不能删除可靠原文。 */
export function collectMangaRegions(page:MangaOcrPage,language:string,width:number,height:number,profile: 'manga' | 'image' = 'manga'):MangaRegion[]{
    const bubbles=page.bubbles??[];
    const context = (item: MangaOcrItem) => bubbles.some(bubble => itemCenterInside(item,bubble.bbox)) ? 'bubble' as const : 'page' as const;
    const reliable = (item: MangaOcrItem) => groupMangaText([item], language, width, height, context(item)).length > 0;
    // 先按原始物理行去重，再合段；否则跨气泡的包围框中心会误删整段，或局部漏行无法并回同一对白。
    const bubbleOrder = bubbles.map((bubble,index)=>({index,area:(bubble.bbox.x1-bubble.bbox.x0)*(bubble.bbox.y1-bubble.bbox.y0)}))
        .sort((a,b)=>a.area-b.area).map(bubble=>bubble.index);
    const local = bubbles.map(() => [] as MangaOcrItem[]), accepted: Array<{item:MangaOcrItem;index:number}> = [];
    for(const index of bubbleOrder)for(const item of bubbles[index].results.filter(reliable)){
        // 浅色面板和内部气泡可能同时入选；只按跨候选且双向高重叠的几何证据去重，
        // 更紧的局部裁剪优先，同候选独立行、不同位置的相同对白均保留。
        if(accepted.some(previous=>previous.index!==index&&overlapsOcrLine(item,previous.item,.65)))continue;
        accepted.push({item,index});
        // 检测来源和对白归属分别保留：外层裁剪补回的漏行也属于最紧的气泡，
        // 不能在去重后把同一对白的首行与后续行分到内外两个段落。
        const owner=profile==='manga'?bubbleOrder.find(candidate=>candidate===index||itemCenterInside(item,bubbles[candidate].bbox))!:index;
        local[owner].push(item);
    }
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
        const index = bubbleOrder.find(index => itemCenterInside(item, bubbles[index].bbox));
        if (index === undefined) outsideItems.push(item); else fallback[index].push(item);
    }
    const paragraphs=bubbles.map((_bubble,index)=>groupMangaText([...local[index],...fallback[index]],language,width,height,'bubble'));
    const outside=groupMangaText(outsideItems,language,width,height);
    return [...outside,...paragraphs.flat()].sort((a,b)=>a.bbox.y0-b.bbox.y0||b.bbox.x0-a.bbox.x0);
}
