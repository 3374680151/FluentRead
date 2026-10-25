# Adjust a particular website

Most sites need no custom rule. If a site consistently misses content or translates metadata you want left alone, first follow [Website reading area](/en/config/site-adaptation).

Open **Tools & learning → Website rules**. Site preferences, content rules, and the effective preview appear on one continuous page. The top navigation scrolls to each section. Everyday preferences do not require JSON. The visual content-rule editor still requires CSS selectors; you can also report a URL and the area you want adjusted instead of writing a rule.

<GuideVisual kind="rules" en />

## Start with an existing rule

Search content rules by site name, host, or rule ID. Open the details and customize a built-in rule, or create a new rule. Export a backup first.

Use one host, path, or CSS selector per line; commas inside CSS remain intact. Augment adds targets to general recognition; focus limits recognition to declared content. Choose Save and apply to validate and save the visual form. It closes only after saving succeeds; failures retain your entries. A rule ID is generated automatically and can be adjusted under advanced options. Switching categories retains the draft. Unsaved edits request the browser's close/reload warning, but drafts are not saved automatically. Confirming departure still discards them; save or export first.

Expand JSON & backup for import, export, and the advanced JSON editor. JSON supports profiles and every advanced field; edits remain in the draft until you choose Save and apply above. Import merges by default: matching IDs replace whole rules, while other rules remain. Conflicting profile definitions are rejected. Whole-draft replacement is optional and can be undone before saving. Removing a custom override and saving restores its built-in version; the disabled ID state remains.

If another page updates saved rules, your draft is retained and stale saves are blocked. Export the draft, restore the latest configuration, and merge your changes again.

A rule mainly describes the website it applies to, where its content is, and what should stay original. Incorrect rules can translate too much or too little; they do not automatically understand the page’s meaning.

<details class="guide-details">
<summary>Check after saving</summary>

## Check after saving

First check a complete HTTP(S) URL in the effective preview. It explains saved site preferences, matched rules, and their priority without visiting the website. It does not validate the site's DOM, permissions, language filters, or translation service. With all-node recognition, only rules explicitly declaring `allScopes` participate.

1. Open the site, restore the original, and translate again.
2. Check headings and article text, along with authors, buttons, and other areas that should stay original.
3. Scroll, expand comments, or change articles to check later content.
4. If it is wrong, disable the custom rule or restore your backup.

</details>

<details class="guide-details">
<summary>Detailed examples</summary>

## Detailed examples

The [repository contribution guide](https://github.com/FluentRead/FluentRead/blob/main/docs/contributing/site-adaptation.md) contains selectors, formats, and validation steps. It also explains how to share a tested rule with the project.

</details>

## Report a compatibility problem

Search results, articles, comments, and signed-in feeds on the same website can use different structures. A dedicated rule does not mean every page type has been verified. Pages without one still use general content recognition. Public-page results also do not establish compatibility behind a login or challenge.

Include the complete URL, browser and extension versions, the area that should be translated, and anything that should stay original. Explain whether scrolling, expanding comments, or changing articles triggers the problem. Do not include credentials or private content. A specific page and action can then be checked through translate, restore, and translate again, including content coverage, duplicate translations, and existing link behavior.

<details class="guide-details">
<summary>Maintainers: inspect the priority website review list</summary>

Run `node scripts/site-translation/audit-site-coverage.cjs` in the repository, adding `--json` for structured output. It reads the current catalog to report declaration counts, categories, fixture evidence, page types to review separately, registered browser contracts, and priority hosts without dedicated rules. Contract registration and host declarations help schedule reviews; they do not establish full URL matching or DOM coverage.

The `scopeAudit`, public HTML probes, and browser records in `coverage.json` retain their historical scope. Historical evidence is not a current live-site pass. Record semantic fixtures, site fixtures, actual pages, and actual translation services separately; rule counts cannot measure the percentage of popular websites that pass.

</details>

## Related guides

- [All guides](/en/docs/)
- [Troubleshooting](/en/guide/faq)
