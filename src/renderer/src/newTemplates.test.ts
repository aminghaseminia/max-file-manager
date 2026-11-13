import test from 'node:test'
import assert from 'node:assert/strict'
import { NEW_FILE_TEMPLATES, NEW_CATEGORIES } from './newTemplates.ts'
import { hasTranslation } from './i18n.ts'

test('NEW_CATEGORIES organizes templates by function', () => {
  const catIds = NEW_CATEGORIES.map((c) => c.id)
  assert.deepEqual(catIds, ['office', 'design', 'code', 'config', 'project'])

  for (const cat of NEW_CATEGORIES) {
    assert.ok(cat.label.length > 0, `${cat.id} has a label`)
    assert.ok(cat.templates.length > 0, `${cat.id} has templates`)
  }
})

test('NEW_FILE_TEMPLATES covers popular and ArtCraft extensions', () => {
  const ids = NEW_FILE_TEMPLATES.map((t) => t.id)
  // ArtCraft & Office formats
  assert.ok(ids.includes('docx'), 'includes docx (WordCraft)')
  assert.ok(ids.includes('xlsx'), 'includes xlsx (GridCraft)')
  assert.ok(ids.includes('pptx'), 'includes pptx (DeckCraft)')
  assert.ok(ids.includes('pdf'), 'includes pdf (PDFCraft)')
  assert.ok(ids.includes('svg'), 'includes svg (VectorCraft)')
  assert.ok(ids.includes('fig'), 'includes fig (FigCraft)')
  assert.ok(ids.includes('png'), 'includes png (PhotoCraft)')

  // Classic code & note formats
  assert.ok(ids.includes('txt'), 'includes txt')
  assert.ok(ids.includes('md'), 'includes md')
  assert.ok(ids.includes('html'), 'includes html')
  assert.ok(ids.includes('css'), 'includes css')
  assert.ok(ids.includes('json'), 'includes json')
  assert.ok(ids.includes('py'), 'includes py')
  assert.ok(ids.includes('js'), 'includes js')
  assert.ok(ids.includes('ts'), 'includes ts')
  assert.ok(ids.includes('sh'), 'includes sh')
  assert.ok(ids.includes('csv'), 'includes csv')
  assert.ok(ids.includes('yaml'), 'includes yaml')
  assert.ok(ids.includes('env'), 'includes env')
  assert.ok(ids.includes('sql'), 'includes sql')
  assert.ok(ids.includes('readme'), 'includes readme')
  assert.ok(ids.includes('agents'), 'includes agents')
  assert.ok(ids.includes('gitignore'), 'includes gitignore')
  assert.ok(ids.includes('empty'), 'includes empty')

  // Dotfile defaults must not be mangled by an appended extension
  const gitignore = NEW_FILE_TEMPLATES.find((t) => t.id === 'gitignore')
  assert.equal(gitignore?.defaultName, '.gitignore')
  assert.equal(gitignore?.ext, '')
  for (const id of ['readme', 'agents']) {
    assert.equal(NEW_FILE_TEMPLATES.find((t) => t.id === id)?.ext, '.md')
  }

  for (const t of NEW_FILE_TEMPLATES) {
    assert.ok(t.label.length > 0, `${t.id} has a label`)
    assert.ok(t.defaultName.length > 0, `${t.id} has defaultName`)
    assert.ok(t.icon.length > 0, `${t.id} has an icon`)
    assert.ok(hasTranslation(t.label), `${t.id} label has an English translation`)
  }
  for (const cat of NEW_CATEGORIES) {
    assert.ok(hasTranslation(cat.label), `${cat.id} label has an English translation`)
  }

  // Check valid base64 for binary templates
  const binaryTemplates = NEW_FILE_TEMPLATES.filter((t) => t.content.startsWith('base64:'))
  assert.ok(binaryTemplates.length >= 6)
  for (const bt of binaryTemplates) {
    const raw = bt.content.slice(7)
    const buf = Buffer.from(raw, 'base64')
    assert.ok(buf.length > 0, `${bt.id} decodes to non-empty buffer`)
  }
})
