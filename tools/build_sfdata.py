#!/usr/bin/env python3
"""Builds js/data/streets.js (main street network) and js/data/hoods.js (neighbourhood grid) from DataSF.
Sources:
  Streets: https://data.sf.gov/resource/3psu-pn9h.json (Streets - Active and Retired), classcode 1-4, active
  Neighbourhoods: https://data.sfgov.org/resource/j2bu-swwd.geojson (Analysis Neighborhoods)
Coordinates are metres, x east, z south, origin 37.77N 122.44W (same as geo.js)."""
import json, math, collections
LON0, LAT0, MX, MZ = -122.44, 37.77, 88000.0, 111000.0
def ll(p): return ((p[0]-LON0)*MX, -(p[1]-LAT0)*MZ)

# ---------------- streets ----------------
raw = json.load(open('/tmp/streets_raw.json'))
TYPE = {'1': 'highway', '2': 'boulevard', '3': 'avenue', '4': 'street'}
groups = collections.defaultdict(list)
for r in raw:
    if not r.get('line'): continue
    name = r.get('streetname', '?')
    pts = [ll(p) for p in r['line']['coordinates']]
    if len(pts) < 2: continue
    groups[(name, r['classcode'])].append(pts)
def key(p): return (round(p[0]/3), round(p[1]/3))
def chain(segs):
    segs = [list(s) for s in segs]; out = []
    ends = collections.defaultdict(list)
    for k, s in enumerate(segs): ends[key(s[0])].append(k); ends[key(s[-1])].append(k)
    used = [False]*len(segs)
    for k in range(len(segs)):
        if used[k]: continue
        used[k] = True; line = segs[k][:]
        for rev in (False, True):
            while True:
                e = key(line[-1]); nxt = None
                for c in ends[e]:
                    if not used[c]: nxt = c; break
                if nxt is None: break
                used[nxt] = True; s = segs[nxt]
                if key(s[0]) != e: s = s[::-1]
                line += s[1:]
            line.reverse()
        out.append(line)
    return out
def simplify(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dz = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dz) or 1e-9
    best, bi = 0, 0
    for i in range(1, len(pts)-1):
        d = abs((pts[i][0]-a[0])*dz - (pts[i][1]-a[1])*dx)/L
        if d > best: best, bi = d, i
    if best <= tol: return [a, b]
    l = simplify(pts[:bi+1], tol); r = simplify(pts[bi:], tol)
    return l[:-1] + r
lines = []
for (name, cc), segs in groups.items():
    for line in chain(segs):
        line = simplify(line, 5.0)
        L = sum(math.hypot(line[i+1][0]-line[i][0], line[i+1][1]-line[i][1]) for i in range(len(line)-1))
        if L < 60: continue
        lines.append((int(cc), name.title(), [round(v) for p in line for v in p], L))
lines.sort(key=lambda l: (l[0], -l[3]))
with open('js/data/streets.js', 'w') as f:
    f.write('// Main streets of San Francisco (freeways, highways, arterials, collectors). Source: DataSF "Streets - Active and Retired".\n')
    f.write('// [class, name, [x,z,...]] in metres; class 1 freeway, 2 highway, 3 arterial, 4 collector.\n')
    f.write('export const STREETS = ' + json.dumps([[l[0], l[1], l[2]] for l in lines], separators=(',', ':')) + ';\n')
print('streets', len(lines), 'km', round(sum(l[3] for l in lines)/1000), {c: sum(1 for l in lines if l[0] == c) for c in (1, 2, 3, 4)})

# ---------------- neighbourhoods ----------------
gj = json.load(open('/tmp/j2bu-swwd.geojson'))
RES = 96; X0, Z0, W, H = -9120, -9120, 180, 170
names = ['']; polys = []
for ft in sorted(gj['features'], key=lambda f: f['properties']['nhood']):
    names.append(ft['properties']['nhood'])
    g = ft['geometry']; ps = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    polys.append([[ll(p) for p in poly[0]] for poly in ps])
def inside(x, z, ring):
    c = False; n = len(ring); j = n-1
    for i in range(n):
        xi, zi = ring[i]; xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj-xi)*(z-zi)/(zj-zi)+xi: c = not c
        j = i
    return c
grid = [0]*(W*H); cen = [[0, 0, 0] for _ in names]
boxes = [[(min(p[0] for p in r), min(p[1] for p in r), max(p[0] for p in r), max(p[1] for p in r)) for r in rings] for rings in polys]
for j in range(H):
    z = Z0+(j+.5)*RES
    for i in range(W):
        x = X0+(i+.5)*RES
        for k, rings in enumerate(polys):
            hit = False
            for r, b in zip(rings, boxes[k]):
                if b[0] <= x <= b[2] and b[1] <= z <= b[3] and inside(x, z, r): hit = True; break
            if hit:
                grid[j*W+i] = k+1; c = cen[k+1]; c[0] += x; c[1] += z; c[2] += 1; break
rle = []; v = grid[0]; n = 0
for g in grid:
    if g == v: n += 1
    else: rle += [v, n]; v = g; n = 1
rle += [v, n]
cent = [[0, 0]] + [[round(c[0]/c[2]), round(c[1]/c[2])] if c[2] else [0, 0] for c in cen[1:]]
with open('js/data/hoods.js', 'w') as f:
    f.write('// Neighbourhood grid (96 m cells). Source: DataSF "Analysis Neighborhoods".\n')
    f.write('export const HOOD = ' + json.dumps({'res': RES, 'x0': X0, 'z0': Z0, 'w': W, 'h': H, 'names': names, 'cent': cent, 'rle': rle}, separators=(',', ':')) + ';\n')
print('hoods', len(names)-1, 'rle', len(rle))
