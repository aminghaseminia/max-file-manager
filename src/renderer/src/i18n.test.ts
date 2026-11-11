import assert from 'node:assert/strict'
import test from 'node:test'
import { getLang, setLang, subscribeLang, t } from './i18n.ts'
import { COLUMNS, colLabel } from './prefs.ts'

test('English is the default and the catalogue translates both ways', () => {
  setLang('en')
  assert.equal(getLang(), 'en')
  assert.equal(t('زبان'), 'Language')
  assert.equal(t('انگلیسی'), 'English')
  assert.equal(t('فارسی'), 'Persian')
  setLang('fa')
  assert.equal(getLang(), 'fa')
  assert.equal(t('زبان'), 'زبان')
  assert.equal(t('فارسی'), 'فارسی')
  setLang('en')
})

test('a nonsense language falls back to English', () => {
  setLang('de' as never)
  assert.equal(getLang(), 'en')
})

test('subscribers fire only when the language actually changes', () => {
  let calls = 0
  const off = subscribeLang(() => calls++)
  setLang('fa')
  setLang('fa')
  setLang('en')
  off()
  setLang('fa')
  assert.equal(calls, 2)
  setLang('en')
})

test('column labels are translated at render, not frozen at import', () => {
  assert.equal(COLUMNS.find((c) => c.id === 'type')?.label, 'نوع')
  setLang('en')
  assert.equal(colLabel('type'), 'Type')
  setLang('fa')
  assert.equal(colLabel('type'), 'نوع')
  setLang('en')
})
