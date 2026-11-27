import { describe, it, expect } from 'vitest'
import { buildOrg, compareDeptName } from '../../src/lib/orgChart.js'
const P = (id, name, rank, deptPath = [], extra = {}) => ({ id, name, rank, deptPath, reportsTo: null, ...extra })
const people = () => [
  P('ito', '伊藤', 1, [], { placeholder: true }),
  P('suzuki', '鈴木', 3, ['営業本部']),
  P('tanaka', '田中', 4, ['営業本部', '第一営業部']),
  P('yamada', '山田', 5, ['営業本部', '第一営業部']),
  P('sato', '佐藤', 7, ['営業本部', '第一営業部'], { placeholder: true }),
  P('kanri', '管理', 5, ['管理本部']),
  P('ni', '二', 7, ['営業本部', '第二営業部'])
]
describe('buildOrg', () => {
  it('builds dept tree with heads and totals', () => {
    const org = buildOrg(people())
    expect(org.root.people.map(p => p.id)).toEqual(['ito'])
    const eigyo = org.root.children.find(c => c.name === '営業本部')
    expect(eigyo.head.id).toBe('suzuki')
    expect(eigyo.total).toBe(5)
    expect(eigyo.children.map(c => c.name)).toEqual(['第一営業部', '第二営業部'])
  })
  it('reporting chain top-down', () => {
    expect(buildOrg(people()).chain('yamada').map(p => p.id)).toEqual(['ito', 'suzuki', 'tanaka', 'yamada'])
  })
  it('peers = same deepest dept, excluding self', () => {
    expect(buildOrg(people()).peers('yamada').map(p => p.id)).toEqual(['tanaka', 'sato'])
  })
  it('explicit reportsTo wins', () => {
    const ps = people(); ps.find(p => p.id === 'yamada').reportsTo = 'suzuki'
    expect(buildOrg(ps).chain('yamada').map(p => p.id)).toEqual(['ito', 'suzuki', 'yamada'])
  })
  it('ignores reportsTo cycles for every member', () => {
    const ps = people()
    ps.find(p => p.id === 'yamada').reportsTo = 'tanaka'
    ps.find(p => p.id === 'tanaka').reportsTo = 'yamada'
    const org = buildOrg(ps)
    expect(org.chain('yamada').map(p => p.id)).toEqual(['ito', 'suzuki', 'tanaka', 'yamada'])
    expect(org.chain('tanaka').map(p => p.id)).toEqual(['ito', 'suzuki', 'tanaka'])
    expect(org.bossOf('tanaka').id).toBe('suzuki')
  })
  it('ignores reportsTo pointing at a subordinate', () => {
    const ps = people(); ps.find(p => p.id === 'suzuki').reportsTo = 'yamada'
    expect(buildOrg(ps).chain('suzuki').map(p => p.id)).toEqual(['ito', 'suzuki'])
  })
  it('missing rank is 7: unknown node, never root head', () => {
    const org = buildOrg([P('u', 'U', undefined, []), P('v', 'V', 5, ['A'])])
    expect(org.nodeOf('u').unknown).toBe(true)
    expect(org.root.head).toBeNull()
  })
  it('merges dept segments that normalise equal', () => {
    const org = buildOrg([P('a', 'a', 5, ['第一営業部']), P('b', 'b', 5, ['第一営業部 ']), P('c', 'c', 5, ['ＩＴ部']), P('d', 'd', 5, ['IT部'])])
    expect(org.root.children).toHaveLength(2)
    expect(org.nodeOf('a')).toBe(org.nodeOf('b'))
    expect(org.nodeOf('c')).toBe(org.nodeOf('d'))
    expect(org.nodeOf('a').name).toBe('第一営業部')
  })
  it('unknown node head is not an inferred boss', () => {
    const org = buildOrg([P('ito', 'I', 1, []), P('u', 'U', 4, []), P('w', 'W', 6, [])])
    expect(org.nodeOf('u').unknown).toBe(true)
    expect(org.chain('w').map(p => p.id)).toEqual(['ito', 'w'])
  })
  it('segments containing / do not collide', () => {
    const org = buildOrg([P('a', 'a', 5, ['A/B']), P('b', 'b', 5, ['A', 'B'])])
    expect(org.nodeOf('a')).not.toBe(org.nodeOf('b'))
  })
  it('applies deptAliases', () => {
    const ps = [...people(), P('z', 'Z', 7, ['営業本部', '第1営業部'])]
    const org = buildOrg(ps, { '第1営業部': '第一営業部' })
    expect(org.nodeOf('z').name).toBe('第一営業部')
  })
  it('people without dept and rank>=3 go to unknown node', () => {
    const org = buildOrg([P('u', 'U', 5, [])])
    expect(org.nodeOf('u').unknown).toBe(true)
  })
  it('pathTo returns node keys from root to person node', () => {
    expect(buildOrg(people()).pathTo('yamada')).toEqual(['営業本部', '営業本部第一営業部'])
  })
})

describe('path-scoped deptAliases', () => {
  const ps = () => [
    P('a', 'A', 5, ['営業本部', '第一部']),
    P('b', 'B', 5, ['管理本部', '第一部']),
    P('c', 'C', 5, ['営業本部', '第1部'])
  ]
  it('a path-qualified key renames only that branch', () => {
    const org = buildOrg(ps(), { '営業本部/第一部': '営業一部' })
    expect(org.nodeOf('a').name).toBe('営業一部')
    expect(org.nodeOf('b').name).toBe('第一部')
  })
  it('a top-level path key starts with /, keys are normalised (width / spaces)', () => {
    const org = buildOrg(ps(), { '/営業本部': 'セールス', '営業本部 / 第一部': 'X' })
    expect(org.nodeOf('a').parent.name).toBe('セールス')
    expect(org.nodeOf('a').name).toBe('X')
    expect(org.nodeOf('b').parent.name).toBe('管理本部')
  })
  it('the path key uses the ORIGINAL parent path, even when the parent is renamed', () => {
    const org = buildOrg(ps(), { '/営業本部': 'セールス', '営業本部/第一部': '一部' })
    expect(org.nodeOf('a').name).toBe('一部')
  })
  it('legacy bare aliases still apply everywhere; the path key wins over the bare one', () => {
    let org = buildOrg(ps(), { 第一部: '一課' })
    expect([org.nodeOf('a').name, org.nodeOf('b').name]).toEqual(['一課', '一課'])
    org = buildOrg(ps(), { 第一部: '一課', '管理本部/第一部': '総務' })
    expect([org.nodeOf('a').name, org.nodeOf('b').name]).toEqual(['一課', '総務'])
  })
  it('nodes list the original path keys that land in them (sources)', () => {
    const org = buildOrg(ps(), { '営業本部/第1部': '第一部' })
    expect(org.nodeOf('a')).toBe(org.nodeOf('c'))
    expect(org.nodeOf('a').sources.sort()).toEqual(['営業本部/第1部', '営業本部/第一部'])
    expect(org.nodeOf('a').parent.sources).toEqual(['/営業本部'])
  })
  it('a / inside a segment is escaped in path keys', () => {
    const org = buildOrg([P('s', 'S', 5, ['A/B'])])
    expect(org.nodeOf('s').sources).toEqual(['/A%2FB'])
    expect(buildOrg([P('s', 'S', 5, ['A/B'])], { '/A%2FB': 'Z' }).nodeOf('s').name).toBe('Z')
  })
})

describe('department sibling order', () => {
  it('understands kanji numerals and digits', () => {
    expect(['第十部', '第三部', '第一部', '第二部'].sort(compareDeptName)).toEqual(['第一部', '第二部', '第三部', '第十部'])
    expect(['10課', '2課', '1課'].sort(compareDeptName)).toEqual(['1課', '2課', '10課'])
    expect(['第二十一部', '第二十部', '第十二部'].sort(compareDeptName)).toEqual(['第十二部', '第二十部', '第二十一部'])
    expect(['第１部', '第2部'].sort(compareDeptName)).toEqual(['第１部', '第2部'])
    expect(['B', 'A', '営業部', '経理部'].sort(compareDeptName)).toEqual(['A', 'B', '営業部', '経理部'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    expect(compareDeptName('第一部', '第一部')).toBe(0)
  })
  it('buildOrg sorts children with it', () => {
    const org = buildOrg(['第十部', '第三部', '第一部'].map((d, i) => P('x' + i, 'x', 5, [d])))
    expect(org.root.children.map(c => c.name)).toEqual(['第一部', '第三部', '第十部'])
  })
})
