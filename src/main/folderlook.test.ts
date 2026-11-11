import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDesktopIniIcon, parseDirectoryIcon } from './folderlook.ts'

test('parseDirectoryIcon: the KDE .directory Icon key', () => {
  assert.equal(parseDirectoryIcon('[Desktop Entry]\nIcon=folder-red\n'), 'folder-red')
  assert.equal(parseDirectoryIcon('[Desktop Entry]\nIcon=/home/x/my.svg\n'), '/home/x/my.svg')
  assert.equal(parseDirectoryIcon('[Desktop Entry]\nComment=\nIcon=Folder\n'), 'Folder')
  assert.equal(parseDirectoryIcon(''), '', 'an empty file has no icon')
  assert.equal(parseDirectoryIcon('[Desktop Entry]\nSortOrder=4\n'), '')
})

test('parseDesktopIniIcon: IconResource with an index and quotes', () => {
  const ini = '[.ShellClassInfo]\nInfoTip=x\nIconResource=C:\\icons\\star.ico,0\n'
  assert.equal(parseDesktopIniIcon(ini), 'C:\\icons\\star.ico')
  assert.equal(parseDesktopIniIcon('[.ShellClassInfo]\nIconResource="D:\\a b\\i.ico",-3\n'), 'D:\\a b\\i.ico')
  assert.equal(parseDesktopIniIcon('[.ShellClassInfo]\nIconFile=pic.png\nIconIndex=2\n'), 'pic.png')
  assert.equal(parseDesktopIniIcon('[.ShellClassInfo]\nInfoTip=only text\n'), '')
})
