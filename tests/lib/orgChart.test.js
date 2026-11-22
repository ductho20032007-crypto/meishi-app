import { describe, it, expect } from 'vitest'
import { buildOrg } from '../../src/lib/orgChart.js'
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
