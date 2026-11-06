import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME =
  process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:5173';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

fs.mkdirSync('test', { recursive: true });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => !!window.__emberfall, { timeout: 15000 });

const waitForPlayer = async (label) => {
  await page.waitForFunction(
    () => {
      const c = window.__emberfall.getCombat();
      return c.state === 'player' && !c.busy && !!c.active;
    },
    { timeout: 30000, polling: 120 },
  );
  const info = await page.evaluate(() => {
    const c = window.__emberfall.getCombat();
    return {
      round: c.round,
      active: c.active.name,
      hp: c.active.hp,
      ap: c.active.ap,
      mp: c.active.mp,
      enemies: c.fighters.filter((f) => f.team === 'enemy').map((f) => `${f.name}:${f.hp}`),
      players: c.fighters.filter((f) => f.team === 'player').map((f) => `${f.name}:${f.hp}`),
    };
  });
  console.log(`[${label}]`, JSON.stringify(info));
  return info;
};

const before = await waitForPlayer('initial player turn');
await page.screenshot({ path: 'test/01-turn.png' });

// --- move the active fighter toward the nearest enemy -----------------------
const movePlan = await page.evaluate(() => {
  const c = window.__emberfall.getCombat();
  const a = c.active;
  const enemies = c.fighters.filter((f) => f.alive && f.team !== a.team);
  let best = null;
  for (const [k] of c.reachable) {
    const [x, y] = k.split(',').map(Number);
    const dist = Math.min(...enemies.map((e) => Math.abs(e.x - x) + Math.abs(e.y - y)));
    if (!best || dist < best.dist) best = { x, y, dist };
  }
  return best;
});

if (movePlan) {
  const pt = await page.evaluate(
    (x, y) => window.__emberfall.renderer.tileToScreen(x, y),
    movePlan.x,
    movePlan.y,
  );
  console.log('move to', movePlan, 'screen', pt);
  await page.mouse.click(pt.x, pt.y);
  await sleep(900);
}

// --- cast the first spell that has a target --------------------------------
const castPlan = await page.evaluate(() => {
  const c = window.__emberfall.getCombat();
  const a = c.active;
  if (!a) return null;
  for (const spell of a.spells) {
    const targets = [...c.validTargets(a, spell)];
    if (!targets.length) continue;
    const before = c.fighters.map((f) => ({ id: f.id, hp: f.hp }));
    return { spell: spell.id, name: spell.name, targets, before };
  }
  return null;
});

if (castPlan) {
  console.log('cast', castPlan.name, 'targets', castPlan.targets.length);
  await page.click(`[data-spell="${castPlan.spell}"]`);
  await sleep(150);
  const [tx, ty] = castPlan.targets[0].split(',').map(Number);
  const pt = await page.evaluate(
    (x, y) => window.__emberfall.renderer.tileToScreen(x, y),
    tx,
    ty,
  );
  await page.mouse.click(pt.x, pt.y);
  await sleep(1200);

  const after = await page.evaluate(() => {
    const c = window.__emberfall.getCombat();
    return c.fighters.map((f) => ({ id: f.id, hp: f.hp }));
  });
  const changed = after.filter((f) => {
    const b = castPlan.before.find((x) => x.id === f.id);
    return b && b.hp !== f.hp;
  });
  console.log('hp changes after cast', JSON.stringify(changed));
}

await page.screenshot({ path: 'test/02-after-action.png' });

// --- end turn and make sure the next turn starts ---------------------------
await page.click('#end-turn');
await sleep(300);
const next = await waitForPlayer('next player turn');
await page.screenshot({ path: 'test/03-next-turn.png' });

// --- force a full fight to completion via the debug handle ------------------
const outcome = await page.evaluate(async () => {
  const game = window.__emberfall;
  const c = game.getCombat();
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  let guard = 0;

  while (c.state !== 'over' && guard++ < 120) {
    if (c.state === 'player' && !c.busy && c.active) {
      const a = c.active;
      let acted = false;

      // 1. best damaging spell on the weakest reachable enemy
      const damageSpells = a.spells.filter((s) => s.damage).sort((x, y) => (y.damage ?? 0) - (x.damage ?? 0));
      for (const spell of damageSpells) {
        const keys = [...c.validTargets(a, spell)];
        if (!keys.length) continue;
        const targets = keys
          .map((k) => {
            const [x, y] = k.split(',').map(Number);
            return c.fighterAt(x, y);
          })
          .filter(Boolean)
          .sort((p, q) => p.hp - q.hp);
        const t = targets[0];
        if (t && (await c.cast(a, spell, t.x, t.y))) {
          acted = true;
          break;
        }
      }

      // 2. heal a wounded ally
      if (!acted) {
        const healSpells = a.spells.filter((s) => s.heal);
        for (const spell of healSpells) {
          const keys = [...c.validTargets(a, spell)];
          const allies = keys
            .map((k) => {
              const [x, y] = k.split(',').map(Number);
              return c.fighterAt(x, y);
            })
            .filter((f) => f && f.hp / f.maxHp < 0.55)
            .sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp);
          const t = allies[0];
          if (t && (await c.cast(a, spell, t.x, t.y))) {
            acted = true;
            break;
          }
        }
      }

      // 3. move toward the nearest enemy
      if (!acted) {
        const enemies = c.fighters.filter((f) => f.alive && f.team !== a.team);
        let best = null;
        for (const [k] of c.reachable) {
          const [x, y] = k.split(',').map(Number);
          const d = Math.min(...enemies.map((e) => dist(e, { x, y })));
          if (!best || d < best.d) best = { x, y, d };
        }
        if (best) {
          await c.movePlayer(a, best.x, best.y);
          acted = true;
        }
      }

      if (!acted) await game.endTurn();
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return { state: c.state, winner: c.winner, round: c.round, log: c.log.slice(-6) };
});
console.log('outcome', JSON.stringify(outcome, null, 2));
await sleep(500);
await page.screenshot({ path: 'test/04-outcome.png' });

// --- restart from the victory banner ---------------------------------------
await page.click('#restart');
await page.waitForFunction(
  () => {
    const c = window.__emberfall.getCombat();
    return c.round === 1 && c.state === 'player' && !c.busy;
  },
  { timeout: 30000, polling: 120 },
);
const restarted = await page.evaluate(() => {
  const c = window.__emberfall.getCombat();
  return {
    round: c.round,
    state: c.state,
    bannerHidden: document.getElementById('banner').classList.contains('hidden'),
    fullHp: c.fighters.every((f) => f.hp === f.maxHp),
  };
});
console.log('restart', JSON.stringify(restarted));
await page.screenshot({ path: 'test/05-restart.png' });

console.log('ERRORS', errors.length ? errors : 'none');
await browser.close();
