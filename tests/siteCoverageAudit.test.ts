import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const {auditSiteCoverage} = require('../scripts/site-translation/audit-site-coverage.cjs');

describe('website coverage maintenance report', () => {
    it('derives current counts from catalog data while keeping fixture evidence distinct from live acceptance', () => {
        const report = auditSiteCoverage();
        expect(report.ok).toBe(true);
        expect(report.catalog.totalRules).toBe(report.catalog.establishedRules + report.catalog.websiteRules);
        expect(Object.values(report.catalog.verification).reduce<number>((sum, count) => sum + Number(count), 0)).toBe(report.catalog.totalRules);
        expect(report.prioritySites.find((site: {id: string}) => site.id === 'youtube').declarations.some((rule: {id: string}) => rule.id === 'youtube')).toBe(true);
        expect(report.prioritySites.find((site: {id: string}) => site.id === 'facebook').status).toBe('no-dedicated-rule');
        expect(report.boundary).toContain('not successful current live-site translations');
    });

    it('does not infer support for a lookalike host or convert historical evidence into a current pass', () => {
        const report = auditSiteCoverage({established: [], profiles: {article: {mode: 'augment'}},
            websites: [{id: 'one', profile: 'article', match: {hosts: ['*.example.com'], paths: ['/articles/*']}}],
            coverage: {rules: [{id: 'one', category: 'news', verification: 'site-fixture', liveVerification: 'passed-2026-09-05'}],
                prioritySites: [{id: 'apex', name: 'Apex', host: 'example.com', reviewSurfaces: ['article']},
                    {id: 'sub', name: 'Subdomain', host: 'news.example.com', reviewSurfaces: ['article']},
                    {id: 'lookalike', name: 'Lookalike', host: 'example.com.evil.test', reviewSurfaces: ['article']}]}});
        expect(report.prioritySites.map((site: {status: string}) => site.status)).toEqual([
            'declared-host-needs-page-verification', 'declared-host-needs-page-verification', 'no-dedicated-rule',
        ]);
        expect(report.prioritySites[0].declarations[0]).toMatchObject({paths: ['/articles/*'], historicalLiveEvidence: 'passed-2026-09-05'});
    });

    it('fails stale metadata references, missing website evidence and duplicate rule IDs', () => {
        const report = auditSiteCoverage({profiles: {}, established: [{id: 'same', match: {hosts: ['example.com']}}],
            websites: [{id: 'same', match: {hosts: ['example.com']}}],
            coverage: {rules: [{id: 'removed', category: 'news', verification: 'site-fixture'}]}});
        expect(report.ok).toBe(false);
        expect(report.errors).toEqual(['Duplicate built-in rule IDs', 'Evidence metadata has no rule: removed', 'Website rule has no evidence metadata: same']);
        expect(report.withoutEvidenceMetadata).toEqual(['same', 'same']);
    });

    it('rejects malformed priority hosts, empty review contracts and duplicate IDs instead of reporting false gaps', () => {
        const valid = {id: 'example', name: 'Example', host: 'example.com', reviewSurfaces: ['article']};
        const report = auditSiteCoverage({profiles: {}, established: [], websites: [], coverage: {rules: [],
            prioritySites: [valid, {...valid}, {...valid, id: 'bad-host', host: 'example.com/articles'},
                {...valid, id: 'empty-contract', reviewSurfaces: []}, {...valid, id: 'bad-case', browserCases: 'case-name'}]}});
        expect(report.ok).toBe(false);
        expect(report.prioritySites).toHaveLength(1);
        expect(report.errors).toEqual(['Duplicate priority site ID: example', 'Invalid priority site: bad-host',
            'Invalid priority site: empty-contract', 'Invalid priority site: bad-case']);
    });
});
