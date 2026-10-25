<!--
 * @file src/features/settings/ui/services/CompositeTranslationFields.vue
 * 文件职责：用紧凑设置行编辑组合成员、调用方式与单成员时限，创建和编辑共用同一表单。
 * 主要内容：成员选择即添加，以小图标、序号和定尺寸图标按钮排序或移除；方式以分段控件显示，仅保留当前解释，复杂规则留在帮助提示；时限归入与控件列对齐的轻量折叠入口，按表单实际宽度切换单列。
 * 模块边界：只发送不含凭据的草稿补丁，名称共用、验证及保存归调用方；活动身份限定旧控件事件，不直接修改配置或发起翻译。
 -->
<template>
  <div class="composite-fields" data-composite-fields>
    <div v-if="showName" class="composite-setting-row">
      <label :for="nameId" class="setting-label">{{ t('settings.services.composite.name') }}</label>
      <div class="setting-control">
        <input :id="nameId" :value="draft.name" :disabled="!active" :maxlength="MAX_COMPOSITE_SERVICE_NAME_LENGTH" :aria-label="t('settings.services.composite.name')" :placeholder="t('settings.services.composite.namePlaceholder')" :aria-invalid="Boolean(errors.name)" data-testid="composite-service-name" :onInput="actions.name" />
        <small v-if="errors.name" class="field-error" role="alert">{{ t(errors.name) }}</small>
      </div>
    </div>
    <div class="composite-setting-row">
      <div class="setting-label">{{ t('settings.services.composite.members') }}<FieldHelp :content="t('settings.services.composite.membersHelp')" /></div>
      <div class="setting-control">
        <ol v-if="draft.services.length" class="composite-member-list">
          <li v-for="(service, index) in draft.services" :key="service" :data-composite-member="service">
            <span class="member-number">{{ index + 1 }}</span>
            <ServiceIcon :service="service" :label="memberLabel(service)" size="small" />
            <span class="member-name">{{ memberLabel(service) }}</span>
            <div class="member-actions">
              <button type="button" :disabled="!active || index === 0" :aria-label="t('settings.services.composite.moveUp', {service: memberLabel(service)})" :onClick="actions.move.bind(null, service, -1)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m-4 4 4-4 4 4" /></svg></button>
              <button type="button" :disabled="!active || index === draft.services.length - 1" :aria-label="t('settings.services.composite.moveDown', {service: memberLabel(service)})" :onClick="actions.move.bind(null, service, 1)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10m-4-4 4 4 4-4" /></svg></button>
              <button type="button" :disabled="!active" :aria-label="t('settings.services.composite.removeMember', {service: memberLabel(service)})" :onClick="actions.remove.bind(null, service)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg></button>
            </div>
          </li>
        </ol>
        <select :value="selectedMember" :disabled="!active || !availableMembers.length" :aria-label="t('settings.services.composite.selectMember')" data-testid="composite-member-select" :onChange="actions.selectMember">
          <option value="">{{ t('settings.services.composite.selectMember') }}</option>
          <option v-for="member in availableMembers" :key="member.value" :value="member.value">{{ member.label }}</option>
        </select>
        <small v-if="errors.services" class="field-error" role="alert">{{ t(errors.services) }}</small>
        <p class="setting-description">{{ t('settings.services.composite.sharedConfig') }}</p>
      </div>
    </div>
    <div class="composite-setting-row">
      <div class="setting-label">{{ t('settings.services.composite.strategy') }}<FieldHelp v-if="draft.strategy === 'sequential'" :content="t('settings.services.composite.sequentialDetails')" /></div>
      <div class="setting-control">
        <SegmentedControl compact class="composite-strategy-control" data-testid="composite-service-strategy" :label="t('settings.services.composite.strategy')" :model-value="draft.strategy" :options="strategyOptions" :disabled="!active" :onUpdate:modelValue="actions.strategy" />
        <p class="setting-description" data-composite-strategy-help>{{ t(`settings.services.composite.${draft.strategy}Help`) }}</p>
      </div>
    </div>
    <details class="composite-advanced" data-composite-advanced :open="advancedOpen" :onToggle="actions.advanced">
      <summary><svg class="composite-advanced-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 5 5-5 5" /></svg>{{ t('settings.services.composite.advanced') }}</summary>
      <div class="composite-setting-row timeout-row">
        <label :for="timeoutId" class="setting-label">{{ t('settings.services.composite.timeout') }}<FieldHelp :content="t('settings.services.composite.timeoutHelp')" /></label>
        <div class="setting-control">
          <input :id="timeoutId" type="number" :value="draft.timeoutMs / 1000" min="1" max="45" step="1" :disabled="!active" :aria-label="t('settings.services.composite.timeout')" :aria-invalid="Boolean(errors.timeoutMs)" data-testid="composite-member-timeout" :onInput="actions.timeout" />
          <small v-if="errors.timeoutMs" class="field-error" role="alert">{{ t(errors.timeoutMs) }}</small>
        </div>
      </div>
    </details>
  </div>
</template>
<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue'
import type {CompositeTranslationStrategy} from '@/src/core/config/compositeTranslation'
import {useUiI18n} from '@/src/ui/i18n'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import {MAX_COMPOSITE_SERVICE_NAME_LENGTH, type CompositeTranslationDraft, type CompositeTranslationDraftErrors} from '@/src/ui/view-model/compositeServiceEditor'
import type {ServiceOption} from '@/src/ui/view-model/serviceCatalog'
import {useSettingsActionContext} from '../../model/useSettingsActionContext'
import FieldHelp from '../components/FieldHelp.vue'
import SegmentedControl from '../components/SegmentedControl.vue'

const props = withDefaults(defineProps<{draft: CompositeTranslationDraft; members: ServiceOption[]; errors?: CompositeTranslationDraftErrors; active?: boolean; context?: unknown; showName?: boolean}>(), {active: true, showName: true, errors: () => ({})})
const emit = defineEmits<{update: [patch: Partial<CompositeTranslationDraft>]}>()
const {t} = useUiI18n()
const selectedMember = ref('')
const advancedOpen = ref(false)
watch(() => props.errors.timeoutMs, error => {if (error) advancedOpen.value = true}, {flush: 'sync'})
const nameId = useId(), timeoutId = useId()
const strategies: CompositeTranslationStrategy[] = ['sequential', 'random', 'smart']
const strategyOptions = computed(() => strategies.map(value => ({value, label: t(`settings.services.composite.${value}`)})))
const availableMembers = computed(() => props.members.filter(member => !props.draft.services.includes(member.value)))
const memberNames = computed(() => new Map(props.members.map(member => [member.value, member.label])))
const memberLabel = (service: string) => memberNames.value.get(service) || service
const {active, capture} = useSettingsActionContext(() => props.active, () => [props.context, props.draft, props.members, props.showName, props.draft.services.join('\0')])
function inputValue(event: Event): string {return (event.currentTarget as HTMLInputElement | null)?.value || ''}
function appendMember(service: string) {
  if (!availableMembers.value.some(member => member.value === service)) return
  emit('update', {services: [...props.draft.services, service]})
  selectedMember.value = ''
}
const actions = computed(() => {
  const current = capture()
  return {
    name: (event: Event) => {if (current() && props.showName) emit('update', {name: inputValue(event)})},
    advanced: (event: Event) => {if (current() && typeof (event.currentTarget as HTMLDetailsElement | null)?.open === 'boolean') advancedOpen.value = (event.currentTarget as HTMLDetailsElement).open},
    timeout: (event: Event) => {if (current()) emit('update', {timeoutMs: inputValue(event).trim() ? Number(inputValue(event)) * 1000 : NaN})},
    selectMember: (event: Event) => {if (current()) {selectedMember.value = inputValue(event);appendMember(selectedMember.value)}},
    strategy: (strategy: string | number) => {if (current() && strategies.includes(strategy as CompositeTranslationStrategy)) emit('update', {strategy: strategy as CompositeTranslationStrategy})},
    move: (service: string, direction: number) => {
      if (!current()) return
      const services = [...props.draft.services], index = services.indexOf(service), target = index + direction
      if (index < 0 || target < 0 || target >= services.length) return
      ;[services[index], services[target]] = [services[target], services[index]]
      emit('update', {services})
    },
    remove: (service: string) => {if (current()) emit('update', {services: props.draft.services.filter(member => member !== service)})},
  }
})
</script>
<style scoped>
.composite-fields { container: composite-fields / inline-size; display: grid; gap: 16px; min-width: 0; color: var(--ink, #172033); }
.composite-setting-row { display: grid; grid-template-columns: var(--composite-label-width, 100px) minmax(0, 1fr); gap: var(--composite-column-gap, 14px); align-items: start; }
.setting-label { display: flex; align-items: center; gap: 3px; min-height: 36px; font-size: 13px; font-weight: 550; }
.setting-control { display: grid; gap: 7px; min-width: 0; }
input, select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 36px; padding: 7px 10px; border: 1px solid var(--line, #dfe3eb); border-radius: 8px; background: var(--surface, #fff); color: inherit; font: inherit; font-size: 13px; }
input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--brand, #ef4776); outline-offset: 2px; }
input[aria-invalid='true'] { border-color: var(--el-color-danger, #d9345e); }
.setting-description { margin: 0; color: var(--muted, #737c8f); font-size: 12px; line-height: 1.6; }
.field-error { color: var(--el-color-danger, #c52f58); font-size: 12px; }
.composite-member-list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.composite-member-list li { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 36px; padding: 3px 7px; }
.composite-member-list li + li { border-top: 1px solid var(--line); }
.member-number { min-width: 12px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.composite-member-list :deep(.service-brand-icon) { width: 24px; height: 24px; border-radius: 6px; }
.member-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; line-height: 1.4; }
.member-actions { display: flex; flex: none; gap: 1px; }
.member-actions button { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; color: var(--muted); background: transparent; cursor: pointer; }
.member-actions svg, .composite-advanced-chevron { flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.member-actions button:hover:not(:disabled) { color: var(--brand-strong); background: var(--brand-soft); }
button:disabled, input:disabled, select:disabled { opacity: .45; cursor: default; }
.composite-strategy-control { width: min(100%, 330px); }
.composite-advanced summary { display: flex; align-items: center; gap: 5px; width: fit-content; max-width: calc(100% - var(--composite-label-width, 100px) - var(--composite-column-gap, 14px)); min-height: 28px; margin-inline-start: calc(var(--composite-label-width, 100px) + var(--composite-column-gap, 14px)); padding: 4px 0; border: 0; border-radius: 4px; color: var(--muted); background: transparent; font-size: 12px; line-height: 1.5; list-style: none; cursor: pointer; }
.composite-advanced summary::-webkit-details-marker { display: none; }
.composite-advanced summary::marker { content: ''; }
.composite-advanced summary:hover { color: var(--brand-strong); }
.composite-advanced[open] .composite-advanced-chevron { transform: rotate(90deg); }
.composite-advanced[open] summary { margin-bottom: 9px; }
.timeout-row input { width: 84px; }
@container composite-fields (max-width: 480px) { .composite-setting-row { grid-template-columns: 1fr; gap: 5px; }.setting-label { min-height: 24px; }.composite-advanced summary { max-width: 100%; margin-inline-start: 0; } }
@media (max-width: 560px) { .composite-setting-row { grid-template-columns: 1fr; gap: 5px; }.setting-label { min-height: 24px; }.composite-fields { gap: 13px; } }
</style>
