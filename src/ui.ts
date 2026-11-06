import type { Combat } from './game/combat';
import type { Fighter, Spell } from './game/types';
import { CLASS_INFO } from './game/data';

export interface UIHandlers {
  selectSpell: (spell: Spell | null) => void;
  endTurn: () => void;
  restart: () => void;
}

const fmtClass = (kind: string) => CLASS_INFO[kind]?.name ?? kind;
const fmtIcon = (kind: string) => CLASS_INFO[kind]?.icon ?? '✦';

function spellMeta(spell: Spell): string {
  const range =
    spell.minRange === spell.maxRange
      ? `${spell.minRange}`
      : `${spell.minRange}–${spell.maxRange}`;
  const bits: string[] = [`${spell.ap} AP`, `Range ${range}`];
  if (spell.damage) bits.push(`${spell.damage} dmg`);
  if (spell.heal) bits.push(`${spell.heal} heal`);
  if (spell.shield) bits.push(`${spell.shield} shield`);
  if (spell.push) bits.push(`push ${spell.push}`);
  if (spell.aoe) bits.push(`AoE ${spell.aoe}`);
  if (spell.poison) bits.push(`poison ${spell.poison.damage}/turn`);
  if (spell.teleport) bits.push('teleport');
  return bits.join(' · ');
}

function hpClass(f: Fighter): string {
  const pct = f.hp / f.maxHp;
  if (pct <= 0.25) return 'low';
  if (pct <= 0.5) return 'mid';
  return '';
}

export class UI {
  private handlers: UIHandlers;
  private roundEl: HTMLElement;
  private orderEl: HTMLElement;
  private sideEl: HTMLElement;
  private spellsEl: HTMLElement;
  private hintEl: HTMLElement;
  private endTurnEl: HTMLButtonElement;
  private toastEl: HTMLElement;
  private bannerEl: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerText: HTMLElement;
  private bannerEyebrow: HTMLElement;
  private restartEl: HTMLButtonElement;
  private tooltipEl: HTMLElement;

  private selected: Spell | null = null;
  private currentSpells: Spell[] = [];
  private lastActiveKey = '';
  private toastTimer = 0;
  private bannerShown = false;

  constructor(handlers: UIHandlers) {
    this.handlers = handlers;
    this.roundEl = document.getElementById('round')!;
    this.orderEl = document.getElementById('turn-order')!;
    this.sideEl = document.getElementById('side-panel')!;
    this.spellsEl = document.getElementById('spells')!;
    this.hintEl = document.getElementById('hint')!;
    this.endTurnEl = document.getElementById('end-turn') as HTMLButtonElement;
    this.toastEl = document.getElementById('toast')!;
    this.bannerEl = document.getElementById('banner')!;
    this.bannerTitle = document.getElementById('banner-title')!;
    this.bannerText = document.getElementById('banner-text')!;
    this.bannerEyebrow = document.getElementById('banner-eyebrow')!;
    this.restartEl = document.getElementById('restart') as HTMLButtonElement;
    this.tooltipEl = document.getElementById('tooltip')!;

    this.endTurnEl.addEventListener('click', () => this.handlers.endTurn());
    this.restartEl.addEventListener('click', () => this.handlers.restart());

    this.spellsEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-spell]');
      if (!btn || btn.classList.contains('disabled')) return;
      const id = btn.dataset.spell;
      const spell = this.currentSpells.find((s) => s.id === id) ?? null;
      this.handlers.selectSpell(spell && spell === this.selected ? null : spell);
    });

    this.spellsEl.addEventListener('mouseover', (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-spell]');
      if (!btn) return;
      const spell = this.currentSpells.find((s) => s.id === btn.dataset.spell);
      if (spell) this.showTooltip(spell, btn);
    });

    this.spellsEl.addEventListener('mouseout', (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-spell]');
      if (btn) this.tooltipEl.classList.add('hidden');
    });
  }

  setSelected(spell: Spell | null): void {
    this.selected = spell;
  }

  refresh(combat: Combat): void {
    this.roundEl.textContent = String(combat.round);

    // ----- turn order
    const chips: string[] = [];
    for (let i = 0; i < combat.order.length; i++) {
      const f = combat.order[(combat.turnIndex + i) % combat.order.length];
      const active = f === combat.active;
      const color = f.team === 'player' ? '#5fb0ff' : '#ff6b6b';
      const pct = Math.max(0, (f.hp / f.maxHp) * 100);
      chips.push(`
        <div class="turn-chip ${active ? 'active' : ''} ${f.alive ? '' : 'dead'}"
             style="--c:${color}" title="${f.name} — ${fmtClass(f.kind)}">
          <span class="chip-icon">${fmtIcon(f.kind)}</span>
          <span class="chip-body">
            <span class="chip-name">${f.name}</span>
            <span class="chip-hp"><i style="width:${pct}%"></i></span>
          </span>
        </div>`);
    }
    this.orderEl.innerHTML = chips.join('');

    // ----- active fighter panel
    const active = combat.active;
    if (active) {
      const statuses = active.statuses
        .map((s) => `<span class="status-chip">${s.label} ${s.turns}</span>`)
        .join('');
      const shield = active.shield
        ? `<span class="shield-chip">◈ ${active.shield} shield</span>`
        : '';
      const apPips = Array.from({ length: active.maxAp })
        .map((_, i) => `<span class="pip ap ${i < active.ap ? 'on' : ''}"></span>`)
        .join('');
      const mpPips = Array.from({ length: active.maxMp })
        .map((_, i) => `<span class="pip mp ${i < active.mp ? 'on' : ''}"></span>`)
        .join('');
      const logItems = combat.log
        .slice(-6)
        .map((l) => `<li style="color:${l.color}">${l.text}</li>`)
        .join('');

      this.sideEl.innerHTML = `
        <div class="fighter-card" style="--c:${active.color}">
          <div class="fc-head">
            <span class="fc-icon">${fmtIcon(active.kind)}</span>
            <div>
              <h2 class="fc-name">${active.name}</h2>
              <p class="fc-sub">${fmtClass(active.kind)} · ${active.team === 'player' ? 'Party' : 'Enemy'}</p>
            </div>
          </div>
          <div class="stat">
            <span class="stat-label">HP</span>
            <div class="bar hp ${hpClass(active)}"><i style="width:${Math.max(0, (active.hp / active.maxHp) * 100)}%"></i></div>
            <span class="stat-value">${active.hp}/${active.maxHp}</span>
          </div>
          <div class="pips"><span class="label">AP</span>${apPips}</div>
          <div class="pips"><span class="label">MP</span>${mpPips}</div>
          <div class="status-row">${shield}${statuses}</div>
        </div>
        <div class="log-card">
          <div class="log-title">Battle Log</div>
          <ul class="log-list">${logItems}</ul>
        </div>`;
    }

    // ----- spells
    const canAct = combat.canAct();
    const isPlayerTurn = combat.state === 'player' && active?.team === 'player';
    this.currentSpells = isPlayerTurn && active ? active.spells : [];
    this.selected = this.selected && this.currentSpells.includes(this.selected) ? this.selected : null;

    if (combat.state === 'over') {
      this.spellsEl.innerHTML = '';
    } else if (isPlayerTurn && active) {
      this.spellsEl.innerHTML = active.spells
        .map((s, i) => {
          const disabled = !canAct || active.ap < s.ap;
          const selected = s === this.selected;
          return `
            <button type="button" class="spell ${disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}"
                    data-spell="${s.id}" style="--sc:${s.color}">
              <span class="spell-key">${i + 1}</span>
              <span class="spell-icon">${s.icon}</span>
              <span class="spell-name">${s.name}</span>
              <span class="spell-cost">${s.ap} AP</span>
            </button>`;
        })
        .join('');
    } else {
      this.spellsEl.innerHTML = `
        <div class="enemy-thinking">
          <span class="orb"></span>
          Enemy turn — thinking
        </div>`;
    }

    this.endTurnEl.disabled = !canAct;
    this.endTurnEl.style.opacity = canAct ? '1' : '0.35';

    // ----- hint
    if (combat.state === 'over') {
      this.hintEl.textContent = '';
      this.hintEl.classList.remove('active');
    } else if (!isPlayerTurn) {
      this.hintEl.textContent = 'The enemy is taking its turn…';
      this.hintEl.classList.remove('active');
    } else if (this.selected) {
      this.hintEl.textContent = `${active?.name ?? 'Hero'}: ${this.selected.name} — click a highlighted target · Esc / right-click to cancel`;
      this.hintEl.classList.add('active');
    } else {
      this.hintEl.textContent = `${active?.name ?? 'Hero'} — click a blue tile to move · choose a spell (1–4) · Enter ends turn`;
      this.hintEl.classList.remove('active');
    }

    // ----- toast
    if (active && !this.bannerShown) {
      const key = `${combat.round}:${active.id}:${combat.turnIndex}`;
      if (key !== this.lastActiveKey) {
        this.lastActiveKey = key;
        this.showToast(`Round ${combat.round} · ${active.name}'s turn`);
      }
    }

    // ----- banner
    if (combat.state === 'over' && combat.winner) {
      if (!this.bannerShown) {
        this.bannerShown = true;
        const victory = combat.winner === 'player';
        this.bannerEyebrow.textContent = victory ? 'Battle Complete' : 'Battle Lost';
        this.bannerTitle.textContent = victory ? 'Victory' : 'Defeat';
        this.bannerTitle.classList.toggle('defeat', !victory);
        this.bannerText.textContent = victory
          ? 'The ambush is broken. Emberfall is safe — for now.'
          : 'The party has fallen. Regroup and try a different approach.';
        this.bannerEl.classList.remove('hidden');
      }
    } else {
      this.bannerShown = false;
      this.bannerEl.classList.add('hidden');
    }
  }

  private showToast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    // force reflow so the animation can retrigger
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1900);
  }

  private showTooltip(spell: Spell, anchor: HTMLElement): void {
    this.tooltipEl.innerHTML = `
      <h3>${spell.name}</h3>
      <p class="tt-meta">${spellMeta(spell)}</p>
      <p>${spell.description}</p>`;
    this.tooltipEl.classList.remove('hidden');

    const rect = anchor.getBoundingClientRect();
    const ttRect = this.tooltipEl.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - ttRect.width / 2;
    left = Math.max(10, Math.min(window.innerWidth - ttRect.width - 10, left));
    const top = rect.top - ttRect.height - 10;
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${Math.max(8, top)}px`;
  }
}
