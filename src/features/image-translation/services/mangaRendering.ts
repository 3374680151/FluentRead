/**
 * @file src/features/image-translation/services/mangaRendering.ts
 * 文件职责：在整段漫画区域中绘制适合阅读的译文，避免整行逐框放大和复杂背景扩散条纹。
 * 主要内容：保留整段内容和裁剪边界，对白使用随字号缩小的内边距，避免短行损失半数高度；原始大标题使用有界大字与高对比描边；均匀背景按原始行及描边蒙版清字，保留行间画面；复用页内准确度量和原图背景分类，避免修补后被误判成均匀底色而二次铺板。
 * 模块边界：只操作调用方提供的画布和像素，不运行 OCR/翻译、不修改宿主页面；绘制区域局限于识别框，完整原图仍可通过现有按钮对照。
 */
import type {MangaRegion} from './mangaRegions';
import {getImageTextColor, getImageTextBackgroundColor} from './rendering';
import {layoutMangaTranslationText, MANGA_TEXT_FONT} from './mangaTypography';
import {mangaMaskBoxes} from '../mangaPatchResult';

export interface MangaBackground {color: string; uniform: boolean}

export function mangaRegionBackground(pixels: Uint8ClampedArray, width: number, height: number, box: MangaRegion['bbox']) {
    const sampled = getImageTextBackgroundColor(pixels, width, height, box);
    const channels = sampled.match(/\d+/g)!.map(Number);
    let matching = 0, samples = 0;
    const sample = (x: number, y: number) => {
        const offset = (y * width + x) * 4; samples += 1;
        if (pixels[offset + 3] >= 128 && channels.every((value, index) => Math.abs(pixels[offset + index] - value) <= 20)) matching += 1;
    };
    for (let x = Math.floor(box.x0); x < box.x1; x += Math.max(1, Math.floor((box.x1 - box.x0) / 32))) {
        sample(x, Math.max(0, Math.floor(box.y0) - 1)); sample(x, Math.min(height - 1, Math.ceil(box.y1)));
    }
    for (let y = Math.floor(box.y0); y < box.y1; y += Math.max(1, Math.floor((box.y1 - box.y0) / 32))) {
        sample(Math.max(0, Math.floor(box.x0) - 1), y); sample(Math.min(width - 1, Math.ceil(box.x1)), y);
    }
    return {color: sampled, uniform: matching / samples >= 0.9};
}

/** 背景判断取自原图；修补模型生成的平滑像素不应改变该区域的绘制策略。 */
export function sampleMangaBackgrounds(pixels: Uint8ClampedArray, width: number, height: number, regions: MangaRegion[]): MangaBackground[] {
    return regions.map(region => mangaRegionBackground(pixels,width,height,region.bbox));
}

/** 短对白有统一上限，标题根据源字号保持层次；所有文字依然限制在原识别范围内。 */
export function drawMangaTranslations(context: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
    width: number, height: number, regions: Array<MangaRegion & {sourceText?: string}>, repaired = false, backgrounds?: MangaBackground[]) {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || pixels.length < width * height * 4) return;
    // 只在本次绘制内保留；字体和实际字号进入 key，不跨页面或设备复用字体度量。
    const measurements = new Map<string, number>();
    let cachedCharacters = 0;
    for (const [index,region] of regions.entries()) {
        const box = region.bbox;
        const left = Math.max(0, box.x0), top = Math.max(0, box.y0);
        const right = Math.min(width, box.x1), bottom = Math.min(height, box.y1);
        if (right <= left || bottom <= top) continue;
        const sampled = backgrounds?.[index] ?? mangaRegionBackground(pixels, width, height, {x0:left,y0:top,x1:right,y1:bottom});
        const background = sampled.uniform ? sampled.color : 'rgb(255,255,255)';
        context.save();
        try {
            if (sampled.uniform || !repaired) {
                context.fillStyle = background;
                // 已有物理行时，清字边界与修补/传输图块完全一致：清掉框外描边，不铺白整段行间画面。
                if (sampled.uniform && region.sourceBoxes?.length) {
                    for (const source of mangaMaskBoxes(region, width, height)) {
                        context.fillRect(source.x0, source.y0, source.x1 - source.x0, source.y1 - source.y0);
                    }
                } else context.fillRect(left, top, right - left, bottom - top);
            }
            const display = !sampled.uniform && !region.vertical && region.fontSize >= width * .045;
            const weight = display ? 800 : 600;
            const maxSize = Math.min(region.fontSize * 1.05,width * (display ? .10 : .034));
            // OCR 框包含的是字形；固定 4px 会把 7–8px 短行的可用高度减半，译文因此只剩 3px。
            const inset = Math.min(display ? Math.max(3,maxSize * .12) : Math.min(4,maxSize * .1),(right-left) / 4,(bottom-top) / 4);
            let measuredFont = '';
            const layout = layoutMangaTranslationText(region.text,right-left-inset*2,bottom-top-inset*2,(text,size)=>{
                const font = `${weight} ${size}px ${MANGA_TEXT_FONT}`, key = `${font}|${text}`;
                const cached = measurements.get(key);
                if (cached !== undefined) return cached;
                if (measuredFont !== font) {context.font = font; measuredFont = font;}
                const value = context.measureText(text).width;
                if (measurements.size < 8192 && cachedCharacters + key.length <= 131072) {measurements.set(key,value); cachedCharacters += key.length;}
                return value;
            },maxSize);
            if (!layout.lines.length) continue;
            context.beginPath();context.rect(left,top,right-left,bottom-top);context.clip();
            context.font = `${weight} ${layout.fontSize}px ${MANGA_TEXT_FONT}`;
            context.textAlign = 'center';context.textBaseline = 'middle';context.lineJoin = 'round';
            const ink = sampled.uniform ? getImageTextColor(background) : '#111111';
            context.fillStyle = ink === '#111827' ? '#111111' : ink;
            context.strokeStyle = sampled.uniform ? background : '#ffffff';
            context.lineWidth = Math.max(.5,layout.fontSize * (sampled.uniform ? .035 : .14));
            const firstLine = top + (bottom-top-layout.lines.length*layout.lineHeight)/2 + layout.lineHeight/2;
            layout.lines.forEach((text,line)=>{
                const y = firstLine + line*layout.lineHeight;
                context.strokeText(text,(left+right)/2,y);context.fillText(text,(left+right)/2,y);
            });
        } finally { context.restore(); }
    }
}
