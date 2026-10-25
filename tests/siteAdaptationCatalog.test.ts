import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';

import rawProfiles from '@/src/core/site-adaptation/catalog/profiles.json';
import rawRules from '@/src/core/site-adaptation/catalog/websites.json';
import coverage from '@/src/core/site-adaptation/catalog/coverage.json';
import fixtures from '@/scripts/site-translation/site-adaptation-fixtures.json';
import liveCases from '@/scripts/site-translation/site-adaptation-live-cases.json';
import blueskyMetadataFixture from './fixtures/translation-pages/bluesky-profile-metadata.json';
import blueskyQuoteFixture from './fixtures/translation-pages/bluesky-quote-metadata.json';
import steamReviewFixture from './fixtures/translation-pages/steam-review-content.json';
import {compileSiteRulePack, resolveSiteRule} from '@/src/core/site-adaptation/compiler';
import {parseSiteRulePack, validateSelectors} from '@/src/core/site-adaptation/schema';
import {TranslationCandidateCore} from '@/src/core/translation/engine';
import {extractTranslationText, extractTranslationTextFromNodes} from '@/src/core/translation/text';
import {applyTranslationsToSnapshot, buildWholeBlockTranslationSource, createTranslationSourceSnapshot} from '@/src/core/translation/serialization';

const result = parseSiteRulePack({version: 1, profiles: rawProfiles, rules: rawRules});
if (!result.ok) throw new Error(JSON.stringify(result.issues));
const pack = result.pack;
const adapters = compileSiteRulePack(pack);
const adapterById = new Map(adapters.map(adapter => [adapter.id, adapter]));
const rulesById = new Map(pack.rules.map(rule => [rule.id, rule]));

function documentFor(html: string): Document {
    return parseHTML(`<html><head></head><body>${html}</body></html>`).document as unknown as Document;
}

describe('网站正文规则目录', () => {
    it('LinkedIn 公开长文只保护身份、推荐元数据和动作链接，简介与近似类名正文继续可译', () => {
        const fixture = fixtures.find(item => item.id === 'linkedin-articles')!;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const adapter = adapterById.get(fixture.id)!;
        const baselinePack = structuredClone(pack);
        const baselineRule = baselinePack.rules.find(rule => rule.id === fixture.id)!;
        delete baselineRule.exclude;
        delete baselineRule.watchIgnore;
        const baselineCore = new TranslationCandidateCore({url, adapters: compileSiteRulePack(baselinePack)});
        const baselineCandidates = baselineCore.discover(document);
        // 旧 article 模板将作者标题当作正文，通用发现也会接受推荐元数据和动作链接的文字。
        for (const selector of ['#publisher-name', '#inline-metadata', '#aside-metadata', '#like-control', '#comment-control']) {
            const node = document.querySelector(selector)!;
            expect(baselineCandidates.some(candidate => candidate.element === node || node.contains(candidate.element)), selector).toBe(true);
        }
        expect(adapter.genericCandidatePolicy).toBe('allow');
        const original = document.body.innerHTML;
        const verify = () => {
            const candidates = core.discover(document);
            // 推荐标题和站外的近似组件仍走通用发现，不给它们虚构专站正文选择器。
            for (const selector of [...fixture.required, '#inline-title', '#aside-title', '#aside-fake-metadata',
                '#outside-publisher', '#outside-inline', '#outside-action']) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), selector).toBe(false);
                expect(candidates.some(candidate => candidate.element === node), selector).toBe(true);
                expect(core.resolve(node.firstChild)?.element, `hover ${selector}`).toBe(node);
                expect(adapter.shouldIgnoreMutation?.(node, {url}), `watch ${selector}`).toBe(false);
            }
            for (const selector of fixture.forbidden) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), selector).toBe(true);
                expect(candidates.some(candidate => candidate.element === node || node.contains(candidate.element)), selector).toBe(false);
            }
            for (const selector of ['#publisher-name', '#publisher-date', '#inline-metadata', '#aside-metadata', '#like-control', '#comment-control']) {
                const node = document.querySelector(selector)!;
                expect(core.resolve(node.firstChild), selector).toBeNull();
                expect(adapter.shouldIgnoreMutation?.(node, {url}), selector).toBe(true);
            }
            const source = candidates.map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
            const snapshot = createTranslationSourceSnapshot(document.body, core.shouldStayOriginal);
            const snapshotSource = snapshot.slots.map(slot => slot.source).join('\n');
            for (const text of fixture.sourceAssertions!.required) {
                expect(source).toContain(text);
                expect(snapshotSource).toContain(text);
            }
            for (const text of fixture.sourceAssertions!.forbidden) {
                expect(source).not.toContain(text);
                expect(snapshotSource).not.toContain(text);
            }
        };
        verify();
        expect(document.body.innerHTML).toBe(original);
        document.body.innerHTML = fixture.html;
        verify();
    });

    it('LinkedIn 元数据保护不扩展到其他主机、登录页或非长文路径', () => {
        const fixture = fixtures.find(item => item.id === 'linkedin-articles')!;
        const document = documentFor(fixture.html);
        const adapter = adapterById.get(fixture.id)!;
        const baselinePack = structuredClone(pack);
        const baselineRule = baselinePack.rules.find(rule => rule.id === fixture.id)!;
        delete baselineRule.exclude;
        delete baselineRule.watchIgnore;
        const baselineAdapters = compileSiteRulePack(baselinePack);
        for (const raw of ['https://example.test/pulse/authored-article', 'https://uk.linkedin.com/pulse/authored-article',
            'https://www.linkedin.com/in/authored-person', 'https://www.linkedin.com/feed/', 'https://www.linkedin.com/login',
            'https://www.linkedin.com/signup/cold-join']) {
            const url = new URL(raw);
            expect(adapter.matches(url), raw).toBe(false);
            const core = new TranslationCandidateCore({url, adapters});
            const baselineCore = new TranslationCandidateCore({url, adapters: baselineAdapters});
            for (const selector of ['#publisher-name', '#publisher-date', '#inline-metadata', '#aside-metadata', '#like-control', '#comment-control']) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), `${raw} ${selector}`).toBe(baselineCore.shouldStayOriginal(node));
            }
            const source = core.discover(document).map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal));
            const baselineSource = baselineCore.discover(document).map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], baselineCore.shouldStayOriginal));
            expect(source, raw).toEqual(baselineSource);
        }
    });

    it('LinkedIn 新增正文、作者简介和推荐标题仍可译，重挂组件后元数据边界保持一致', () => {
        const fixture = fixtures.find(item => item.id === 'linkedin-articles')!;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const adapter = adapterById.get(fixture.id)!;
        const paragraph = document.querySelector<HTMLElement>('#body-one')!;
        const snapshot = createTranslationSourceSnapshot(paragraph, core.shouldStayOriginal);
        const rendered = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(() => '独立正文译文'));
        expect(rendered).toContain('KEEP_ORIGINAL_TOKEN');
        expect(rendered).toContain('href="https://example.test/reading"');
        const lines = createTranslationSourceSnapshot(document.querySelector<HTMLElement>('#body-two')!, core.shouldStayOriginal);
        expect(lines.slots.map(slot => slot.source).join('\n')).toContain('all of its beginning, middle, and ending.');
        expect(lines.slots.map(slot => slot.source).join('\n')).toContain('Another original line remains');
        expect(applyTranslationsToSnapshot(lines, lines.slots.map(() => '独立换行译文'))).toContain('<br');

        document.querySelector('.article-main__content')!.insertAdjacentHTML('beforeend',
            '<p id="new-body">A newly loaded paragraph retains <a href="https://example.test/new-reference">a new reading reference</a><br>and a complete final line.</p>');
        const info = document.querySelector('article.article-main > header .publisher-author-card > .base-main-card__info')!;
        info.insertAdjacentHTML('beforeend', '<p id="new-bio" class="base-main-card__subtitle">A newly loaded biography explains the author’s work in full.</p>');
        document.querySelector('.inline-articles > div')!.insertAdjacentHTML('beforeend',
            '<div class="inline-article"><a href="/pulse/new-reading"><div id="new-inline-title" class="inline-article-title">A newly loaded recommendation stays readable</div><div id="new-inline-metadata" class="inline-article-meta"><span>New Recommendation Author</span><span>1 month ago</span></div></a></div>');
        document.querySelector('.right-rail')!.insertAdjacentHTML('beforeend',
            '<a class="aside-article-card" href="/pulse/new-aside"><div class="base-aside-card__info"><h3 id="new-aside-title" class="base-aside-card__title">Another newly loaded article remains readable</h3><div id="new-aside-metadata" class="base-aside-card__metadata">Another Recommendation Author</div></div></a>');
        document.querySelector('#publisher-name')!.textContent = 'Updated Publisher Name';
        const publisher = info.parentElement!;
        info.remove();
        publisher.appendChild(info);
        const candidates = core.discover(document);
        for (const selector of ['#new-body', '#new-bio', '#new-inline-title', '#new-aside-title']) {
            const node = document.querySelector(selector)!;
            expect(candidates.some(candidate => candidate.element === node), selector).toBe(true);
            expect(core.resolve(node.firstChild)?.element, selector).toBe(node);
            expect(core.shouldStayOriginal(node), selector).toBe(false);
            expect(adapter.shouldIgnoreMutation?.(node, {url}), selector).toBe(false);
        }
        for (const selector of ['#publisher-name', '#publisher-date', '#new-inline-metadata', '#new-aside-metadata']) {
            const node = document.querySelector(selector)!;
            expect(core.shouldStayOriginal(node), selector).toBe(true);
            expect(adapter.shouldIgnoreMutation?.(node, {url}), selector).toBe(true);
            expect(candidates.some(candidate => candidate.element === node || node.contains(candidate.element)), selector).toBe(false);
        }
        const source = candidates.map(candidate => extractTranslationTextFromNodes(
            candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
        for (const text of ['A newly loaded paragraph retains', 'a new reading reference', 'and a complete final line.',
            'A newly loaded biography explains', 'A newly loaded recommendation stays readable', 'Another newly loaded article remains readable']) expect(source).toContain(text);
        for (const text of ['Updated Publisher Name', 'New Recommendation Author', 'Another Recommendation Author']) expect(source).not.toContain(text);
    });

    it('Steam 按钮卡片中的长短评论在发现与悬浮时都由独立正文拥有，元数据和相似结构不获得正文权限', () => {
        const fixture = steamReviewFixture;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const reviewRule = rulesById.get('steam-store')!.content!.find(content =>
            content.css.some(selector => selector.includes('/recommended/')))!;
        expect(reviewRule).toMatchObject({resolve: 'self', atomic: true});
        const oldPack = structuredClone(pack);
        oldPack.rules.find(rule => rule.id === 'steam-store')!.content =
            oldPack.rules.find(rule => rule.id === 'steam-store')!.content!
                .filter(content => !content.css.some(selector => selector.includes('/recommended/')));
        const oldCore = new TranslationCandidateCore({url, adapters: compileSiteRulePack(oldPack)});
        const verify = () => {
            const candidates = core.discover(document);
            for (const selector of fixture.required) {
                const owner = document.querySelector(selector)!;
                expect(oldCore.discover(document).find(candidate => candidate.element === owner)?.kind, `baseline ${selector}`).toBe('control');
                expect(candidates.filter(candidate => candidate.element === owner), selector).toHaveLength(1);
                expect(candidates.find(candidate => candidate.element === owner)).toMatchObject({kind: 'content', adapterId: 'steam-store'});
                expect(candidates.some(candidate => candidate.element !== owner && owner.contains(candidate.element)), `atomic ${selector}`).toBe(false);
                expect(core.resolve(owner.firstChild)).toMatchObject({element: owner, kind: 'content', adapterId: 'steam-store'});
            }
            expect(core.resolve(document.querySelector('#dirty')!.firstChild)).toMatchObject({
                element: document.querySelector('#long-body'), kind: 'content', adapterId: 'steam-store',
            });
            expect(core.resolve(document.querySelector('#reading-link')!.firstChild)).toMatchObject({
                element: document.querySelector('#long-body'), kind: 'content', adapterId: 'steam-store',
            });
            for (const selector of fixture.controls) {
                const control = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(control), selector).toBe(true);
                expect(core.resolve(control.firstChild), selector).toBeNull();
                expect(candidates.some(candidate => candidate.element === control || control.contains(candidate.element)), selector).toBe(false);
            }
            for (const selector of fixture.negative) {
                const owner = document.querySelector(selector)!;
                const baseline = oldCore.resolve(owner.firstChild)!;
                expect(baseline, selector).not.toBeNull();
                expect(core.resolve(owner.firstChild), selector).toMatchObject({
                    element: baseline.element, kind: baseline.kind, reason: baseline.reason,
                });
                expect(core.resolve(owner.firstChild)?.adapterId, selector).toBeUndefined();
                expect(candidates.some(candidate => candidate.element === owner && candidate.adapterId === 'steam-store'), selector).toBe(false);
            }
            for (const selector of fixture.guarded) {
                const guarded = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(guarded), selector).toBe(true);
                expect(candidates.some(candidate => candidate.element === guarded || guarded.contains(candidate.element)), selector).toBe(false);
            }
        };
        verify();
        document.body.innerHTML = fixture.html;
        verify();
        for (const otherUrl of ['https://example.test/app/570/', 'https://steamcommunity.com/app/570/',
            'https://store.steampowered.com/account/settings']) {
            const otherCore = new TranslationCandidateCore({url: new URL(otherUrl), adapters});
            const owner = document.querySelector('#long-body')!;
            expect(otherCore.discover(document).find(candidate => candidate.element === owner)).toMatchObject({kind: 'control'});
            expect(otherCore.resolve(owner.firstChild)?.adapterId, otherUrl).toBeUndefined();
        }
    });

    it('Steam 评论正文快照保留完整换行与内联文本，动态重挂仍有同一正文边界且不修改源 DOM', () => {
        const fixture = steamReviewFixture;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const adapter = adapterById.get('steam-store')!;
        const original = document.body.innerHTML;
        const owner = document.querySelector<HTMLElement>('#long-body')!;
        const snapshot = createTranslationSourceSnapshot(owner, core.shouldStayOriginal);
        const source = snapshot.slots.map(slot => slot.source).join('\n');
        for (const text of ['This long review explains', 'how careful teamwork helps', 'Another line keeps',
            'an ordinary reading reference', 'The final line adds']) expect(source).toContain(text);
        expect(source).not.toContain('ORIGINAL_CODE_TOKEN');
        const translated = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(() => '测试评论译文'));
        expect(translated).toContain('测试评论译文');
        expect(translated).toContain('ORIGINAL_CODE_TOKEN');
        expect(translated.match(/<br\b/gu)).toHaveLength(3);
        expect(translated).toContain('href="https://example.test/guide"');
        const cardSnapshot = createTranslationSourceSnapshot(document.querySelector('#long-card')!, core.shouldStayOriginal);
        expect(cardSnapshot.slots.map(slot => slot.source).join('\n')).not.toContain('Example Player With A Long Display Name');
        expect(applyTranslationsToSnapshot(cardSnapshot, cardSnapshot.slots.map(() => '测试卡片译文')))
            .toContain('Example Player With A Long Display Name');
        expect(document.body.innerHTML).toBe(original);
        expect(adapter.shouldIgnoreMutation?.(owner, {url})).toBe(false);
        document.querySelector(fixture.dynamic.selector)!.textContent = fixture.dynamic.to;
        expect(core.resolve(document.querySelector(fixture.dynamic.selector)!.firstChild)).toMatchObject({element: owner, kind: 'content'});
        expect(extractTranslationText(owner, core.shouldStayOriginal)).toContain(fixture.dynamic.to);
        document.querySelector('#long-card')!.remove();
        document.querySelector('#app_reviews_hash')!.insertAdjacentHTML('beforeend', fixture.dynamic.appendHtml);
        const newOwner = document.querySelector('#new-body')!;
        expect(core.discover(document).filter(candidate => candidate.element === newOwner)).toHaveLength(1);
        expect(core.resolve(newOwner.firstChild)).toMatchObject({element: newOwner, kind: 'content', adapterId: 'steam-store'});
        expect(core.shouldStayOriginal(document.querySelector('#new-author')!)).toBe(true);
        expect(adapter.shouldIgnoreMutation?.(newOwner, {url})).toBe(false);
        // 原 DOM 的恢复/重新挂载不会借用上一次的节点身份或吞并整张按钮卡片。
        document.body.innerHTML = fixture.html;
        expect(document.body.innerHTML).toBe(original);
        expect(core.resolve(document.querySelector('#long-body')!.firstChild)).toMatchObject({
            element: document.querySelector('#long-body'), kind: 'content', adapterId: 'steam-store',
        });
    });

    it('Bluesky 资料页只排除作者、时间和计数，正文及其中的提及继续由通用引擎发现', () => {
        const fixture = blueskyMetadataFixture;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const verify = () => {
            const candidates = core.discover(document);
            for (const selector of fixture.required) {
                const element = document.querySelector(selector)!;
                expect(candidates.some(candidate => candidate.element === element), selector).toBe(true);
                expect(core.resolve(element.firstChild)?.element, `hover ${selector}`).toBe(element);
            }
            for (const selector of fixture.forbidden) {
                const element = document.querySelector(selector)!;
                expect(candidates.some(candidate => candidate.element === element || element.contains(candidate.element)), selector).toBe(false);
            }
            const source = candidates.map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
            for (const text of fixture.sourceAssertions.required) expect(source).toContain(text);
            for (const text of fixture.sourceAssertions.forbidden) expect(source).not.toContain(text);
            const snapshot = createTranslationSourceSnapshot(document.body, core.shouldStayOriginal);
            const snapshotSource = snapshot.slots.map(slot => slot.source).join('\n');
            for (const text of fixture.sourceAssertions.forbidden) expect(snapshotSource).not.toContain(text);
            expect(snapshotSource).toContain('@reader.example');
        };
        verify();
        document.body.innerHTML = fixture.html;
        verify();
        const adapter = adapterById.get(fixture.id)!;
        expect(adapter.genericCandidatePolicy).toBe('allow');
        // :has() 依赖反向结构，编译器按既有约定保守观察全部属性。
        expect(adapter.observedAttributes).toBeNull();
        for (const selector of ['#profile-name', '#author', '#handle', '#post-time', '#count-actions', '#reposts',
            '#profile-header-handle', '#profile-counts', '#profile-post-count']) {
            expect(core.shouldStayOriginal(document.querySelector(selector)!), selector).toBe(true);
            expect(adapter.shouldIgnoreMutation?.(document.querySelector(selector)!, {url}), selector).toBe(true);
        }
        for (const selector of ['#body1', '#body2', '#mention', '#profile-bio']) {
            expect(adapter.shouldIgnoreMutation?.(document.querySelector(selector)!, {url}), selector).toBe(false);
            expect(core.shouldStayOriginal(document.querySelector(selector)!), selector).toBe(false);
        }
        const change = fixture.dynamic.inlineText[0]!;
        document.querySelector(change.selector)!.textContent = change.to;
        expect(core.discover(document).some(candidate => candidate.element === document.querySelector(change.owner))).toBe(true);
        expect(extractTranslationText(document.querySelector(change.owner)!, core.shouldStayOriginal)).toContain(change.to);
        const appended = fixture.dynamic.appendHtml[0]!;
        document.querySelector(appended.selector)!.insertAdjacentHTML('beforeend', appended.html);
        const updatedCandidates = core.discover(document);
        for (const selector of appended.required) {
            expect(updatedCandidates.some(candidate => candidate.element === document.querySelector(selector)), selector).toBe(true);
        }
        for (const selector of appended.forbidden) {
            const element = document.querySelector(selector)!;
            expect(core.shouldStayOriginal(element), selector).toBe(true);
            expect(updatedCandidates.some(candidate => candidate.element === element || element.contains(candidate.element)), selector).toBe(false);
        }
        document.querySelector('#profile-bio')!.remove();
        for (const selector of ['#profile-header-handle', '#profile-counts']) {
            expect(core.shouldStayOriginal(document.querySelector(selector)!), `no bio ${selector}`).toBe(true);
        }
        const headerHandle = document.querySelector('#profile-header-handle')!;
        headerHandle.setAttribute('data-testid', 'profileHeaderDescription');
        expect(core.shouldStayOriginal(headerHandle), 'description must not become an account handle').toBe(false);
        expect(adapter.matches(new URL('https://bsky.app/'))).toBe(false);
        expect(adapter.matches(new URL('https://other.bsky.app/profile/example.test'))).toBe(false);
    });

    it('Bluesky 引用卡片只保护直接身份栏，引用正文、嵌套引用及提及链接仍由通用引擎翻译', () => {
        const fixture = blueskyQuoteFixture;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const adapter = adapterById.get('bluesky-profile-metadata')!;
        const verify = () => {
            const candidates = core.discover(document);
            for (const selector of fixture.required) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), selector).toBe(false);
                expect(candidates.some(candidate => candidate.element === node || node.contains(candidate.element)), selector).toBe(true);
            }
            for (const selector of fixture.forbidden) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), selector).toBe(true);
                expect(adapter.shouldIgnoreMutation?.(node, {url}), selector).toBe(true);
                expect(candidates.some(candidate => candidate.element === node || node.contains(candidate.element)), selector).toBe(false);
            }
            for (const selector of fixture.mentions) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), selector).toBe(false);
                expect(adapter.shouldIgnoreMutation?.(node, {url}), selector).toBe(false);
            }
            const source = candidates.map(candidate => extractTranslationTextFromNodes(candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
            for (const text of fixture.sourceAssertions.required) expect(source).toContain(text);
            for (const text of fixture.sourceAssertions.forbidden) expect(source).not.toContain(text);
            for (const selector of ['#quote-body', '#nested-body']) {
                const node = document.querySelector<HTMLElement>(selector)!;
                const html = node.innerHTML;
                const snapshot = createTranslationSourceSnapshot(node, core.shouldStayOriginal);
                expect(snapshot.slots.map(slot => slot.source).join(' ')).toContain(node.querySelector('a')!.textContent);
                const rendered = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(() => '引用正文译文'));
                expect(rendered).toContain('引用正文译文');
                for (const link of node.querySelectorAll('a')) expect(rendered).toContain(link.getAttribute('href'));
                expect(node.innerHTML).toBe(html);
            }
            const snapshotSource = createTranslationSourceSnapshot(document.body, core.shouldStayOriginal).slots.map(slot => slot.source).join('\n');
            for (const text of fixture.sourceAssertions.forbidden) expect(snapshotSource).not.toContain(text);
            expect(snapshotSource).toContain('@quoted-reader.example');
            expect(snapshotSource).toContain('@nested-reader.example');
        };
        verify();
        document.querySelector('#quote-author')!.textContent = 'Another Quoted Identity';
        document.querySelector('#quote-dirty')!.textContent = 'an updated independently authored explanation';
        expect(extractTranslationText(document.querySelector('#quote-body')!, core.shouldStayOriginal)).toContain('an updated independently authored explanation');
        const card = document.querySelector('#quote-card')!;
        const parent = card.parentElement!;
        card.remove(); parent.append(card);
        expect(core.shouldStayOriginal(document.querySelector('#quote-header')!)).toBe(true);
        expect(core.resolve(document.querySelector('#quote-body')!.firstChild)?.element).toBe(document.querySelector('#quote-body'));
        document.body.innerHTML = fixture.html;
        verify();
        for (const url of [new URL('https://bsky.app/'), new URL('https://elsewhere.example/profile/example.test')]) {
            const otherCore = new TranslationCandidateCore({url, adapters});
            expect(otherCore.shouldStayOriginal(document.querySelector('#quote-header')!)).toBe(false);
        }
    });

    it('Product Hunt 首页逐卡翻译介绍，保留产品名称、分类和订阅控件，重挂后仍命中介绍', () => {
        const adapter = adapterById.get('product-hunt')!;
        const url = new URL('https://www.producthunt.com/');
        expect(adapter.matches(url)).toBe(true);
        const html = `<div id="root-container"><header><input data-test="header-search-input" placeholder="Search"></header>
            <main><div data-test="homepage-section-today"><h1>Top Products Launching Today</h1>
            <section data-container="true"><div><span id="name-one"><a href="/products/first"><span id="link-overlay" data-target="true"></span>1. First Product</a></span>
            <span id="tagline-one">Build useful tools with your team. <code id="code">KEEP_CODE_LOCAL</code></span>
            <div><a id="topic" href="/topics/developer-tools">Developer Tools</a></div></div>
            <button data-test="vote-button">Upvote this product</button></section>
            <section data-container="true"><div><span id="name-two"><a href="/products/second">2. Second Product</a></span>
            <span id="tagline-two">Find clear answers from the documents you already own.</span></div></section>
            <section data-test="newsletter-banner"><p id="newsletter">Get the best launches in your inbox</p></section>
            </div><article><p id="fallback">An ordinary product discussion still has readable prose.</p></article></main>
            <footer><h3 id="footer-category">Engineering and Development</h3></footer>
            <div data-test="dismiss-CookiePopup"><div><span id="cookie-message">We use cookies to improve your experience.<a href="/legal#privacy">Learn more in our privacy settings.</a></span>
            <div><button>No thanks</button><button>Accept all cookies</button></div></div></div></div>`;
        const document = documentFor(html);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const verify = () => {
            const candidates = core.discover(document);
            for (const id of ['tagline-one', 'tagline-two', 'fallback']) {
                const owner = document.getElementById(id)!;
                expect(candidates.find(candidate => candidate.element === owner)?.adapterId, id).toBe('product-hunt');
                expect(core.resolve(owner.firstChild)?.element, id).toBe(owner);
            }
            for (const selector of ['#name-one', '#name-two', '#topic', '#newsletter', '#footer-category', '#cookie-message', 'button', 'input']) {
                const protectedNode = document.querySelector(selector)!;
                expect(core.resolve(protectedNode.firstChild ?? protectedNode), selector).toBeNull();
                expect(core.shouldStayOriginal(protectedNode), selector).toBe(true);
            }
            const source = candidates.map(candidate => extractTranslationText(candidate.element, core.shouldStayOriginal)).join('\n');
            expect(source).not.toContain('First Product');
            expect(source).not.toContain('Developer Tools');
            expect(source).not.toContain('Get the best launches');
            expect(source).not.toContain('KEEP_CODE_LOCAL');
            expect(source).not.toContain('We use cookies');
            expect(source).not.toContain('Learn more in our privacy settings');
            expect(adapter.shouldIgnoreMutation?.(document.getElementById('cookie-message')!, {url})).toBe(true);
            expect(core.shouldStayOriginal(document.getElementById('code')!)).toBe(true);
            // 卡片的透明整卡链接仍在最上层；坐标解析应找到下层介绍，不能把名称当正文。
            const tagline = document.getElementById('tagline-two')!;
            Object.defineProperty(document, 'elementsFromPoint', {configurable: true, value: () => [
                document.getElementById('link-overlay')!, document.getElementById('name-one')!, tagline,
            ]});
            expect(core.resolveAtPoint(document, 20, 30)?.element).toBe(tagline);
        };
        verify();
        document.body.innerHTML = html;
        verify();
        for (const path of ['/posts/first', '/products/first']) expect(adapter.matches(new URL(path, url))).toBe(true);
        expect(adapter.matches(new URL('https://help.producthunt.com/en/articles/481909'))).toBe(false);
    });

    it('Amazon 星级弹层文字不进入候选或祖先快照，商品与评论正文仍可翻译', () => {
        const fixture = fixtures.find(item => item.id === 'amazon-shopping')!;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const verify = () => {
            const rating = document.querySelector('#acrPopover')!;
            const candidates = core.discover(document);
            expect(core.shouldStayOriginal(rating)).toBe(true);
            expect(candidates.some(candidate => rating === candidate.element || rating.contains(candidate.element))).toBe(false);
            for (const selector of fixture.required) {
                const element = document.querySelector(selector)!;
                expect(candidates.some(candidate => candidate.element === element), selector).toBe(true);
                expect(core.resolve(element.firstChild)?.element, selector).toBe(element);
            }
            const source = candidates.map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
            expect(source).not.toContain('out of 5 stars');
            const before = document.body.innerHTML;
            const snapshot = createTranslationSourceSnapshot(document.body, core.shouldStayOriginal);
            expect(snapshot.slots.some(slot => slot.source.includes('out of 5 stars'))).toBe(false);
            const rendered = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(() => '商品正文译文'));
            expect(rendered).toContain(document.querySelector('#rating-label')!.textContent);
            expect(rendered).toContain('商品正文译文');
            expect(document.body.innerHTML).toBe(before);
        };
        verify();
        document.querySelector('#rating-label')!.textContent = '4.8 out of 5 stars';
        verify();
        document.body.innerHTML = fixture.html;
        verify();
    });

    it('CNN 图注叙述保持可译，作者、日期和相邻图片署名不进入请求源', () => {
        const fixture = fixtures.find(item => item.id === 'cnn-news')!;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const verify = () => {
            const candidates = core.discover(document);
            const textFor = (candidate: typeof candidates[number]) => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal);
            const source = candidates.map(textFor).join('\n');
            for (const text of fixture.sourceAssertions!.required) expect(source).toContain(text);
            for (const text of fixture.sourceAssertions!.forbidden) expect(source).not.toContain(text);
            for (const selector of fixture.forbidden) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), selector).toBe(true);
                expect(candidates.some(candidate => node === candidate.element || node.contains(candidate.element)), selector).toBe(false);
            }
            for (const selector of ['#main-caption', '#related-caption']) {
                const caption = document.querySelector(selector)!;
                const text = caption.textContent!;
                const matches = candidates.filter(candidate => textFor(candidate).includes(text));
                expect(matches, selector).toHaveLength(1);
                // 独立 DOM 中的块级说明和实站内联说明可有不同 owner；只允许说明或它的 metadata 父级。
                expect([caption, caption.parentElement], selector).toContain(matches[0]!.element);
                const owner = caption.parentElement!;
                const before = owner.innerHTML;
                const credit = owner.querySelector('figcaption')!;
                const snapshot = createTranslationSourceSnapshot(owner, core.shouldStayOriginal);
                expect(snapshot.slots.map(slot => slot.source).join(' ')).toContain(text);
                expect(snapshot.slots.map(slot => slot.source).join(' ')).not.toContain(credit.textContent);
                const rendered = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(() => '图片说明译文'));
                expect(rendered).toContain(credit.textContent);
                expect(rendered).toContain('图片说明译文');
                expect(owner.innerHTML).toBe(before);
            }
            expect(core.shouldStayOriginal(document.querySelector('#ordinary-prose')!)).toBe(false);
        };
        verify();
        document.body.innerHTML = fixture.html;
        verify();
    });

    it('Steam 保护开始游戏入口和评论用户名，普通评论与游戏正文继续翻译', () => {
        const fixture = fixtures.find(item => item.id === 'steam-store')!;
        const url = new URL(fixture.url);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters});
        const verify = () => {
            const candidates = core.discover(document);
            for (const selector of ['#body1', '#body2', '#review-body']) {
                const node = document.querySelector(selector)!;
                expect(candidates.some(candidate => candidate.element === node), selector).toBe(true);
                expect(core.resolve(node.firstChild)?.element, selector).toBe(node);
            }
            for (const selector of ['#freeGameBtn', '#review-author']) {
                const node = document.querySelector(selector)!;
                expect(core.shouldStayOriginal(node), selector).toBe(true);
                expect(candidates.some(candidate => candidate.element === node || node.contains(candidate.element)), selector).toBe(false);
            }
            const source = candidates.map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
            expect(source).toContain('This review explains why the game works well');
            expect(source).not.toContain('Play Game');
            expect(source).not.toContain(document.querySelector('#review-author')!.textContent);
        };
        verify();
        document.querySelector('#review-author')!.textContent = 'Another Independent Reviewer';
        verify();
        document.body.innerHTML = fixture.html;
        verify();
    });

    it('ar5iv 定理中的可读叙述可形成候选，内联 MathML 保持受保护', () => {
        const url = new URL('https://ar5iv.labs.arxiv.org/html/2106.03753');
        const adapter = adapterById.get('ar5iv')!;
        const document = documentFor(`
            <article><div class="ltx_para"><p id="theorem" class="ltx_p">
            <span class="ltx_text ltx_font_italic">In single-hop beeping networks of size
            <math class="ltx_Math"><mi>n</mi></math>, there exists a deterministic algorithm
            that names distinct nodes in time slots.</span></p></div></article>
        `);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const candidate = core.discover(document).find(item => item.element.id === 'theorem');
        expect(candidate?.adapterId).toBe('ar5iv');
        expect(extractTranslationText(document.getElementById('theorem')!, core.shouldStayOriginal))
            .toContain('there exists a deterministic algorithm');
    });

    it('Wikipedia 多层章节内的段落也属于正文候选', () => {
        const url = new URL('https://en.wikipedia.org/wiki/United_States');
        const adapter = adapterById.get('wikipedia')!;
        const document = documentFor(`
            <main id="mw-content-text"><div class="mw-parser-output">
            <section><section><p id="nested">The later history section describes how
            <a href="/wiki/Example">national legislation</a> and <a href="/wiki/Another">court decisions</a>
            changed the country over several decades.<sup class="reference">[42]</sup></p>
            </section></section></div></main>
        `);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const candidates = core.discover(document);
        expect(candidates.find(candidate => candidate.element.id === 'nested')?.adapterId).toBe('wikipedia');
        expect(adapter.decide(document.getElementById('nested')!, {url})).toMatchObject({
            kind: 'force-target', atomic: true,
        });
    });

    it.each([
        ['Division', '/', '除法'],
        ['Logical NOT', '!a', '逻辑非'],
    ] as const)('Swift %s 的 p 持有可译标签，非原子 li 不吞并子段落，inline code 留在本地', (label, codeText, translated) => {
        const document = documentFor(`<main><ul><li id="item"><p id="operator">${label} (<code>${codeText}</code>)</p></li></ul></main>`);
        const url = new URL('https://docs.swift.org/latest/documentation/the-swift-programming-language/basicoperators/');
        const adapter = adapterById.get('swift-docs')!;
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const paragraph = document.getElementById('operator') as HTMLElement;
        const item = document.getElementById('item')!;
        const code = paragraph.querySelector('code')!;
        const original = paragraph.innerHTML;
        expect(adapter.decide(paragraph, {url})).toMatchObject({kind: 'force-target', atomic: false});
        expect(adapter.decide(item, {url})).toMatchObject({kind: 'force-target', atomic: false});
        const candidates = core.discover(document);
        expect(candidates.filter(candidate => candidate.element === paragraph)).toHaveLength(1);
        expect(candidates.some(candidate => candidate.element === item)).toBe(false);
        expect(core.resolve(paragraph.firstChild)?.element).toBe(paragraph);
        expect(core.shouldStayOriginal(code)).toBe(true);
        expect(core.resolve(code.firstChild)?.element).toBe(paragraph);
        const snapshot = createTranslationSourceSnapshot(paragraph, core.shouldStayOriginal);
        expect(snapshot.slots.map(slot => slot.source)).toEqual([`${label} (`, ')']);
        expect(buildWholeBlockTranslationSource(snapshot)).toBeNull();
        const rendered = applyTranslationsToSnapshot(snapshot, [`${translated}（`, ')']);
        expect(rendered).toBe(`${translated}（<code>${codeText}</code>)`);
        expect(paragraph.innerHTML).toBe(original);
        expect(paragraph.querySelector('code')).toBe(code);
        expect(code.textContent).toBe(codeText);
    });

    it('整个目录满足统一 JSON 契约，使用有效选择器和可追踪的独立设计记录', () => {
        expect(pack.rules.length).toBeGreaterThanOrEqual(100);
        expect(validateSelectors(pack, documentFor('<main></main>'))).toEqual([]);
        expect(new Set(coverage.rules.map(rule => rule.id))).toEqual(new Set(pack.rules.map(rule => rule.id)));
        expect(new Set(coverage.rules.map(rule => rule.category))).toEqual(new Set([
            'documentation', 'news', 'encyclopedia', 'research', 'community', 'ai', 'commerce', 'mail',
        ]));
        expect(Object.keys(coverage.profiles).sort()).toEqual(Object.keys(pack.profiles ?? {}).sort());
        expect(coverage.rules.every(rule => typeof rule.liveVerification === 'string' && rule.liveVerification.length > 0)).toBe(true);
        expect(coverage.remainingCapabilities.map(item => item.capability)).toEqual(expect.arrayContaining([
            'captions', 'image-text', 'cross-origin-frames', 'virtualized-layout', 'closed-shadow-dom',
        ]));
        for (const rule of pack.rules) {
            const standalone = resolveSiteRule(pack, rule);
            expect(parseSiteRulePack({version: 1, rules: [standalone]}), rule.id).toMatchObject({ok: true});
            if (standalone.content?.length) {
                expect(standalone.protect, rule.id).toEqual(expect.arrayContaining(['code', 'pre', 'input', 'textarea']));
                expect(standalone.exclude, rule.id).toContain('nav');
            } else {
                // 只补元数据边界的规则保留通用发现，独立夹具必须证明正文没有被白名单收窄。
                expect(rule.id).toBe(blueskyMetadataFixture.id);
                expect(rule.profile).toBeUndefined();
                expect(standalone.mode).toBe('augment');
                expect(standalone.exclude?.length, rule.id).toBeGreaterThan(0);
                expect(standalone.watchIgnore, rule.id).toEqual(expect.arrayContaining(standalone.exclude!));
            }
        }
    });

    it('每一个 focus 规则和每一种正文模板都有真实引擎消费的可重复夹具', () => {
        expect(new Set(fixtures.map(fixture => rulesById.get(fixture.id)?.profile).filter(Boolean)))
            .toEqual(new Set(Object.keys(pack.profiles ?? {})));
        const fixtureIds = new Set(fixtures.map(fixture => fixture.id));
        expect(fixtureIds.size).toBe(fixtures.length);
        expect(new Set(fixtures.map(fixture => new URL(fixture.url).hostname)).size).toBeGreaterThanOrEqual(20);
        for (const rule of pack.rules) {
            if (resolveSiteRule(pack, rule).mode === 'focus') expect(fixtureIds.has(rule.id), rule.id).toBe(true);
        }
    });

    it('公开页面验证清单的地址触发对应规则，正文定位使用标准 CSS', () => {
        expect(liveCases.length).toBeGreaterThanOrEqual(20);
        expect(new Set(liveCases.map(item => new URL(item.url).hostname)).size).toBe(liveCases.length);
        const document = documentFor('<main><p>Readable example</p></main>');
        for (const item of liveCases) {
            expect(adapterById.get(item.id)?.matches(new URL(item.url)), item.id).toBe(true);
            expect(() => document.querySelectorAll(item.selector), item.id).not.toThrow();
        }
    });

    it('pnpm 文档保留版本标记和移动目录控件，并继续逐段翻译正文', () => {
        const document = documentFor(`
            <main><article>
                <span id="version-badge" class="theme-doc-version-badge badge badge--secondary">Version: 12.x</span>
                <div class="theme-doc-toc-mobile">
                    <button id="mobile-toc-button" type="button">On this page</button>
                    <ul><li id="mobile-toc-entry"><a href="#installation">Installation instructions</a></li></ul>
                </div>
                <div class="theme-doc-markdown markdown">
                    <h1 id="installation">Installation</h1>
                    <p id="body-one">Install the package manager before opening a terminal to configure your project.</p>
                    <p id="body-two">This second paragraph explains how the installed command can be checked safely.</p>
                </div>
            </article></main>
        `);
        const adapter = adapterById.get('pnpm-docs')!;
        const url = new URL('https://pnpm.io/installation');
        expect(adapter.matches(url)).toBe(true);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const candidates = core.discover(document);
        for (const id of ['installation', 'body-one', 'body-two']) {
            const element = document.getElementById(id)!;
            expect(candidates.find(candidate => candidate.element === element)).toMatchObject({adapterId: 'pnpm-docs'});
            expect(core.resolve(element.firstChild)?.element).toBe(element);
        }
        for (const id of ['version-badge', 'mobile-toc-button', 'mobile-toc-entry']) {
            const element = document.getElementById(id)!;
            expect(core.resolve(element.firstChild), id).toBeNull();
            expect(candidates.some(candidate => candidate.element === element || element.contains(candidate.element)), id).toBe(false);
        }
        const source = extractTranslationText(document.querySelector('article')!, core.shouldStayOriginal);
        expect(source).not.toContain('Version:');
        expect(source).not.toContain('On this page');
        expect(source).not.toContain('Installation instructions');
    });

    it.each(pack.rules)('$id 的全部主机和路径按域名边界匹配，不接收相似或伪装主机', (rule) => {
        const adapter = adapterById.get(rule.id)!;
        for (const pattern of rule.match.hosts) {
            const baseHost = pattern.replace(/^\*\./u, '');
            const host = pattern.startsWith('*.') ? `reader.${baseHost}` : baseHost;
            for (const pathPattern of rule.match.paths ?? ['/article/fixture']) {
                const path = pathPattern.replaceAll('*', 'fixture');
                expect(adapter.matches(new URL(`https://${host}${path}`)), `${rule.id}: ${host}${path}`).toBe(true);
                expect(adapter.matches(new URL(`http://${host}${path}`))).toBe(true);
                expect(adapter.matches(new URL(`https://${host}${path}?next=/login#settings`))).toBe(true);
                expect(adapter.matches(new URL(`https://${baseHost}${path}`))).toBe(true);
                expect(adapter.matches(new URL(`https://${baseHost}.attacker.invalid${path}`))).toBe(false);
                expect(adapter.matches(new URL(`https://spoof-${baseHost}${path}`))).toBe(false);
                expect(adapter.matches(new URL(`https://${baseHost}@attacker.invalid${path}`))).toBe(false);
                expect(adapter.matches(new URL(`https://attacker.invalid${path}?host=${baseHost}`))).toBe(false);
                expect(adapter.matches(new URL(`ftp://${host}${path}`))).toBe(false);
                if (!pattern.startsWith('*.')) expect(adapter.matches(new URL(`https://reader.${host}${path}`))).toBe(false);
            }
            for (const excluded of rule.match.excludePaths ?? []) {
                expect(adapter.matches(new URL(`https://${host}${excluded.replaceAll('*', 'fixture')}`))).toBe(false);
            }
            // 不带末尾 / 的单段路径不匹配 Gist 的双段页面；空 wildcard 可合法匹配尾部 /。
            if (rule.match.paths) expect(adapter.matches(new URL(`https://${host}/__unrelated_route__`))).toBe(false);
        }
    });

    it.each(fixtures)('$id 通过专属适配器选择两段正文，保护控制与元数据，重挂载后边界一致', fixture => {
        const adapter = adapterById.get(fixture.id)!;
        const url = new URL(fixture.url);
        expect(adapter.matches(url), fixture.id).toBe(true);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});

        const verify = (): string[] => {
            const candidates = core.discover(document);
            const messageContainer = document.querySelector('#message-container, [data-message-container]');
            if (messageContainer) {
                expect(candidates.some(candidate => candidate.element === messageContainer),
                    `${fixture.id}: paragraphs must not also produce one whole-message request`).toBe(false);
            }
            for (const selector of fixture.required) {
                const element = document.querySelector(selector)!;
                expect(element, `${fixture.id}: ${selector}`).not.toBeNull();
                const candidate = candidates.find(candidate => candidate.element === element);
                expect(candidate, `${fixture.id}: ${selector}`).toBeDefined();
                if (candidate?.reason === 'generic-inline-run') {
                    // 非原子容器直接首段沿用现有 inline-run 类型，由实时专站决策授权。
                    expect(adapter.decide(element, {url}), `${fixture.id}: ${selector}`)
                        .toMatchObject({kind: 'force-target', target: element, atomic: false});
                    expect(candidate.nodes?.length, `${fixture.id}: ${selector}`).toBeGreaterThan(0);
                } else expect(candidate?.adapterId, `${fixture.id}: ${selector}`).toBe(fixture.id);
                const walker = document.createTreeWalker(element, 4);
                let readable = walker.nextNode();
                while (readable && (!readable.textContent?.trim() ||
                    (readable.parentElement && core.shouldStayOriginal(readable.parentElement)))) readable = walker.nextNode();
                expect(readable, `${fixture.id}: readable ${selector}`).not.toBeNull();
                expect(core.resolve(readable)?.element, `${fixture.id}: hover ${selector}`).toBe(element);
            }
            for (const selector of fixture.forbidden) {
                const element = document.querySelector(selector)!;
                expect(element, `${fixture.id}: ${selector}`).not.toBeNull();
                expect(candidates.some(candidate => element === candidate.element || element.contains(candidate.element)),
                    `${fixture.id}: protected ${selector}`).toBe(false);
            }
            const source = candidates.map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
            expect(source).not.toContain('KEEP_ORIGINAL_TOKEN');
            expect(source).not.toContain('FORMULA_TOKEN');
            expect(source).not.toContain('Navigation remains unchanged');
            expect(source).not.toContain('User metadata remains unchanged');
            expect(document.querySelector('#protected')?.textContent).toBe('KEEP_ORIGINAL_TOKEN');
            return candidates.map(candidate => candidate.element.id);
        };

        const originalIds = verify();
        document.body.innerHTML = fixture.html;
        expect(verify()).toEqual(originalIds);
    });

    it.each(['mdn', 'python-docs', 'huggingface', 'reuters', 'wikipedia', 'arxiv', 'discourse-meta', 'perplexity', 'etsy-shopping'])(
        '%s 区分页面框架和文章拥有的导语、结语及语义提示框', id => {
            const adapter = adapterById.get(id)!;
            const rule = rulesById.get(id)!;
            const host = rule.match.hosts[0]!.replace(/^\*\./u, '');
            const path = rule.match.paths?.[0]?.replaceAll('*', 'fixture') ?? '/article/fixture';
            const core = new TranslationCandidateCore({url: new URL(`https://${host}${path}`), adapters: [adapter]});
            const document = documentFor(`
                <main>
                    <header><h1 id="page-title">A readable document title</h1><p id="page-metadata">Page tools and update metadata</p></header>
                    <article class="document markdown-body cooked">
                        <header><h2 id="article-title">A readable article title</h2><p id="article-lead">This introductory paragraph belongs to the article and describes its subject clearly.</p></header>
                        <p id="body">The article body remains available for translation with ordinary prose and context.</p>
                        <aside><p id="article-aside">This article owns its explanatory sidebar, which is useful readable content.</p></aside>
                        <aside role="note"><p id="article-note">A semantic note inside the article remains part of the readable explanation.</p></aside>
                        <footer><p id="article-conclusion">This closing paragraph belongs to the article and supplies a readable conclusion.</p></footer>
                        <div role="toolbar"><p id="toolbar">Copy link and edit this page</p></div>
                    </article>
                    <aside><p id="page-aside">Related pages and navigation tools</p></aside>
                    <aside class="note"><p id="note-label">Note</p><p id="note-copy">A DocC style note belongs to the main document and keeps its descriptive text.</p></aside>
                    <footer><p id="page-footer">Page legal notices and global tools</p></footer>
                </main>
                <aside class="note"><p id="global-aside">A global sidebar is still outside the main document despite its note class.</p></aside>
            `);
            const candidates = core.discover(document);
            const selected = candidates.map(candidate => candidate.element.id);
            expect(selected).toEqual(expect.arrayContaining(['article-lead', 'body', 'article-aside', 'article-note', 'article-conclusion', 'note-label', 'note-copy']));
            for (const protectedId of ['page-metadata', 'page-aside', 'toolbar', 'page-footer', 'global-aside']) {
                expect(selected, `${id}: ${protectedId}`).not.toContain(protectedId);
                const element = document.getElementById(protectedId)!;
                expect(core.resolve(element.firstChild), `${id}: hover ${protectedId}`).toBeNull();
            }
        },
    );
});
