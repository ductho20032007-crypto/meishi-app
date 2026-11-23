import { describe, it, expect } from 'vitest'
import { buildOrg } from '../../src/lib/orgChart.js'
import {
  companyInitial, companyTint, companyStats, filterCompanies, companyPeople, chartLevels, deptNodes, nodePath, deptLabel, withDeptAlias, WIDE
} from '../../src/lib/orgView.js'

const company = {
  id: 'c-abc', name: 'ABC商事株式会社', aliases: ['株式会社ABC'], deptAliases: {},
  placeholders: [
    { id: 'p-ito', name: '伊藤', title: '社長', rank: 1, deptPath: [], reportsTo: null },
    { id: 'p-sato', name: '佐藤', title: '担当', rank: 7, deptPath: ['営業本部', '第一営業部'], reportsTo: null }
  ]
}
const C = (id, name, rank, deptPath, extra = {}) => ({ id, name, rank, deptPath, companyId: 'c-abc', status: 'done', reportsTo: null, ...extra })
const cards = [
  C('suzuki', '鈴木 一郎', 3, ['営業本部']),
  C('tanaka', '田中 花子', 4, ['営業本部', '第一営業部']),
  C('yamada', '山田 太郎', 5, ['営業本部', '第一営業部']),
  C('ni', '二宮', 7, ['営業本部', '第二営業部']),
  C('kanri', '管理', 4, ['管理本部']),
  C('other', '他社', 4, [], { companyId: 'c-other', status: 'pending' }),
  C('pend', '', null, [], { status: 'pending' })
]
const org = () => buildOrg(companyPeople(company, cards), company.deptAliases)

describe('companies list helpers', () => {
  it('initial skips legal-form words', () => {
    expect(companyInitial('ABC商事株式会社')).toBe('A')
    expect(companyInitial('株式会社サクラシステム')).toBe('サ')
    expect(companyInitial('Công ty CP Minh Phát')).toBe('M')
    expect(companyInitial('công ty tnhh sông hồng')).toBe('S')
    expect(companyInitial('(株)ﾃｽﾄ')).toBe('テ')
    expect(companyInitial('')).toBe('?')
  })
  it('tint is stable per id', () => {
    expect(companyTint('c-abc')).toEqual(companyTint('c-abc'))
    expect(companyTint('c-abc')).toHaveProperty('tint')
  })
  it('stats count cards, placeholders and pending cards of the company only', () => {
    expect(companyStats(company, cards)).toEqual({ cards: 6, notMet: 2, pending: 1 })
    expect(companyStats({ id: 'c-x' }, cards)).toEqual({ cards: 0, notMet: 0, pending: 0 })
  })
  it('filters by name and aliases, insensitive to width, case, accents and spaces; sorts by name', () => {
    const list = [company, { id: 'c-2', name: 'Công ty CP Minh Phát', aliases: [] }, { id: 'c-3', name: 'ＸＹＺ株式会社', aliases: [] }]
    expect(filterCompanies(list, '').map(c => c.id)).toEqual(['c-abc', 'c-2', 'c-3'].sort((a, b) =>
      new Intl.Collator('ja').compare(list.find(x => x.id === a).name, list.find(x => x.id === b).name)))
    expect(filterCompanies(list, 'minh phat').map(c => c.id)).toEqual(['c-2'])
    expect(filterCompanies(list, 'MinhPhát').map(c => c.id)).toEqual(['c-2'])
    expect(filterCompanies(list, 'xyz').map(c => c.id)).toEqual(['c-3'])
    expect(filterCompanies(list, '株式会社abc').map(c => c.id)).toEqual(['c-abc'])
    expect(filterCompanies(list, 'nothing')).toEqual([])
  })
})

describe('org chart helpers', () => {
  it('company people = cards of the company + flagged placeholders', () => {
    const ps = companyPeople(company, cards)
    expect(ps.filter(p => p.placeholder).map(p => p.id)).toEqual(['p-ito', 'p-sato'])
    expect(ps.some(p => p.id === 'other')).toBe(false)
    expect(companyPeople(null, cards)).toEqual([])
  })
  it('levels with path highlight for a focused person', () => {
    const { root, levels, deepest } = chartLevels(org(), 'yamada')
    expect(root.head.id).toBe('p-ito')
    expect(root.onPath).toBe(true)
    expect(levels).toHaveLength(2)
    const l1 = levels[0].groups[0].nodes
    // the pending card without a department lands in the unknown-dept block (last)
    expect(l1.map(n => n.name)).toEqual(['営業本部', '管理本部', null])
    expect(l1[2]).toMatchObject({ unknown: true, total: 1 })
    expect(l1.find(n => n.name === '営業本部')).toMatchObject({ onPath: true, deepest: false, total: 5 })
    expect(l1.find(n => n.name === '管理本部')).toMatchObject({ onPath: false, deepest: false, total: 1 })
    expect(levels[1].groups).toHaveLength(1)
    expect(levels[1].groups[0]).toMatchObject({ parentName: '営業本部', onPath: true })
    const l2 = levels[1].groups[0].nodes
    expect(l2.map(n => n.name)).toEqual(['第一営業部', '第二営業部'])
    expect(l2[0]).toMatchObject({ onPath: true, deepest: true, total: 3 })
    expect(l2[1]).toMatchObject({ onPath: false, deepest: false })
    expect(deepest).toBe(l2[0].key)
    expect(levels.every(l => !l.wide)).toBe(true)
  })
  it('no focus -> nothing highlighted', () => {
    const { root, levels, deepest } = chartLevels(org())
    expect(root.onPath).toBe(false)
    expect(deepest).toBeNull()
    expect(levels.flatMap(l => l.groups.flatMap(g => g.nodes)).some(n => n.onPath || n.deepest)).toBe(false)
  })
  it('a row with more than WIDE boxes is wide; unknown-dept node is flagged', () => {
    const ps = ['A', 'B', 'C', 'D'].map((d, i) => ({ id: 'x' + i, name: 'x', rank: 4, deptPath: [d] }))
    ps.push({ id: 'u', name: 'u', rank: 5, deptPath: [] })
    const { levels } = chartLevels(buildOrg(ps))
    expect(levels[0].count).toBe(5)
    expect(levels[0].count > WIDE && levels[0].wide).toBe(true)
    expect(levels[0].groups[0].nodes.at(-1)).toMatchObject({ unknown: true, name: null })
  })
  it('focus on a root person highlights only the root', () => {
    const { root, levels } = chartLevels(org(), 'p-ito')
    expect(root.onPath).toBe(true)
    expect(levels.flatMap(l => l.groups.flatMap(g => g.nodes)).some(n => n.onPath)).toBe(false)
  })
  it('dept nodes / node path / dept label', () => {
    const o = org()
    const nodes = deptNodes(o)
    expect(nodes.map(n => n.label)).toEqual(['営業本部', '営業本部 › 第一営業部', '営業本部 › 第二営業部', '管理本部'])
    const first = nodes.find(n => n.name === '第一営業部')
    expect(nodePath(o, first.key)).toEqual(['営業本部', '第一営業部'])
    expect(nodePath(o, 'nope')).toEqual([])
    expect(deptLabel(o, 'yamada')).toBe('第一営業部')
    expect(deptLabel(o, 'p-ito')).toBe('')
  })
  it('dept aliases merge departments', () => {
    const o = buildOrg(companyPeople({ ...company, deptAliases: { 第二営業部: '第一営業部' } }, cards), { 第二営業部: '第一営業部' })
    const { levels } = chartLevels(o, 'ni')
    expect(levels[1].groups[0].nodes.map(n => n.name)).toEqual(['第一営業部'])
    expect(levels[1].groups[0].nodes[0]).toMatchObject({ total: 4, deepest: true })
  })
})

describe('withDeptAlias', () => {
  it('adds an alias and keeps the others', () => {
    expect(withDeptAlias({ a: 'b' }, '第二営業部', '第一営業部')).toEqual({ a: 'b', 第二営業部: '第一営業部' })
    expect(withDeptAlias(undefined, 'x', 'y')).toEqual({ x: 'y' })
  })
  it('earlier aliases pointing at the renamed department follow it', () => {
    expect(withDeptAlias({ 第1営業部: '第一営業部' }, '第一営業部', '営業一部')).toEqual({ 第1営業部: '営業一部', 第一営業部: '営業一部' })
  })
  it('renaming back to the raw name drops identity entries', () => {
    expect(withDeptAlias({ raw: 'X' }, 'X', 'raw')).toEqual({ X: 'raw' })
    expect(withDeptAlias({}, ' 営業部 ', '営業部')).toEqual({})
  })
})
