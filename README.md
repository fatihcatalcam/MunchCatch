# Munch Catch 🥗🍔

A browser-based **Healthy vs Junk Food** falling-objects game built entirely with the **HTML5 Canvas API** for a Computer Graphics university final project.

---

## How to Play

| Action | Controls |
|--------|----------|
| Move left | ← Arrow Key or **A** |
| Move right | → Arrow Key or **D** |
| Start game | **SPACE** or click / tap |
| Pause / Resume | **P** or **ESC** |
| Mute / Unmute | **M** or click 🔊 button |
| Mobile | Tap the **left** or **right** half of the screen |

**Catch healthy food** (🍎🥦🥕🍌🍉) — each catch scores **+10 points**.  
**Avoid junk food** (🍔🍟🥤🍩🍬) — each catch costs **1 life**.  
**Don't miss healthy food** — letting healthy food fall past the bottom also costs **1 life** (red flash + screen shake).  
You start with **3 lives** shown as hearts ❤❤❤.

### Combo System
Catch 3 or more healthy items in a row without catching junk food to trigger a **COMBO** bonus: each combo catch scores **+15 points** instead of 10.

### Difficulty Progression
Every **30 seconds**, the game advances one level:
- Fall speed increases **×1.15**
- Spawn rate increases **×1.10**

Hit **100 / 250 / 500 / 1000** point milestones for a special on-screen animation.

---

## Computer Graphics Concepts Used

### 1. HTML5 Canvas API
All rendering is done via the 2D canvas context (`ctx`). No DOM elements, images, or CSS animations are used for game objects.

### 2. 2D Translation
- **Falling objects** translate downward each frame (`y += speed × dt`)
- **Player basket** translates horizontally based on input
- **Parallax background** layers translate at different speeds

### 3. 2D Rotation
Every food item accumulates a rotation angle each frame and is drawn with `ctx.rotate(angle)`, producing a spinning effect as it falls.

### 4. 2D Scaling
- **Proximity scaling**: objects grow slightly as they near the bottom (depth cue)
- **Catch animation**: caught objects scale up rapidly while fading out

### 5. Matrix Stack (Transformation Pipeline)
`ctx.save()` / `ctx.translate()` / `ctx.rotate()` / `ctx.scale()` / `ctx.restore()` are composed together for every object drawn, demonstrating the full 2D transformation matrix pipeline.

### 6. requestAnimationFrame Game Loop
A single `requestAnimationFrame` loop drives all updates and rendering. **Delta time** (`dt`) ensures frame-rate-independent physics at 30 fps or 144 fps.

### 7. Particle System
On catch, 14–18 coloured particles burst outward with random velocity vectors, gravity, and fading alpha — a classic real-time particle effect.

### 8. Floating Score Text Animation
Score labels rise upward and fade out via alpha interpolation, giving immediate visual feedback.

### 9. AABB Collision Detection
Axis-Aligned Bounding Box collision: four comparisons determine whether the basket rectangle and any food rectangle overlap. Fires particle burst + floating text on detection.

### 10. Screen Shake
When the player loses a life, the canvas origin is randomly displaced for ~400 ms via `ctx.translate(±random, ±random)` — a translation-based feedback technique.

### 11. Procedural Shape Rendering
All 10 food types are drawn entirely with Canvas path commands — `arc`, `bezierCurveTo`, `quadraticCurveTo`, `ellipse`, `moveTo`, `lineTo`, `fill`, `stroke`. **No external image files.**

### 12. Dynamic Background Gradient
`ctx.createLinearGradient()` generates a sky that hue-shifts as difficulty increases, providing a subtle visual cue of escalating tension.

### 13. Glow / Shadow Effects
`ctx.shadowBlur` + `ctx.shadowColor` simulate soft light emission on score text when points are gained, and on particle bursts.

### 14. Parallax Scrolling
Two independent background layers (far clouds + near shapes) translate at different speeds to create a sense of depth.

### 15. Screen Fade Transitions
A black rectangle drawn with decreasing `ctx.globalAlpha` creates smooth fade-in transitions between game screens.

### 16. Responsive Canvas
A `resize` event listener recalculates canvas dimensions to maintain a 2:3 aspect ratio at any window size.

---

## File Structure

```
MunchCatch/
├── index.html   — Game shell, loads CSS + JS
├── style.css    — Page layout and canvas styling
├── game.js      — All game logic (~1 000 lines, fully commented)
└── README.md    — This file
```

---

## Screenshots

*(Add screenshots here after deployment)*

---

## Live Demo

[https://USERNAME.github.io/MunchCatch/](https://USERNAME.github.io/MunchCatch/)

*(Replace USERNAME with your GitHub username after deploying to GitHub Pages)*

---

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Set **Source** to `main` branch, root folder `/`.
4. GitHub Pages will serve `index.html` automatically.

The game has **zero dependencies** — no npm, no build step, no server required.

---

## Credits

- Game design and code: *[Your Name]*
- All artwork drawn procedurally with the HTML5 Canvas 2D API
- No third-party libraries or assets used
