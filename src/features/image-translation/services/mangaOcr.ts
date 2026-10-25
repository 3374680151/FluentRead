/**
 * @file src/features/image-translation/services/mangaOcr.ts
 * 文件职责：在扩展独立 Worker 中按需运行 PaddleOCR 漫画识别，并隔离排队、取消、失败和空闲释放。
 * 主要内容：延迟导入浏览器 OCR 和本地 ONNX WASM，用频繁读取的画布完成 OCR 预处理，透明像素仅在识别画布上按前景亮度合成对比底色，读取已校验模型并融合 ONNX 执行图，硬件可用时加速识别，GPU 故障有界切换 CPU；SVG 复用已解码原图异步转为无损 PNG 后进入 Worker，取消或失败释放自有画布且保留借用原图；大图以有重叠的原像素瓦片识别并按物理行去重，整页原文与放大的独立气泡共同参与可靠性回退，每页共享至多四个低置信竖列的单项复识别预算，只有置信度提升且原框完全吻合才替换原文，普通图片保留物理行供严格段落策略使用；滚动取消保留轻量模型端口，Worker owner 有界收尾，GPU 挂起重建一次 CPU 后端，空闲三分钟释放会话，统一清理 OCR 与修补会话。
 * 模块边界：不访问宿主 DOM、不翻译文本、不处理译图；仅漫画及显式选择 PaddleOCR 的单张图片使用本模型；通用识别与圈选继续由 Tesseract 负责。
 */
import {localWasmThreads, paceLocalInference} from '@/src/shared/onnx/resources';
import {mangaInferenceClient, mangaExtensionUrl, type MangaInferenceProgress} from './mangaInferenceClient';
import {probeWebGpu} from '@/src/shared/onnx/webgpu';
import {protectMangaSession} from './mangaSessionFallback';
import {configureOnnxWasmBackend} from '@/src/shared/onnx/wasmBinary';
import {assertMangaOcrActive, loadMangaOcrAssets, removeMangaOcrAssets, withMangaModelAdmission, withMangaModelRemoval} from './mangaOcrAssets';
import type {MangaRegion} from './mangaRegions';
import {findMangaBubbles,collectMangaRegions,type MangaOcrPage} from './mangaBubbles';
import {mangaInpaintingRuntime} from './mangaInpainting';
import {encodeImageCanvas} from './imageEncoding';
import {flattenOcrAlpha} from './ocrPixels';
import {mergeMangaOcrTiles, planMangaOcrTiles, type MangaOcrTileResult} from './mangaOcrTiles';

interface MangaOcrPort {
    recognize(image: string, options: {flatten: true; noCache: true; strategy: 'per-box';signal?:AbortSignal; decodedImage?: HTMLImageElement; progress?: MangaInferenceProgress}): Promise<MangaOcrPage>;
    destroy(): Promise<void>;
}
type Progress = MangaInferenceProgress;

/** 单队列持有模型会话，取消排队请求不能终止其他页正在使用的模型。 */
export function createMangaOcrRuntime(create: (signal?: AbortSignal, progress?: Progress) => Promise<MangaOcrPort>) {
    let service: MangaOcrPort | undefined;
    let tail: Promise<void> = Promise.resolve();
    let idle: ReturnType<typeof setTimeout> | undefined;
    function clearIdle() { clearTimeout(idle); idle = undefined; }
    async function release() {
        clearIdle(); const current = service; service = undefined;
        await current?.destroy();
    }
    function queue<T>(operation: () => Promise<T>): Promise<T> {
        const result = tail.then(operation);
        tail = result.then(() => undefined, () => undefined);
        return result;
    }
    return {
        recognize(image: string, language: string, width: number, height: number, signal?: AbortSignal, progress?: Progress, decodedImage?: HTMLImageElement, profile: 'manga' | 'image' = 'manga'): Promise<MangaRegion[]> {
            const result = withMangaModelAdmission(() => queue(async () => {
                assertMangaOcrActive(signal); clearIdle();
                try {
                    return await (async () => {
                        if (!service) {
                            progress?.('preparing', 0);
                            service = await create(signal, progress);
                        }
                        assertMangaOcrActive(signal); progress?.('recognizing');
                        const response = await service.recognize(image, {flatten: true, noCache: true, strategy: 'per-box',signal, decodedImage, progress});
                        assertMangaOcrActive(signal);
                        return collectMangaRegions(response, language, width, height, profile);
                    })().catch(async error => {
                        // 滚动取消只丢弃本页结果；端口仍可复用，由 Worker owner 看守原生推理收尾。
                        if (signal?.aborted && (error as Error | undefined)?.name === 'AbortError') throw error;
                        const current=service;service=undefined;
                        await Promise.resolve().then(()=>current?.destroy()).catch(()=>undefined);
                        throw error;
                    });
                } finally {
                    // 不把输入图或结果缓存在库内；跨页结果缓存仍由 content 的像素预算管理。
                    idle = setTimeout(() => { void queue(release).catch(() => undefined); }, 180_000);
                }
            }));
            if (!signal) return result;
            return new Promise((resolve, reject) => {
                const abort = () => reject(new DOMException('漫画识别已取消', 'AbortError'));
                signal.addEventListener('abort', abort, {once: true});
                if (signal.aborted) abort();
                void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
            });
        },
        dispose: () => queue(release),
        removeModels: () => queue(async () => { try { await release(); } finally { await removeMangaOcrAssets(); } }),
    };
}

export async function createBrowserMangaOcr(signal?: AbortSignal, progress?: Progress): Promise<MangaOcrPort> {
    const model = await loadMangaOcrAssets(signal, percent => progress?.('preparing', percent));
    assertMangaOcrActive(signal); progress?.('initializing');
    // 两个包共享同一 ONNX 实例；在导入 SDK 前覆盖其 CDN 默认路径，符合扩展 CSP。
    const ort = await import('onnxruntime-web/webgpu');
    ort.env.wasm.numThreads = localWasmThreads();
    configureOnnxWasmBackend(ort.env.wasm, {
        mjs: mangaExtensionUrl('/fluent-read-ai/ort-wasm-simd-threaded.asyncify.mjs'),
        wasm: mangaExtensionUrl('/fluent-read-ai/ort-wasm-simd-threaded.asyncify.wasm'),
    });
    const {PaddleOcrService} = await import('ppu-paddle-ocr/web');
    const gpu=await probeWebGpu();
    let activeSignal=signal;
    class MangaService extends PaddleOcrService {
        private checks:Array<()=>void>=[];
        private inferenceFailure: {error: unknown} | undefined;
        private remainingRetries=4;
        beginMangaPage(): void {this.remainingRetries=4;}
        private checkInferenceFailure(): void {
            if(this.inferenceFailure)throw this.inferenceFailure.error;
        }
        async recognizeManga(canvas:HTMLCanvasElement | OffscreenCanvas,options:{flatten:true;noCache:true;strategy:'per-box'}) {
            this.inferenceFailure=undefined;
            try {
                const page=await this.recognize(canvas,options);
                // 批量裁切会把不同宽度补齐；只对已有低置信竖列有界复识别，不再运行检测或新增框。
                const weak=page.results.filter(item=>item.confidence<.9&&item.box.height>item.box.width*1.8)
                    .sort((a,b)=>a.confidence-b.confidence).slice(0,this.remainingRetries);
                if(!weak.length)return page;
                assertMangaOcrActive(activeSignal);
                this.remainingRetries-=weak.length;
                const retried=await this.recognitor!.run(canvas,weak.map(item=>item.box),
                    this.options.recognition!.charactersDictionary,'per-box',{...options,recBatchSize:1});
                assertMangaOcrActive(activeSignal);
                const replacements=new Map(weak.map(item=>[item, retried.find(candidate=>
                    candidate.box.x===item.box.x&&candidate.box.y===item.box.y&&candidate.box.width===item.box.width
                    &&candidate.box.height===item.box.height&&candidate.confidence>=item.confidence+.05)]));
                return {...page,results:page.results.map(item=>replacements.get(item)??item)};
            }
            finally {
                this.checks.forEach(check=>check());
                // SDK 的识别阶段可能记录错误后返回空数组；CPU 也必须向调用方报告首因，允许正常重试。
                this.checkInferenceFailure();
            }
        }
        async initialize() {
            await super.initialize();
            for(const [key,session] of [['detection',this.detectionSession],['recognition',this.recognitionSession]] as const) {
                if(session && gpu.available)this.checks.push(protectMangaSession(session,async()=>{
                    assertMangaOcrActive(activeSignal);
                    const assets=await loadMangaOcrAssets(activeSignal);
                    assertMangaOcrActive(activeSignal);
                    const cpu=await ort.InferenceSession.create(assets[key],{executionProviders:['wasm'],graphOptimizationLevel:'all'});
                    try {assertMangaOcrActive(activeSignal);}catch(error){await Promise.resolve().then(()=>cpu.release()).catch(()=>undefined);throw error;}
                    return cpu;
                },()=>activeSignal));
                if(session){
                    const run=session.run.bind(session),invoke=run as (...args:Parameters<typeof run>)=>ReturnType<typeof run>;
                    session.run=(async(...args:Parameters<typeof run>)=>{
                        try{return await paceLocalInference(()=>{assertMangaOcrActive(activeSignal);return invoke(...args);});}
                        catch(error){this.inferenceFailure??={error};throw error;}
                    }) as typeof session.run;
                }
            }
        }
    }
    const service = new MangaService({model, detection: {maxSideLength:1536,paddingVertical:0.1,paddingHorizontal:0.2},
        recognition: {charactersDictionary: [], minimumConfidence:0.65,strategy:'per-box',spaceRecovery:true,mainThreadYieldMs:1,maxCropSourceSideLength:8192},
        session: {executionProviders: gpu.available?['webgpu','wasm']:['wasm'], graphOptimizationLevel: 'all'}});
    try {
        await service.initialize(); assertMangaOcrActive(signal);
        return {
            recognize: async (image, options) => {
                activeSignal=options.signal;
                assertMangaOcrActive(options.signal);
                service.beginMangaPage();
                const bitmap=options.decodedImage ?? await createImageBitmap(new Blob([await (await fetch(image)).arrayBuffer()]));
                const canvas=createOcrCanvas();
                try {
                    assertMangaOcrActive(options.signal);
                    const width='naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width,height='naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
                    const tiles=planMangaOcrTiles(width,height);
                    canvas.width=width;canvas.height=height;
                    const context=canvas.getContext('2d', {willReadFrequently: true});if(!context)throw new Error('浏览器不支持图片处理');
                    context.drawImage(bitmap,0,0);
                    const pixels=context.getImageData(0,0,canvas.width,canvas.height);
                    // Paddle 的 RGB 张量忽略 alpha；只在识别像素上合成对比底色，
                    // 后续重绘仍借用保留透明度的原图，不重复回读或复制整图。
                    if(flattenOcrAlpha(pixels.data))context.putImageData(pixels,0,0);
                    const boxes=findMangaBubbles(pixels.data,canvas.width,canvas.height);
                    const sdkOptions={flatten:true as const,noCache:true as const,strategy:'per-box' as const};
                    // 整页保留气泡原文，局部识别为空、低置信或漏行时仍有回退证据。
                    // 超出检测边长的图按原像素切片，不能为长图把所有小字缩到不可辨认。
                    let page: MangaOcrPage;
                    if(tiles.length===1) page=await service.recognizeManga(canvas,sdkOptions);
                    else {
                        const tileCanvas=createOcrCanvas(),pages:MangaOcrTileResult[]=[];
                        try {
                            const tileContext=tileCanvas.getContext('2d',{willReadFrequently:true});
                            if(!tileContext)throw new Error('浏览器不支持图片处理');
                            for(const tile of tiles){
                                assertMangaOcrActive(options.signal);
                                tileCanvas.width=tile.width;tileCanvas.height=tile.height;
                                tileContext.drawImage(canvas,tile.x,tile.y,tile.width,tile.height,0,0,tile.width,tile.height);
                                const result=await service.recognizeManga(tileCanvas,sdkOptions);
                                assertMangaOcrActive(options.signal);
                                pages.push({tile,results:result.results});
                            }
                            page={results:mergeMangaOcrTiles(pages,width,height)};
                        }finally{tileCanvas.width=0;tileCanvas.height=0;}
                    }
                    const bubbles:NonNullable<MangaOcrPage['bubbles']>=[];
                    for(const bbox of boxes){
                        assertMangaOcrActive(options.signal);
                        const width=bbox.x1-bbox.x0,height=bbox.y1-bbox.y0;
                        const scale=Math.min(3,1536/Math.max(width,height));
                        const crop=createOcrCanvas();crop.width=Math.round(width*scale);crop.height=Math.round(height*scale);
                        try {
                            const ctx=crop.getContext('2d', {willReadFrequently: true});if(!ctx)throw new Error('浏览器不支持图片处理');
                            ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
                            ctx.drawImage(canvas,bbox.x0,bbox.y0,width,height,0,0,crop.width,crop.height);
                            const result=await service.recognizeManga(crop,sdkOptions);
                            const sx=crop.width/width,sy=crop.height/height;
                            bubbles.push({bbox,results:result.results.map(item=>({...item,box:{x:bbox.x0+item.box.x/sx,y:bbox.y0+item.box.y/sy,width:item.box.width/sx,height:item.box.height/sy}}))});
                        }finally{crop.width=0;crop.height=0;}
                    }
                    assertMangaOcrActive(options.signal);return {results:page.results,bubbles};
                }finally{canvas.width=0;canvas.height=0;if ('close' in bitmap) bitmap.close();}
            },
            destroy: () => service.destroy(),
        };
    } catch (error) { await Promise.resolve().then(()=>service.destroy()).catch(()=>undefined); throw error; }
}

function createOcrCanvas(): HTMLCanvasElement | OffscreenCanvas {
    return typeof document === 'undefined' ? new OffscreenCanvas(0, 0) : document.createElement('canvas');
}

async function createWorkerMangaOcr(signal?: AbortSignal, progress?: Progress): Promise<MangaOcrPort> {
    await mangaInferenceClient.prepare('ocr', signal, progress);
    return {
        recognize: async (image, options) => {
            let workerImage = image;
            // Worker 的 Blob 位图解码器不能解码 SVG；DOM 预检已解码并限制了尺寸，
            // 借用此源转 PNG，避免重抓原图或让 GPU/CPU 重试重复同一次解码错误。
            if (options.decodedImage && /^data:image\/svg\+xml[;,]/iu.test(image)) {
                assertMangaOcrActive(options.signal);
                const source = options.decodedImage;
                const canvas = document.createElement('canvas');
                try {
                    canvas.width = source.naturalWidth;
                    canvas.height = source.naturalHeight;
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error('浏览器不支持图片处理');
                    context.drawImage(source, 0, 0);
                    workerImage = await encodeImageCanvas(canvas, options.signal);
                    assertMangaOcrActive(options.signal);
                } finally {
                    canvas.width = 0;
                    canvas.height = 0;
                }
            }
            return mangaInferenceClient.request({type:'recognize', image: workerImage}, options.signal, options.progress);
        },
        destroy: () => mangaInferenceClient.release('ocr'),
    };
}

export const mangaOcrRuntime = createMangaOcrRuntime(createWorkerMangaOcr);

/** 设置清理和页面销毁共用模型会话生命周期。 */
export function removeMangaModels():Promise<void>{
    return withMangaModelRemoval(async () => {
        // 先等修补队列退出，再由 OCR 队列清除缓存；释放失败仍须尝试剩余清理。
        try { await mangaInpaintingRuntime.dispose(); }
        finally {
            try { await mangaOcrRuntime.dispose(); }
            finally {
                // 两个运行队列退出后，清除取消准备留下的无人端口，避免删除后重新写入模型缓存。
                mangaInferenceClient.dispose();
                await mangaOcrRuntime.removeModels();
            }
        }
    });
}
export function disposeMangaModels():void{mangaInferenceClient.dispose();void mangaOcrRuntime.dispose().catch(()=>undefined);void mangaInpaintingRuntime.dispose().catch(()=>undefined);}
