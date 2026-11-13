import {
  DOCX_BASE64,
  XLSX_BASE64,
  PPTX_BASE64,
  PDF_BASE64,
  FIG_BASE64,
  PNG_BASE64
} from './binaryTemplates.ts'

export type NewIconName =
  | 'folder'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'pdf'
  | 'palette'
  | 'layers'
  | 'image'
  | 'code'
  | 'terminal'
  | 'file'

export type NewTemplate = {
  id: string
  label: string
  ext: string
  defaultName: string
  icon: NewIconName
  content: string
}

export type NewCategory = {
  id: string
  label: string
  icon: NewIconName
  templates: NewTemplate[]
}

export const NEW_CATEGORIES: NewCategory[] = [
  {
    id: 'office',
    label: 'اسناد و اداری',
    icon: 'doc',
    templates: [
      {
        id: 'docx',
        label: 'سند ورد (.docx)',
        ext: '.docx',
        defaultName: 'document.docx',
        icon: 'doc',
        content: 'base64:' + DOCX_BASE64
      },
      {
        id: 'xlsx',
        label: 'کاربرگ اکسل (.xlsx)',
        ext: '.xlsx',
        defaultName: 'spreadsheet.xlsx',
        icon: 'sheet',
        content: 'base64:' + XLSX_BASE64
      },
      {
        id: 'pptx',
        label: 'ارائه و اسلاید (.pptx)',
        ext: '.pptx',
        defaultName: 'presentation.pptx',
        icon: 'slides',
        content: 'base64:' + PPTX_BASE64
      },
      {
        id: 'pdf',
        label: 'سند پی‌دی‌اف (.pdf)',
        ext: '.pdf',
        defaultName: 'document.pdf',
        icon: 'pdf',
        content: 'base64:' + PDF_BASE64
      },
      {
        id: 'md',
        label: 'یادداشت مارک‌داون (.md)',
        ext: '.md',
        defaultName: 'notes.md',
        icon: 'doc',
        content: '# \n\n'
      },
      {
        id: 'csv',
        label: 'جدول داده (.csv)',
        ext: '.csv',
        defaultName: 'data.csv',
        icon: 'sheet',
        content: 'id,title,value\n'
      },
      {
        id: 'txt',
        label: 'فایل متنی (.txt)',
        ext: '.txt',
        defaultName: 'document.txt',
        icon: 'doc',
        content: ''
      }
    ]
  },
  {
    id: 'design',
    label: 'طراحی و گرافیک',
    icon: 'palette',
    templates: [
      {
        id: 'svg',
        label: 'طرح برداری (.svg)',
        ext: '.svg',
        defaultName: 'design.svg',
        icon: 'palette',
        content:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">\n  <rect width="100%" height="100%" fill="#ffffff"/>\n</svg>\n'
      },
      {
        id: 'fig',
        label: 'طراحی رابط کاربری (.fig)',
        ext: '.fig',
        defaultName: 'design.fig',
        icon: 'layers',
        content: 'base64:' + FIG_BASE64
      },
      {
        id: 'png',
        label: 'بوم تصویر (.png)',
        ext: '.png',
        defaultName: 'image.png',
        icon: 'image',
        content: 'base64:' + PNG_BASE64
      }
    ]
  },
  {
    id: 'code',
    label: 'کد و وب',
    icon: 'code',
    templates: [
      {
        id: 'py',
        label: 'اسکریپت پایتون (.py)',
        ext: '.py',
        defaultName: 'script.py',
        icon: 'code',
        content: '#!/usr/bin/env python3\n'
      },
      {
        id: 'js',
        label: 'اسکریپت جاوااسکریپت (.js)',
        ext: '.js',
        defaultName: 'script.js',
        icon: 'code',
        content: '// JavaScript\n'
      },
      {
        id: 'ts',
        label: 'اسکریپت تایپ‌اسکریپت (.ts)',
        ext: '.ts',
        defaultName: 'script.ts',
        icon: 'code',
        content: '// TypeScript\n'
      },
      {
        id: 'html',
        label: 'صفحه وب (.html)',
        ext: '.html',
        defaultName: 'index.html',
        icon: 'code',
        content:
          '<!DOCTYPE html>\n<html lang="fa" dir="rtl">\n<head>\n  <meta charset="UTF-8">\n  <title>Document</title>\n</head>\n<body>\n  \n</body>\n</html>\n'
      },
      {
        id: 'css',
        label: 'شیوه‌نامه (.css)',
        ext: '.css',
        defaultName: 'style.css',
        icon: 'code',
        content: '/* Styles */\n'
      },
      {
        id: 'sh',
        label: 'اسکریپت بش (.sh)',
        ext: '.sh',
        defaultName: 'script.sh',
        icon: 'terminal',
        content: '#!/usr/bin/env bash\n\n'
      },
      {
        id: 'sql',
        label: 'اسکریپت اس‌کیوال (.sql)',
        ext: '.sql',
        defaultName: 'query.sql',
        icon: 'code',
        content: '-- SQL Query\n'
      }
    ]
  },
  {
    id: 'config',
    label: 'داده و پیکربندی',
    icon: 'code',
    templates: [
      {
        id: 'json',
        label: 'فایل داده (.json)',
        ext: '.json',
        defaultName: 'data.json',
        icon: 'code',
        content: '{\n  \n}\n'
      },
      {
        id: 'yaml',
        label: 'پیکربندی (.yaml)',
        ext: '.yaml',
        defaultName: 'config.yaml',
        icon: 'code',
        content: '# Configuration\n'
      },
      {
        id: 'env',
        label: 'متغیرهای محیطی (.env)',
        ext: '.env',
        defaultName: '.env',
        icon: 'code',
        content: '# Environment Variables\n'
      }
    ]
  }
]

export const BLANK_TEMPLATE: NewTemplate = {
  id: 'empty',
  label: 'فایل خالی…',
  ext: '',
  defaultName: 'new-file.txt',
  icon: 'file',
  content: ''
}

export const NEW_FILE_TEMPLATES: NewTemplate[] = [
  ...NEW_CATEGORIES.flatMap((c) => c.templates),
  BLANK_TEMPLATE
]
