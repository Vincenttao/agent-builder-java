import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ProjectStore, WorkbenchError, validateFiles, type Role } from './projects.js';
type Item = {
    code: string;
    name: string;
    passed: boolean;
    detail: string;
};
export class ReviewManager {
    constructor(private store: ProjectStore) { store.db.exec('CREATE TABLE IF NOT EXISTS design_checks(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS design_candidates(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,record TEXT NOT NULL)'); }
    private owner(id: string, role: Role) { const p = this.store.get(id, role); if ((p.kind === 'template') !== (role === 'platform'))
        throw new WorkbenchError('FORBIDDEN', '当前身份只能只读查看此工程', 403); return p; }
    list(id: string, role: Role) { const p = this.store.get(id, role); return (this.store.db.prepare('SELECT record FROM design_checks WHERE projectId=? ORDER BY rowid DESC LIMIT 30').all(id) as {
        record: string;
    }[]).map(r => ({ ...JSON.parse(r.record), stale: JSON.parse(r.record).head !== p.head })); }
    candidates(id: string, role: Role) { const p = this.store.get(id, role); return (this.store.db.prepare('SELECT record FROM design_candidates WHERE projectId=? ORDER BY rowid DESC LIMIT 30').all(id) as {
        record: string;
    }[]).map(r => ({ ...JSON.parse(r.record), stale: JSON.parse(r.record).head !== p.head })); }
    check(id: string, role: Role) {
        const p = this.owner(id, role), files = this.store.snapshot(id, p.head), d = validateFiles(files), items: Item[] = [];
        const add = (code: string, name: string, passed: boolean, detail: string) => items.push({ code, name, passed, detail });
        add('DEFINITION', '定义与版本', true, '读取已保存Git提交；未保存草稿不参与检查');
        add('INSTRUCTIONS', '角色与行为', Boolean(files['instructions.md']?.trim()), 'instructions.md需要非空；语义一致性仍须审阅');
        add('BUSINESS_SCOPE', '业务范围', p.kind === 'template' || d.scope.own.length + d.scope.delegated.length > 0, p.kind === 'template' ? '空MOA模板不预置业务' : '应用需要自己负责或已委派的业务范围');
        let catalog: Record<string, any> = {};
        try {
            catalog = JSON.parse(files['adapters/operations.json'] ?? '{}');
            if (!catalog || Array.isArray(catalog) || typeof catalog !== 'object')
                throw Error();
            add('CATALOG', '操作目录JSON', true, '操作目录可解析');
        }
        catch {
            catalog={};
            add('CATALOG', '操作目录JSON', false, 'adapters/operations.json格式无效');
        }
        const agents = d.capabilities.filter((c: any) => c.type === 'agent'), ids = agents.map((c: any) => c.id), drafts = d.capabilities.filter((c: any) => c.status === 'draft' || !['agent'].includes(c.type));
        add('ASSEMBLY_READY', '能力装配状态', drafts.length === 0, drafts.length ? '存在未接线能力草稿；它们不是可执行工具' : '挂载能力没有待接线草稿');
        add('CONNECTIONS', '连接与引用', new Set(ids).size === ids.length && agents.every((c: any) => { try {
            const u = new URL(d.connections[c.connection]);
            return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
        }
        catch {
            return false;
        } }), '检查Agent连接引用和无凭据HTTP(S)地址，不验证远端可用性');
        add('HANDOFF', '接管与两层策略', !d.handoff.enabled || ids.includes(d.handoff.target), '启用时接管目标必须已挂载；最多A→B');
        for (const s of d.skills) {
            const ops = s.operations.map((name: string) => catalog[name]);
            add('SKILL_' + s.id, 'Skill ' + s.id, Boolean(files[s.file]?.startsWith('---')) && ops.length > 0 && ops.every((op: any) => op && ['SCRIPT', 'A2A'].includes(op.type) && (!op.resultScript || Boolean(files['skills/' + op.resultScript]))), '检查指导、操作引用及脚本存在；可用集合不是强制执行顺序');
            for (const name of s.operations) {
                const op = catalog[name];
                if (['redeem', 'transfer', 'purchase'].includes(name))
                    add('CONFIRM_' + name, '写操作确认 ' + name, op?.confirmationRequired === true, '写操作必须保留独立确认');
            }
            const diagram = files['skills/' + s.id + '/flow.json'];
            if (diagram) {
                try {
                    const f = JSON.parse(diagram), nodes = new Set(f.nodes.map((n: any) => n.id));
                    add('FLOW_' + s.id, 'Skill流程说明 ' + s.id, f.designOnly === true && f.nodes.length>0 && f.nodes.length<=30 && nodes.size===f.nodes.length && f.nodes.every((n:any)=>typeof n.id==='string'&&typeof n.label==='string'&&Number.isInteger(n.row)&&n.row>=0&&n.row<=30&&Number.isInteger(n.column)&&n.column>=0&&n.column<=2) && f.nodes.every((n: any) => !n.operation || s.operations.includes(n.operation)) && f.edges.every((e: any) => nodes.has(e.from) && nodes.has(e.to)), '流程说明仅作设计投影，节点引用必须有效');
                }
                catch {
                    add('FLOW_' + s.id, 'Skill流程说明 ' + s.id, false, 'flow.json结构无效');
                }
            }
        }
        try {
            const examples = JSON.parse(files['tests/routing-examples.json'] ?? '{"cases":[]}');
            add('ROUTING_EXAMPLES', '路由预期示例', Array.isArray(examples.cases) && new Set(examples.cases.map((c:any)=>c.query?.trim())).size===examples.cases.length && examples.cases.every((c: any) => typeof c.query === 'string' && c.query.trim() && (['CLARIFY', 'CONFLICT', 'CONTINUE'].includes(c.action) || c.action === 'SKILL' && d.skills.some(s => s.id === c.target) || c.action==='DELEGATE' && ids.includes(c.target) || c.action==='HANDOFF'&&d.handoff.enabled&&c.target===d.handoff.target&&ids.includes(c.target))), '用于设计预演和调试输入，不替代实际模型路由结果');
        }
        catch {
            add('ROUTING_EXAMPLES', '路由预期示例', false, 'tests/routing-examples.json无效');
        }
        const python = Object.fromEntries(Object.entries(files).filter(([n]) => n.endsWith('.py')));
        try {
            const errors = JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-c', 'import ast,json,sys\ne=[]\nfor name,code in json.load(sys.stdin).items():\n try: ast.parse(code,filename=name)\n except SyntaxError as x: e.append(name+":"+str(x.lineno)+":"+x.msg)\nprint(json.dumps(e))'], { input: JSON.stringify(python), encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } }));
            add('PYTHON_SYNTAX', 'Python语法', errors.length === 0, errors.join('；') || '只解析语法，不执行脚本');
        }
        catch {
            add('PYTHON_SYNTAX', 'Python语法', false, '未能完成本机语法检查');
        }
        add('SECRETS', '凭据排除', !Object.values(files).some(v => /sk-[a-zA-Z0-9_-]{20,}/.test(v)), '工程中不允许模型Key；凭据来自外部配置');
        const report = { id: randomUUID(), projectId: id, head: p.head, createdAt: new Date().toISOString(), passed: items.every(i => i.passed), business: 'not-verified', kind: 'structural-only', items };
        this.store.db.prepare('INSERT INTO design_checks VALUES(?,?,?)').run(report.id, id, JSON.stringify(report));
        return report;
    }
    candidate(id: string, role: Role, checkId: string) { const p = this.owner(id, role); if (p.kind !== 'application')
        throw new WorkbenchError('INVALID_PROJECT', '请在应用中固定技术候选'); const report = this.list(id, role).find(r => r.id === checkId); if (!report?.passed || report.head !== p.head)
        throw new WorkbenchError('CHECK_REQUIRED', '先对当前保存版本完成结构检查，旧报告不能固定新候选', 409); const previous = this.candidates(id, role).find(c => c.head === p.head && c.checkId === checkId); if (previous)
        return previous; const value = { id: randomUUID(), projectId: id, head: p.head, checkId, createdAt: new Date().toISOString(), verification: 'structural-only', business: 'not-verified', publication: 'not-published' }; this.store.db.prepare('INSERT INTO design_candidates VALUES(?,?,?)').run(value.id, id, JSON.stringify(value)); return value; }
    activity(id: string, role: Role) { this.store.get(id, role); const parts = this.store.git(id, ['log', '-24', '--format=%H%x00%aI%x00%s%x00']).split('\0'), events: any[] = []; for (let n = 0; n + 2 < parts.length; n += 3) {
        if (parts[n].trim())
            events.push({ kind: 'commit', head: parts[n].trim(), createdAt: parts[n + 1], title: parts[n + 2] });
    } for (const report of this.list(id, role))
        events.push({ kind: 'check', head: report.head, createdAt: report.createdAt, title: report.passed ? '结构检查通过' : '结构检查有问题' }); return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
}
