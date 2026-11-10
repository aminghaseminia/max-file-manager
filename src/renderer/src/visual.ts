/**
 * Visual markdown editor — the same Milkdown/Crepe setup the Secure Vault web UI uses: a WYSIWYG
 * surface whose document is markdown, per-block direction decided by node decorations, and code
 * blocks that never flip to RTL.
 */
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose, replaceAll } from '@milkdown/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const CONTAINER_NODES = new Set(['blockquote', 'bullet_list', 'ordered_list', 'table'])

/** Each block carries its own dir; code blocks are always LTR. */
const autoDirection = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mfm-auto-direction'),
      props: {
        decorations: (state) => {
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'code_block') {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { dir: 'ltr' }))
              return
            }
            if (!node.isTextblock && !CONTAINER_NODES.has(node.type.name)) return
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                dir: RTL_RE.test(node.textContent) ? 'rtl' : 'ltr'
              })
            )
          })
          return DecorationSet.create(state.doc, decorations)
        }
      }
    })
)

const LABELS = {
  placeholder: 'بنویس… «/» برای منو',
  groupText: 'متن',
  text: 'پاراگراف',
  h1: 'سرتیتر ۱',
  h2: 'سرتیتر ۲',
  h3: 'سرتیتر ۳',
  h4: 'سرتیتر ۴',
  h5: 'سرتیتر ۵',
  h6: 'سرتیتر ۶',
  quote: 'نقل‌قول',
  divider: 'خط جداکننده',
  groupList: 'فهرست',
  bulletList: 'فهرست نقطه‌ای',
  orderedList: 'فهرست شماره‌دار',
  taskList: 'فهرست کار',
  groupAdvanced: 'پیشرفته',
  image: 'تصویر',
  codeBlock: 'بلوک کد',
  table: 'جدول',
  math: 'فرمول',
  upload: 'بارگذاری',
  confirm: 'تأیید',
  caption: 'زیرنویس',
  url: 'نشانی',
  linkEdit: 'ویرایش پیوند',
  linkRemove: 'حذف پیوند',
  linkConfirm: 'تأیید',
  linkPlaceholder: 'نشانی پیوند…',
  previewToggle: 'نمایش کد',
  editCode: 'ویرایش کد',
  searchLanguage: 'جست‌وجوی زبان…',
  copyCode: 'رونوشت',
  noResult: 'چیزی پیدا نشد',
  bold: 'توپر',
  italic: 'ایتالیک',
  strikethrough: 'خط‌خورده',
  code: 'کد',
  latex: 'فرمول',
  link: 'پیوند'
}

const item = (label: string) => (label ? { label } : undefined)

export type VisualEditor = {
  getMarkdown(): string
  setMarkdown(md: string): void
  focus(): void
  destroy(): void
}

export async function createVisualEditor(
  root: HTMLElement,
  value: string,
  onChange: (md: string) => void
): Promise<VisualEditor> {
  root.dir = 'rtl'
  root.classList.add('visual-editor')

  const crepe = new Crepe({
    root,
    defaultValue: value,
    features: {
      [CrepeFeature.AI]: false,
      [CrepeFeature.TopBar]: false,
      // no KaTeX fonts offline → `$…$` stays plain text
      [CrepeFeature.Latex]: false
    },
    featureConfigs: {
      [CrepeFeature.Placeholder]: { text: LABELS.placeholder },
      [CrepeFeature.BlockEdit]: {
        textGroup: {
          label: LABELS.groupText,
          text: item(LABELS.text),
          h1: item(LABELS.h1),
          h2: item(LABELS.h2),
          h3: item(LABELS.h3),
          h4: item(LABELS.h4),
          h5: item(LABELS.h5),
          h6: item(LABELS.h6),
          quote: item(LABELS.quote),
          divider: item(LABELS.divider)
        },
        listGroup: {
          label: LABELS.groupList,
          bulletList: item(LABELS.bulletList),
          orderedList: item(LABELS.orderedList),
          taskList: item(LABELS.taskList)
        },
        advancedGroup: {
          label: LABELS.groupAdvanced,
          image: item(LABELS.image),
          codeBlock: item(LABELS.codeBlock),
          table: item(LABELS.table),
          math: item(LABELS.math)
        }
      },
      [CrepeFeature.ImageBlock]: {
        blockUploadButton: LABELS.upload,
        inlineUploadButton: LABELS.upload,
        blockConfirmButton: LABELS.confirm,
        inlineConfirmButton: LABELS.confirm,
        blockUploadPlaceholderText: LABELS.url,
        inlineUploadPlaceholderText: LABELS.url,
        blockCaptionPlaceholderText: LABELS.caption
      },
      [CrepeFeature.LinkTooltip]: {
        editButton: LABELS.linkEdit,
        removeButton: LABELS.linkRemove,
        confirmButton: LABELS.linkConfirm,
        inputPlaceholder: LABELS.linkPlaceholder
      },
      [CrepeFeature.CodeMirror]: {
        previewToggleText: (previewOnly: boolean) =>
          previewOnly ? LABELS.editCode : LABELS.previewToggle,
        searchPlaceholder: LABELS.searchLanguage,
        copyText: LABELS.copyCode,
        noResultText: LABELS.noResult
      },
      [CrepeFeature.Toolbar]: {
        boldLabel: LABELS.bold,
        italicLabel: LABELS.italic,
        strikethroughLabel: LABELS.strikethrough,
        codeLabel: LABELS.code,
        latexLabel: LABELS.latex,
        linkLabel: LABELS.link
      }
    }
  })

  crepe.editor.use(autoDirection)

  // registered before create(): a listener added afterwards never fires
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown, previous) => {
      if (markdown !== previous) onChange(markdown)
    })
  })

  await crepe.create()

  return {
    getMarkdown: () => crepe.getMarkdown(),
    setMarkdown: (md: string) => {
      // replaceAll dispatches without history, so the markdown listener stays quiet
      crepe.editor.action(replaceAll(md, true))
    },
    focus: () => root.querySelector<HTMLElement>('.ProseMirror')?.focus(),
    destroy: () => {
      root.querySelector('.milkdown')?.remove()
      void crepe.destroy()
    }
  }
}
