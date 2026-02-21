# Practice Game

The web interface now includes a practice subpage at `/practice`.

## Overview

The practice game is designed for an external keyboard and does **not** provide an on-screen keyboard.

Each round lasts 60 seconds:
- A random syllable is shown.
- You play the chord for that syllable.
- If the chord is wrong, the same syllable stays on screen until you play the correct chord.
- Your score increments only on correct chords.

Syllables are loaded from `generated_regexes.json` by enumerating each regex pattern into concrete syllables.

## Practice Modes

1. **Partial syllable, left hand**
2. **Partial syllable, right hand**
3. **Partial syllable, random hand** (left/right is randomized per prompt)
4. **Full syllable**

For all partial modes, `*` (spacebar) must be held for a valid chord.

## Leaderboards

Each mode has its own local leaderboard in `localStorage`:
- Key format: `v7.practice.leaderboard.<mode-id>`
- Stores top scores (descending)

## Controls

- Choose a mode from the dropdown.
- Press **Start 60s Game**.
- Use your steno layout keys to enter chords.
