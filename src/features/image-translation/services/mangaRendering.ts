/**
 * @file src/features/image-translation/services/mangaRendering.ts
 * 文件职责：在整段漫画区域中绘制适合阅读的译文，避免整行逐框放大和复杂背景扩散条纹。
 * 主要内容：保留整段内容和裁剪边界，对白保留横向内边距，按真实 Canvas 整行字形上下界、描边与有界像素余量适配并居中，缺少完整指标时保守沿用行框；原始大标题使用有界大字与高对比描边；均匀背景按原始行及描边蒙版清字，保留行间画面；页内度量以固定字体族下的字重、字号与全文短键复用，连续字号复用字体前缀，仍按原完整字体键扣除预算；复用原图背景分类，避免修补后被误判成均匀底色而二次铺板。
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
    // 本次绘制的字体族固定；短键保留字重、实际字号和全文，不跨页面或设备复用。
    const measurements = new Map<string, {width:number;ascent:number;descent:number}>();
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
            // 保留横向余量；OCR 框是字形边界，竖向空间由实际字形和描边适配，不再重复扣除内边距。
            const inset = Math.min(display ? Math.max(3,maxSize * .12) : Math.min(4,maxSize * .1),(right-left) / 4,(bottom-top) / 4);
            let measuredFont = '', keyFontSize = NaN, font = '', keyPrefix = '', logicalPrefixLength = 0;
            context.textBaseline = 'alphabetic';
            const measure = (text:string,size:number) => {
                if (keyFontSize !== size) {
                    keyFontSize = size; font = `${weight} ${size}px ${MANGA_TEXT_FONT}`;
                    keyPrefix = `${weight}|${size}|`; logicalPrefixLength = font.length + 1;
                }
                const key = keyPrefix + text;
                const cached = measurements.get(key);
                if (cached !== undefined) return cached;
                if (measuredFont !== font) {context.font = font; measuredFont = font;}
                const metrics = context.measureText(text);
                const value = {width:metrics.width,ascent:metrics.actualBoundingBoxAscent,descent:metrics.actualBoundingBoxDescent};
                // 键更短也不增加缓存准入量，仍按原完整字体键的长度计费。
                const logicalCharacters = logicalPrefixLength + text.length;
                if (measurements.size < 8192 && cachedCharacters + logicalCharacters <= 131072) {measurements.set(key,value); cachedCharacters += logicalCharacters;}
                return value;
            };
            const lineWidth = (size:number)=>Math.max(.5,size*(sampled.uniform ? .035 : .14));
            const layout = layoutMangaTranslationText(region.text,right-left-inset*2,bottom-top,(text,size)=>measure(text,size).width,maxSize,(text,size)=>{
                const {ascent,descent} = measure(text,size);
                if (![ascent,descent].every(Number.isFinite) || ascent+descent<=0) return undefined;
                const padding = lineWidth(size)/2+.5;
                return {ascent:ascent+padding,descent:descent+padding};
            });
            if (!layout.lines.length) continue;
            context.beginPath();context.rect(left,top,right-left,bottom-top);context.clip();
            context.font = `${weight} ${layout.fontSize}px ${MANGA_TEXT_FONT}`;
            context.textAlign = 'center';context.textBaseline = layout.ink ? 'alphabetic' : 'middle';context.lineJoin = 'round';
            const ink = sampled.uniform ? getImageTextColor(background) : '#111111';
            context.fillStyle = ink === '#111827' ? '#111111' : ink;
            context.strokeStyle = sampled.uniform ? background : '#ffffff';
            context.lineWidth = lineWidth(layout.fontSize);
            const firstLine = top + (bottom-top-layout.lines.length*layout.lineHeight)/2 + layout.lineHeight/2;
            layout.lines.forEach((text,line)=>{
                const y = layout.ink ? top+(bottom-top-layout.ink.height)/2+layout.ink.baselines[line] : firstLine+line*layout.lineHeight;
                context.strokeText(text,(left+right)/2,y);context.fillText(text,(left+right)/2,y);
            });
        } finally { context.restore(); }
    }
}
