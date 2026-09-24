"""The code graph growing from the first saved file to today, as a page.

    python scripts/graph-growth.py          # writes graphify-out/growth.html
    python scripts/graph-growth.py --open   # and opens it
    python scripts/graph-growth.py --cached # only what is already rebuilt (a preview)

Rebuilds graphify's code graph (AST only: local, no LLM) at every stage of
the project and animates between them, so code that was later deleted, code
added to files that already existed, and connections that came and went all
show -- not just today's graph revealed in order.

The stages, one a minute wherever something changed:
  - Before git: the week before the first commit, rebuilt from VS Code's
    local history (every file save is kept there with its time).
  - Git: every commit along the first-parent line (the last, where two share
    a minute). Git records nothing between commits, so this is as fine as
    its history goes.
And first, an empty folder, so it grows from nothing.

Stages are rebuilt in work folders outside the repo (graphify skips anything
the repo's .gitignore covers, and graphify-out/ is ignored), six at a time,
and each result is cached there as its own file, so a second run only
rebuilds what it hasn't seen. graphify now and then crashes on start or on
exit; a stage whose graph didn't come out is retried.
"""

import colorsys, html, io, json, math, os, random, re, shutil, subprocess, sys, tarfile, threading, time, urllib.parse, webbrowser
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx

REPO = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.cache') / 'atrium-graph-growth'
STAGES = WORK / 'stages'  # one JSON per rebuilt stage
LANES = 6                 # stages rebuilt side by side, each in WORK/tree<n>
OUT = REPO / 'graphify-out' / 'growth.html'
TEMPLATE = Path(__file__).with_suffix('.html')


def git(*args: str) -> str:
    return subprocess.run(['git', *args], cwd=REPO, capture_output=True, text=True,
                          encoding='utf-8', check=True).stdout


def git_stages() -> list[dict]:
    """Every commit, oldest first -- the last of any that share a minute."""
    by_minute: dict[int, dict] = {}
    for line in git('log', '--first-parent', '--reverse', '--format=%H%x09%ct%x09%s').splitlines():
        sha, ct, subject = line.split('\t', 2)
        by_minute[int(ct) // 60] = {'key': 'git:' + sha, 'sha': sha, 't': int(ct), 'note': subject}
    return list(by_minute.values())


def vscode_stages(before: int) -> list[dict]:
    """The project as VS Code saved it, one stage per minute with saves, before `before`."""
    history = Path(os.environ.get('APPDATA', '')) / 'Code' / 'User' / 'History'
    if not history.is_dir():
        return []
    root = REPO.as_posix().lower().rstrip('/') + '/'
    saves = []  # (ms, relative path, file holding that version)
    for entries in history.glob('*/entries.json'):
        try:
            meta = json.loads(entries.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        path = urllib.parse.unquote(meta.get('resource', '')).removeprefix('file:///').removeprefix('file://')
        if not path.lower().startswith(root):
            continue
        rel = path[len(root):]
        # Never the environment files, and nothing that isn't the project's own.
        if rel.split('/')[-1].startswith('.env') or rel.startswith(('node_modules/', 'dist/', '.git/')):
            continue
        for e in meta.get('entries', []):
            if e.get('timestamp', 0) < before * 1000 and (entries.parent / e['id']).is_file():
                saves.append((e['timestamp'], rel, entries.parent / e['id']))
    saves.sort()
    stages: dict[int, dict] = {}
    latest: dict[str, Path] = {}
    for ms, rel, blob in saves:
        latest[rel] = blob
        stages[ms // 60_000] = {'key': f'vscode:{ms}', 't': ms // 1000, 'files': dict(latest),
                        'note': 'before git: rebuilt from VS Code\'s saved versions'}
    return list(stages.values())


def materialise(stage: dict, tree: Path) -> None:
    """Puts the stage's files in `tree`, keeping graphify's cache from the last one."""
    tree.mkdir(parents=True, exist_ok=True)
    for child in tree.iterdir():
        if child.name != 'graphify-out':
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    if 'sha' in stage:
        archive = subprocess.run(['git', 'archive', stage['sha']], cwd=REPO, capture_output=True, check=True).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(tree, filter='data')
    else:
        for rel, blob in stage['files'].items():
            dest = tree / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(blob, dest)


def extract(stage: dict, tree: Path) -> dict:
    materialise(stage, tree)
    # Four extraction workers each, so six lanes don't all ask for every core at once.
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'GRAPHIFY_FORCE': '1', 'GRAPHIFY_NO_TIPS': '1', 'GRAPHIFY_MAX_WORKERS': '4'}
    graph = tree / 'graphify-out' / 'graph.json'
    for attempt in range(15):
        graph.unlink(missing_ok=True)
        run = subprocess.run([sys.executable, '-m', 'graphify', 'update', str(tree), '--no-cluster'],
                             capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
        # A crash on the way out can come after the graph is written; this
        # attempt's graph (the old one was removed above) is good if it reads.
        try:
            g = json.loads(graph.read_text(encoding='utf-8'))
            break
        except (OSError, ValueError):
            print(f'    graphify exited {run.returncode}, retrying', flush=True)
    else:
        raise RuntimeError(f'graphify kept failing on {stage["key"]}')
    nodes = {n['id']: [n.get('label', ''), str(n.get('source_file') or '').replace('\\', '/')] for n in g['nodes']}
    edges = sorted({tuple(sorted((l['source'], l['target']))) for l in g['links']
                    if l['source'] != l['target'] and l['source'] in nodes and l['target'] in nodes})
    return {'nodes': nodes, 'edges': [list(e) for e in edges]}


def refresh_graphify() -> None:
    """Brings the repo's own graphify graph up to date, so the layout read from
    it below is today's. Retried like the stages; a failure only means the
    layout comes from the graph as it was."""
    page = REPO / 'graphify-out' / 'graph.html'
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'GRAPHIFY_NO_TIPS': '1'}
    for _ in range(15):
        began = time.time()
        subprocess.run([sys.executable, '-m', 'graphify', 'update', str(REPO)], capture_output=True, env=env)
        if page.is_file() and page.stat().st_mtime >= began:
            return
    print('  (could not refresh graphify; using its graph as it was)')


BROWSERS = [
    shutil.which('msedge'), shutil.which('chrome'), shutil.which('chromium'), shutil.which('google-chrome'),
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

# Appended to a copy of graphify's page: once its physics has settled, write
# where every node ended up, and in what colour, into the page for --dump-dom.
PROBE = """<script>(function () {
  const dump = () => {
    if (document.getElementById('atrium-layout')) return
    const at = network.getPositions()
    const out = nodesDS.get().map(n => [n.id, at[n.id].x, at[n.id].y,
      typeof n.color === 'string' ? n.color : (n.color && n.color.background) || ''])
    const pre = document.createElement('pre'); pre.id = 'atrium-layout'; pre.textContent = JSON.stringify(out)
    document.body.append(pre)
  }
  network.once('stabilizationIterationsDone', () => setTimeout(dump, 0))
  setTimeout(dump, 60000)
})()</script>"""


def graphify_layout() -> dict[str, tuple[float, float, str]]:
    """Where graphify's own page puts each of today's nodes, and its colour.

    graph.html stores no positions: vis-network settles them in the browser
    every time the page opens, from the same spiral start and the same 200
    steps, so they land the same way each time. Settled here by that page
    itself, in a headless browser, and read back -- the one way to match it
    exactly.
    """
    page = REPO / 'graphify-out' / 'graph.html'
    browser = next((b for b in BROWSERS if b and Path(b).is_file()), None)
    if not page.is_file() or not browser:
        return {}
    probe = WORK / 'graph-probe.html'
    probe.write_text(page.read_text(encoding='utf-8').replace('</body>', PROBE + '</body>'), encoding='utf-8')
    try:
        run = subprocess.run([browser, '--headless=new', '--disable-gpu', '--virtual-time-budget=120000',
                              '--dump-dom', probe.as_uri()],
                             capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
    except subprocess.TimeoutExpired:
        return {}
    found = re.search(r'<pre id="atrium-layout">(.*?)</pre>', run.stdout, re.S)
    if not found:
        return {}
    return {n: (x, y, c) for n, x, y, c in json.loads(html.unescape(found.group(1)))}


def place(union: nx.Graph, ids: list[str]) -> tuple[dict, dict]:
    """A position and a colour for every node that ever existed.

    What exists today goes exactly where graphify's page puts it, in its
    colour. Code that was deleted before today goes beside what it was
    connected to (or, failing that, the rest of its file), in their colour.
    Without a browser to read graphify's layout, the whole history is laid
    out here instead.
    """
    layout = graphify_layout()
    if not layout:
        print('  (graphify\'s layout unavailable; laying out here)')
        pos = nx.forceatlas2_layout(union, seed=7, max_iter=600, linlog=True, scaling_ratio=2.0, strong_gravity=True)
        colour = {}
        for c, members in enumerate(sorted(nx.community.louvain_communities(union, seed=7), key=len, reverse=True)):
            r, g, b = colorsys.hls_to_rgb((c * 0.381966) % 1, 0.62, 0.72)
            for m in members:
                colour[m] = f'#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}'
        return pos, colour

    pos, colour = {}, {}
    for i, n in enumerate(ids):
        if n in layout:
            pos[i] = layout[n][:2]
            colour[i] = layout[n][2] or '#8b8b98'
    spread = max(max(abs(p[0]) for p in pos.values()), max(abs(p[1]) for p in pos.values())) or 1
    rng = random.Random(7)
    # Everything placed at one anchor goes round it in a sunflower spiral,
    # one dot's width apart. Scattered at random, the dozens of pieces of a
    # deleted file all landed in the same spot and read as one solid blob.
    around: dict[tuple, int] = defaultdict(int)

    def near_anchor(x: float, y: float) -> tuple[float, float]:
        key = (round(x / spread, 2), round(y / spread, 2))
        k = around[key]
        around[key] += 1
        r, a = spread * 0.016 * math.sqrt(k + 1), k * 2.39996
        return x + r * math.cos(a), y + r * math.sin(a)

    def settle(near_of) -> None:
        progress = True
        while progress:
            progress = False
            for i in range(len(ids)):
                if i in pos:
                    continue
                near = [j for j in near_of(i) if j in pos]
                if not near:
                    continue
                pos[i] = near_anchor(sum(pos[j][0] for j in near) / len(near), sum(pos[j][1] for j in near) / len(near))
                colour[i] = max(set(colour[j] for j in near), key=[colour[j] for j in near].count)
                progress = True

    settle(lambda i: union.neighbors(i))
    by_file = defaultdict(list)
    for i, n in enumerate(ids):
        by_file[FILE_OF[n]].append(i)
    settle(lambda i: by_file[FILE_OF[ids[i]]] if FILE_OF[ids[i]] else [])
    for i in range(len(ids)):
        if i not in pos:
            pos[i] = (rng.uniform(-0.3, 0.3) * spread, rng.uniform(-0.3, 0.3) * spread)
            colour[i] = '#8b8b98'
    return pos, colour


FILE_OF: dict[str, str] = {}
KIND: dict[str, int] = {}      # 0 code (graphify's), 1 other file, 2 folder
TREE_EDGES: set[tuple] = set()  # folder to folder, folder to file, file to its code


def with_tree(stage: dict, g: dict) -> dict:
    """The stage's code graph plus its files and folders, the way Gource
    draws them: every file under its folder, every folder under its parent.

    A file graphify reads is its own file node; the rest -- pictures, fonts,
    docs -- are added here, so a deleted folder or file shows going too, not
    only deleted code.
    """
    paths = git('ls-tree', '-r', '--name-only', stage['sha']).splitlines() if 'sha' in stage else list(stage['files'])
    nodes = dict(g['nodes'])
    edges = {tuple(e) for e in g['edges']}
    own_file = {f: n for n, (label, f) in g['nodes'].items() if f and label == f.split('/')[-1]}
    code_of = defaultdict(list)
    for n, (_, f) in g['nodes'].items():
        if f:
            code_of[f].append(n)

    def link(a: str, b: str) -> None:
        e = tuple(sorted((a, b)))
        edges.add(e)
        TREE_EDGES.add(e)

    for path in paths:
        node = own_file.get(path)
        if not node:
            node = 'file:' + path
            nodes[node] = [path.split('/')[-1], path]
            KIND[node] = 1
            for code in code_of.get(path, []):
                link(node, code)
        parts = path.split('/')
        for depth in range(len(parts) - 1, -1, -1):
            folder = '/'.join(parts[:depth])
            parent = 'dir:' + folder
            known = parent in nodes
            if not known:
                nodes[parent] = [(parts[depth - 1] if depth else REPO.name) + '/', folder]
                KIND[parent] = 2
            link(parent, node)
            if known:
                break
            node = parent
    return {'nodes': nodes, 'edges': [list(e) for e in edges]}


def intervals(present: list[bool]) -> list[list[int]]:
    """[[start, end), ...] runs of True."""
    runs, start = [], None
    for i, p in enumerate(present + [False]):
        if p and start is None:
            start = i
        elif not p and start is not None:
            runs.append([start, i])
            start = None
    return runs


def main() -> None:
    first_commit = int(git('log', '--reverse', '--format=%ct').split()[0])
    stages = vscode_stages(first_commit) + git_stages()
    STAGES.mkdir(parents=True, exist_ok=True)
    stored = lambda s: STAGES / (s['key'].replace(':', '_') + '.json')
    # --cached: a quick look at what's been rebuilt so far, rebuilding nothing.
    if '--cached' in sys.argv:
        stages = [s for s in stages if stored(s).is_file()]
    todo = [s for s in stages if not stored(s).is_file()]
    print(f'{len(stages)} stages ({len(stages) - len(todo)} cached), rebuilding {len(todo)}', flush=True)

    # Each lane takes a run of consecutive stages, so its graphify cache keeps
    # being useful from one to the next.
    lock, done = threading.Lock(), [0]

    def lane(k: int) -> None:
        tree = WORK / f'tree{k}'
        for stage in todo[k * len(todo) // LANES:(k + 1) * len(todo) // LANES]:
            began = time.time()
            graph = extract(stage, tree)
            # Written aside and swapped in, so a stopped run can't leave half a file.
            stored(stage).with_suffix('.tmp').write_text(json.dumps(graph), encoding='utf-8')
            os.replace(stored(stage).with_suffix('.tmp'), stored(stage))
            with lock:
                done[0] += 1
                when = datetime.fromtimestamp(stage['t'], timezone.utc).strftime('%Y-%m-%d %H:%M')
                print(f'  [{done[0]}/{len(todo)}] {when}  {len(graph["nodes"])} nodes  ({time.time() - began:.0f}s)', flush=True)

    with ThreadPoolExecutor(LANES) as pool:
        futures = [pool.submit(lane, k) for k in range(LANES)]
    for f in futures:
        if f.exception():
            raise f.exception()

    graphs = [with_tree(s, json.loads(stored(s).read_text(encoding='utf-8'))) for s in stages]
    # It starts from nothing: an empty folder, a minute before the first save.
    stages = [{'t': stages[0]['t'] - 60, 'note': 'an empty folder'}] + stages
    graphs = [{'nodes': {}, 'edges': []}] + graphs
    # Every node and connection that ever existed, and the stages each was in.
    ids = sorted({n for g in graphs for n in g['nodes']})
    at = {n: i for i, n in enumerate(ids)}
    info = {}
    for g in graphs:
        info.update(g['nodes'])  # the newest label and file wins
    FILE_OF.update({n: info[n][1] for n in ids})
    print("refreshing graphify's own graph, to borrow its layout", flush=True)
    refresh_graphify()
    node_sets = [set(g['nodes']) for g in graphs]
    edge_sets = [{tuple(e) for e in g['edges']} for g in graphs]
    all_edges = sorted(set().union(*edge_sets))

    union = nx.Graph()
    union.add_nodes_from(range(len(ids)))
    union.add_edges_from((at[a], at[b]) for a, b in all_edges)
    pos, colour = place(union, ids)
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    half = max(max(xs) - min(xs), max(ys) - min(ys)) / 2 or 1

    data = {
        'stages': [{'t': s['t'], 'note': s['note'], 'git': 'sha' in s} for s in stages],
        'nodes': [[round((pos[i][0] - cx) / half, 4), round((pos[i][1] - cy) / half, 4), colour[i],
                   union.degree(i), info[n][0], info[n][1], KIND.get(n, 0), intervals([n in ns for ns in node_sets])]
                  for i, n in enumerate(ids)],
        'edges': [[at[a], at[b], int((a, b) in TREE_EDGES), intervals([(a, b) in es for es in edge_sets])]
                  for a, b in all_edges],
    }
    html = TEMPLATE.read_text(encoding='utf-8').replace('/*DATA*/null', json.dumps(data, separators=(',', ':')))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print(f'wrote {OUT.relative_to(REPO)}: {len(ids)} nodes and {len(all_edges)} connections that ever existed, '
          f'{len(stages)} stages')
    if '--open' in sys.argv:
        webbrowser.open(OUT.as_uri())


if __name__ == '__main__':
    main()
