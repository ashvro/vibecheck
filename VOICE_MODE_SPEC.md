# VibeCheck — AI Assistant "Voice Mode" Mockup Spec (React + Tailwind)

Source: `/home/user/Downloads/VibeCheck AI Assistant – Improved Chat Mockup-png (1)/`
- `Voice mode listening.png`
- `Voice mode speaking.png`

Both files verified pixel-exact with Python/PIL: **2560 × 1640 px** each (aspect ≈ **1.56:1**, landscape). Top bar, pills, and bottom buttons are **identical** between the two files; the **only** differences are in the central orb (diameter, highlight position/brightness, body saturation). Verbatim strings are transcribed exactly below.

---

## 1. Image 1 — Voice mode listening.png

### 1.1 Dimensions / aspect / framing / what is cut off
- **Size:** 2560 × 1640 px (≈ 1.56:1 landscape).
- **Framing:** A full-screen app view / complete voice-stage screen, not a cropped widget. The very dark background fills the entire frame; there is no browser chrome, no window frame, and nothing is cut off at any edge. It should be treated as one full viewport (the whole chat tab taken over by voice mode).
- **Left chat sidebar:** **Not visible.** The voice UI replaces the entire main chat area.
- **Transcript:** **Not visible.** No transcript appears behind or around the voice stage. The voice UI is a full-screen replacement of the chat area, not an overlay on top of a visible transcript.

### 1.2 Overall layout (left → right)
Single central panel; no side columns.
- **Top bar** — full width, top ~6% of height. Left side holds the pipeline label + three mode pills; far right holds "Back to text".
- **Center stage** — the large orb sits dead-center horizontally, slightly above vertical center (≈ 47% down). It occupies the middle ~40–45% of height.
- **Bottom controls** — two circular buttons side-by-side, bottom-center, ≈ 91% down, ≈ 5% up from the bottom edge.
- There is **no left sidebar, no transcript column, no composer, and no timer** visible anywhere.

### 1.3 Central voice visualizer / orb (LISTENING) — maximum detail
- **Shape:** A single soft-edged **circle (sphere/ball)**. No ring border, no waveform bars, no animated wave rings, no particles. Just a smooth radial gradient sphere with an outer glow/halo (blur).
- **Position / size:** Center ≈ **(1280, 770)**. The colored sphere diameter = **600 px** (radius 300 px), which is ≈ **36.6% of panel height** and ≈ **23.4% of panel width**. A softer glow/blur halo extends visibly beyond the sphere edge (blur roughly +40–80 px).
- **Gradient (top → bottom, sampled at x=1280):**
  - Top edge (~y 470–500): near-white lavender `#E0DBF3` → bright white peak `#F3F0FE` / `#F3F0FF` around **y 535–605** (the brightest white cap sits just above vertical center).
  - Upper-mid (y 640–745): `#ECE7FC` → `#DDD4FB` → `#C4B3F5` → `#A894F2` (fading into purple).
  - Center (y 770–815): `#947BEB` → `#876EE8` (true sphere center color at y=770: `#9982EE`).
  - Lower-mid (y 850–990): `#7863DB` → `#705ED3` → `#6357C9` → `#6055C5` → `#6052C5`.
  - Bottom edge (y 1025–1060, just before sphere edge at y≈1069): `#5E4BC4` → `#5640B9` (deep purple), then hard-ish falloff to background `#0E0A1F`.
- **Accent / secondary color:** A cooler blue‑violet spot sits at the **bottom-right** of the sphere ≈ `#717DCA` / `#7980D1`.
- **Glow / halo:** Soft outer blur around the sphere; immediately above the sphere (y≈380–440) it is faint (`#120E27`–`#1B1433`), i.e. a subtle purple-tinted haze, not a hard ring.
- **Animation hint (static mockup):** None drawn; this is the smaller, "calmer" listening state (see Differences section vs. speaking).

### 1.4 Every string on screen, verbatim, with position
These are the **only** strings visible in Image 1:
| String | Position | Notes |
|---|---|---|
| `INTENT-AWARE · SAFETY-FIRST PIPELINE` | Top-left, small-caps, above the pills | Muted slate‑lavender, very small |
| `Counselor` | Top-left pill (first of three) | Filled selected pill; white text |
| `Tutor` | Top-left pill (second) | Outlined ring; muted text |
| `General` | Top-left pill (third) | Outlined ring; muted text |
| `Back to text` | Top-right | Link-style text, light lavender‑gray |

**Absent (intentionally):** no status/phase label, no headline, no hint ("Speak now" / "Listening…"), no live transcript, no speaker attribution, no timer/duration, no tiny print, no disclaimer.

### 1.5 All controls
Two circular icon buttons, bottom-center, side by side (pair centered ≈ image horizontal center 1280):
- **Mic / voice button (left)** — center ≈ (1174, 1493), diameter ≈ 120–126 px (≈ 7.7% of height). **Filled dark-purple circle** `#3A2D6E` with a **white microphone icon** `#ECE8FA` in the middle. No visible text label under it (icon only).
- **End / close button (right, "X")** — center ≈ (1366, 1493), diameter ≈ 120–126 px. **Filled off-white circle** `#ECE8FA` (236,232,250) with a **dark X icon** `#3E3B4E` / `#1A1338` in the middle. No visible text label under it.
- Gap between the two buttons ≈ 130 px.
- Neither button has a visible text label beneath it in this mockup.

### 1.6 Composer / input area state
**Not visible.** No text input, composer, microphone toggle strip, or send button appears in voice mode.

### 1.7 Colors (hex approximations)
- **App background:** `#0E0A1F` (14,10,31) — near-black deep purple. (Very edge corners read slightly lighter `#2B2150`; treat main fill as `#0E0A1F`.)
- **Top bar small pipeline text:** `#8A82A8` core, anti-aliased `#5C5676`–`#A79FCB` (muted slate‑lavender).
- **"Back to text":** `#B9B3DA`–`#C4BDE6` (light lavender‑gray).
- **Pills:**
  - `Counselor` (selected): fill `#221A4A`, text `#ECE8FA` (near-white), leading active dot `#7DD3C0` (mint green).
  - `Tutor`: outlined ring `#F2C06B`–`#9C7C4F` (gold/amber), muted text.
  - `General`: outlined ring `#8B6CF6`–`#5C47A5` (violet), muted text.
- **Orb (listening):** gradient `#F3F0FF` (white peak) → `#947BEB`/`#876EE8` (purple mid) → `#6052C5` → `#5640B9` (bottom); bottom-right blue spot `#717DCA`–`#7980D1`; sphere center `#9982EE`.
- **Orb glow/halo:** faint purple haze above sphere `#120E27`–`#1B1433`.
- **Mic button:** fill `#3A2D6E`, icon `#ECE8FA`.
- **X button:** fill `#ECE8FA`, icon `#3E3B4E`–`#1A1338`.
- **Text on buttons:** none (icon-only).

### 1.8 Typography
- **Family feel:** Modern geometric sans-serif (Inter/SF-like), all clean and legible; no serifs, no display novelty.
- **Size/weight hierarchy (approx.):**
  - Pipeline label `INTENT-AWARE · SAFETY-FIRST PIPELINE`: smallest, ~12–14 px, regular/medium, small-caps feel, muted.
  - `Back to text`: ~12 px, regular, light color.
  - Pills `Counselor` / `Tutor` / `General`: ~18–22 px, medium/semibold; selected `Counselor` white on dark fill, unselected muted.
- No headline, no hint, no body copy exists on screen.

### 1.9 Shape language / radii / shadows / spacing
- Everything rounded/circular: pills are capsules, orb is a circle, buttons are circles.
- Orb: no hard border; pure gradient + `blur`/glow halo.
- Buttons: solid flat fills, no visible border, subtle icon contrast.
- Shadows: only the orb's outer glow/blur; no drop-shadows on buttons or pills evident.
- Spacing rhythm: top bar tight to top edge; pills grouped with small gaps; orb vertically centered in the open middle; button pair centered near the bottom with a wide horizontal gap between them; ≈ 5% bottom margin below buttons.

### 1.10 Pixel-perfect notes (listening)
- No status/hint/transcript/timer strings exist — do not add them if matching exactly.
- Orb center is horizontally dead-center (x = W/2) but slightly above vertical middle (y ≈ 47% down).
- Sphere edge falls off to `#0E0A1F` background; do not draw a hard ring around the orb.
- Bottom-right of sphere carries a cooler blue‑violet spot.

---

## 2. Image 2 — Voice mode speaking.png

### 2.1 Dimensions / aspect / framing / what is cut off
- **Size:** 2560 × 1640 px (≈ 1.56:1 landscape) — identical to Image 1.
- **Framing:** Identical full-screen app view; nothing cut off; no sidebar; no transcript; voice UI replaces the whole chat area.

### 2.2 Overall layout
Identical to Image 1: top bar (pills left, "Back to text" right), center orb, bottom-center mic + X button pair. No left sidebar, no transcript, no composer, no timer.

### 2.3 Central voice visualizer / orb (SPEAKING) — maximum detail
- **Shape:** Same single soft-edged **circle/sphere**; no ring border, no waveform, no particles.
- **Position / size:** Center ≈ **(1280, 770)** — same center as listening. Colored sphere diameter = **720 px** (radius 360 px), ≈ **43.9% of panel height** and ≈ **28.1% of panel width**. **This is ~20% larger in diameter than the listening orb (720 vs 600 px).** Glow/blur halo extends beyond the sphere similarly.
- **Gradient (top → bottom, sampled at x=1280):**
  - Top edge (~y 410–430): already bright `#DCD6EF`; white cap `#EBE6FB` → `#F0EBFE` / `#EEEAFF` around **y 430–535** (peak `#F0EBFE` near y 500). The white highlight is **larger and sits higher** than in listening.
  - Upper-mid (y 570–710): `#E7E1FE` → `#D7CEFB` → `#C0B1F5` → `#A995F0` → `#947AEC`.
  - Center (y 745–780): `#896FE9` → `#8568E7` (center color at y=770: `#876BE8` — slightly darker/more saturated than listening's `#9982EE`).
  - Lower-mid (y 815–990): `#7F63E5` → `#795EE1` → `#725BD8` → `#6C59D2` → `#6956CC` → `#6953CD`.
  - Bottom edge (y 1025–1095, sphere edge ≈ y 1129): `#6953CD` → `#634AC8` → `#5E44C3` (deep purple) → falloff to `#0E0A1F`.
- **Accent / secondary color:** Bottom-right blue spot ≈ `#6D76C4`–`#7183C8` (very similar to listening).
- **Glow / halo:** Speaking's glow is brighter/more extended at the top — immediately above the sphere at y≈420 it reads bright white `#D7D0EA`–`#E1DAF3` (whereas listening at the same y is faint dark `#17112F`), because the speaking sphere itself reaches higher.
- **Animation hint:** Larger, brighter orb — the "active/expanded" speaking state.

### 2.4 Every string on screen, verbatim, with position
Identical to Image 1 — **these are the only strings**:
| String | Position |
|---|---|
| `INTENT-AWARE · SAFETY-FIRST PIPELINE` | Top-left, small-caps |
| `Counselor` | Top-left pill (filled/selected) |
| `Tutor` | Top-left pill (outlined) |
| `General` | Top-left pill (outlined) |
| `Back to text` | Top-right |

**Absent:** no status label, no headline, no hint, no transcript, no timer, no disclaimer.

### 2.5 All controls
Identical to Image 1:
- **Mic button (left):** filled dark-purple `#3A2D6E`, white mic icon `#ECE8FA`, center ≈ (1174, 1493), Ø ≈ 120–126 px, icon-only (no label under it).
- **X button (right):** filled off-white `#ECE8FA`, dark X icon `#3E3B4E`, center ≈ (1366, 1493), Ø ≈ 120–126 px, icon-only.
- No text labels under either button.

### 2.6 Composer / input area
**Not visible** (same as listening).

### 2.7 Colors
Identical palette to Image 1, with the orb differences noted:
- Background `#0E0A1F`; pipeline text `#8A82A8` (muted slate‑lavender); "Back to text" `#B9B3DA`–`#C4BDE6`.
- Pills: `Counselor` fill `#221A4A` / text `#ECE8FA` / dot `#7DD3C0`; `Tutor` ring `#F2C06B`–`#9C7C4F`; `General` ring `#8B6CF6`–`#5C47A5`.
- **Orb (speaking):** gradient `#F0EBFE` (high white peak) → `#8568E7` (center) → `#6953CD` → `#5E44C3` (bottom); bottom-right blue spot `#6D76C4`–`#7183C8`; sphere center `#876BE8`.
- Buttons: mic `#3A2D6E` fill + `#ECE8FA` icon; X `#ECE8FA` fill + `#3E3B4E` icon.

### 2.8 Typography
Same as Image 1 (sans-serif; pipeline smallest ~12–14 px muted small-caps; pills ~18–22 px medium/semibold; "Back to text" ~12 px). No headline/hint/body copy.

### 2.9 Shape language
Same as Image 1: all-circular pills/orb/buttons, orb has gradient + blur halo (no hard ring), buttons flat solid fills, ≈5% bottom margin, button pair centered with wide gap.

### 2.10 Pixel-perfect notes (speaking)
- Orb is measurably **larger** (Ø 720 px) than listening (Ø 600 px) with the same center (1280, 770).
- White highlight is **larger and positioned higher** (peak near y 500 vs listening peak near y 570–605).
- Body purple is **slightly darker/more saturated** (center `#876BE8` vs `#9982EE`; bottom `#5E44C3` vs `#5640B9`).
- Glow at the very top of the orb region is bright in speaking (sphere reaches y≈410) vs faint in listening (sphere reaches y≈470).
- No other UI difference: strings, pills, buttons, colors outside the orb are pixel-identical.

---

## 3. Differences between listening and speaking

| Attribute | Listening (`Voice mode listening.png`) | Speaking (`Voice mode speaking.png`) |
|---|---|---|
| **Orb diameter** | 600 px (≈ 36.6% of height) | 720 px (≈ 43.9% of height) — **~20% larger** |
| **Orb center** | (1280, 770) — same | (1280, 770) — same |
| **White highlight** | Peak `#F3F0FF` around y 570–605 (just above center) | Peak `#F0EBFE` around y 430–535 (larger, higher, fills upper half) |
| **Body saturation** | Center `#9982EE`; bottom `#5640B9` — slightly lighter | Center `#876BE8`; bottom `#5E44C3` — slightly darker/more saturated |
| **Top glow** | Faint above sphere (`#120E27`–`#1B1433` at y 380–440) | Bright above sphere (`#D7D0EA`–`#E1DAF3` at y 420–440) because sphere reaches higher |
| **Bottom-right blue spot** | `#717DCA`–`#7980D1` | `#6D76C4`–`#7183C8` (nearly identical) |
| **All strings** | Identical (5 strings only) | Identical (5 strings only) |
| **Pills / buttons / chrome** | Pixel-identical | Pixel-identical |
| **Status / hint / transcript / timer** | None shown | None shown |

**Bottom line for implementation:** Build one voice-stage component. The listening and speaking states are the **same layout**; only the orb changes — it scales up (~Ø 600 → 720 px), the white gradient highlight shifts upward and brightens, and the purple body deepens slightly. Everything else (top bar, pills, "Back to text", mic + X buttons) is shared and static. No transcript, sidebar, composer, timer, or status text appears in either state.
