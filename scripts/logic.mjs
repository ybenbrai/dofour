import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:5173';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__emberfall, { timeout: 15000 });

const results = await page.evaluate(async () => {
  const { Combat } = await import('/src/game/combat.ts');
  const fx = {
    bolt() {},
    slash() {},
    ring() {},
    teleport() {},
    text() {},
    shake() {},
  };
  const out = [];
  const check = (name, ok, extra = '') => out.push({ name, ok: !!ok, extra });

  const byName = (c, name) => c.fighters.find((f) => f.name === name);
  const setup = () => {
    const c = new Combat(fx);
    c.busy = false;
    return c;
  };
  const asPlayer = (c, f) => {
    c.active = f;
    c.state = 'player';
    c.busy = false;
    f.ap = f.maxAp;
    f.mp = f.maxMp;
    c.touch();
  };

  // ---------------- movement / pathfinding ----------------
  {
    const c = setup();
    const a = byName(c, 'Aelina');
    const reach = c.computeReachable(a);
    check('reachable tiles exist', reach.size > 0, reach.size);
    const first = [...reach.keys()][0];
    const [x, y] = first.split(',').map(Number);
    c.reachable = reach;
    const path = c.pathTo(x, y);
    check('path cost matches BFS', path.length === reach.get(first).cost, `${path.length}`);
    check('path ends on target', path[path.length - 1]?.x === x && path[path.length - 1]?.y === y);
  }

  // ---------------- damage, shield, heal ----------------
  {
    const c = setup();
    const b = byName(c, 'Boldur');
    b.shield = 10;
    const hp0 = b.hp;
    c.damage(b, 20);
    check('shield absorbs damage', b.shield === 0 && b.hp < hp0 && b.hp >= hp0 - 12, `hp ${b.hp}`);
    c.heal(b, 5);
    check('heal restores hp', b.hp > hp0 - 12, `hp ${b.hp}`);
  }

  // ---------------- iop: cleave, intimidation push, leap ----------------
  {
    const c = setup();
    const iop = byName(c, 'Boldur');
    const goblin = byName(c, 'Goblin Scout');
    asPlayer(c, iop);
    iop.x = 5;
    iop.y = 5;
    goblin.x = 6;
    goblin.y = 5;
    const hp0 = goblin.hp;
    const ok = await c.cast(iop, iop.spells.find((s) => s.id === 'cleave'), 6, 5);
    check('cleave hits adjacent enemy', ok && goblin.hp < hp0, `hp ${goblin.hp}`);

    asPlayer(c, iop);
    iop.x = 9;
    iop.y = 10;
    goblin.x = 10;
    goblin.y = 10;
    goblin.hp = 70;
    const okPush = await c.cast(iop, iop.spells.find((s) => s.id === 'intimidation'), 10, 10);
    check('intimidation pushes target', okPush && goblin.x === 12 && goblin.y === 10, `${goblin.x},${goblin.y}`);

    asPlayer(c, iop);
    iop.x = 2;
    iop.y = 2;
    const okLeap = await c.cast(iop, iop.spells.find((s) => s.id === 'leap'), 2, 5);
    check('leap teleports to empty tile', okLeap && iop.x === 2 && iop.y === 5, `${iop.x},${iop.y}`);
  }

  // ---------------- cra: poison tick and aoe ----------------
  {
    const c = setup();
    const cra = byName(c, 'Aelina');
    const scout = byName(c, 'Goblin Scout');
    const brute = byName(c, 'Goblin Brute');
    asPlayer(c, cra);
    cra.x = 5;
    cra.y = 5;
    scout.x = 8;
    scout.y = 5;
    scout.hp = 70;
    const ok = await c.cast(cra, cra.spells.find((s) => s.id === 'poison'), 8, 5);
    const poisoned = scout.statuses.some((s) => s.kind === 'poison');
    check('poison arrow applies status', ok && poisoned);

    c.order = [scout, ...c.order.filter((f) => f !== scout)];
    c.turnIndex = 0;
    const hp0 = scout.hp;
    c.beginTurn(0);
    check('poison ticks at turn start', scout.hp < hp0, `hp ${scout.hp}`);
    check('poison decrements turns', (scout.statuses.find((s) => s.kind === 'poison')?.turns ?? 0) <= 1);

    const c2 = setup();
    const cra2 = byName(c2, 'Aelina');
    const s1 = byName(c2, 'Goblin Scout');
    const s2 = byName(c2, 'Goblin Brute');
    asPlayer(c2, cra2);
    cra2.x = 5;
    cra2.y = 5;
    s1.x = 9;
    s1.y = 5;
    s2.x = 9;
    s2.y = 6;
    const hpA = s1.hp;
    const hpB = s2.hp;
    const aoeValid = c2.isValidTarget(cra2, cra2.spells.find((s) => s.id === 'explosive'), 9, 5);
    const okAoe = await c2.cast(cra2, cra2.spells.find((s) => s.id === 'explosive'), 9, 5);
    check(
      'explosive arrow hits both targets',
      okAoe && s1.hp < hpA && s2.hp < hpB,
      `ok=${okAoe} valid=${aoeValid} state=${c2.state} busy=${c2.busy} same=${c2.active === cra2} team=${cra2.team} ap=${cra2.ap} cost=${cra2.spells.find((s) => s.id === 'explosive')?.ap} pos=${s1.x},${s1.y}/${s2.x},${s2.y} hp=${s1.hp}/${s2.hp}`,
    );
  }

  // ---------------- eniripsa: heal self, heal ally, shield ----------------
  {
    const c = setup();
    const mira = byName(c, 'Mira');
    const boldur = byName(c, 'Boldur');
    asPlayer(c, mira);
    mira.x = 5;
    mira.y = 5;
    boldur.x = 6;
    boldur.y = 5;
    boldur.hp = 50;
    const okHeal = await c.cast(mira, mira.spells.find((s) => s.id === 'healing-word'), 6, 5);
    check('healing word heals ally', okHeal && boldur.hp === 74, `hp ${boldur.hp}`);

    asPlayer(c, mira);
    mira.hp = 40;
    const okSelf = await c.cast(mira, mira.spells.find((s) => s.id === 'healing-word'), 5, 5);
    check('healing word can target self', okSelf && mira.hp === 64, `hp ${mira.hp}`);

    asPlayer(c, mira);
    const okShield = await c.cast(mira, mira.spells.find((s) => s.id === 'protective-word'), 6, 5);
    check('protective word grants shield', okShield && boldur.shield === 22, `shield ${boldur.shield}`);
  }

  // ---------------- line of sight / targeting ----------------
  {
    const c = setup();
    const cra = byName(c, 'Aelina');
    const scout = byName(c, 'Goblin Scout');
    asPlayer(c, cra);
    cra.x = 5;
    cra.y = 5;
    scout.x = 7;
    scout.y = 5;
    c.obstacles.add('6,5');
    const blocked = c.isValidTarget(cra, cra.spells.find((s) => s.id === 'precise'), 7, 5);
    check('obstacle blocks line of sight', blocked === false);
    c.obstacles.delete('6,5');

    const iop = byName(c, 'Boldur');
    asPlayer(c, iop);
    iop.x = 5;
    iop.y = 5;
    c.obstacles.add('6,5');
    const leapOver = c.isValidTarget(iop, iop.spells.find((s) => s.id === 'leap'), 7, 6);
    check('leap ignores obstacles', leapOver === true);
    c.obstacles.delete('6,5');
  }

  // ---------------- AI turn terminates ----------------
  {
    const c = setup();
    const goblin = byName(c, 'Goblin Scout');
    c.active = goblin;
    c.state = 'enemy';
    c.busy = false;
    const prev = c.turnIndex;
    await c.runEnemyTurn();
    check('AI turn finishes and advances', c.state !== 'enemy' || c.turnIndex !== prev, `${c.state} ${c.turnIndex}`);
  }

  // ---------------- victory / defeat ----------------
  {
    const c = setup();
    for (const f of c.fighters.filter((x) => x.team === 'enemy')) {
      f.hp = 1;
      c.damage(f, 50);
    }
    check('victory when all enemies die', c.state === 'over' && c.winner === 'player');

    const c2 = setup();
    for (const f of c2.fighters.filter((x) => x.team === 'player')) {
      f.hp = 1;
      c2.damage(f, 50);
    }
    check('defeat when all players die', c2.state === 'over' && c2.winner === 'enemy');
  }

  return out;
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? `  (${r.extra})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log('page errors:', errors.length ? errors : 'none');

await browser.close();
process.exit(failed ? 1 : 0);
