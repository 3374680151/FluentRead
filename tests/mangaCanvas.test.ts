import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createMangaCanvas} from '@/src/features/image-translation/content/mangaCanvas';
import {composeMangaPage} from '@/src/features/image-translation/content/mangaCompositor';
import {encodeImageCanvas} from '@/src/features/image-translation/services/imageEncoding';
import {createMangaReader} from '@/src/features/image-translation/content/mangaReader';
vi.mock('@/src/features/image-translation/content/mangaCompositor', () => ({composeMangaPage: vi.fn()}));
vi.mock('@/src/features/image-translation/services/imageEncoding', () => ({encodeImageCanvas: vi.fn()}));
const compose = vi.mocked(composeMangaPage);
const encode = vi.mocked(encodeImageCanvas);
const packet = {width: 400, height: 300, patches: [{x: 0, y: 0, width: 1, height: 1, image: 'data:image/png;base64,AQ=='}]};
const result = {mangaPatches: packet, lines: [{text: '译文', bbox: {x0: 0, y0: 0, x1: 1, y1: 1}, backgroundColor: '#fff'}]};
const deferred = <T,>() => {let resolve!: (value: T) => void, reject!: (error: Error) => void;const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};};
const flush = async () => {for (let n = 0; n < 30; n++) await Promise.resolve();};

function fixture(recovery?: Parameters<typeof createMangaCanvas>[0]['recovery']) {
    encode.mockResolvedValue('data:image/png;base64,AQ==');
    const {document, window} = parseHTML('<html><body><div id="reader"></div></body></html>');
    const create = document.createElement.bind(document);
    const snapshots: HTMLCanvasElement[] = [], outputs: HTMLCanvasElement[] = [], roots: ShadowRoot[] = [];
    let missingCaptureContext = false;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const element = create(tag);
        if (tag === 'div') {const attach = element.attachShadow.bind(element);element.attachShadow = options => {const root = attach(options);roots.push(root);return root;};}
        if (tag === 'canvas') {
            const canvas = element as HTMLCanvasElement;
            let drawn: HTMLCanvasElement | null = null;
            canvas.getContext = vi.fn(() => missingCaptureContext && canvas.width > 8 ? null : {
                drawImage: (source: HTMLCanvasElement) => {drawn = source;canvas.dataset.content = source.dataset.content || 'A';},
                getImageData: () => {
                    if (drawn?.dataset.tainted === 'true') throw new DOMException('tainted', 'SecurityError');
                    return {data: new Uint8ClampedArray(256).fill(Number(drawn?.dataset.pixel ?? 1))};
                },
            }) as typeof canvas.getContext;
            canvas.toDataURL = vi.fn(() => 'data:image/png;base64,AQ==');
            snapshots.push(canvas);
        }
        return element;
    }) as typeof document.createElement);
    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    canvas.width = 400;canvas.height = 300;canvas.dataset.pixel = '1';
    canvas.style.cssText = 'border:1px solid red;';document.getElementById('reader')!.append(canvas);
    const bounds = {left: 100, top: 50, right: 500, bottom: 350, width: 400, height: 300};
    canvas.getBoundingClientRect = () => bounds as DOMRect;
    const styles = new Map<Element, Record<string, string>>();
    const hit = vi.fn(() => canvas as Element | null);
    document.elementFromPoint = hit;
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', {innerWidth: 1280, innerHeight: 900});
    // 同时覆盖不具备 WebCrypto 的 HTTP 内容环境；原生 digest 由专门用例验证。
    vi.stubGlobal('crypto', {});
    vi.stubGlobal('getComputedStyle', (element: Element) => ({display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', ...styles.get(element)}));
    compose.mockImplementation(async () => {const output = document.createElement('canvas') as HTMLCanvasElement;output.width = 400;output.height = 300;outputs.push(output);return output;});
    const ports = {enabled: vi.fn(() => true), configurationIdentity: vi.fn(() => 'config-1'), cacheEnabled: vi.fn(() => true), recovery, acceptsInteractionLayer:vi.fn((_canvas:HTMLCanvasElement,_hit:Element)=>false), translate: vi.fn().mockResolvedValue(result)};
    const runtime = createMangaCanvas(ports);
    return {document, window, canvas, bounds, styles, hit, snapshots, outputs, roots, ports, runtime,
        missingContext: () => {missingCaptureContext = true;}};
}

function readerFor(f: ReturnType<typeof fixture>) {
    const outer = f.document.createElement('div');outer.className = 'images-container';
    outer.innerHTML = '<div class="view-container"><div class="image-container"></div></div>';
    outer.querySelector('.image-container')!.append(f.canvas);f.document.body.append(outer);
    vi.stubGlobal('Element', f.window.Element);
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('MutationObserver', class {observe() {} disconnect() {}});
    const callbacks = new Map<number, FrameRequestCallback>();let sequence = 0;
    vi.stubGlobal('window', {innerWidth: 1280, innerHeight: 900, location: {href: 'https://manga.bilibili.com/mc30124/595886'},
        requestAnimationFrame: (callback: FrameRequestCallback) => {callbacks.set(++sequence, callback);return sequence;},
        cancelAnimationFrame: (id: number) => callbacks.delete(id), addEventListener: vi.fn(), removeEventListener: vi.fn()});
    encode.mockImplementation(async canvas => `data:image/png;base64,${btoa(canvas.dataset.content || 'A')}`);
    const reader = createMangaReader({enabled: () => true, identity: () => 'unused-image', translate: vi.fn(), restore: vi.fn(), release: vi.fn(), failed: () => false, changed: vi.fn(), canvas: f.runtime});
    return reader;
}
afterEach(() => {vi.restoreAllMocks();vi.resetAllMocks();vi.unstubAllGlobals();});

describe('公开可读漫画画布的任务与显示所有权', () => {
    it('画布、背景和分段共用的错误反馈只从可信动作请求原会话重试，关闭不伪造成功或循环识别', async () => {
        const recovery={retry:vi.fn(()=>false),openSettings:vi.fn(async()=>{}),translateUi:(text:string)=>`本地化:${text}`};
        const f=fixture(recovery);f.ports.translate.mockRejectedValueOnce(Object.assign(new Error('provider detail'),{errorCode:'language'}));
        await expect(f.runtime.translate(f.canvas)).rejects.toThrow('provider detail');
        const root=f.roots[0],feedback=root.querySelector<HTMLElement>('.fr-image-feedback')!;
        const retry=feedback.querySelector<HTMLButtonElement>('.fluent-read-image-translation-button')!;
        const click=(target:Element,trusted=true)=>{const event=new f.window.Event('click',{bubbles:true});Object.defineProperty(event,'isTrusted',{value:trusted});target.dispatchEvent(event);};
        expect(feedback.hidden).toBe(false);expect(feedback.style.left).toBe('108px');expect(feedback.style.top).toBe('58px');
        expect(feedback.textContent).toContain('本地化:图片文字已识别');expect(feedback.querySelector('details')!.textContent).toContain('provider detail');
        click(retry,false);expect(recovery.retry).not.toHaveBeenCalled();click(retry);expect(recovery.retry).toHaveBeenCalledWith(f.canvas);expect(retry.disabled).toBe(false);
        recovery.retry.mockReturnValue(true);click(retry);expect(retry.disabled).toBe(true);
        click(feedback.querySelector('.fr-image-model-settings')!);await flush();expect(recovery.openSettings).toHaveBeenCalledWith('settings-services');
        f.runtime.refreshLanguage();expect(feedback.querySelector('.fluent-read-image-translation-button')!.textContent).toBe('本地化:重试');
        click(feedback.querySelector('.fr-image-dismiss')!);expect(feedback.isConnected).toBe(false);
        expect(f.runtime.failed(f.canvas)).toBe(true);expect(f.runtime.reuse(f.canvas)).toBe(false);f.runtime.update();
        expect(root.querySelector('.fr-image-feedback')).toBeNull();expect(f.ports.translate).toHaveBeenCalledOnce();
        await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledTimes(2);expect(f.runtime.failed(f.canvas)).toBe(false);
        expect(root.querySelectorAll('style')).toHaveLength(1);f.runtime.refreshLanguage();f.runtime.dispose();
    });
    it('共享错误恢复跟随可见裁切，离屏、隐藏和宿主遮挡时撤下，不能把自己当作宿主遮挡', async () => {
        const f=fixture({retry:vi.fn(()=>false),openSettings:async()=>{}});f.ports.translate.mockRejectedValueOnce('offline');
        await expect(f.runtime.translate(f.canvas)).rejects.toBe('offline');
        const feedback=f.roots[0].querySelector<HTMLElement>('.fr-image-feedback')!,host=f.document.getElementById('fluent-read-manga-canvas-container')!;
        Object.assign(f.bounds,{left:-100,top:-50,right:300,bottom:250});f.runtime.update();
        expect(feedback.style.left).toBe('8px');expect(feedback.style.top).toBe('8px');expect(feedback.hidden).toBe(false);
        f.hit.mockReturnValue(host);f.document.elementsFromPoint=()=>[host,f.canvas];f.runtime.update();expect(feedback.hidden).toBe(false);
        f.document.elementsFromPoint=()=>[host];f.runtime.update();expect(feedback.hidden).toBe(true);
        f.document.elementsFromPoint=undefined as unknown as typeof document.elementsFromPoint;f.runtime.update();expect(feedback.hidden).toBe(true);
        const dialog=f.document.createElement('div');f.hit.mockReturnValue(dialog);f.runtime.update();expect(feedback.hidden).toBe(true);
        f.hit.mockReturnValue(f.canvas);Object.defineProperty(f.document,'hidden',{configurable:true,value:true});f.runtime.update();expect(feedback.hidden).toBe(true);
        Object.defineProperty(f.document,'hidden',{configurable:true,value:false});Object.assign(f.bounds,{left:1500,right:1900});f.runtime.update();expect(feedback.hidden).toBe(true);
        Object.assign(f.bounds,{left:100,right:500});f.runtime.update();expect(feedback.hidden).toBe(false);f.runtime.dispose();
    });
    it.each(['pause','invalidate','redraw','reset','remove','dispose'])('错误提示在 %s 清理，旧错误与迟到设置失败不会重新出现', async change => {
        const pending=deferred<void>(),settings=vi.fn(()=>pending.promise),retry=vi.fn(()=>false),f=fixture({retry,openSettings:settings});
        f.ports.translate.mockRejectedValueOnce(new Error('offline'));await expect(f.runtime.translate(f.canvas)).rejects.toThrow('offline');
        const root=f.roots[0],feedback=root.querySelector<HTMLElement>('.fr-image-feedback')!;
        const click=(target:Element)=>{const event=new f.window.Event('click',{bubbles:true});Object.defineProperty(event,'isTrusted',{value:true});target.dispatchEvent(event);};
        click(feedback.querySelector('.fr-image-service-settings')!);await flush();
        if(change==='pause')f.runtime.restore(f.canvas);
        if(change==='invalidate')f.runtime.invalidate(f.canvas);
        if(change==='redraw'){f.canvas.dataset.pixel='2';f.runtime.update();}
        if(change==='reset')f.runtime.resetCache();
        if(change==='remove'){f.canvas.remove();f.runtime.update();}
        if(change==='dispose')f.runtime.dispose();
        pending.reject(new Error('late settings failure'));await flush();
        expect(feedback.isConnected).toBe(false);expect(root.querySelector('.fr-image-feedback')).toBeNull();
        click(feedback.querySelector('.fluent-read-image-translation-button')!);expect(retry).not.toHaveBeenCalled();
        expect(f.ports.translate).toHaveBeenCalledOnce();f.runtime.dispose();
    });
    it.each(['pause','redraw','configuration','reset','remove','dispose','disable'])('在途识别于 %s 失效后拒绝，不创建迟到错误恢复提示', async change => {
        const pending=deferred<typeof result>(),f=fixture({retry:vi.fn(()=>false),openSettings:async()=>{}});
        f.ports.translate.mockReturnValueOnce(pending.promise);const task=f.runtime.translate(f.canvas);await flush();
        if(change==='pause')f.runtime.restore(f.canvas);
        if(change==='redraw')f.canvas.dataset.pixel='2';
        if(change==='configuration')f.ports.configurationIdentity.mockReturnValue('new settings');
        if(change==='reset')f.runtime.resetCache();
        if(change==='remove')f.canvas.remove();
        if(change==='dispose')f.runtime.dispose();
        if(change==='disable')f.ports.enabled.mockReturnValue(false);
        pending.reject(new Error('late OCR failure'));await task;
        expect(f.runtime.failed(f.canvas)).toBe(false);expect(f.roots).toHaveLength(0);expect(f.canvas.style.opacity).not.toBe('0');f.runtime.dispose();
    });
    it.each([new Error('settings offline'),'settings offline'])('打开设置失败保留真实错误详情，状态失效的恢复动作不能绕过会话 %s', async cause => {
        const openSettings=vi.fn().mockRejectedValueOnce(cause).mockRejectedValueOnce(new Error('later settings failure'));
        const retry=vi.fn(()=>false),f=fixture({retry,openSettings});f.ports.translate.mockRejectedValueOnce(new Error('provider failed'));
        await expect(f.runtime.translate(f.canvas)).rejects.toThrow('provider failed');
        const feedback=f.roots[0].querySelector<HTMLElement>('.fr-image-feedback')!;
        const click=(target:Element)=>{const event=new f.window.Event('click',{bubbles:true});Object.defineProperty(event,'isTrusted',{value:true});target.dispatchEvent(event);};
        f.ports.enabled.mockReturnValue(false);click(feedback.querySelector('.fluent-read-image-translation-button')!);click(feedback.querySelector('.fr-image-service-settings')!);await flush();
        expect(retry).not.toHaveBeenCalled();expect(openSettings).not.toHaveBeenCalled();
        f.ports.enabled.mockReturnValue(true);click(feedback.querySelector('.fr-image-service-settings')!);await flush();
        expect(feedback.textContent).toContain('无法打开设置');expect(feedback.querySelector('details')!.textContent).toContain('settings offline');
        // 关闭后已经在途的设置异常也不能重新挂载提示。
        await f.runtime.translate(f.canvas);f.ports.translate.mockRejectedValueOnce(new Error('new failure'));f.ports.cacheEnabled.mockReturnValue(false);
        f.runtime.release(f.canvas);await expect(f.runtime.translate(f.canvas)).rejects.toThrow('new failure');
        const next=f.roots[0].querySelector<HTMLElement>('.fr-image-feedback')!;
        click(next.querySelector('.fr-image-service-settings')!);click(next.querySelector('.fr-image-dismiss')!);await flush();
        expect(f.roots[0].querySelector('.fr-image-feedback')).toBeNull();expect(f.runtime.failed(f.canvas)).toBe(true);f.runtime.dispose();
    });
    it('错误详情的设置请求排队后改变来源配置，微任务不能打开旧页面的设置', async () => {
        const openSettings=vi.fn(async()=>{}),f=fixture({retry:vi.fn(()=>false),openSettings});
        f.ports.translate.mockRejectedValueOnce(new Error('provider failed'));await expect(f.runtime.translate(f.canvas)).rejects.toThrow();
        const button=f.roots[0].querySelector('.fr-image-service-settings')!,event=new f.window.Event('click',{bubbles:true});
        Object.defineProperty(event,'isTrusted',{value:true});button.dispatchEvent(event);
        f.ports.configurationIdentity.mockReturnValue('new model');await flush();expect(openSettings).not.toHaveBeenCalled();
        f.runtime.update();expect(button.isConnected).toBe(false);f.runtime.dispose();
    });
    it.each(['toggle', 'retry'])('显式%s在旧采样点未变时隐藏旧译层并翻译新原图', async action => {
        const f = fixture(), reader = readerFor(f);
        f.canvas.dataset.content = 'A';reader.toggle();await flush();
        expect(f.ports.translate).toHaveBeenCalledOnce();
        const output = f.outputs[0], identity = f.runtime.identity(f.canvas);
        if (action === 'toggle') reader.toggle();
        f.canvas.dataset.content = 'B';expect(f.runtime.identity(f.canvas)).toBe(identity);
        if (action === 'toggle') reader.toggle();
        else expect(reader.retry(f.canvas)).toBe(true);
        expect(output.isConnected).toBe(false);
        await flush();
        expect(f.ports.translate).toHaveBeenCalledTimes(2);
        expect(f.ports.translate.mock.calls[1][0]).toBe(`data:image/png;base64,${btoa('B')}`);
        expect(f.outputs[1].isConnected).toBe(true);
        reader.dispose();f.runtime.dispose();
    });

    it.each([true, false])('同源显式操作只验证一次并复用已完成译层，不重复模型与合成，缓存开关%s', async cache => {
        const f = fixture();f.ports.cacheEnabled.mockReturnValue(cache);
        const reader = readerFor(f);reader.toggle();await flush();
        const output = f.outputs[0];expect(output.isConnected).toBe(true);expect(encode).toHaveBeenCalledTimes(2);
        for (const action of ['toggle', 'retry']) {
            const before = encode.mock.calls.length;
            if (action === 'toggle') {reader.toggle();reader.toggle();}
            else expect(reader.retry(f.canvas)).toBe(true);
            expect(output.isConnected).toBe(false);expect(f.runtime.reuse(f.canvas)).toBe(false);
            await flush();expect(output.isConnected).toBe(true);expect(encode).toHaveBeenCalledTimes(before + 1);
            expect(f.ports.translate).toHaveBeenCalledOnce();expect(compose).toHaveBeenCalledOnce();
        }
        const count = encode.mock.calls.length;
        for (let i = 0; i < 20; i++) {f.runtime.identity(f.canvas);f.runtime.update();}
        expect(encode).toHaveBeenCalledTimes(count);
        reader.dispose();f.runtime.dispose();
    });

    it('开启只标记当前及附近画布，远页不保留且无预译时不额外编码', async () => {
        const f = fixture(), reader = readerFor(f), invalidate = vi.spyOn(f.runtime, 'invalidate');
        for (let index = 1; index <= 3; index++) {
            const canvas = f.document.createElement('canvas') as HTMLCanvasElement;canvas.width = 400;canvas.height = 300;
            canvas.getBoundingClientRect = () => ({left: 0, top: index * 1000, right: 400, bottom: index * 1000 + 300, width: 400, height: 300}) as DOMRect;
            f.canvas.parentElement!.append(canvas);
        }
        reader.toggle();await flush();
        expect(invalidate).toHaveBeenCalledTimes(3);expect(invalidate).toHaveBeenNthCalledWith(1, f.canvas);
        expect(f.ports.translate).toHaveBeenCalledOnce();expect(encode).toHaveBeenCalledTimes(2);
        expect(reader.status()).toMatchObject({pageCount: 4, completed: 1});reader.dispose();f.runtime.dispose();
    });

    it('初始编码与合成复用同一不可变快照，发布前发现未采样重绘则丢弃译层且不写缓存', async () => {
        const f = fixture({retry: vi.fn(() => false), openSettings: async () => {}});
        encode.mockImplementation(async canvas => `data:image/png;base64,${btoa(canvas.dataset.content || 'A')}`);
        const captured: string[] = [], originalCompose = compose.getMockImplementation()!;
        compose.mockImplementation(async (...args) => {captured.push((args[0] as HTMLCanvasElement).dataset.content!);return originalCompose(...args);});
        f.canvas.dataset.content = 'A';
        f.ports.translate.mockImplementationOnce(async () => {f.canvas.dataset.content = 'B';return result;});
        await expect(f.runtime.translate(f.canvas)).rejects.toThrow('画布内容已变化');
        expect(f.ports.translate.mock.calls[0][0]).toBe(`data:image/png;base64,${btoa('A')}`);
        expect(captured).toEqual(['A']);expect(encode.mock.calls[0][0]).toBe(compose.mock.calls[0][0]);
        expect(encode.mock.calls[1][0]).toBe(encode.mock.calls[0][0]);
        expect(f.outputs[0].width).toBe(0);expect(f.outputs[0].isConnected).toBe(false);expect(f.runtime.failed(f.canvas)).toBe(true);
        const feedback = f.roots[0].querySelector<HTMLElement>('.fr-image-feedback')!;
        expect(feedback.hidden).toBe(false);expect(feedback.textContent).toContain('画布内容已变化');
        expect(f.runtime.reuse(f.canvas)).toBe(false);
        f.canvas.dataset.content = 'A';await f.runtime.translate(f.canvas);
        expect(f.ports.translate).toHaveBeenCalledTimes(2);expect(f.outputs[1].isConnected).toBe(true);
        expect(feedback.isConnected).toBe(false);expect(f.roots[0].querySelector('.fr-image-feedback')).toBeNull();f.runtime.dispose();
    });

    it('A→B→C显式代次丢弃忽略取消的B编码，迟到完成不能覆盖C或恢复旧译层', async () => {
        const f = fixture();encode.mockImplementation(async canvas => `data:image/png;base64,${btoa(canvas.dataset.content || 'A')}`);
        await f.runtime.translate(f.canvas);const old = f.outputs[0], pending = deferred<string>();
        f.canvas.dataset.content = 'B';f.runtime.invalidate(f.canvas);encode.mockReturnValueOnce(pending.promise);
        const b = f.runtime.translate(f.canvas);await flush();expect(old.isConnected).toBe(false);
        f.canvas.dataset.content = 'C';f.runtime.invalidate(f.canvas);await f.runtime.translate(f.canvas);
        const current = f.outputs[1];expect(current.isConnected).toBe(true);
        pending.resolve(`data:image/png;base64,${btoa('B')}`);await b;
        expect(current.isConnected).toBe(true);expect(f.ports.translate.mock.calls.map(call => call[0])).toEqual([
            `data:image/png;base64,${btoa('A')}`, `data:image/png;base64,${btoa('C')}`,
        ]);expect(old.width).toBe(0);f.runtime.dispose();
    });

    it('关闭后再次开启取消在途识别但保留串行槽，迟到旧结果不合成且随后只翻译新来源', async () => {
        const f = fixture(), reader = readerFor(f), pending = deferred<typeof result>();
        f.canvas.dataset.content = 'A';f.ports.translate.mockReturnValueOnce(pending.promise);
        reader.toggle();await flush();expect(f.ports.translate).toHaveBeenCalledOnce();
        f.canvas.dataset.content = 'B';reader.toggle();reader.toggle();await flush();
        expect(f.ports.translate.mock.calls[0][1].aborted).toBe(true);
        expect(f.ports.translate).toHaveBeenCalledOnce();expect(compose).not.toHaveBeenCalled();
        pending.resolve(result);await flush();
        expect(f.ports.translate.mock.calls.map(call => call[0])).toEqual([
            `data:image/png;base64,${btoa('A')}`, `data:image/png;base64,${btoa('B')}`,
        ]);
        expect(compose).toHaveBeenCalledOnce();expect(f.outputs[0].isConnected).toBe(true);
        expect(reader.status()).toMatchObject({completed: 1, errors: 0, pending: false});
        reader.dispose();f.runtime.dispose();
    });

    it.each(['initial', 'publication'])('异步原生摘要%s阶段取消后不识别、不发布或缓存迟到结果', async phase => {
        const f = fixture(), pending = deferred<ArrayBuffer>(), digest = vi.fn();
        if (phase === 'publication') digest.mockResolvedValueOnce(new Uint8Array(32).buffer);
        digest.mockReturnValueOnce(pending.promise).mockResolvedValue(new Uint8Array(32).buffer);
        vi.stubGlobal('crypto', {subtle: {digest}});
        const task = f.runtime.translate(f.canvas);await flush();
        expect(digest).toHaveBeenCalledTimes(phase === 'initial' ? 1 : 2);
        f.runtime.invalidate(f.canvas);pending.resolve(new Uint8Array(32).buffer);await task;
        expect(f.runtime.failed(f.canvas)).toBe(false);
        if (phase === 'initial') expect(f.ports.translate).not.toHaveBeenCalled();
        else {expect(f.outputs[0].width).toBe(0);expect(f.outputs[0].isConnected).toBe(false);}
        await f.runtime.translate(f.canvas);
        expect(f.ports.translate).toHaveBeenCalledTimes(phase === 'initial' ? 1 : 2);f.runtime.dispose();
    });

    it('WebCrypto不可用仍以完整来源区分缓存，源注入适配器不进入原生验证合同', async () => {
        const f = fixture();vi.stubGlobal('crypto', undefined);await f.runtime.translate(f.canvas);
        f.runtime.invalidate(f.canvas);await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledOnce();
        const source = createMangaCanvas({...f.ports, source: {identity: () => 'url-load-revision', bounds: () => f.bounds as DOMRect,
            capture: async (_element, target) => {target.width = 400;target.height = 300;}}});
        await source.translate(f.canvas);source.invalidate(f.canvas);expect(source.reuse(f.canvas)).toBe(true);
        source.dispose();source.invalidate(f.canvas);f.runtime.dispose();f.runtime.invalidate(f.canvas);
    });

    it('注入来源校验锚点与身份，成功裁切后复用压缩缓存，空身份不抓取', async () => {
        const f = fixture(), identity = vi.fn<() => string | null>(() => 'segment-1'), anchor = vi.fn(() => f.canvas);
        const source = createMangaCanvas({...f.ports, source: {identity, anchor, bounds: () => f.bounds as DOMRect,
            capture: async (_element, target) => {target.width = 400;target.height = 300;},
            viewport: () => ({x: 0, y: 50, width: 400, height: 200})}});
        await source.translate(f.canvas);
        expect(anchor).toHaveBeenCalledWith(f.canvas);expect(f.outputs[0].width).toBe(0);
        source.release(f.canvas);await source.translate(f.canvas);
        expect(f.ports.translate).toHaveBeenCalledOnce();expect(compose).toHaveBeenCalledTimes(2);
        expect(source.reuse(f.canvas)).toBe(true);source.release(f.canvas);identity.mockReturnValue(null);
        await source.translate(f.canvas);expect(source.identity(f.canvas)).toBeNull();
        expect(f.ports.translate).toHaveBeenCalledOnce();source.dispose();f.runtime.dispose();
    });

    it.each(['source', 'publication'])('异步编码%s阶段取消后不启动识别或发布译层', async phase => {
        const f = fixture(), pending = deferred<string>();
        const runtime = phase === 'source' ? createMangaCanvas({...f.ports, source: {
            identity: () => 'background-1', bounds: () => f.bounds as DOMRect,
            capture: async (_element, target) => {target.width = 400;target.height = 300;},
        }}) : f.runtime;
        if (phase === 'publication') encode.mockResolvedValueOnce('data:image/png;base64,AQ==');
        encode.mockReturnValueOnce(pending.promise);
        const task = runtime.translate(f.canvas);await flush();runtime.restore(f.canvas);
        pending.resolve('data:image/png;base64,AQ==');await task;
        expect(runtime.failed(f.canvas)).toBe(false);
        if (phase === 'source') expect(f.ports.translate).not.toHaveBeenCalled();
        else expect(f.outputs[0].width).toBe(0);
        expect(f.outputs.every(output => !output.isConnected)).toBe(true);runtime.dispose();f.runtime.dispose();
    });

    it('无文字完成页在显式验证期间也不复用且不合成空译层', async () => {
        const f = fixture();f.ports.translate.mockResolvedValue({lines: []});
        await f.runtime.translate(f.canvas);f.runtime.invalidate(f.canvas);await f.runtime.translate(f.canvas);
        expect(f.ports.translate).toHaveBeenCalledOnce();expect(compose).not.toHaveBeenCalled();
        expect(f.runtime.reuse(f.canvas)).toBe(true);f.runtime.dispose();
    });


    it.each(['context','draw'])('分段输出裁切失败释放上下文和合成画布，并保留原文 %s',async mode=>{
        const f=fixture();
        const runtime=createMangaCanvas({...f.ports,source:{identity:()=> 'crop',bounds:()=>f.bounds as DOMRect,capture:async(_element,target)=>{target.width=400;target.height=300;},viewport:()=>({x:0,y:50,width:400,height:200})}});
        compose.mockImplementation(async()=>{
            const output=f.document.createElement('canvas') as HTMLCanvasElement;output.width=400;output.height=300;f.outputs.push(output);
            if(mode==='context')f.missingContext();
            else {
                const create=f.document.createElement.bind(f.document);
                vi.spyOn(f.document,'createElement').mockImplementation(((tag:string)=>{const value=create(tag);if(tag==='canvas')(value as HTMLCanvasElement).getContext=(()=>({drawImage:()=>{throw new Error('crop failed');}})) as unknown as typeof output.getContext;return value;}) as typeof f.document.createElement);
            }
            return output;
        });
        await expect(runtime.translate(f.canvas)).rejects.toThrow();expect(runtime.failed(f.canvas)).toBe(true);expect(f.outputs[0].width).toBe(0);
        runtime.dispose();f.runtime.dispose();
    });
    it('异步快照即使忽略取消，完成后也不能发送已暂停任务的 OCR',async()=>{
        const f=fixture(),capture=deferred<void>();
        const runtime=createMangaCanvas({...f.ports,source:{identity:()=> 'public-source',bounds:()=>f.bounds as DOMRect,capture:()=>capture.promise}});
        const task=runtime.translate(f.canvas);runtime.restore(f.canvas);capture.resolve();await task;
        expect(f.ports.translate).not.toHaveBeenCalled();runtime.dispose();f.runtime.dispose();
    });
    it.each(['redraw','configuration','remove','pause','reset','dispose','disable'])('异步编码迟到后复核所有权，不识别已失效快照 %s',async mode=>{
        const f=fixture(),pending=deferred<string>();encode.mockReturnValue(pending.promise);
        const task=f.runtime.translate(f.canvas);await flush();
        const [snapshot,signal]=encode.mock.calls[0];
        expect(snapshot).not.toBe(f.canvas);expect(snapshot.width).toBe(400);expect(snapshot.height).toBe(300);
        expect(snapshot.toDataURL).not.toHaveBeenCalled();expect(f.ports.translate).not.toHaveBeenCalled();
        if(mode==='redraw'){f.canvas.dataset.pixel='2';f.runtime.update();}
        if(mode==='configuration'){f.ports.configurationIdentity.mockReturnValue('config-2');f.runtime.update();}
        if(mode==='remove'){f.canvas.remove();f.runtime.update();}
        if(mode==='pause')f.runtime.restore(f.canvas);
        if(mode==='reset')f.runtime.resetCache();
        if(mode==='dispose')f.runtime.dispose();
        if(mode==='disable')f.ports.enabled.mockReturnValue(false);
        pending.resolve('data:image/png;base64,late');await task;
        expect(f.ports.translate).not.toHaveBeenCalled();expect(compose).not.toHaveBeenCalled();
        expect(snapshot.width).toBe(0);expect(snapshot.height).toBe(0);expect(f.runtime.failed(f.canvas)).toBe(false);
        if(mode!=='disable')expect(signal?.aborted).toBe(true);f.runtime.dispose();
    });
    it('编码中取消的拒绝不记录旧失败，完整快照及时释放',async()=>{
        const f=fixture(),pending=deferred<string>();encode.mockReturnValue(pending.promise);
        const task=f.runtime.translate(f.canvas);await flush();const [snapshot,signal]=encode.mock.calls[0];
        f.runtime.restore(f.canvas);expect(signal?.aborted).toBe(true);
        pending.reject(new DOMException('已取消','AbortError'));await task;
        expect(f.ports.translate).not.toHaveBeenCalled();expect(f.runtime.failed(f.canvas)).toBe(false);
        expect(snapshot.width).toBe(0);f.runtime.dispose();
    });
    it('当前编码失败保留原文并允许下一次重试',async()=>{
        const f=fixture();encode.mockRejectedValueOnce(new Error('图片数据读取失败'));
        await expect(f.runtime.translate(f.canvas)).rejects.toThrow('图片数据读取失败');
        expect(f.runtime.failed(f.canvas)).toBe(true);expect(f.ports.translate).not.toHaveBeenCalled();
        await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledOnce();
        expect(f.ports.translate.mock.calls[0][0]).toBe('data:image/png;base64,AQ==');f.runtime.dispose();
    });
    it('识别重绘和配置变化，受污染或空画布不阻止后一张正常正文', () => {
        const f = fixture(), first = f.runtime.identity(f.canvas);
        expect(first).not.toBeNull();expect(f.runtime.identity(f.canvas)).toBe(first);
        f.canvas.dataset.pixel = '2';expect(f.runtime.identity(f.canvas)).not.toBe(first);
        const second = f.runtime.identity(f.canvas);f.ports.configurationIdentity.mockReturnValue('config-2');expect(f.runtime.identity(f.canvas)).not.toBe(second);
        f.canvas.dataset.tainted = 'true';expect(f.runtime.identity(f.canvas)).toBeNull();
        delete f.canvas.dataset.tainted;expect(f.runtime.identity(f.canvas)).not.toBeNull();
        f.canvas.dataset.pixel = '0';expect(f.runtime.identity(f.canvas)).toBeNull();f.runtime.dispose();
    });
    it.each([[79,300],[400,39],[8193,100],[100,8193],[5000,5000]])('像素尺寸边界拒绝不可处理画布 %sx%s', (width,height) => {
        const f = fixture();f.canvas.width = width;f.canvas.height = height;expect(f.runtime.identity(f.canvas)).toBeNull();f.runtime.dispose();
    });
    it('独立快照经现有端口翻译，译图只覆盖正文，暂停和重复开启不改宿主且不重跑模型', async () => {
        const f = fixture(), original = f.canvas.outerHTML;
        await f.runtime.translate(f.canvas);
        expect(f.ports.translate).toHaveBeenCalledOnce();expect(compose.mock.calls[0][0]).not.toBe(f.canvas);
        expect((compose.mock.calls[0][0] as HTMLCanvasElement).width).toBe(0);
        const output = f.outputs[0];expect(output.style.display).toBe('block');expect(output.style.pointerEvents).toBe('none');expect(output.style.left).toBe('100px');
        const host = f.document.getElementById('fluent-read-manga-canvas-container')!;
        expect(host.shadowRoot).toBeNull();
        // 外层也是插件所有的 UI，必须抵抗宿主全局强制隐藏和点击规则；真实计算样式由浏览器夹具验证。
        expect(host.style.cssText).toMatch(/all:\s*initial\s*!important/);
        expect(host.style.cssText).toMatch(/display:\s*block\s*!important/);
        expect(host.style.cssText).toMatch(/pointer-events:\s*none\s*!important/);
        expect(f.canvas.outerHTML).toBe(original);expect(f.runtime.failed(f.canvas)).toBe(false);
        f.runtime.restore(f.canvas);expect(output.isConnected).toBe(false);
        expect(f.runtime.reuse(f.canvas)).toBe(true);expect(output.isConnected).toBe(true);
        await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledOnce();
        f.runtime.dispose();expect(output.width).toBe(0);expect(f.document.getElementById('fluent-read-manga-canvas-container')).toBeNull();
        expect(f.canvas.outerHTML).toBe(original);expect(f.runtime.identity(f.canvas)).toBeNull();
    });
    it('离屏释放位图后，有界压缩结果可重建而不重新 OCR；关闭缓存后重跑', async () => {
        const f = fixture();await f.runtime.translate(f.canvas);f.runtime.release(f.canvas);expect(f.outputs[0].width).toBe(0);
        await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledOnce();expect(compose).toHaveBeenCalledTimes(2);
        f.runtime.release(f.canvas);f.ports.cacheEnabled.mockReturnValue(false);await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledTimes(2);
        f.runtime.resetCache();await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledTimes(3);f.runtime.dispose();
    });
    it('无文字页保留完成标记，恢复和压缩缓存复用不创建空译图', async () => {
        const f = fixture();f.ports.translate.mockResolvedValue({lines: []});
        await f.runtime.translate(f.canvas);expect(f.runtime.reuse(f.canvas)).toBe(true);expect(compose).not.toHaveBeenCalled();
        f.runtime.release(f.canvas);await f.runtime.translate(f.canvas);expect(f.ports.translate).toHaveBeenCalledOnce();f.runtime.dispose();
    });
    it.each(['redraw','configuration','remove','pause','reset','dispose','disable'])('在途请求失去所有权后取消或丢弃迟到结果 %s', async mode => {
        const f = fixture(), pending = deferred<typeof result>();f.ports.translate.mockReturnValue(pending.promise);
        const task = f.runtime.translate(f.canvas);await flush();const signal = f.ports.translate.mock.calls[0][1] as AbortSignal;
        if (mode === 'redraw') {f.canvas.dataset.pixel = '2';f.runtime.update();}
        if (mode === 'configuration') {f.ports.configurationIdentity.mockReturnValue('config-2');f.runtime.update();}
        if (mode === 'remove') {f.canvas.remove();f.runtime.update();}
        if (mode === 'pause') f.runtime.restore(f.canvas);
        if (mode === 'reset') f.runtime.resetCache();
        if (mode === 'dispose') f.runtime.dispose();
        if (mode === 'disable') f.ports.enabled.mockReturnValue(false);
        pending.resolve(result);await task;expect(compose).not.toHaveBeenCalled();expect(f.outputs).toHaveLength(0);
        if (mode !== 'disable') expect(signal.aborted).toBe(true);f.runtime.dispose();
    });
    it('合成期间取消仍释放迟到画布，失败只记录当前任务，原画布保持可读', async () => {
        const f = fixture(), pending = deferred<HTMLCanvasElement>();compose.mockReturnValue(pending.promise);
        const task = f.runtime.translate(f.canvas);await flush();f.runtime.restore(f.canvas);
        const output = f.document.createElement('canvas') as HTMLCanvasElement;output.width = 400;output.height = 300;
        pending.resolve(output);await task;expect(output.width).toBe(0);expect(output.isConnected).toBe(false);
        f.runtime.resetCache();f.ports.translate.mockRejectedValue(new Error('OCR unavailable'));await expect(f.runtime.translate(f.canvas)).rejects.toThrow('OCR unavailable');
        expect(f.runtime.failed(f.canvas)).toBe(true);expect(f.runtime.reuse(f.canvas)).toBe(false);f.runtime.dispose();
    });
    it('取消后客户端拒绝不发布旧失败', async () => {
        const f = fixture(), pending = deferred<typeof result>();f.ports.translate.mockReturnValue(pending.promise);
        const task = f.runtime.translate(f.canvas);await flush();f.runtime.release(f.canvas);pending.reject(new Error('cancelled'));await task;
        expect(f.runtime.failed(f.canvas)).toBe(false);f.runtime.release(f.canvas);f.runtime.restore(f.canvas);f.runtime.dispose();
    });
    it('缺少浏览器处理能力或有效结果时保留原文并允许显式重试', async () => {
        const f = fixture();f.missingContext();await expect(f.runtime.translate(f.canvas)).rejects.toThrow('不支持');expect(f.runtime.failed(f.canvas)).toBe(true);f.runtime.dispose();
        const second = fixture();second.ports.translate.mockResolvedValue({lines: result.lines});await expect(second.runtime.translate(second.canvas)).rejects.toThrow('数据无效');second.runtime.dispose();
    });
    it('缺少采样上下文时不宣布画布可读，也不启动翻译', async () => {
        const f = fixture();f.runtime.identity(f.canvas);vi.mocked(f.snapshots[1].getContext).mockReturnValue(null);
        expect(f.runtime.identity(f.canvas)).toBeNull();await f.runtime.translate(f.canvas);expect(f.ports.translate).not.toHaveBeenCalled();f.runtime.dispose();
    });
    it('禁用或离开 DOM 时不读取完整像素、不启动翻译', async () => {
        const f = fixture();f.ports.enabled.mockReturnValue(false);await f.runtime.translate(f.canvas);expect(f.ports.translate).not.toHaveBeenCalled();
        f.ports.enabled.mockReturnValue(true);f.canvas.remove();await f.runtime.translate(f.canvas);expect(f.ports.translate).not.toHaveBeenCalled();
        f.canvas.width = 1;await f.runtime.translate(f.canvas);expect(f.runtime.reuse(f.canvas)).toBe(false);f.runtime.dispose();
    });
    it('祖先裁切、滚动、隐藏与宿主弹窗控制显示范围，不穿透覆盖物', async () => {
        const f = fixture(), parent = f.canvas.parentElement!;
        Reflect.deleteProperty(f.ports,'acceptsInteractionLayer');
        parent.getBoundingClientRect = () => ({left:150,right:450,top:75,bottom:325}) as DOMRect;
        f.styles.set(parent,{overflowX:'hidden',overflowY:'auto'});await f.runtime.translate(f.canvas);
        const output = f.outputs[0];expect(output.style.clipPath).toBe('inset(25px 50px 25px 50px)');
        f.bounds.top = -400;f.bounds.bottom = -100;f.runtime.update();expect(output.style.display).toBe('none');
        f.bounds.top = 50;f.bounds.bottom = 350;f.hit.mockReturnValue(parent);f.runtime.update();expect(output.style.display).toBe('block');
        f.hit.mockReturnValue(f.document.body.appendChild(f.document.createElement('dialog')));f.runtime.update();expect(output.style.display).toBe('none');
        f.hit.mockReturnValue(null);f.runtime.update();expect(output.style.display).toBe('none');
        f.hit.mockReturnValue(f.canvas);f.styles.set(parent,{opacity:'0'});f.runtime.update();expect(output.style.display).toBe('none');
        f.styles.set(parent,{display:'none'});f.runtime.update();expect(output.style.display).toBe('none');
        f.styles.set(parent,{visibility:'hidden'});f.runtime.update();expect(output.style.display).toBe('none');
        f.styles.set(parent,{visibility:'collapse'});f.runtime.update();expect(output.style.display).toBe('none');
        f.styles.clear();Object.defineProperty(f.document,'hidden',{configurable:true,value:true});f.runtime.update();expect(output.style.display).toBe('none');
        Object.defineProperty(f.document,'hidden',{value:false});f.ports.enabled.mockReturnValue(false);f.runtime.update();expect(output.style.display).toBe('none');f.runtime.dispose();
    });
    it('仅已适配的透明翻页层允许正文译图，其他覆盖物仍隐藏译图且不接管点击', async () => {
        const f=fixture(),nav=f.document.createElement('div');nav.id='xCVLeftNav';f.document.body.append(nav);f.hit.mockReturnValue(nav);
        f.ports.acceptsInteractionLayer.mockImplementation((_canvas,hit)=>hit===nav);await f.runtime.translate(f.canvas);
        expect(f.outputs[0].style.display).toBe('block');expect(f.outputs[0].style.pointerEvents).toBe('none');
        f.hit.mockReturnValue(f.document.createElement('dialog'));f.runtime.update();expect(f.outputs[0].style.display).toBe('none');f.runtime.dispose();
    });
});
