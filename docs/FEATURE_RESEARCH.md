# Feature Research: what to add (2026-06-11)

Surveyed the dominant proxy-printing tools (MPC Autofill / mpcfill.com) and the
Pokemon-specific tools (Proxycroak, Limitless, Proxxied, PROXYPRNT) to find
high-value additions, each mapped against the current codebase so the effort is
concrete, not aspirational.

## #1 (strong): decklist import

Every competitor leads with the same headline: "proxy a whole deck straight from
a decklist." This project has card browse + add-to-list + the print engine, but
**no way to paste a deck** - so the core "I want to playtest this list" workflow
takes dozens of manual adds. This is the single biggest UX gap.

- **Format** (Pokemon TCG Live / Limitless text export): `[Qty] [Name] [SetCode] [Number]`,
  e.g. `2 Pikachu SVI 94`, `2 Poke Ball SVI 185`, grouped under `Pokemon: N` /
  `Trainer: N` / `Energy: N` headers.
- **Already supported by the model:** `card_set.ptcg_code` stores the PTCGL set
  code (`SVI`, `OBF`, ...) and `card_print.collector_number_raw`/`_norm` the
  number, so `(setCode, number)` resolves straight to a `card_print`; the print
  list / cart infra already exists.
- **Effort:** a pure, unit-testable line parser + one resolution query + a
  textarea + "import" on the print page. Bulk of the plumbing is done.
- **Known edge cases (from research):** PTCGL promo cards use an in-game
  numbering system (e.g. `SWSHALT 127` instead of `BRS 132`) - resolve
  best-effort and surface unresolved lines for manual fix; Trainer/Energy can be
  matched by name alone when the set code is ambiguous.

## Lower-priority candidates (mapped to current state)

- **Dynamic MPC bracket detection.** MPC Autofill now queries the vendor's *live*
  bracket tiers instead of hardcoding them; we hardcode a (config-overridable)
  ladder. `exceedsCapacity` is already surfaced. The ladder values are the
  documented maintenance risk (OPEN_ITEMS) - a live fetch would remove it.
- **Cardstock options (S30 / S27).** MPC added S27 smooth. `MpcOptions.stock`
  already exists (default `(S30) Standard Smooth`); just expose the choice in the
  UI. Tiny.
- **DPI downscale-on-export cap.** MPC Autofill caps uploads at ~800 DPI to limit
  size; we cap at 600 already, so low value.
- **Cloud sync / accounts.** Competitors offer sign-in to sync lists across
  devices; we are localStorage-only. Larger lift (auth + persistence); aligns
  with the donation/login note but is well past the proxy core.
- **Flexible page layout (rows/cols/margins).** Competitors expose it; we are
  deliberately opinionated (fixed 63x88, 3x3, gutter + bleed) because the card
  size is fixed and competitive. Likely keep fixed by design.

## Sources

- MPC Autofill: <https://github.com/chilli-axe/mpc-autofill>, <https://mpcfill.com/>
- Proxycroak: <https://proxycroak.com/> · Limitless tools: <https://limitlesstcg.com/tools>
- Proxxied: <https://proxxied.com/> · PROXYPRNT: <https://proxyprnt.it/>
- PTCGL/Limitless decklist format: <https://docs.limitlesstcg.com/player/decklists>
